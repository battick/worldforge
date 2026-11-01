/**
 * 开发期端到端验证：**AI 干活时切页，它照样干完；侧栏在对应那一格转圈**。
 *
 * 覆盖：
 *   1. 工作台 agent 跑到一半切走 → 侧栏「AI 工作台」出现工作动画；
 *      切走期间活干完了（条目真的落库）；切回来那几轮对话还在。
 *   2. 资料库抽取跑到一半切走 → 侧栏「资料库」出现工作动画；
 *      切走期间抽完并进了审查队列；切回来结果面板还在（成果没被丢掉）。
 *   3. 不属于自己的导航项**不该**转圈（动画是定位用的，到处转就等于没有）。
 *   4. 跑完动画自动消失。
 *   5. 没有未捕获异常。
 *
 * 前置：
 *   npx vite build                 （e2e 跑的是构建产物）
 *   node server.mjs                （5188）
 *   node .dev/mock-upstream.mjs 5190
 * 用法：node .dev/e2e-ai-bg.mjs
 *
 * 两个容易踩的点：
 *   - **必须用 hash 切页**（点侧栏），不能 Page.navigate。后者是整页重载，
 *     会把模块级的任务表一起清掉 —— 那就变成在测另一件事了。
 *   - 假上游默认瞬时回包，抓不到「正在跑」的窗口。脚本开头会打
 *     `/__mock-delay?ms=1800` 把回包拖慢，测完再关掉。
 */
import { spawn } from 'node:child_process';
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const CHROME = 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const APP_URL = process.env.APP_URL || 'http://127.0.0.1:5188/';
const MOCK_BASE = process.env.MOCK_URL || 'http://127.0.0.1:5190/v1';
const MOCK_ORIGIN = new URL(MOCK_BASE).origin;
const OUT = '.shots/ai-bg';
const PORT = 9377;
const profile = mkdtempSync(join(tmpdir(), 'cdp-aibg-'));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** 回包延迟。要够长，才好在「请求还没回来」的那一刻切页并断言 */
const SLOW_MS = 1800;

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
  /** 用点侧栏切页 —— 与作者的真实操作一致，且**不会整页重载**（模块级任务表才活得下来） */
  const goRoute = async (key) => {
    // 条目库 / 杂物间并进 Wiki 之后不再各占一格导航：这两个 key 先点 Wiki、再点子页签 ——
    // 走的还是作者那两下（侧栏只剩 `nav-wiki` 了，写 `nav-entries` 会点到 null）
    const sub = key === 'entries' || key === 'pieces' ? key : null;
    await evaluate(`document.querySelector('[data-role=nav-${sub ? 'wiki' : key}]').click(); 'go'`);
    if (sub) await evaluate(`document.querySelector('[data-role=wiki-tab-${sub}]').click(); 'go'`);
    await sleep(320);
  };
  /** 某个导航项上有没有工作动画 */
  const workingOn = (key) =>
    evaluate(`!!document.querySelector('[data-role=nav-${key}] [data-role=nav-working]')`);
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

  /* ---------------- 0. 预置世界 + 拖慢假上游 ---------------- */
  await fetch(`${MOCK_ORIGIN}/__mock-stats/reset`).catch(() => {});
  await fetch(`${MOCK_ORIGIN}/__mock-delay?ms=${SLOW_MS}`).catch(() => {});

  await client.send('Page.navigate', { url: APP_URL });
  await sleep(1800);
  const seeded = await evaluate(`(async () => {
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
    const t = Date.now();
    const wid = 'wd_bg';
    const world = { id: wid, name: '后台测试世界', tagline: '海每年上涨三尺', summary: '## 概览\\n海水不可逆地上涨。', genre: '低魔海洋',
      tone: '', themeColor: '#0e7c8a', createdAt: t, updatedAt: t };
    const cat = { id: 'ct_sys', worldId: wid, name: '体系', icon: '⚙️', fieldDefs: [], order: 0, createdAt: t, updatedAt: t };
    const mk = (id, title, summary) => ({ id, worldId: wid, categoryId: 'ct_sys', title, aliases: [], summary,
      content: '## 概览\\n' + summary, tags: [], fields: {}, status: 'canon', sourceRefs: [], createdAt: t, updatedAt: t });
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
      mk('en_price', '等重的代价', '让海水退去必须付出等重的失去'),
    ]);
    await put('docs', [{
      id: 'dc_bg', worldId: wid, name: '灰烬手记.txt', ext: 'txt', size: 1200,
      text: '每年冬季灰云下沉，形成低空尘暴，岛上人叫它灰烬潮汐。'.repeat(6),
      parsed: false, addedAt: t,
    }]);
    localStorage.setItem('worldforge:settings', JSON.stringify({
      ai: { provider: 'custom', baseUrl: '${MOCK_BASE}', apiKey: 'k', model: 'm', temperature: 0.8, contextLimit: 60, vision: true },
      activeWorldId: wid
    }));
    // 直接执行档：不需要中途停下来等拍板，才好在「它正在跑」时切页
    localStorage.setItem('worldforge:agentMode', 'auto');
    db.close();
    return 'seeded';
  })()`);
  check('预置测试世界与一份资料', seeded === 'seeded');

  // 预置是写进 localStorage 的，而应用**已经加载过了** —— 内存里那份配置还是旧的
  // （会一直停在「还没有世界」的引导页）。所以这里必须真正重载一次。
  //
  // 踩过的坑：`Page.navigate` 到只差一个 hash 的 URL（`/` → `/#studio`）属于**同文档导航**，
  // 浏览器根本不会重新加载 —— 页面看起来没变，脚本却以为已经切过去了。
  // 必须 `Page.reload`。
  //
  // 注意：全场只有这一次整页重载；后面切页一律点侧栏走 hash，
  // 否则会把模块级的任务表一起清掉，那就变成在测另一件事了。
  await client.send('Page.reload');
  await sleep(2000);
  await evaluate(`location.hash = 'studio'; 'x'`);
  await sleep(600);

  /* ---------------- 1. 工作台 agent：跑到一半切走 ---------------- */
  await waitFor(`!!document.querySelector('[data-role=studio-agent]')`, 25000);
  const inputReady = await waitFor(
    `(() => { const t = document.querySelector('[data-role=agent-input]'); return !!t && !t.disabled; })()`,
    20000,
  );
  check('工作台输入区就绪', inputReady);
  if (!inputReady) throw new Error('输入区一直没就绪，后面的断言没意义');
  await sleep(400);

  await evaluate(`(() => {
    const ta = document.querySelector('[data-role=agent-input]');
    const setter = Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, 'value').set;
    setter.call(ta, '把缺的那条规则补上');
    ta.dispatchEvent(new Event('input', { bubbles: true }));
    return 'typed';
  })()`);
  await waitFor(`(() => { const b = document.querySelector('[data-role=agent-send]'); return !!b && !b.disabled; })()`, 12000);
  await evaluate(`document.querySelector('[data-role=agent-send]').click(); 'sent'`);

  // 不等它回话，立刻切走 —— 这正是「作者换一页继续干别的」那一刻
  await sleep(250);
  await goRoute('entries');
  const agentWorking = await workingOn('studio');
  check('切走后，侧栏「AI 工作台」转起来了', agentWorking);
  const otherIdle = !(await workingOn('docs')) && !(await workingOn('graph'));
  check('无关的导航项没有跟着转（动画是定位用的）', otherIdle);
  await shot(`${OUT}-1-working.png`);

  // 它应该在「没人在看」的时候把活干完
  const agentDone = await waitFor(
    `!document.querySelector('[data-role=nav-studio] [data-role=nav-working]')`,
    45000,
  );
  check('切走期间它把这一轮做完了，动画随之消失', agentDone);

  const reviewItems = JSON.parse(await readStore('review'));
  check(
    '切走期间产出的条目真的进了审查队列（不是一个假动画）',
    reviewItems.some((r) => r.title === '潮汐律'),
    `队列：${reviewItems.map((r) => r.title).join('、') || '（空）'}`,
  );
  const reviewPending = await evaluate(
    `document.querySelector('[data-role=nav-review] .nav-badge')?.textContent ?? ''`,
  );
  check('侧栏审查队列的数字跟着涨了', reviewPending.trim() !== '', `徽标=${reviewPending.trim() || '无'}`);

  // 切回来：那几轮对话要还在（说明它是在「同一段会话」上继续干的）
  await goRoute('studio');
  await waitFor(`!!document.querySelector('[data-role=studio-agent]')`, 20000);
  await sleep(400);
  const turnsBack = await evaluate(`document.querySelectorAll('[data-role=agent-turn]').length`);
  check('切回工作台，刚才那几轮都还在', turnsBack >= 3, `${turnsBack} 轮`);
  const stillIdle = !(await evaluate(`!!document.querySelector('[data-role=nav-working]')`));
  check('回来时已经没有在跑的动画了', stillIdle);
  await shot(`${OUT}-2-back.png`);

  /* ---------------- 2. 资料库抽取：跑到一半切走 ---------------- */
  await goRoute('docs');
  await waitFor(`!!document.querySelector('[data-role=docs-extract]')`, 20000);
  await sleep(300);
  await evaluate(`document.querySelector('[data-role=docs-extract]').click(); 'go'`);
  await sleep(250);
  await goRoute('dashboard');
  const docsWorking = await workingOn('docs');
  check('切走后，侧栏「资料库」转起来了', docsWorking);
  await shot(`${OUT}-3-docs-working.png`);

  const docsDone = await waitFor(
    `!document.querySelector('[data-role=nav-docs] [data-role=nav-working]')`,
    45000,
  );
  check('切走期间抽取跑完了', docsDone);
  // 抽取完成会把资料标成「已解析」，而这一步写在 `ai.run` **之后** ——
  // 也就是跑在「页面已经卸载」的闭包里。它落库了，才证明收尾代码真的跑完了，
  // 而不是只把 loading 关掉。（抽取结果不直接进审查队列，要点「送进审查」才进，
  // 所以不能拿队列条数当证据 —— 一开始就是这么写错的。）
  const docParsed = JSON.parse(await readStore('docs')).find((d) => d.id === 'dc_bg')?.parsed;
  check('收尾代码在页面卸载后照样跑完了（资料标记为已解析）', docParsed === true, `parsed=${docParsed}`);

  await goRoute('docs');
  await sleep(400);
  const resultKept = await evaluate(
    `!!document.querySelector('[data-role=docs-result]')`,
  );
  check('切回资料库，结果面板还在（不用重新抽一遍）', resultKept);
  const keptTitle = await evaluate(
    `document.querySelector('[data-role=docs-result]')?.textContent?.includes('灰烬潮汐') ?? false`,
  );
  check('结果面板里就是刚才抽出来的东西', keptTitle);
  await shot(`${OUT}-4-docs-back.png`);

  /* ---------------- 3. 关掉延迟，确认不拖累后续 ---------------- */
  await fetch(`${MOCK_ORIGIN}/__mock-delay?ms=0`).catch(() => {});
  const delayOff = await (await fetch(`${MOCK_ORIGIN}/__mock-delay?ms=0`)).json();
  check('延迟可以关掉（不留副作用）', delayOff.responseDelayMs === 0);

  /* ---------------- 4. 运行时报错 ---------------- */
  const bad = [];
  const mockHost = MOCK_ORIGIN.replace(/^https?:\/\//, '');
  for (const e of client.events) {
    if (e.method === 'Runtime.exceptionThrown') {
      bad.push('EXCEPTION: ' + (e.params.exceptionDetails?.exception?.description ?? ''));
    } else if (e.method === 'Log.entryAdded' && e.params.entry.level === 'error') {
      const text = e.params.entry.text || '';
      const url = e.params.entry.url || '';
      // 假上游故意不发 CORS 头：浏览器拦下直连、应用改走本机转发 —— 这正是要验证的场景，
      // 它在控制台里就是一条 net::ERR_FAILED。**这是预期内的**，不是「意料之外的报错」。
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
