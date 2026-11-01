/**
 * 开发期端到端验证：**一致性检查跑完真的会出结果**（以及关系推荐同样的路径）。
 *
 * 为什么要有这一条：
 * 每条 AI 任务的提示词都写明了返回形状（一致性检查 `{"issues": [...]}`、
 * 关系推荐 `{"relations": [...]}`），而 `asArray` 曾经只认一份硬编码的白名单，
 * 名单里没有这两个键 —— 于是**整份结果被静默丢空**，界面上的表现是一句
 * 「没有发现明显的设定冲突」。sweep 只检查页面能不能渲染、从不点按钮，
 * 所以这条路径一直没被任何脚本覆盖。
 *
 * 本脚本同时盯住三件事：
 *   1. 正常返回 → 问题真的出现在页面上、真的进了审查队列、能据此生成修订；
 *   2. 关系推荐（同一个根因）→ 推荐的关系真的进得了审查队列；
 *   3. 「模型答非所问」→ 必须报「没读懂」，**不许**冒充「没有问题」。
 *
 * 前置：
 *   npx vite build                 （e2e 跑的是构建产物）
 *   node server.mjs                （5188）
 *   node .dev/mock-upstream.mjs 5190
 * 用法：node .dev/e2e-consist.mjs
 */
import { spawn } from 'node:child_process';
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const CHROME = 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const APP_URL = process.env.APP_URL || 'http://127.0.0.1:5188/';
const MOCK_BASE = process.env.MOCK_URL || 'http://127.0.0.1:5190/v1';
const MOCK_ORIGIN = new URL(MOCK_BASE).origin;
const OUT = '.shots/consist';
const PORT = 9382;
const profile = mkdtempSync(join(tmpdir(), 'cdp-consist-'));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** 拖慢回包，好在「正在审计」那一刻断言按钮与侧栏动画 */
const SLOW_MS = 700;

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
    } else if (msg.method === 'Page.javascriptDialogOpening') {
      ws.send(
        JSON.stringify({ id: ++id, method: 'Page.handleJavaScriptDialog', params: { accept: true } }),
      );
    } else if (msg.method) {
      events.push(msg);
    }
  };
  const send = (method, params = {}) =>
    new Promise((resolve, reject) => {
      const mid = ++id;
      pending.set(mid, { resolve, reject });
      ws.send(JSON.stringify({ id: mid, method, params }));
    });
  return { ready, send, events, close: () => ws.close() };
}

/**
 * 预置：一个世界 + 四条条目。
 * 条目标题是**特意**挑的 —— 假上游的一致性分支指向「烬落盆地」，
 * 关系分支给出「匠人同盟 → 烬石」（能对上）与「余烬教团 → 北方灰原」（对不上），
 * 这样两边的结果条数都是确定的。
 */
const SEED = (worldName) => `(async () => {
  try {
    const open = indexedDB.open('worldforge', 5);
    const db = await new Promise((res, rej) => {
      open.onsuccess = () => res(open.result);
      open.onerror = () => rej(open.error);
    });
    const t = Date.now();
    const wid = 'wd_con';
    const world = { id: wid, name: ${JSON.stringify(worldName)}, tagline: '海面每年上涨三尺',
      summary: '## 概览\\n\\n海水不可逆地上涨，沿海城邦逐年内迁。', genre: '低魔海洋',
      tone: '冷峻', themeColor: '#0e7c8a', createdAt: t, updatedAt: t };
    const cat = { id: 'ct_geo', worldId: wid, name: '地理', icon: '🗺️', fieldDefs: [], order: 0, createdAt: t, updatedAt: t };
    const mk = (id, title, sum) => ({ id, worldId: wid, categoryId: 'ct_geo', title, aliases: [], summary: sum,
      content: '## 概览\\n\\n' + sum, tags: [], fields: {}, status: 'canon', sourceRefs: [], createdAt: t, updatedAt: t });
    const put = (store, items) => new Promise((res, rej) => {
      const tx = db.transaction(store, 'readwrite');
      items.forEach((i) => tx.objectStore(store).put(i));
      tx.oncomplete = () => res();
      tx.onerror = () => rej(tx.error);
    });
    await put('worlds', [world]);
    await put('categories', [cat]);
    await put('entries', [
      mk('en_tide', '涨潮纪', '以海面第一次上涨为元年的历法'),
      mk('en_basin', '烬落盆地', '内陆盆地，人口密集，靠烬石开采为生'),
      mk('en_guild', '匠人同盟', '以烬石锻造为业的行会'),
      mk('en_ember', '烬石', '可燃烧的矿石，是城邦唯一的能源'),
    ]);
    localStorage.setItem('worldforge:settings', JSON.stringify({
      ai: { provider: 'custom', baseUrl: '${MOCK_BASE}', apiKey: 'k', model: 'm',
            temperature: 0.8, contextLimit: 60, vision: true },
      activeWorldId: wid
    }));
    db.close();
    return 'seeded';
  } catch (e) {
    return 'seed-failed: ' + (e && e.message);
  }
})()`;

async function main() {
  await waitForDevtools();
  const targets = await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json();
  const client = makeClient(targets.find((t) => t.type === 'page').webSocketDebuggerUrl);
  await client.ready;
  await client.send('Page.enable');
  await client.send('Runtime.enable');
  await client.send('Log.enable').catch(() => {});

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
    mkdirSync('.shots', { recursive: true });
    writeFileSync(path, Buffer.from(s.data, 'base64'));
  };
  const waitFor = async (expr, timeout = 20000) => {
    const t0 = Date.now();
    while (Date.now() - t0 < timeout) {
      try {
        if (await evaluate(expr)) return true;
      } catch {
        /* 导航中可能短暂取不到 */
      }
      await sleep(120);
    }
    return false;
  };
  const goRoute = async (key) => {
    // 条目库并进 Wiki 之后不再单独占一格导航：`entries` 先点 Wiki、再点「编辑」子页签
    const sub = key === 'entries' || key === 'pieces' ? key : null;
    await evaluate(`document.querySelector('[data-role=nav-${sub ? 'wiki' : key}]').click(); 'go'`);
    if (sub) await evaluate(`document.querySelector('[data-role=wiki-tab-${sub}]').click(); 'go'`);
    await sleep(350);
  };
  const readStore = (store) =>
    evaluate(`(async () => {
      const open = indexedDB.open('worldforge', 5);
      const db = await new Promise((res, rej) => {
        open.onsuccess = () => res(open.result);
        open.onerror = () => rej(open.error);
      });
      const all = await new Promise((res, rej) => {
        const r = db.transaction('${store}', 'readonly').objectStore('${store}').getAll();
        r.onsuccess = () => res(r.result);
        r.onerror = () => rej(r.error);
      });
      db.close();
      return JSON.stringify(all);
    })()`);
  const review = async () => JSON.parse(await readStore('review'));

  /**
   * 等库里的东西真的变了。
   *
   * 有些动作（生成修订、忽略一条问题）在界面上是**卡片当场消失** —— 默认只看待处理的列表里它没了，
   * 再拿「卡片还在不在」当完成条件就永远等不到。库里的状态才是事实。
   */
  const waitReview = async (pred, timeout = 30000) => {
    const t0 = Date.now();
    while (Date.now() - t0 < timeout) {
      try {
        if (pred(await review())) return true;
      } catch {
        /* 导航中可能短暂取不到 */
      }
      await sleep(150);
    }
    return false;
  };

  /** 重载页面并回到一致性页 —— 内存里的库要重新从 IndexedDB 读一遍 */
  const reloadApp = async () => {
    await client.send('Page.reload');
    await sleep(2000);
    await evaluate(`location.hash = 'consistency'; 'x'`);
    await sleep(800);
  };

  /** 改世界名 —— 假上游的一致性分支靠世界名里的触发词分派（见 .dev/mock-upstream.mjs） */
  const renameWorld = async (name) => {
    await evaluate(`(async () => {
      const open = indexedDB.open('worldforge', 5);
      const db = await new Promise((res) => { open.onsuccess = () => res(open.result); });
      const tx = db.transaction('worlds', 'readwrite');
      const st = tx.objectStore('worlds');
      const w = await new Promise((res) => { const r = st.get('wd_con'); r.onsuccess = () => res(r.result); });
      w.name = ${JSON.stringify(name)};
      st.put(w);
      await new Promise((res) => { tx.oncomplete = res; });
      db.close();
      return 'renamed';
    })()`);
    await reloadApp();
  };

  /** 清空整张审查表 —— 有一节要从一张白纸开始，才数得清「这一轮到底新增了几条」 */
  const clearReviewStore = () =>
    evaluate(`(async () => {
      const open = indexedDB.open('worldforge', 5);
      const db = await new Promise((res) => { open.onsuccess = () => res(open.result); });
      const tx = db.transaction('review', 'readwrite');
      tx.objectStore('review').clear();
      await new Promise((res) => { tx.oncomplete = res; });
      db.close();
      return 'cleared';
    })()`);

  const auditOnce = async () => {
    await evaluate(`document.querySelector('[data-role=consist-audit]').click(); 'go'`);
    await waitFor(`!document.querySelector('[data-role=consist-audit] .spinner')`, 30000);
    await sleep(400);
    return evaluate(`document.querySelector('[data-role=consist-audit-result]')?.innerText || ''`);
  };

  /* ---------------- 0. 预置 + 拖慢假上游 ---------------- */
  await fetch(`${MOCK_ORIGIN}/__mock-stats/reset`).catch(() => {});
  await fetch(`${MOCK_ORIGIN}/__mock-delay?ms=${SLOW_MS}`).catch(() => {});

  await client.send('Page.navigate', { url: APP_URL });
  await sleep(1800);
  check('预置测试世界（含四条可对上的条目）', (await evaluate(SEED('一致性测试世界'))) === 'seeded');

  // 预置走的是 localStorage，而应用**已经加载过了** —— 内存里那份还是旧的。
  // 注意 `Page.navigate` 到只差 hash 的 URL 属于同文档导航、根本不会重载，必须用 reload。
  await client.send('Page.reload');
  await sleep(2000);
  await evaluate(`location.hash = 'consistency'; 'x'`);
  await sleep(800);

  /* ---------------- 1. 初始状态 ---------------- */
  check(
    '一致性页渲染出来了',
    (await evaluate(`document.querySelector('.page-title')?.textContent`)) === '一致性检查',
  );
  check('一开始没有问题卡片', (await evaluate(`document.querySelectorAll('[data-role=consist-issue]').length`)) === 0);
  check('一开始是空态（而不是一张空列表）', await evaluate(`!!document.querySelector('.empty')`));

  /* ---------------- 2. 点「开始审计」 ---------------- */
  await evaluate(`document.querySelector('[data-role=consist-audit]').click(); 'go'`);
  await sleep(250);
  check(
    '点了之后按钮进入「审计中…」并转圈',
    await evaluate(
      `(document.querySelector('[data-role=consist-audit]')?.textContent || '').includes('审计中')` +
        ` && !!document.querySelector('[data-role=consist-audit] .spinner')`,
    ),
  );
  check(
    '侧栏「一致性检查」那一格出现工作动画',
    await evaluate(`!!document.querySelector('[data-role=nav-consistency] [data-role=nav-working]')`),
  );

  const done = await waitFor(`!document.querySelector('[data-role=consist-audit] .spinner')`, 30000);
  check('审计跑完了', done);

  /* ---------------- 3. 结果真的出现在页面上 ---------------- */
  const cardCount = await evaluate(`document.querySelectorAll('[data-role=consist-issue]').length`);
  check('页面上出现了 1 条问题卡片（不再是一片空白）', cardCount === 1, `实际 ${cardCount} 张`);

  const cardText = await evaluate(
    `document.querySelector('[data-role=consist-issue]')?.innerText || ''`,
  );
  check('卡片标题是模型给的那条', cardText.includes('烬石储量与城邦规模不匹配'));
  check('卡片带出了冲突说明', cardText.includes('人口规模需要远超'));
  check('卡片带出了修改建议', cardText.includes('补充一条地下深层矿脉'));
  check('卡片能点回相关条目', cardText.includes('烬落盆地'));

  const stat = (key) =>
    evaluate(
      `document.querySelector('[data-role=consist-stat][data-key=${key}] .stat-num')?.textContent`,
    );
  check('统计：中风险 1 条', (await stat('medium')) === '1', `实际 ${await stat('medium')}`);
  check('统计：高风险 0 条', (await stat('high')) === '0');

  await shot(`${OUT}-1-found.png`);

  /* ---------------- 4. 结果真的进了审查队列 ---------------- */
  let items = await review();
  const consistItems = items.filter((r) => r.kind === 'consistency');
  check('库里也落了这条问题（不只是页面上好看）', consistItems.length === 1, `kind=consistency ${consistItems.length} 条`);
  check('落库的问题带着待处理状态', consistItems[0]?.status === 'pending');
  check(
    '侧栏「审查队列」徽标变成 1',
    (await evaluate(`document.querySelector('[data-role=nav-review] .nav-badge')?.textContent`)) === '1',
  );

  /* ---------------- 5. 据此生成修订 → 又进一次审查 ---------------- */
  await evaluate(`document.querySelector('[data-role=consist-fix]').click(); 'go'`);
  // 生成成功的那一刻这条问题就被标成已处理了 —— 默认「只看待处理」的列表里它会当场消失。
  // 所以这里盯的是**库里真的多了一条修订**，不是那张卡片还在不在。
  const fixDone = await waitReview(
    (all) => all.some((r) => r.kind === 'update-entry' && r.targetEntryId === 'en_basin'),
    30000,
  );
  await sleep(400);
  items = await review();
  const updates = items.filter((r) => r.kind === 'update-entry');
  check('「据此修订」生成了修订建议', fixDone && updates.length === 1, `update-entry ${updates.length} 条`);
  check(
    '修订建议挂在那条相关条目上',
    !!updates[0]?.targetEntryId,
    updates[0]?.targetEntryId ?? '(无)',
  );
  check(
    '原问题被标记为已处理',
    (await review()).find((r) => r.id === consistItems[0]?.id)?.status === 'accepted',
  );
  check('统计：已处理 1 条', (await stat('handled')) === '1', `实际 ${await stat('handled')}`);

  /* ---------------- 5b. 处理掉的不再占着视线 ---------------- */
  // 已判定的和待处理的长得一样、混在一个列表里，是「怎么老这几条」的一半来源
  check(
    '处理掉的那条从「待处理」里消失了',
    (await evaluate(`document.querySelectorAll('[data-role=consist-issue]').length`)) === 0,
  );
  await evaluate(`document.querySelector('[data-role=consist-filter-all]').click(); 'go'`);
  await sleep(300);
  check(
    '切到「全部」还能回看它（历史没被抹掉）',
    (await evaluate(`document.querySelectorAll('[data-role=consist-issue]').length`)) === 1,
  );
  const filterLabels = await evaluate(
    `[...document.querySelectorAll('[data-role=consist-filter] .btn')].map((b) => b.innerText).join(' | ')`,
  );
  check('两个筛选口都报了条数', /待处理 0/.test(filterLabels) && /全部 1/.test(filterLabels), filterLabels);
  await evaluate(`document.querySelector('[data-role=consist-filter-pending]').click(); 'go'`);
  await sleep(200);
  check(
    '切回「待处理」时是「清空了」而不是「还没有审计记录」',
    (await evaluate(`document.querySelector('.empty')?.innerText || ''`)).includes('待处理的问题清空了'),
  );

  /* ---------------- 6. 关系推荐：同一个根因的另一处 ---------------- */
  await goRoute('graph');
  await waitFor(`!!document.querySelector('[data-role=graph-ai-recommend]')`, 20000);
  const beforeRel = (await review()).length;
  await evaluate(`document.querySelector('[data-role=graph-ai-recommend]').click(); 'go'`);
  const relDone = await waitFor(
    `!document.querySelector('[data-role=graph-ai-recommend] .spinner')`,
    30000,
  );
  await sleep(700);
  const afterRel = await review();
  const newRels = afterRel.slice(beforeRel);
  check('关系推荐跑完了', relDone);
  check(
    '推荐出来的关系进了审查队列（`relations` 键同样被认）',
    newRels.some((r) => r.kind === 'relation'),
    `新增 ${newRels.length} 条：${newRels.map((r) => r.title).join('、') || '（无）'}`,
  );
  check(
    '能对上的那一条关系落在了正确两端',
    newRels.some((r) => r.kind === 'relation' && !!r.relationDraft?.fromEntryId && !!r.relationDraft?.toEntryId),
  );
  await shot(`${OUT}-2-relations.png`);

  /* ---------------- 7. 全部生成修订方案（多条问题一次摆平） ---------------- */
  // 换个世界名，让假上游改走「一次出好几条」那条分支（触发词写在世界名里）
  await evaluate(`(async () => {
    const open = indexedDB.open('worldforge', 5);
    const db = await new Promise((res) => { open.onsuccess = () => res(open.result); });
    const tx = db.transaction('worlds', 'readwrite');
    const st = tx.objectStore('worlds');
    const w = await new Promise((res) => { const r = st.get('wd_con'); r.onsuccess = () => res(r.result); });
    w.name = '多修订标记世界';
    st.put(w);
    await new Promise((res) => { tx.oncomplete = res; });
    db.close();
    return 'renamed';
  })()`);
  // 放慢一点，好抓到「正在逐条生成」那一刻，也够时间切页再切回来
  await fetch(`${MOCK_ORIGIN}/__mock-delay?ms=1200`).catch(() => {});
  await client.send('Page.reload');
  await sleep(2000);
  await evaluate(`location.hash = 'consistency'; 'x'`);
  await sleep(800);

  await evaluate(`document.querySelector('[data-role=consist-audit]').click(); 'go'`);
  await waitFor(`!document.querySelector('[data-role=consist-audit] .spinner')`, 30000);
  await sleep(400);

  // 5 条是这一轮新报的；上一节那条已经判过、退出了待处理列表（切「全部」才看得见）
  const cards = await evaluate(`document.querySelectorAll('[data-role=consist-issue]').length`);
  check('一次审计出的多条问题都摆出来了', cards === 5, `实际 ${cards} 张`);

  const barTitle = await evaluate(
    `document.querySelector('[data-role=consist-fixall-title]')?.innerText || ''`,
  );
  check('出现了「全部生成修订方案」的入口', barTitle.includes('2 条问题'), barTitle);
  const barText = await evaluate(
    `document.querySelector('[data-role=consist-fixall-bar]')?.innerText || ''`,
  );
  check('横幅说清了「同一个条目上的多条会合并成一条修订」', barText.includes('合并成一条修订'));
  const barHeld = await evaluate(
    `document.querySelector('[data-role=consist-fixall-held]')?.innerText || ''`,
  );
  check('横幅提前说清了「已有待审修订的条目这次先放过」', barHeld.includes('1 条问题'), barHeld);

  const beforeFixAll = new Set((await review()).map((r) => r.id));
  await evaluate(`document.querySelector('[data-role=consist-fixall]').click(); 'go'`);

  const sawProgress = await waitFor(
    `!!document.querySelector('[data-role=consist-fixall-progress]')`,
    8000,
  );
  check('跑起来有进度（不是只有一个转圈）', sawProgress);
  const progText = await evaluate(
    `document.querySelector('[data-role=consist-fixall-progress-text]')?.innerText || ''`,
  );
  check('进度说出了「第几条 / 共几条 · 在改谁」', /^1\/2 · \S/.test(progText.trim()), progText.trim());
  await shot(`${OUT}-4-fixall-progress.png`);

  // 跑着的时候切走：任务活在全局任务槽里，不该被打断
  await goRoute('entries');
  check(
    '跑着的时候能切到别的页面',
    await evaluate(`!!document.querySelector('[data-role=entries-batch-toggle]')`),
  );
  check(
    '切走之后侧栏「一致性检查」那格还在转（它在别处继续跑）',
    await waitFor(`!!document.querySelector('[data-role=nav-consistency] [data-role=nav-working]')`, 8000),
  );
  const finishedElsewhere = await waitFor(
    `!document.querySelector('[data-role=nav-consistency] [data-role=nav-working]')`,
    40000,
  );
  check('在别处也能看到它跑完', finishedElsewhere);

  // 切回来：结果必须还在。结果得**显式**存进全局任务槽，不存的话切走就白跑了
  await goRoute('consistency');
  check('切回来结果卡还在', await waitFor(`!!document.querySelector('[data-role=consist-fixall-result]')`, 6000));
  const resultText = await evaluate(
    `document.querySelector('[data-role=consist-fixall-result]')?.innerText || ''`,
  );
  check(
    '结果卡报出「已生成 2 条修订方案」',
    resultText.includes('已生成 2 条'),
    resultText.slice(0, 140).replace(/\n/g, ' / '),
  );
  check('结果卡说清了合并掉的那几条', resultText.includes('并进同一条修订'));
  check('结果卡说清了被先放过的那条', resultText.includes('先放过'));
  check('结果卡说清了生成不了的那条', resultText.includes('找不到可改的条目'));
  check('没有失败项', !resultText.includes('没生成成功'));
  await shot(`${OUT}-5-fixall-result.png`);

  /* ---------------- 8. 合并到底有没有把问题吃掉 ---------------- */
  const fresh = (await review()).filter((r) => !beforeFixAll.has(r.id));
  const recs = fresh.filter((r) => r.kind === 'update-entry');
  check(
    '两条修订都进了审查队列',
    recs.length === 2,
    `实际 ${recs.length} 条：${recs.map((r) => r.title).join('、') || '（无）'}`,
  );
  check(
    '两条修订是同一批（审查页据此归到一起）',
    new Set(recs.map((r) => r.batchId)).size === 1 && !!recs[0]?.batchId,
  );

  const guild = recs.filter((r) => r.targetEntryId === 'en_guild');
  const ember = recs.filter((r) => r.targetEntryId === 'en_ember');
  check('匠人同盟上只摆了一条修订（同一目标不叠两份）', guild.length === 1, `实际 ${guild.length} 条`);
  const guildBody = guild[0]?.entryDraft?.content ?? '';
  check('同一个条目上的两条问题是被**合并**进同一次请求的', guildBody.includes('成立年份与涨潮纪对不上'));
  check('合并没有把另一条问题吃掉', guildBody.includes('同盟的成员数两处打架'));
  check(
    '另一个条目上单独生成了一条',
    ember.length === 1 && (ember[0]?.entryDraft?.content ?? '').includes('燃烧温度前后不一'),
  );

  const issuesAfter = (await review()).filter((r) => r.kind === 'consistency');
  const stillPending = issuesAfter.filter((i) => i.status === 'pending');
  check(
    '处理掉的问题都被标记成已处理（不在页面上重复挂着）',
    stillPending.length === 2,
    `待处理 ${stillPending.length} 条：${stillPending.map((i) => i.title).join('、')}`,
  );
  check(
    '生成不了修订的那条如实留在待处理里',
    stillPending.some((i) => i.title.includes('灰烬议会')),
    stillPending.map((i) => i.title).join('、'),
  );
  check(
    '被先放过的那条也留在待处理里（没有悄悄消失）',
    stillPending.some((i) => i.title.includes('烬落盆地')),
  );

  /* ---------------- 9. 批头整批采纳 ---------------- */
  await goRoute('review');
  const batchCount = await evaluate(
    `document.querySelector('[data-role=review-batch-count]')?.innerText || ''`,
  );
  check('审查页把这两条归成了同一批', batchCount.includes('2 条'), batchCount);
  await evaluate(`document.querySelector('[data-role=review-batch-accept]').click(); 'go'`);
  await sleep(1400);
  const emberAfter = JSON.parse(await readStore('entries')).find((e) => e.id === 'en_ember');
  check('整批采纳之后正文真的变了', (emberAfter?.content ?? '').includes('燃烧温度前后不一'));

  const statsFix = await (await fetch(`${MOCK_ORIGIN}/__mock-stats`)).json();
  check(
    '合并版请求真的发出去了（不是逐条发的）',
    (statsFix.byBranch['expand-many'] ?? 0) >= 1,
    JSON.stringify(statsFix.byBranch),
  );
  // 把延迟调回去，别拖长后面那一段
  await fetch(`${MOCK_ORIGIN}/__mock-delay?ms=${SLOW_MS}`).catch(() => {});

  /* ---------------- 10. 答非所问：不许冒充「没有问题」 ---------------- */
  // 换个世界名，让假上游走「能解析、但没有列表」那条分支
  await evaluate(`(async () => {
    const open = indexedDB.open('worldforge', 5);
    const db = await new Promise((res) => { open.onsuccess = () => res(open.result); });
    const tx = db.transaction('worlds', 'readwrite');
    const st = tx.objectStore('worlds');
    const w = await new Promise((res) => { const r = st.get('wd_con'); r.onsuccess = () => res(r.result); });
    w.name = '畸形返回测试世界';
    st.put(w);
    await new Promise((res) => { tx.oncomplete = res; });
    db.close();
    return 'renamed';
  })()`);
  await client.send('Page.reload');
  await sleep(2000);
  await evaluate(`location.hash = 'consistency'; 'x'`);
  await sleep(800);

  const beforeBad = (await review()).length;
  await evaluate(`document.querySelector('[data-role=consist-audit]').click(); 'go'`);
  const errShown = await waitFor(`!!document.querySelector('.toast.error')`, 30000);
  check('模型答非所问时报了错（而不是替它宣布「没有问题」）', errShown);
  const errText = await evaluate(
    `[...document.querySelectorAll('.toast.error')].map((x) => x.textContent).join(' | ')`,
  );
  check('报错说明了是「返回形状对不上」', errText.includes('形状对不上'), errText.slice(0, 80));
  check(
    '没有出现「没有发现问题」的成功提示',
    !(await evaluate(
      `[...document.querySelectorAll('.toast.success')].map((x) => x.textContent).join(' | ')`,
    )).includes('没有发现'),
  );
  check(
    '这次没有往审查队列里塞任何东西',
    (await review()).length === beforeBad,
    `${beforeBad} → ${(await review()).length}`,
  );
  await shot(`${OUT}-3-shape-mismatch.png`);

  /* ---------------- 11. 账本：报过的老问题不再来第二遍 ----------------
   *
   * 这一节验的是作者抱怨的那件事：「每次查冲突都是那几条」。
   * 根子在于审计原先**没有记忆** —— 作者判过、忽略过的，下一轮原样回来。
   *
   * 做法是让假上游**只在看到账本块时才改口**（见 mock 里的 consistency-ledger-* 两条分支）：
   * 少一块【已审账本】，路由就掉回老分支、照样回那条固定问题，下面这些断言会全挂。
   * 所以这些断言同时证明了「账本真的进了提示词」—— 不只是界面上显示了什么。
   */
  await renameWorld('一致性测试世界');
  // 清表之后必须**再重载一次**：内存里那份还是旧的，页面上会继续摆着已经删掉的卡片
  await clearReviewStore();
  await reloadApp();
  check(
    '清空之后回到空态',
    (await evaluate(`document.querySelectorAll('[data-role=consist-issue]').length`)) === 0,
  );
  check(
    '范围横幅提前讲明「还没有账本」',
    (await evaluate(
      `document.querySelector('[data-role=consist-scope-ledger]')?.innerText || ''`,
    )).includes('还没有账本'),
  );

  const firstAudit = await auditOnce();
  check(
    '首次审计如实说「新增 1 条」',
    firstAudit.includes('本轮新增 1 条问题'),
    firstAudit.slice(0, 90).replace(/\n/g, ' / '),
  );
  check(
    '账本是空的，所以结果卡里没有账本那一行',
    !(await evaluate(`!!document.querySelector('[data-role=consist-audit-ledger]')`)),
  );

  // 作者把这条判成「不是问题」忽略掉 —— 这个动作必须回流到下一轮
  await evaluate(`document.querySelector('[data-role=consist-ignore]').click(); 'go'`);
  const ignored = await waitReview((all) => all.some((r) => r.status === 'rejected'));
  check('忽略成功了', ignored);
  await sleep(300);

  /* --- 第二轮：假上游看到账本 → 按纪律返回空列表 --- */
  await renameWorld('账本静默标记世界');
  const beforeSilent = (await review()).length;
  const silent = await auditOnce();
  check(
    '第二轮如实说「本轮没有新问题」（而不是装成一次有收获的检查）',
    silent.includes('本轮没有新问题'),
    silent.slice(0, 90).replace(/\n/g, ' / '),
  );
  check(
    '结果卡交代了账本里有多少条、各是什么状态',
    silent.includes('待处理 0') && silent.includes('已判定 1'),
    silent.slice(0, 200).replace(/\n/g, ' / '),
  );
  check(
    '并说清了「压在账本上」这件事 —— 不处理掉，下一轮还是同样的结果',
    silent.includes('还压着'),
    silent.slice(0, 260).replace(/\n/g, ' / '),
  );
  check(
    '这一刻库里一条都没多',
    (await review()).length === beforeSilent,
    `${beforeSilent} → ${(await review()).length}`,
  );
  await shot(`${OUT}-6-ledger-clean.png`);

  /* --- 第三轮：模型不听话，把老账又报了一遍（外加一条真新的）--- */
  await renameWorld('账本漏网标记世界');
  const beforeLeak = (await review()).length;
  const leak = await auditOnce();
  check(
    '模型又报了一遍老账，界面仍如实说「新增 1 条」',
    leak.includes('本轮新增 1 条问题'),
    leak.slice(0, 90).replace(/\n/g, ' / '),
  );
  check(
    '并把拦下的那条**点名**说出来（不是闷掉）',
    leak.includes('烬石储量与城邦规模不匹配') && leak.includes('已按账本拦下'),
    leak.slice(0, 220).replace(/\n/g, ' / '),
  );

  const afterLeak = await review();
  check(
    '库里只多了一条（重复的那条真的没进去）',
    afterLeak.length === beforeLeak + 1,
    `${beforeLeak} → ${afterLeak.length}`,
  );
  check(
    '进来的是那条新问题',
    afterLeak.filter((r) => r.kind === 'consistency' && r.title.includes('涨潮纪的纪年起点两处不一'))
      .length === 1,
    afterLeak.map((r) => r.title).join('、'),
  );
  check(
    '那条被忽略的老账没有被塞回库里（只有原来那一条）',
    afterLeak.filter((r) => r.title.includes('烬石储量与城邦规模不匹配')).length === 1,
  );
  check(
    '页面上只摆了那条新的（老账没有卷土重来）',
    (await evaluate(`document.querySelectorAll('[data-role=consist-issue]').length`)) === 1,
  );

  await shot(`${OUT}-7-ledger-leak.png`);

  const statsLedger = await (await fetch(`${MOCK_ORIGIN}/__mock-stats`)).json();
  check(
    '账本真的进了提示词（假上游只在看到账本块时才走这两条分支）',
    (statsLedger.byBranch['consistency-ledger-silent'] ?? 0) >= 1 &&
      (statsLedger.byBranch['consistency-ledger-leak'] ?? 0) >= 1,
    JSON.stringify(statsLedger.byBranch),
  );

  /* ---------------- 12. 收尾 ---------------- */
  await fetch(`${MOCK_ORIGIN}/__mock-delay?ms=0`).catch(() => {});
  const stats = await (await fetch(`${MOCK_ORIGIN}/__mock-stats`)).json();
  check(
    '没有请求落到 unknown 分支（提示词标记与路由一致）',
    (stats.byBranch.unknown ?? 0) === 0,
    JSON.stringify(stats.byBranch),
  );

  const bad = [];
  const mockHost = MOCK_ORIGIN.replace(/^https?:\/\//, '');
  for (const e of client.events) {
    if (e.method === 'Runtime.exceptionThrown') {
      bad.push('EXCEPTION: ' + (e.params.exceptionDetails?.exception?.description ?? ''));
    } else if (e.method === 'Log.entryAdded' && e.params.entry.level === 'error') {
      const text = e.params.entry.text || '';
      const url = e.params.entry.url || '';
      // 假上游故意不发 CORS 头 → 直连被拦、应用改走本机转发。这是设计内的路径
      if (
        /blocked by CORS policy|net::ERR_FAILED/.test(text) &&
        (text.includes(mockHost) || url.includes(mockHost) || !url)
      ) {
        continue;
      }
      bad.push('LOG: ' + text);
    } else if (e.method === 'Runtime.consoleAPICalled' && e.params.type === 'error') {
      bad.push('CONSOLE: ' + e.params.args.map((x) => x.value ?? x.description).join(' '));
    }
  }
  check('没有未捕获异常', bad.length === 0, bad.slice(0, 3).join(' | '));

  const failed = results.filter((r) => !r.ok);
  console.log(`\n===== 结果：${results.length - failed.length}/${results.length} 项通过 =====`);
  if (failed.length) {
    console.log('未通过：');
    failed.forEach((f) => console.log('  ✗ ' + f.name));
    process.exitCode = 1;
  }
  client.close();
}

try {
  await main();
} catch (e) {
  console.error('\n验证脚本失败：', e.message);
  process.exitCode = 1;
} finally {
  chrome.kill();
}
