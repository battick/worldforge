/**
 * 开发期端到端验证：**正文字编辑器**（wiki 编辑条目那一页）
 *
 * 覆盖：
 *   1. 打开：工具栏、高亮副本、状态条都在，且副本与输入框**逐字符一致**
 *   2. 工具栏：包裹（加粗，含反切换）、行前缀（标题/列表，含反切换）、块插入
 *   3. 表格：面板里改行列 → 插出来的是真表格
 *   4. 内链补全：打 [[ 弹候选、选中填入；**一个都不匹配时要说话**（不许静默）
 *   5. 快捷键：Ctrl+B、Tab 缩进、列表里回车续下一项
 *   6. 章节：下拉列出小节，点一下光标跳到那一段
 *   7. 三种模式：编辑 / 分栏 / 预览
 *   8. 编辑摘要：写一句 → 保存 → 活动日志里翻得到
 *   9. 草稿：改到一半关掉不丢，重开能恢复；保存成功后草稿消失
 *  10. 无未捕获异常
 *
 * 前置：node server.mjs（默认 5188，需已构建最新 dist）
 * 用法：node .dev/e2e-wiki-edit.mjs
 */
import { spawn } from 'node:child_process';
import { writeFileSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const CHROME = 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const APP_URL = 'http://127.0.0.1:5188/';
const OUT = '.shots/wkedit';
const PORT = 9374;
const profile = mkdtempSync(join(tmpdir(), 'cdp-wkedit-'));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const results = [];
const check = (name, ok, detail = '') => {
  results.push({ name, ok, detail });
  console.log(`  ${ok ? '✓' : '✗'} ${name}${detail ? ' — ' + detail : ''}`);
};
/** 只打印小节标题，别把每条都刷出来 */
const head = (s) => console.log(`\n${s}`);

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
    } else {
      events.push(msg);
      if (msg.method === 'Page.javascriptDialogOpening') {
        // 默认一律**取消**：本脚本里出现的 confirm 有两个（未保存关掉、删除条目），
        // 两个默认分支都应当是「停在这儿别动」——「确定」那条路我们单独立一例去走。
        ws.send(
          JSON.stringify({
            id: ++id,
            method: 'Page.handleJavaScriptDialog',
            params: { accept: false },
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

/* 正文写得长一点：章节跳转那条断言要「滚得动」才验得出来 */
const BODY = [
  '## 概览',
  '',
  '在北境[[灯塔]]上守了四十一年。他认得每一块礁石。',
  '',
  '## 历史',
  '',
  '年轻时随[[灰袍教团]]北上。',
  '',
  '### 早年',
  '',
  '他自称来自南边。',
  ...Array.from({ length: 26 }, (_, i) => `补充第 ${i + 1} 行，用来把正文撑到能滚动。`),
].join('\n');

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
      throw new Error('页面执行出错：' + JSON.stringify(r.exceptionDetails).slice(0, 400));
    }
    return r.result?.value;
  };
  const shot = async (path) => {
    const s = await client.send('Page.captureScreenshot', { format: 'png' });
    writeFileSync(path, Buffer.from(s.data, 'base64'));
  };
  const waitFor = async (expr, timeout = 15000, step = 250) => {
    const t0 = Date.now();
    while (Date.now() - t0 < timeout) {
      if (await evaluate(expr)) return true;
      await sleep(step);
    }
    return false;
  };
  const goto = async (url) => {
    await client.send('Page.navigate', { url: 'about:blank' });
    await sleep(250);
    await client.send('Page.navigate', { url });
    // 整页重载会把挂在 window 上的小工具一起冲掉 —— 每次导航后都得重新装一遍
    await sleep(500);
    await installTools();
  };
  const click = (sel) => evaluate(`(() => { const el = document.querySelector(${JSON.stringify(sel)}); if (!el) return 'missing'; el.click(); return 'ok'; })()`);
  const text = (sel) => evaluate(`document.querySelector(${JSON.stringify(sel)})?.textContent || ''`);
  const val = () => evaluate(`document.querySelector('[data-role="wxe-input"]')?.value ?? null`);

  /**
   * 装一组页面内小工具。
   *
   * 往受控 textarea 里塞值必须走原生 setter 再派发 input —— 直接改 `.value`
   * React 收不到，界面上看不出任何动静，很容易误判成「功能坏了」。
   */
  const installTools = async () => {
    const expr = `(() => {
      const proto = window.HTMLTextAreaElement.prototype;
      const setter = Object.getOwnPropertyDescriptor(proto, 'value').set;
      const ta = () => document.querySelector('[data-role="wxe-input"]');
      window.__wxe = {
        set(v) { const el = ta(); el.focus(); setter.call(el, v); el.dispatchEvent(new Event('input', { bubbles: true })); return 'ok'; },
        sel(a, b) { const el = ta(); el.focus(); el.setSelectionRange(a, b); el.dispatchEvent(new Event('select', { bubbles: true })); return 'ok'; },
        key(k, opts) { const el = ta(); el.dispatchEvent(new KeyboardEvent('keydown', Object.assign({ key: k, bubbles: true, cancelable: true }, opts || {}))); return 'ok'; }
      };
      return 'ready';
    })()`;
    for (let i = 0; i < 20; i++) {
      try {
        if ((await evaluate(expr)) === 'ready') return true;
      } catch {
        /* 导航途中执行上下文可能刚被销毁，等一下再来 */
      }
      await sleep(300);
    }
    return false;
  };

  /* ---------------- 0. 预置一个最小世界 ---------------- */
  await client.send('Page.navigate', { url: APP_URL });
  await sleep(1500);

  const seed = {
    world: { id: 'wd_we', name: '编辑器测试世界', tagline: '', summary: '## 概览\n测试用', genre: '测试',
      tone: '', themeColor: '#2f6fb0', createdAt: 1, updatedAt: 1 },
    cats: [{ id: 'ct_ppl', worldId: 'wd_we', name: '人物', icon: '👤', fieldDefs: [], order: 0, createdAt: 1, updatedAt: 1 }],
    entries: [
      { id: 'en_keeper', worldId: 'wd_we', categoryId: 'ct_ppl', title: '灯塔守', aliases: ['老守'],
        summary: '北境最老的守塔人。', content: BODY, tags: [], fields: {}, status: 'canon',
        sourceRefs: [], createdAt: 1, updatedAt: 9 },
      { id: 'en_tower', worldId: 'wd_we', categoryId: 'ct_ppl', title: '灯塔', aliases: [],
        summary: '黑石砌的塔。', content: '## 概览\n\n黑石砌的塔。', tags: [], fields: {}, status: 'canon',
        sourceRefs: [], createdAt: 1, updatedAt: 8 },
      { id: 'en_order', worldId: 'wd_we', categoryId: 'ct_ppl', title: '灰袍教团', aliases: [],
        summary: '苦修者结成的团体。', content: '## 概览\n\n苦修者。', tags: [], fields: {}, status: 'canon',
        sourceRefs: [], createdAt: 1, updatedAt: 7 },
    ],
    settings: {
      ai: { provider: 'custom', baseUrl: 'http://127.0.0.1:5190/v1', apiKey: 'k', model: 'm',
        temperature: 0.8, contextLimit: 60, vision: true },
      activeWorldId: 'wd_we',
    },
  };

  const seeded = await evaluate(`(async () => {
    const data = ${JSON.stringify(seed)};
    const open = indexedDB.open('worldforge', 5);
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
    const put = (store, items) => new Promise((res, rej) => {
      const tx = db.transaction(store, 'readwrite');
      items.forEach((i) => tx.objectStore(store).put(i));
      tx.oncomplete = () => res();
      tx.onerror = () => rej(tx.error);
    });
    await put('worlds', [data.world]);
    await put('categories', data.cats);
    await put('entries', data.entries);
    localStorage.setItem('worldforge:settings', JSON.stringify(data.settings));
    localStorage.removeItem('wf.wkedit.en_keeper');
    db.close();
    return 'seeded';
  })()`);
  check('预置测试世界', seeded === 'seeded');

  /* ---------------- 1. 打开编辑器 ---------------- */
  head('一、打开');
  await goto(`${APP_URL}#wiki`);
  await waitFor(`!!document.querySelector('[data-role="wiki-tab-entries"]')`, 20000);
  await click('[data-role="wiki-tab-entries"]');
  await sleep(600);
  await click('[data-role="entry-row"][data-entry-id="en_keeper"]');
  const opened = await waitFor(`!!document.querySelector('[data-role="wxe"]')`, 10000);
  check('从 Wiki 的「编辑」支点开条目 → 编辑器打开', opened);
  await shot(`${OUT}-1-open.png`);

  check('工具栏在', (await evaluate(`document.querySelectorAll('[data-role="wxe-bar"] .wxe-btn').length`)) === 19,
    String(await evaluate(`document.querySelectorAll('[data-role="wxe-bar"] .wxe-btn').length`)));
  check('正文装进去了', (await val())?.startsWith('## 概览'));
  check(
    '高亮副本与输入框**逐字符一致**（对齐的前提）',
    (await evaluate(`document.querySelector('.wxe-layer-in').textContent === document.querySelector('[data-role="wxe-input"]').value`)) === true,
  );
  check('标题那段被单独上了色', (await evaluate(`!!document.querySelector('.wxe-layer-in .wxe-h')`)) === true);
  check('内链那段也被上了色', (await evaluate(`!!document.querySelector('.wxe-layer-in .wxe-link')`)) === true);
  check('状态条报了字数/小节/内链',
    /共 \d+ 字/.test(await text('[data-role="wxe-stats"]')) &&
      /3 节/.test(await text('[data-role="wxe-stats"]')) &&
      /2 内链/.test(await text('[data-role="wxe-stats"]')),
    (await text('[data-role="wxe-stats"]')).replace(/\s+/g, ' ').trim());

  /* 后续所有「设值 / 设选区 / 按键」都走这一组页面内小工具 */
  check('页面内测试工具就绪', (await installTools()) === true);

  /* ---------------- 2. 工具栏：包裹 ---------------- */
  head('二、工具栏');
  const body0 = await val();
  const idx = body0.indexOf('在北境');
  await evaluate(`window.__wxe.sel(${idx + 1}, ${idx + 3})`); // 选中「北境」
  await click('[data-role="wxe-tool-bold"]');
  await sleep(250);
  check('选中一段 → 加粗：包起来了', (await val()).includes('在**北境**[[灯塔]]上'),
    (await val()).slice(idx, idx + 16));
  await click('[data-role="wxe-tool-bold"]');
  await sleep(250);
  check('再点一次 → 脱掉（不是又套一层）', (await val()).includes('在北境[[灯塔]]上'), (await val()).slice(idx, idx + 16));

  await evaluate(`window.__wxe.sel(0, 0)`);
  await click('[data-role="wxe-tool-bold"]');
  await sleep(250);
  check('没选中 → 插占位符', (await val()).startsWith('**粗体**'), (await val()).slice(0, 12));
  const phSel = await evaluate(`(() => { const el = document.querySelector('[data-role="wxe-input"]');
    return el.value.slice(el.selectionStart, el.selectionEnd); })()`);
  check('占位符被选中（接着打字直接覆盖）', phSel === '粗体', phSel);
  await evaluate(`window.__wxe.set(${JSON.stringify(body0)})`);
  await sleep(200);

  /* ---------------- 3. 行前缀与块插入 ---------------- */
  const hIdx = (await val()).indexOf('## 概览');
  await evaluate(`window.__wxe.sel(${hIdx}, ${hIdx + 6})`);
  await click('[data-role="wxe-tool-h2"]');
  await sleep(250);
  check('标题：已经是二级了，再点一次脱掉', (await val()).startsWith('概览'), (await val()).slice(0, 10));
  await click('[data-role="wxe-tool-h2"]');
  await sleep(250);
  check('再点一次加回来（替换而不是叠成 ###）', (await val()).startsWith('## 概览'), (await val()).slice(0, 10));

  await click('[data-role="wxe-tool-plain"]');
  await sleep(250);
  check('「变回正文」把标题降回段落', (await val()).startsWith('概览'), (await val()).slice(0, 10));
  await click('[data-role="wxe-tool-h1"]');
  await sleep(250);
  check('换成一级标题', (await val()).startsWith('# 概览'), (await val()).slice(0, 10));
  await click('[data-role="wxe-tool-h2"]');
  await sleep(250);
  check('一级 → 二级：井号个数被替换', (await val()).startsWith('## 概览'), (await val()).slice(0, 10));

  await click('[data-role="wxe-tool-ul"]');
  await sleep(250);
  check('列表：整行加上前缀', (await val()).startsWith('- ## 概览'), (await val()).slice(0, 12));
  await click('[data-role="wxe-tool-ol"]');
  await sleep(250);
  check('切成有序列表：圆点被换掉而不是叠加', (await val()).startsWith('1. ## 概览'), (await val()).slice(0, 12));
  await click('[data-role="wxe-tool-ol"]');
  await sleep(250);
  check('再点一次脱掉列表', (await val()).startsWith('## 概览'), (await val()).slice(0, 10));

  await evaluate(`window.__wxe.set(${JSON.stringify(body0)})`);
  await sleep(150);
  await evaluate(`window.__wxe.sel(${hIdx + 5}, ${hIdx + 5})`); // 光标停在「## 概览」行尾
  await click('[data-role="wxe-tool-quote"]');
  await sleep(250);
  check('引用：行首加 >', (await val()).includes('> ## 概览'), (await val()).slice(hIdx, hIdx + 12));
  await click('[data-role="wxe-tool-quote"]');
  await sleep(250);
  check('引用：再点一次脱掉', (await val()).includes('## 概览') && !(await val()).includes('> ## 概览'));

  await evaluate(`window.__wxe.set(${JSON.stringify('甲')})`);
  await sleep(150);
  await evaluate(`window.__wxe.sel(1, 1)`);
  await click('[data-role="wxe-tool-hr"]');
  await sleep(250);
  check('分隔线：插到下一段而不是粘在同一行', (await val()) === '甲\n---', JSON.stringify(await val()));

  /* ---------------- 4. 表格 ---------------- */
  head('三、表格');
  await evaluate(`window.__wxe.set(${JSON.stringify('前文')})`);
  await sleep(150);
  await evaluate(`window.__wxe.sel(2, 2)`);
  await click('[data-role="wxe-tool-table"]');
  await sleep(300);
  check('表格面板打开', (await evaluate(`!!document.querySelector('[data-role="wxe-table-pop"]')`)) === true);
  await evaluate(`(() => {
    const input = document.querySelector('[data-role="wxe-table-cols"]');
    const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
    setter.call(input, '4');
    input.dispatchEvent(new Event('input', { bubbles: true }));
    return 'ok';
  })()`);
  await sleep(150);
  await click('[data-role="wxe-table-insert"]');
  await sleep(300);
  const tval = await val();
  check('插出来的表头按语言包给列名', tval.includes('| 列1 | 列2 | 列3 | 列4 |'), tval.split('\n')[1] || '');
  check('分隔行是四个 ---', tval.includes('| --- | --- | --- | --- |'), tval.split('\n')[2] || '');
  check('表插在下一段（前文没被吞）', tval.startsWith('前文\n|'), JSON.stringify(tval.slice(0, 14)));
  await evaluate(`window.__wxe.set(${JSON.stringify(body0)})`);
  await sleep(150);

  /* ---------------- 5. 内链补全 ---------------- */
  head('四、内链补全');
  await evaluate(`window.__wxe.set(${JSON.stringify('见 [[灯')})`);
  await sleep(350);
  const sugOpen = await waitFor(`!!document.querySelector('[data-role="wxe-suggest"]')`, 5000);
  check('打 [[ 就弹候选', sugOpen);
  const sugTitles = await evaluate(`[...document.querySelectorAll('[data-role="wxe-suggest-item"]')].map(b => b.querySelector('.wxe-suggest-title').textContent).join('、')`);
  check('候选里按标题匹配到了「灯塔」', String(sugTitles).includes('灯塔'), String(sugTitles));
  /*
   * 候选面板得**整个露在视野里**。
   * 它钉在编辑区左下角，而编辑区有 320 高 —— 在弹窗（本身也是一层滚动容器）里，
   * 这个位置很容易正好落在看不见的地方。那样作者打 `[[` 会以为「什么都没弹」，
   * 可 DOM 查询一切正常：光断言「元素存在」根本抓不住，必须量坐标。
   */
  const sugBox = JSON.parse(await evaluate(`(() => {
    const s = document.querySelector('[data-role="wxe-suggest"]');
    const stage = document.querySelector('.wxe-stage');
    const r = s.getBoundingClientRect(), sr = stage.getBoundingClientRect();
    return JSON.stringify({ h: Math.round(r.height), top: Math.round(r.top), bottom: Math.round(r.bottom),
      stTop: Math.round(sr.top), stBottom: Math.round(sr.bottom), vh: window.innerHeight });
  })()`));
  check('候选面板整个落在编辑区里（没被裁成一条）',
    sugBox.top >= sugBox.stTop && sugBox.bottom <= sugBox.stBottom && sugBox.h > 60,
    JSON.stringify(sugBox));
  check('候选面板也在视野里（不用作者自己往下滚才看得到）',
    sugBox.top >= 0 && sugBox.bottom <= sugBox.vh, JSON.stringify(sugBox));
  await shot(`${OUT}-2-suggest.png`);
  await evaluate(`(() => {
    const b = [...document.querySelectorAll('[data-role="wxe-suggest-item"]')].find(x => x.querySelector('.wxe-suggest-title').textContent === '灯塔');
    b.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true }));
    return 'ok';
  })()`);
  await sleep(300);
  check('点候选 → 补成完整的 [[灯塔]]', (await val()) === '见 [[灯塔]]', JSON.stringify(await val()));
  check('补完之后候选收起来', (await evaluate(`!!document.querySelector('[data-role="wxe-suggest"]')`)) === false);
  const caretAfter = await evaluate(`document.querySelector('[data-role="wxe-input"]').selectionStart`);
  check('光标落在链接之后（接着往下写句子）', caretAfter === '见 [[灯塔]]'.length, String(caretAfter));

  await evaluate(`window.__wxe.set(${JSON.stringify('见 [[zzz')})`);
  await sleep(350);
  const noneShown = await waitFor(`!!document.querySelector('[data-role="wxe-suggest-none"]')`, 5000);
  check('一个都不匹配时**如实说**（不静默什么都不显示）', noneShown);
  check('说的是「还没有叫 zzz 的条目」', (await text('[data-role="wxe-suggest-none"]')).includes('zzz'),
    (await text('[data-role="wxe-suggest-none"]')).slice(0, 40));
  await evaluate(`window.__wxe.set(${JSON.stringify('见 [[')})`);
  await sleep(350);
  check('刚打完 [[ 一个字没写时列的是全部候选（不是「没有匹配」）',
    (await evaluate(`document.querySelectorAll('[data-role="wxe-suggest-item"]').length`)) === 2,
    String(await evaluate(`document.querySelectorAll('[data-role="wxe-suggest-item"]').length`)));
  check('候选里没有自己（不该链到自己）',
    (await evaluate(`[...document.querySelectorAll('[data-role="wxe-suggest-item"]')].some(b => b.textContent.includes('灯塔守'))`)) === false,
    await evaluate(`[...document.querySelectorAll('[data-role="wxe-suggest-item"]')].map(b=>b.textContent).join('、')`));

  /* ---------------- 6. 快捷键 ---------------- */
  head('五、快捷键');
  await evaluate(`window.__wxe.set(${JSON.stringify('甲乙丙')})`);
  await sleep(150);
  await evaluate(`window.__wxe.sel(0, 2)`);
  await evaluate(`window.__wxe.key('b', { ctrlKey: true })`);
  await sleep(250);
  check('Ctrl+B 加粗', (await val()) === '**甲乙**丙', await val());

  await evaluate(`window.__wxe.set(${JSON.stringify('一行\n二行')})`);
  await sleep(150);
  await evaluate(`window.__wxe.sel(0, 0)`);
  await evaluate(`window.__wxe.key('Tab')`);
  await sleep(250);
  check('Tab 缩进（两个空格）', (await val()) === '  一行\n二行', JSON.stringify(await val()));
  await evaluate(`window.__wxe.key('Tab', { shiftKey: true })`);
  await sleep(250);
  check('Shift+Tab 反缩进', (await val()) === '一行\n二行', JSON.stringify(await val()));

  await evaluate(`window.__wxe.set(${JSON.stringify('- 一\n- 二')})`);
  await sleep(150);
  await evaluate(`window.__wxe.sel(8, 8)`);
  await evaluate(`window.__wxe.key('Enter')`);
  await sleep(250);
  check('列表里回车 → 自动续上下一项', (await val()) === '- 一\n- 二\n- ', JSON.stringify(await val()));
  await evaluate(`window.__wxe.set(${JSON.stringify('- 一\n- ' )})`);
  await sleep(150);
  await evaluate(`window.__wxe.sel(6, 6)`);
  await evaluate(`window.__wxe.key('Enter')`);
  await sleep(250);
  check('空列表项上回车 → 把那个符号收掉（结束列表）', (await val()) === '- 一\n', JSON.stringify(await val()));

  await evaluate(`window.__wxe.set(${JSON.stringify('一\n二\n三')})`);
  await sleep(150);
  await evaluate(`window.__wxe.sel(1, 1)`);
  await evaluate(`window.__wxe.key('Enter')`);
  await sleep(250);
  check('不在列表里回车 → 交给默认行为（不瞎接管）', (await evaluate(`document.querySelector('[data-role="wxe-input"]').value`)) === '一\n二\n三');

  /* ---------------- 7. 章节跳转 ---------------- */
  head('六、章节');
  await evaluate(`window.__wxe.set(${JSON.stringify(BODY)})`);
  await sleep(250);
  await click('[data-role="wxe-tool-sections"]');
  await sleep(300);
  const secCount = await evaluate(`document.querySelectorAll('[data-role="wxe-section"]').length`);
  check('章节下拉列出全部小节（2 个二级 + 1 个三级）', secCount === 3, String(secCount));
  const expectAt = BODY.indexOf('## 历史');
  await evaluate(`(() => {
    const items = [...document.querySelectorAll('[data-role="wxe-section"]')];
    items.find(x => x.textContent === '历史').click();
    return 'ok';
  })()`);
  await sleep(300);
  const afterJump = await evaluate(`(() => { const el = document.querySelector('[data-role="wxe-input"]');
    return { start: el.selectionStart, scrollTop: el.scrollTop }; })()`);
  check('点小节 → 光标落到那一段的开头', afterJump.start === expectAt, `${afterJump.start} vs ${expectAt}`);
  check('正文也滚过去了（长条目不用手动找）', afterJump.scrollTop > 0, String(afterJump.scrollTop));
  await shot(`${OUT}-3-sections.png`);

  /* ---------------- 8. 快捷键面板 ---------------- */
  await click('[data-role="wxe-tool-help"]');
  await sleep(300);
  check('快捷键面板打得开且列出了几条', (await evaluate(`document.querySelectorAll('.wxe-help-row').length`)) === 5,
    String(await evaluate(`document.querySelectorAll('.wxe-help-row').length`)));
  await click('[data-role="wxe-tool-help"]');
  await sleep(200);

  /* ---------------- 9. 三种模式 ---------------- */
  head('七、三种模式');
  await click('[data-role="entry-mode-edit"]');
  await sleep(350);
  check('只编辑：有编辑器、没有预览',
    (await evaluate(`!!document.querySelector('[data-role="wxe"]')`)) === true &&
      (await evaluate(`!!document.querySelector('[data-role="entry-preview"]')`)) === false);
  await click('[data-role="entry-mode-preview"]');
  await sleep(350);
  check('只看成品：有预览、编辑器收起',
    (await evaluate(`!!document.querySelector('[data-role="wxe"]')`)) === false &&
      (await evaluate(`!!document.querySelector('[data-role="entry-preview"]')`)) === true);
  check('预览用的是阅读页那套排版（md wiki）',
    (await evaluate(`!!document.querySelector('[data-role="entry-preview"] .md.wiki h3')`)) === true);
  await click('[data-role="entry-mode-split"]');
  await sleep(350);
  check('分栏：编辑区与预览同时在',
    (await evaluate(`!!document.querySelector('[data-role="wxe"]')`)) === true &&
      (await evaluate(`!!document.querySelector('[data-role="entry-preview"]')`)) === true);
  await shot(`${OUT}-4-split.png`);

  /* ---------------- 10. 编辑摘要 + 保存 ---------------- */
  head('八、编辑摘要');
  await evaluate(`window.__wxe.set(${JSON.stringify(BODY.replace('四十一年', '四十二年'))})`);
  await sleep(250);
  await evaluate(`(() => {
    const input = document.querySelector('[data-role="entry-summary"]');
    const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
    setter.call(input, '把守塔年数改成四十二年');
    input.dispatchEvent(new Event('input', { bubbles: true }));
    return 'ok';
  })()`);
  await sleep(200);
  await click('[data-role="entry-save"]');
  await sleep(900);
  await goto(`${APP_URL}#log`);
  const logOk = await waitFor(`document.body.textContent.includes('把守塔年数改成四十二年')`, 15000);
  check('保存时写的摘要进了活动日志（日后翻得到「为什么改」）', logOk);

  /* ---------------- 11. 草稿不丢 ---------------- */
  head('九、草稿');
  await goto(`${APP_URL}#wiki`);
  await waitFor(`!!document.querySelector('[data-role="wiki-tab-entries"]')`, 20000);
  await click('[data-role="wiki-tab-entries"]');
  await sleep(600);
  await click('[data-role="entry-row"][data-entry-id="en_keeper"]');
  await waitFor(`!!document.querySelector('[data-role="wxe"]')`, 10000);
  // 保存成功过，所以这次打开不该有草稿横幅
  check('刚保存过 → 不会平白冒出一条「未保存的改动」',
    (await evaluate(`!!document.querySelector('[data-role="entry-draft"]')`)) === false);
  check('保存成功后草稿键被清掉了',
    (await evaluate(`localStorage.getItem('wf.wkedit.en_keeper')`)) === null);

  const halfWritten = BODY + '\n\n## 半句话\n\n还没写完的那一节。';
  await evaluate(`window.__wxe.set(${JSON.stringify(halfWritten)})`);
  await sleep(1100); // 等自动存草稿的防抖
  check('草稿已自动落盘', (await evaluate(`!!localStorage.getItem('wf.wkedit.en_keeper')`)) === true);
  await click('[data-role="entry-close"]'); // confirm 默认被取消 → 不保存、只关掉
  await sleep(700);
  check('关掉后编辑器收起', (await evaluate(`!!document.querySelector('[data-role="wxe"]')`)) === false);

  await click('[data-role="entry-row"][data-entry-id="en_keeper"]');
  await waitFor(`!!document.querySelector('[data-role="wxe"]')`, 10000);
  const banner = await waitFor(`!!document.querySelector('[data-role="entry-draft"]')`, 5000);
  check('重开时摆出「上次还有没存的改动」', banner);
  check('**不自动套上去** —— 正文仍是库里那一份', (await val()) === BODY.replace('四十一年', '四十二年'),
    (await val()).slice(-20).replace(/\n/g, '⏎'));
  await shot(`${OUT}-5-draft.png`);
  await click('[data-role="entry-draft-restore"]');
  await sleep(400);
  check('点恢复 → 半截稿回到编辑器', (await val()).includes('还没写完的那一节'));
  await click('[data-role="entry-save"]');
  await sleep(800);
  check('保存后草稿键消失', (await evaluate(`localStorage.getItem('wf.wkedit.en_keeper')`)) === null);

  /* ---------------- 12. 无异常 ---------------- */
  head('十、异常');
  const errs = [];
  for (const e of client.events) {
    if (e.method === 'Runtime.exceptionThrown') {
      errs.push('EXCEPTION: ' + (e.params.exceptionDetails?.exception?.description ?? '').slice(0, 200));
    } else if (e.method === 'Runtime.consoleAPICalled' && e.params.type === 'error') {
      errs.push('CONSOLE: ' + e.params.args.map((a) => a.value ?? a.description).join(' ').slice(0, 200));
    }
  }
  check('全程没有未捕获异常 / console.error', errs.length === 0);
  if (errs.length) for (const e of errs.slice(0, 5)) console.log('        ' + e);

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
