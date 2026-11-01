/**
 * 开发期端到端验证：Wiki（原「条目库 + 杂物间」并成的一页）
 *
 * 覆盖：
 *   1. 导航与子页签：侧栏只剩一个 Wiki；三支默认落在「阅读」
 *   2. 目录（左栏）：按分类分组、每条都在、带状态、当前那条高亮
 *   3. 正文（中栏）：默认摊开第一条；导语、Markdown 正文（知识库排版）、分类与状态
 *   4. 信息栏（右栏）：本文目录、关联条目（两个方向分开）、没挂资料时不留空框
 *   5. 筛选与排序：关键词、状态、计数；三档排序都在**同一个分类组**里对账
 *      （目录按分类分组，排序只决定组内先后）
 *   6. 换一篇读：点目录切正文、给得出「返回」、退得回来
 *   7. 「挑过就锁定」：搜索/筛选不会把正在读的那篇挤走
 *   8. 结构化字段（定义过的 + 定义之外的旧键）与来源资料（挂在「灯塔守」上）
 *   9. 内链跳转：正文里点 [[名字]] 跳过去、能退回来、找不到要说话（不许静默）
 *  10. 子页：「编辑」支渲染出条目库（且**没有重复的页标题/工具栏**）、「杂物间」支渲染出速记条
 *  11. 地址栏：#entries / #pieces 落到对应子页，刷新后仍在那一支
 *  12. 无未捕获异常
 *
 * 前置：node server.mjs（默认 5188，需已构建最新 dist）
 * 用法：node .dev/e2e-wiki.mjs
 */
import { spawn } from 'node:child_process';
import { writeFileSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const CHROME = 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const APP_URL = 'http://127.0.0.1:5188/';
const OUT = '.shots/wiki';
const PORT = 9368;
const DB_VERSION = 5; // 要与 src/storage/indexeddb.ts 同步
const profile = mkdtempSync(join(tmpdir(), 'cdp-wiki-'));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const results = [];
const check = (name, ok, detail = '') => {
  results.push({ name, ok, detail });
  console.log(`  ${ok ? '✓' : '✗'} ${name}${detail ? ' — ' + detail : ''}`);
};

const chrome = spawn(
  CHROME,
  [
    '--headless=new',
    '--disable-gpu',
    '--no-sandbox',
    '--hide-scrollbars',
    '--no-first-run',
    '--disable-extensions',
    `--remote-debugging-port=${PORT}`,
    `--user-data-dir=${profile}`,
    '--window-size=1560,1000',
    'about:blank',
  ],
  { stdio: 'ignore' },
);

async function waitForDevtools() {
  for (let i = 0; i < 60; i++) {
    try {
      if ((await fetch(`http://127.0.0.1:${PORT}/json/version`)).ok) return;
    } catch {
      /* not ready */
    }
    await sleep(250);
  }
  throw new Error('DevTools 未就绪');
}

function makeClient(wsUrl) {
  const ws = new WebSocket(wsUrl);
  let id = 0;
  const pending = new Map();
  const events = [];
  const ready = new Promise((res, rej) => {
    ws.onopen = () => res();
    ws.onerror = () => rej(new Error('WebSocket 连接失败'));
  });
  ws.onmessage = (ev) => {
    const msg = JSON.parse(ev.data);
    if (msg.id && pending.has(msg.id)) {
      const { resolve, reject } = pending.get(msg.id);
      pending.delete(msg.id);
      msg.error ? reject(new Error(JSON.stringify(msg.error))) : resolve(msg.result);
    } else if (msg.method) {
      events.push(msg);
      if (msg.method === 'Page.javascriptDialogOpening') {
        ws.send(
          JSON.stringify({
            id: ++id,
            method: 'Page.handleJavaScriptDialog',
            params: { accept: true },
          }),
        );
      }
    }
  };
  const send = (method, params = {}) =>
    new Promise((resolve, reject) => {
      const mid = ++id;
      pending.set(mid, { resolve, reject });
      ws.send(JSON.stringify({ id: mid, method, params }));
    });
  return { ready, send, events };
}

async function main() {
  await waitForDevtools();
  const targets = await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json();
  const client = makeClient(targets.find((t) => t.type === 'page').webSocketDebuggerUrl);
  await client.ready;
  await client.send('Page.enable');
  await client.send('Runtime.enable');

  const evaluate = async (expression) => {
    const r = await client.send('Runtime.evaluate', {
      expression,
      returnByValue: true,
      awaitPromise: true,
    });
    if (r.exceptionDetails) {
      throw new Error('页面执行出错：' + JSON.stringify(r.exceptionDetails).slice(0, 300));
    }
    return r.result?.value;
  };
  const shot = async (path) => {
    const s = await client.send('Page.captureScreenshot', { format: 'png' });
    writeFileSync(path, Buffer.from(s.data, 'base64'));
    console.log('  截图 →', path);
  };
  const waitFor = async (expr, timeout = 20000, step = 300) => {
    const t0 = Date.now();
    while (Date.now() - t0 < timeout) {
      if (await evaluate(expr)) return true;
      await sleep(step);
    }
    return false;
  };
  /** 走 about:blank 中转，确保是真正的整页加载（直接改 hash 属于同文档跳转，不会重载） */
  const goto = async (url) => {
    await client.send('Page.navigate', { url: 'about:blank' });
    await sleep(300);
    await client.send('Page.navigate', { url });
  };
  const click = (role) =>
    evaluate(`(() => { const b = document.querySelector('[data-role="${role}"]');
      if (!b) return 'missing'; b.click(); return 'ok'; })()`);
  const setInput = (sel, value) =>
    evaluate(`(() => {
      const el = document.querySelector(${JSON.stringify(sel)});
      if (!el) return 'missing';
      const proto = el.tagName === 'TEXTAREA' ? window.HTMLTextAreaElement.prototype
                                              : window.HTMLInputElement.prototype;
      Object.getOwnPropertyDescriptor(proto, 'value').set.call(el, ${JSON.stringify(value)});
      el.dispatchEvent(new Event('input', { bubbles: true }));
      return 'ok';
    })()`);

  /** 左栏目录里列着的条目标题（DOM 顺序 = 分组顺序 = 组内是作者选的排序） */
  const navTitles = () =>
    evaluate(
      `[...document.querySelectorAll('[data-role="wiki-nav-item-title"]')].map((x) => x.textContent.trim())`,
    );
  /** 点目录里的某一条 —— 这是「换一篇读」的正常入口 */
  const openNav = (title) =>
    evaluate(`(() => {
      const b = [...document.querySelectorAll('[data-role="wiki-nav-item"]')].find(
        (x) => x.querySelector('[data-role="wiki-nav-item-title"]')?.textContent.trim() === ${JSON.stringify(title)});
      if (!b) return 'missing';
      b.click();
      return 'ok';
    })()`);
  /** 右边摊着的那一条的标题 */
  const artTitle = () =>
    evaluate(`document.querySelector('[data-role="wiki-art-title"]')?.textContent.trim() || ''`);
  const artText = () =>
    evaluate(`document.querySelector('[data-role="wiki-article"]')?.innerText || ''`);
  const toastText = () =>
    evaluate(
      `[...document.querySelectorAll('.toast')].map((x) => x.textContent.trim()).join(' | ')`,
    );
  const clickLink = (name) =>
    evaluate(`(() => {
      const w = [...document.querySelectorAll('[data-role="wiki-article"] .md .wl')]
        .find((x) => x.dataset.wl === ${JSON.stringify(name)});
      if (!w) return 'missing';
      w.click();
      return 'ok';
    })()`);
  /**
   * 某一组里列着的标题。
   *
   * 目录是**按分类分组**的，排序管的是**组内**顺序 —— 拿整个目录去跟全局序列对账，
   * 会被分组切得七零八落，看着特别像「排序没生效」。所以对账要一组一组来。
   */
  const groupOf = (name) =>
    evaluate(`(() => {
      const g = [...document.querySelectorAll('[data-role="wiki-nav-group"]')]
        .find((x) => (x.querySelector('.wk-nav-group-name')?.textContent || '').includes(${JSON.stringify(name)}));
      return g ? [...g.querySelectorAll('[data-role="wiki-nav-item-title"]')].map((x) => x.textContent.trim()) : [];
    })()`);

  /* ---------------- 0. 预置一个够测的世界 ---------------- */
  await client.send('Page.navigate', { url: APP_URL });
  await sleep(1500);

  const seeded = await evaluate(`(async () => {
    const open = indexedDB.open('worldforge', ${DB_VERSION});
    const db = await new Promise((res, rej) => {
      open.onupgradeneeded = () => {
        for (const n of ['worlds','categories','entries','relations','docs','review','drafts','pieces','ops','chats']) {
          if (!open.result.objectStoreNames.contains(n)) {
            const s = open.result.createObjectStore(n, { keyPath: 'id' });
            if (n !== 'worlds' && n !== 'drafts') s.createIndex('worldId', 'worldId', { unique: false });
          }
        }
      };
      open.onsuccess = () => res(open.result);
      open.onerror = () => rej(open.error);
    });
    const t = ${Date.now()};
    const H = 3600 * 1000;
    const wid = 'wd_wiki';
    const world = { id: wid, name: 'Wiki 测试世界', tagline: '知识库版式验证',
      summary: '## 概览\\n\\n用来验证 Wiki 这一页。', genre: '测试', tone: '', themeColor: '#2f6fb0',
      createdAt: t, updatedAt: t };
    const cat = (id, name, icon, order) => ({ id, worldId: wid, name, icon, fieldDefs: [], order, createdAt: t, updatedAt: t });
    const cats = [
      cat('ct_ppl', '人物', '👤', 0),
      cat('ct_geo', '地理', '🗺️', 1),
      cat('ct_org', '势力', '🏛️', 2),
      cat('ct_tool', '器物', '⚙️', 3),
    ];
    // 「人物」定义了「年龄」这个结构化字段，用来验字段区
    cats[0].fieldDefs = [{ key: '年龄', label: '年龄' }];
    const mk = (id, c, title, summary, content, extra) => ({
      id, worldId: wid, categoryId: c, title, aliases: [], summary, content, tags: [],
      fields: {}, status: 'canon', sourceRefs: [], createdAt: t, updatedAt: t, ...extra });
    const entries = [
      mk('en_lighthouse', 'ct_ppl', '灯塔守', '北境最老的守塔人，认得每一块礁石。',
        '## 概览\\n\\n在北境[[灯塔]]上守了四十一年。他认得每一块礁石，也认得每一道裂缝。\\n\\n## 历史\\n\\n年轻时随[[灰袍教团]]北上。参见[[不存在的塔]]。\\n\\n## 未解\\n\\n他从不提自己为什么留下。',
        { aliases: ['老守', '守塔人'], tags: ['北境', '人物'],
          fields: { 年龄: '61', 旧称: '塔伯' }, sourceRefs: ['dc_1'], updatedAt: t - 1 * H }),
      // 地理组这四条是**排序的试验田**：「最近更新」与「关联最多」两档刻意排出不同顺序
      // （灯塔改得最旧、却牵连最多），否则两档碰巧一样，等于没验。
      mk('en_tower', 'ct_geo', '灯塔', '黑石砌的塔，九十九级台阶。',
        '## 概览\\n\\n黑石砌的塔。\\n\\n## 位置\\n\\n架在崖上。',
        { tags: ['北境'], updatedAt: t - 7 * H }),
      mk('en_bay', 'ct_geo', '静默湾', '北境唯一不结冰的湾。', '## 概览\\n\\n不结冰。',
        { updatedAt: t - 6 * H }),
      mk('en_tide', 'ct_geo', '涨潮纪', '北境使用的纪年法。',
        '## 概览\\n\\n以潮汐记年。\\n\\n## 历法\\n\\n一年十二汛。',
        { tags: ['纪年'], updatedAt: t - 5 * H }),
      mk('en_order', 'ct_org', '灰袍教团', '北上的苦修者结成的团体。', '## 概览\\n\\n苦修者。',
        { updatedAt: t - 5 * H }),
      mk('en_trough', 'ct_tool', '潮汐槽', '刻在崖壁上的水位刻度。', '## 概览\\n\\n一道刻痕。',
        { updatedAt: t - 6 * H }),
      mk('en_scrap', 'ct_geo', '残页', '', '## 概览\\n\\n只剩半句话。',
        { status: 'draft', updatedAt: t - 4 * H }),
    ];
    const rel = (id, from, to, type, note) => ({ id, worldId: wid, fromEntryId: from, toEntryId: to,
      type, note, status: 'canon', createdAt: t });
    // 「灯塔」故意做成枢纽（出 1 入 2）——「关联最多」那一档要能把它顶到第一
    const relations = [
      rel('rl_a', 'en_lighthouse', 'en_order', '隶属', '年轻时随教团北上'),
      rel('rl_b', 'en_tower', 'en_bay', '位于', ''),
      rel('rl_c', 'en_trough', 'en_tower', '位于', '刻在塔基'),
      rel('rl_d', 'en_tide', 'en_tower', '记载于', ''),
    ];
    const docs = [{ id: 'dc_1', worldId: wid, name: '北境旧志.txt', ext: 'txt', size: 1234,
      text: '北境旧志', parsed: false, addedAt: t }];
    const put = (store, items) => new Promise((res, rej) => {
      const tx = db.transaction(store, 'readwrite');
      items.forEach((i) => tx.objectStore(store).put(i));
      tx.oncomplete = () => res();
      tx.onerror = () => rej(tx.error);
    });
    await put('worlds', [world]);
    await put('categories', cats);
    await put('entries', entries);
    await put('relations', relations);
    await put('docs', docs);
    localStorage.setItem('worldforge:settings', JSON.stringify({
      ai: { provider: 'custom', baseUrl: 'http://127.0.0.1:5190/v1', apiKey: 'k', model: 'm',
            temperature: 0.8, contextLimit: 60, vision: true },
      activeWorldId: wid
    }));
    db.close();
    return 'seeded';
  })()`);
  check('预置测试世界（7 条条目 / 4 条关系 / 1 份资料）', seeded === 'seeded', seeded);

  /* ---------------- 1. 导航与子页签 ---------------- */
  await goto(APP_URL + '#wiki');
  const ready = await waitFor(`!!document.querySelector('[data-role="wiki-layout"]')`, 20000);
  check('Wiki 页面打开（三栏版式在）', ready);

  check(
    '侧栏只剩一个入口：条目库 / 杂物间 那两格没了',
    (await evaluate(`!document.querySelector('[data-role="nav-entries"]') &&
      !document.querySelector('[data-role="nav-pieces"]') &&
      !!document.querySelector('[data-role="nav-wiki"]')`)) === true,
  );
  check(
    '三个子页签都在，默认落在「阅读」',
    (await evaluate(`JSON.stringify({
      n: document.querySelectorAll('[data-role="wiki-tabs"] [data-role^="wiki-tab-"]').length,
      active: document.querySelector('[data-role="wiki-tab-display"]')?.classList.contains('active'),
      nav: !!document.querySelector('[data-role="wiki-nav"]'),
      art: !!document.querySelector('[data-role="wiki-article"]')
    })`)) === JSON.stringify({ n: 3, active: true, nav: true, art: true }),
  );
  check(
    '页标题是 Wiki，而且**没有**卡片墙',
    (await evaluate(`document.querySelector('.page-title')?.textContent.trim()`)) === 'Wiki' &&
      (await evaluate(`!document.querySelector('[data-role="wiki-card"]')`)) === true,
  );
  await shot(`${OUT}-1-read.png`);

  /* ---------------- 2. 左栏：目录 ---------------- */
  const titles = await navTitles();
  check('七条条目都在目录里', titles.length === 7, titles.join('、'));
  check(
    '目录按分类分组（人物 / 地理 / 势力 / 器物 各一组）',
    (await evaluate(`JSON.stringify(
      [...document.querySelectorAll('[data-role="wiki-nav-group"] .wk-nav-group-name')]
        .map((x) => x.textContent.trim()))`)).includes('人物') &&
      (await evaluate(`document.querySelectorAll('[data-role="wiki-nav-group"]').length`)) === 4,
    await evaluate(`[...document.querySelectorAll('.wk-nav-group-name')].map((x) => x.textContent.trim()).join('、')`),
  );
  check(
    '目录里那一组有几条，组头就写几条',
    (await evaluate(`JSON.stringify(
      [...document.querySelectorAll('[data-role="wiki-nav-group"]')].map((g) => ({
        name: g.querySelector('.wk-nav-group-name').textContent.trim().replace(/^[^\\s]+\\s/, ''),
        n: Number(g.querySelector('.wk-nav-group-n').textContent.trim()),
        real: g.querySelectorAll('[data-role="wiki-nav-item"]').length
      })).every((x) => x.n === x.real && x.real > 0))`)) === 'true',
  );
  check(
    '目录里带着状态（草稿那条能看出来）',
    (await evaluate(
      `document.querySelector('[data-role="wiki-nav-item"][data-entry-id="en_scrap"]')?.dataset.status`,
    )) === 'draft',
  );
  check(
    '当前正摊在右边的那一条，目录里高亮着',
    (await evaluate(
      `document.querySelector('[data-role="wiki-nav-item"].active')?.dataset.entryId`,
    )) === 'en_lighthouse',
  );
  check(
    '目录里显示别名（灯塔守又叫老守）',
    (await evaluate(
      `document.querySelector('[data-role="wiki-nav-item"][data-entry-id="en_lighthouse"] .wk-nav-item-alias')?.textContent || ''`,
    )).includes('老守'),
  );

  /* ---------------- 3. 中栏：正文（默认摊开第一条） ---------------- */
  check('一进来就摊开最近更新的那条（灯塔守）', (await artTitle()) === '灯塔守', await artTitle());
  const rText = await artText();
  check('导语用的是作者写的摘要', rText.includes('北境最老的守塔人，认得每一块礁石。'), rText.slice(0, 100));
  check(
    '正文按知识库排版渲染（.md.wiki + 分节标题）',
    // 正文里的 `## 概览` 落成 **h3** 而不是 h2：MarkdownView 把 `#` 留给了页面标题
    // （`renderMarkdown` 里 `level = h[1].length + 1`）。声明 h2 会永远红，而它红的样子
    // 很像「知识库排版没生效」—— 其实 `.md.wiki` 那套 h2/h3 都覆盖到了。
    (await evaluate(`JSON.stringify({
      cls: !!document.querySelector('[data-role="wiki-article"] .md.wiki'),
      heads: document.querySelectorAll('[data-role="wiki-article"] .md.wiki h3').length
    })`)) === JSON.stringify({ cls: true, heads: 3 }),
  );
  check(
    '正文顶上带着分类与状态',
    // `StatusPill` 渲染成 `<span class="pill {status}">已定稿</span>` —— 它没有
    // `data-status` 钩子（那个只在目录项上），所以这里按文案认。
    (await evaluate(`document.querySelector('[data-role="wiki-read-cat"]')?.textContent || ''`)).includes('人物') &&
      (await evaluate(`document.querySelector('[data-role="wiki-article"]')?.innerText || ''`)).includes('已定稿'),
  );

  /* ---------------- 4. 右栏：信息栏 ---------------- */
  check(
    '右栏列出了正文的小节（Markdown 被认出来了）',
    (await evaluate(`[...document.querySelectorAll('[data-role="wiki-outline"] li')]
      .map((x) => x.textContent.trim()).join('、')`)) === '概览、历史、未解',
    await evaluate(`[...document.querySelectorAll('[data-role="wiki-outline"] li')].map((x) => x.textContent.trim()).join('、')`),
  );
  check(
    '右栏的目录分出了层级（## 是一级，没有更深的就全是 level 2）',
    (await evaluate(`[...document.querySelectorAll('[data-role="wiki-outline"] li')]
      .every((x) => x.dataset.level === '2')`)) === true,
  );

  /* ---------------- 5. 筛选与排序 ---------------- */
  await setInput('[data-role="wiki-search"]', '礁石');
  await sleep(450);
  check('搜「礁石」目录只剩一条', JSON.stringify(await navTitles()) === JSON.stringify(['灯塔守']), (await navTitles()).join('、'));
  await setInput('[data-role="wiki-search"]', '');
  await sleep(450);
  check('清空搜索又回到七条', (await navTitles()).length === 7);

  await click('wiki-status-draft');
  await sleep(450);
  check(
    '切到「草稿」只剩草稿那条',
    JSON.stringify(await navTitles()) === JSON.stringify(['残页']),
    (await navTitles()).join('、'),
  );
  check(
    '计数行跟着变（共 1 条）',
    (await evaluate(`document.querySelector('[data-role="wiki-count"]')?.textContent || ''`)).includes('1'),
  );
  await click('wiki-status-all');
  await sleep(450);
  check('切回「全部」又是七条', (await navTitles()).length === 7);

  /*
   * 三档排序都在**地理组**里对账。
   *
   * 目录按分类分组，排序只决定组内先后 —— 同一条目在不同档下必须真的挪位置，
   * 否则「切了档」和「没切」看着一样。这四条刻意排成：最近更新 = 残页·涨潮纪·
   * 静默湾·灯塔，关联最多 = 灯塔·静默湾·涨潮纪·残页，按名字 = 残页·灯塔·
   * 静默湾·涨潮纪 —— 三套互不相同。
   */
  check(
    '默认按「最近更新」：地理组里最久没动的那条排在最后',
    JSON.stringify(await groupOf('地理')) === JSON.stringify(['残页', '涨潮纪', '静默湾', '灯塔']),
    (await groupOf('地理')).join('、'),
  );
  await click('wiki-sort-links');
  await sleep(450);
  check(
    '按「关联最多」：枢纽（灯塔，出 1 入 2）在它那一组排到第一',
    JSON.stringify(await groupOf('地理')) === JSON.stringify(['灯塔', '静默湾', '涨潮纪', '残页']),
    (await groupOf('地理')).join('、'),
  );
  await click('wiki-sort-title');
  await sleep(450);
  check(
    '按「按名字」：地理组又换了一套顺序（三档互不相同）',
    JSON.stringify(await groupOf('地理')) === JSON.stringify(['残页', '灯塔', '静默湾', '涨潮纪']),
    (await groupOf('地理')).join('、'),
  );
  check(
    '每一组内部都真的是按当前语言排的（拿浏览器自己的比较器逐组对账）',
    // 两边都要 JSON.stringify 成字符串再比 —— 拿数组字面量去 `===` 一个字符串恒为 false，
    // 那样这条断言会永远红，而它红的样子又很像「排序坏了」。
    (await evaluate(`JSON.stringify(
      [...document.querySelectorAll('[data-role="wiki-nav-group"]')].every((g) => {
        const items = [...g.querySelectorAll('[data-role="wiki-nav-item-title"]')].map((x) => x.textContent.trim());
        return JSON.stringify(items) === JSON.stringify([...items].sort((a, b) => a.localeCompare(b, 'zh-Hans-CN')));
      })
    )`)) === 'true',
    (await groupOf('地理')).join('、'),
  );
  await click('wiki-sort-updated');
  await sleep(450);

  /* ---------------- 6. 换一篇读 + 返回 ---------------- */
  check('点目录里的「潮汐槽」换一篇读', (await openNav('潮汐槽')) === 'ok');
  await sleep(500);
  check('右边换成了那一篇', (await artTitle()) === '潮汐槽', await artTitle());
  check(
    '目录里的高亮跟着挪过去',
    (await evaluate(
      `document.querySelector('[data-role="wiki-nav-item"].active')?.dataset.entryId`,
    )) === 'en_trough',
  );
  check(
    '换过之后给得出「返回上一条」',
    (await evaluate(`!!document.querySelector('[data-role="wiki-read-back"]')`)) === true,
  );
  await click('wiki-read-back');
  await sleep(500);
  check('点返回回到出发的那一条', (await artTitle()) === '灯塔守', await artTitle());

  /* ---------------- 7. 挑过就锁定：筛选不许把正在读的挤走 ---------------- */
  await setInput('[data-role="wiki-search"]', '残页');
  await sleep(450);
  check(
    '搜别的条目时，正在读的那篇不会自己跑掉',
    (await artTitle()) === '灯塔守' && JSON.stringify(await navTitles()) === JSON.stringify(['残页']),
    await artTitle(),
  );
  await setInput('[data-role="wiki-search"]', '');
  await sleep(450);

  /* ---------------- 8. 结构化字段与来源资料 ---------------- */
  await openNav('灯塔守');
  await sleep(500);
  const fields = await evaluate(`[...document.querySelectorAll('.wk-fields dt')].map((x) => x.textContent.trim()).join('、')`);
  check('分类里定义过的字段显示出来了', fields.includes('年龄'), fields);
  check('分类定义之外的旧字段也不丢（label 用键名）', fields.includes('旧称'), fields);
  check(
    // 「灯塔守」是唯一挂了 sourceRefs 的条目（['dc_1']）→ 来源资料该列在这里
    '来源资料列出来了（这条挂着一份 .txt）',
    (await evaluate(`document.querySelector('[data-role="wiki-sources"]')?.innerText || ''`)).includes('北境旧志.txt'),
    await evaluate(`document.querySelector('[data-role="wiki-sources"]')?.innerText || ''`),
  );
  await openNav('灯塔');
  await sleep(500);
  check(
    // 「灯塔」这条没挂任何资料（sourceRefs 是空的）—— 那一块该整块不渲染，
    // 而不是摆一个空标题在那儿让人以为「资料丢了」。
    '没有挂资料时，「来源」那一块不渲染（不留空框）',
    (await evaluate(`!document.querySelector('[data-role="wiki-sources"]')`)) === true,
  );
  const rels = await evaluate(`JSON.stringify(
    [...document.querySelectorAll('[data-role="wiki-related-item"]')]
      .map((x) => x.dataset.dir + ':' + x.innerText.replace(/\\s+/g, ' ').trim()))`);
  check(
    '关联条目三个方向分开记（出 1 / 入 2）',
    JSON.parse(rels).filter((s) => s.startsWith('out:')).length === 1 &&
      JSON.parse(rels).filter((s) => s.startsWith('in:')).length === 2,
    rels,
  );
  check(
    '对端名字对得上，且「本条目」出现在该在的那一侧',
    JSON.parse(rels).some((s) => s.startsWith('out:') && s.includes('本条目') && s.includes('静默湾')) &&
      JSON.parse(rels).some((s) => s.startsWith('in:') && s.includes('潮汐槽')) &&
      JSON.parse(rels).some((s) => s.startsWith('in:') && s.includes('涨潮纪')),
    rels,
  );
  await shot(`${OUT}-2-read.png`);

  /* ---------------- 9. 内链跳转 ---------------- */
  await openNav('灯塔守');
  await sleep(500);
  check('点正文里的 [[灰袍教团]] 跳过去', (await clickLink('灰袍教团')) === 'ok');
  await waitFor(`document.querySelector('[data-role="wiki-art-title"]')?.textContent.trim() === '灰袍教团'`, 6000);
  check('右边换成了目标条目', (await artTitle()) === '灰袍教团', await artTitle());
  await click('wiki-read-back');
  await sleep(500);
  check('点返回回到出发的那一条', (await artTitle()) === '灯塔守', await artTitle());

  const beforeToast = await toastText();
  check('点不存在的 [[不存在的塔]] 有反应（不是静默）', (await clickLink('不存在的塔')) === 'ok');
  await sleep(500);
  check(
    '它如实说「没有叫这个的条目」',
    (await toastText()).includes('不存在的塔') && (await toastText()) !== beforeToast,
    await toastText(),
  );

  /* ---------------- 10. 子页：编辑 / 杂物间 ---------------- */
  await click('wiki-tab-entries');
  await sleep(800);
  check(
    '「编辑」支渲染出了条目库（批量打磨按钮在）',
    (await evaluate(`!!document.querySelector('[data-role="entries-batch-toggle"]')`)) === true,
  );
  check(
    '嵌进来之后没有重复的页标题与工具栏',
    (await evaluate(`JSON.stringify({
      titles: document.querySelectorAll('.page-title').length,
      toolbars: document.querySelectorAll('.toolbar').length
    })`)) === JSON.stringify({ titles: 1, toolbars: 1 }),
    await evaluate(`document.querySelectorAll('.toolbar').length`),
  );
  check(
    '编辑支照样给得出操作按钮（新建条目还在）',
    (await evaluate(`!!document.querySelector('[data-role="entries-actions"]')`)) === true,
  );
  check('地址栏跟着变成 #entries', (await evaluate(`location.hash`)) === '#entries', await evaluate(`location.hash`));
  await shot(`${OUT}-3-entries.png`);

  await click('wiki-tab-pieces');
  await sleep(800);
  check(
    '「杂物间」支渲染出了速记条',
    (await evaluate(`!!document.querySelector('.pz-quick')`)) === true,
  );
  check(
    '那一支也留着「这里收什么」的说明（并进来之后不能丢）',
    (await evaluate(`!!document.querySelector('.wk-sub-hint')`)) === true,
  );
  check('地址栏变成 #pieces', (await evaluate(`location.hash`)) === '#pieces', await evaluate(`location.hash`));
  await shot(`${OUT}-4-pieces.png`);

  await click('wiki-tab-display');
  await sleep(800);
  check(
    '点回「阅读」又是三栏版式，地址栏回到 #wiki',
    (await evaluate(`location.hash`)) === '#wiki' && (await navTitles()).length === 7,
  );

  /* ---------------- 11. 地址栏别名与刷新 ---------------- */
  await goto(APP_URL + '#entries');
  check(
    '老地址 #entries 直接打开就落在「编辑」支',
    (await waitFor(`!!document.querySelector('[data-role="entries-batch-toggle"]')`, 15000)) &&
      (await evaluate(`document.querySelector('[data-role="wiki-tab-entries"]')?.classList.contains('active')`)) === true,
  );
  await client.send('Page.reload');
  await sleep(2400);
  check(
    '刷新之后还停在「编辑」支（子页各有各的地址，不会掉回阅读）',
    (await evaluate(`!!document.querySelector('[data-role="entries-batch-toggle"]') &&
      !document.querySelector('[data-role="wiki-layout"]')`)) === true,
  );

  await goto(APP_URL + '#pieces');
  check(
    '老地址 #pieces 直接打开就落在「杂物间」支',
    (await waitFor(`!!document.querySelector('.pz-quick')`, 15000)) &&
      (await evaluate(`document.querySelector('[data-role="wiki-tab-pieces"]')?.classList.contains('active')`)) === true,
  );

  /* ---------------- 12. 「编辑这条」要落到编辑支 ---------------- */
  await goto(APP_URL + '#wiki');
  await waitFor(`!!document.querySelector('[data-role="wiki-layout"]')`, 15000);
  await openNav('静默湾');
  await sleep(600);
  check('正文切到了静默湾', (await artTitle()) === '静默湾', await artTitle());
  await click('wiki-read-edit');
  await sleep(1000);
  check(
    '正文里点「编辑这条」→ 切到编辑支并把这条打开',
    (await evaluate(`document.querySelector('[data-role="wiki-tab-entries"]')?.classList.contains('active') &&
      !!document.querySelector('.modal')`)) === true,
    await evaluate(`document.querySelector('.modal')?.innerText?.slice(0, 40) || '(无弹窗)'`),
  );
  check(
    '打开的正是静默湾那一条（不是列表页）',
    (await evaluate(`document.querySelector('.modal')?.innerText || ''`)).includes('静默湾'),
  );
  await shot(`${OUT}-5-edit-this.png`);

  /* ---------------- 13. 没有未捕获异常 ---------------- */
  const errs = [];
  for (const e of client.events) {
    if (e.method === 'Runtime.exceptionThrown') {
      errs.push('EXCEPTION: ' + (e.params.exceptionDetails?.exception?.description ?? '').slice(0, 200));
    } else if (e.method === 'Runtime.consoleAPICalled' && e.params.type === 'error') {
      errs.push('CONSOLE: ' + e.params.args.map((a) => a.value ?? a.description).join(' ').slice(0, 200));
    }
  }
  check('运行期间没有未捕获异常 / 控制台报错', errs.length === 0, errs.slice(0, 3).join(' | '));

  chrome.kill();
  const failed = results.filter((r) => !r.ok);
  console.log(`\n结果：${results.length - failed.length}/${results.length} 通过`);
  if (failed.length) {
    console.log('失败项：', failed.map((f) => f.name).join('、'));
    process.exit(1);
  }
}

main().catch((e) => {
  console.error('验证脚本异常：', e);
  chrome.kill();
  process.exit(1);
});
