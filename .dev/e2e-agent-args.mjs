/**
 * 开发期端到端验证：agent 把**参数名写错**时，事情还能不能办成。
 *
 * 真实翻车现场（用户报的）：
 *   作者让 agent「把条目里提到、但还没建的人物和物品补全」，它连着调了 8 次 read_entry，
 *   每次都报「缺少标题」—— 它明明写了标题，只是写在了 `title` 这个键上。
 *   工具内部只读 `args.entry`，读不到就等于没传；而那句报错里又读不出
 *   「你的键名它不认识」，于是它原样重试、再失败，攒够几次撞上打转护栏，
 *   **整件事中止、一条也没补**。
 *
 * 覆盖：
 *   1. 参数用别名（`title` 当 `entry`）也能调通 —— 第一次就成功，不再报「缺少标题」
 *   2. 读到之后它真的把缺的条目提议出来，且**只进审查队列、不直接落库**
 *   3. 别名也救不回来时，报错必须「能照着重写」：缺哪个 / 这个工具认哪些 / 你给的是什么
 *   4. 这时的护栏插的是「照参数名重写」那条，**不是**「去问作者」那条
 *   5. 最后停下时说的是「它把动作写错了」，**不许**冒充「它没查到」
 *   6. 没有未捕获异常
 *
 * 前置：
 *   npx vite build                 （e2e 跑的是构建产物）
 *   node server.mjs                （5188）
 *   node .dev/mock-upstream.mjs 5190
 * 用法：node .dev/e2e-agent-args.mjs
 */
import { spawn } from 'node:child_process';
import { writeFileSync, mkdirSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const CHROME = 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const APP_URL = 'http://127.0.0.1:5188/';
const MOCK_URL = 'http://127.0.0.1:5190/v1';
const MOCK_STATS = 'http://127.0.0.1:5190/__mock-stats';
const OUT = '.shots/agent-args';
mkdirSync(OUT, { recursive: true });
const PORT = 9384;
const profile = mkdtempSync(join(tmpdir(), 'cdp-args-'));
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
  return { ready, send, events };
}

const DB_VERSION = 5; // 要与 src/storage/indexeddb.ts 同步

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
  };
  const waitFor = async (expr, timeout = 25000, step = 250) => {
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
  };

  /** 往 agent 输入框里打字（走 native setter，React 才收得到） */
  const type = async (text) => {
    // 输入框在 agent 跑着时是 disabled，而 React **会丢弃 disabled 元素上的输入事件**，
    // 抢着打字会静默失效，后面表现为「发送键一直不可用」的假失败。
    const usable = await waitFor(
      `(() => { const t = document.querySelector('[data-role=agent-input]'); return !!t && !t.disabled; })()`,
      30000,
    );
    if (!usable) throw new Error('输入框一直不可输入：agent 可能还没收尾');
    return evaluate(`(() => {
      const ta = document.querySelector('[data-role=agent-input]');
      const setter = Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, 'value').set;
      setter.call(ta, ${JSON.stringify(text)});
      ta.dispatchEvent(new Event('input', { bubbles: true }));
      return 'typed';
    })()`);
  };
  const send = async () => {
    const ready = await waitFor(
      `(() => { const b = document.querySelector('[data-role=agent-send]'); return !!b && !b.disabled; })()`,
      12000,
    );
    if (!ready) {
      const state = await evaluate(`JSON.stringify({
        hasSend: !!document.querySelector('[data-role=agent-send]'),
        hasAbort: !!document.querySelector('[data-role=agent-abort]'),
        hasPlan: !!document.querySelector('[data-role=agent-plan]'),
        input: document.querySelector('[data-role=agent-input]')?.value ?? null,
        tail: document.body.innerText.slice(-300),
      })`);
      throw new Error('发送键不可用，当前状态：' + state);
    }
    await evaluate(`document.querySelector('[data-role=agent-send]').click(); 'sent'`);
  };
  /** 直接读 IndexedDB，绕开界面内存态 —— 库里到底改没改，以它为准 */
  const readStore = (store) =>
    evaluate(`(async () => {
      const open = indexedDB.open('worldforge', ${DB_VERSION});
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
  /** 工作台里所有工具回执的合并文本（含「读了「X」」「缺少…」这些） */
  const stepText = () =>
    evaluate(
      `[...document.querySelectorAll('[data-role=agent-step]')].map((n) => n.innerText).join('\\n')`,
    );

  try {
    await fetch(`${MOCK_STATS}/reset`);
  } catch {
    /* 假上游没起就让它后面的断言说话 */
  }

  /* ---------------- 0. 预置一个最小世界 ---------------- */
  await client.send('Page.navigate', { url: APP_URL });
  await sleep(1800);
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
    const t = Date.now();
    const wid = 'wd_args';
    const world = { id: wid, name: '涨潮纪', tagline: '海每年上涨三尺', summary: '## 概览\\n海水不可逆地上涨。',
      genre: '低魔海洋', tone: '', themeColor: '#0e7c8a', createdAt: t, updatedAt: t };
    const cat = { id: 'ct_sys', worldId: wid, name: '体系', icon: '⚙️', fieldDefs: [], order: 0, createdAt: t, updatedAt: t };
    const mk = (id, title, summary, content) => ({ id, worldId: wid, categoryId: 'ct_sys', title, aliases: [],
      summary, content, tags: [], fields: {}, status: 'canon', sourceRefs: [], createdAt: t, updatedAt: t });
    const put = (store, items) => new Promise((res, rej) => {
      const tx = db.transaction(store, 'readwrite');
      items.forEach((i) => tx.objectStore(store).put(i));
      tx.oncomplete = () => res();
      tx.onerror = () => rej(tx.error);
    });
    await put('worlds', [world]);
    await put('categories', [cat]);
    await put('entries', [
      mk('en_tide', '涨潮纪', '以海面第一次上涨为元年的历法', '## 概览\\n历法。'),
      // 这两条是模型要读的对象 —— 库里**必须**有，否则报的是「没找到条目」，
      // 而不是我们要验的「参数名不认识」。正文里各埋一个「提到却还没建」的名字。
      mk('en_slot', '潮汐槽', '刻着潮线的石槽',
        '## 概览\\n潮汐槽刻着历年潮线。守灯人阿棠每天来描一次。'),
      mk('en_keeper', '守塔人', '负责报时与维护灯塔的人',
        '## 概览\\n守塔人负责报时。描线用的是一枚潮线石。'),
    ]);
    localStorage.setItem('worldforge:settings', JSON.stringify({
      ai: { provider: 'custom', baseUrl: '${MOCK_URL}', apiKey: 'k', model: 'm', temperature: 0.8, contextLimit: 60, vision: true },
      activeWorldId: wid
    }));
    // 直接执行：这一轮验的是「动作能不能跑通」，不是「要不要先问作者」。
    // （即使直接执行，新建条目也只进审查队列 —— 那是产品的底色，下面单独断。）
    localStorage.setItem('worldforge:agentMode', 'auto');
    db.close();
    return 'seeded';
  })()`);
  check('预置测试世界', seeded === 'seeded', String(seeded));

  /* ---------------- 1. 别名键也能调通 ---------------- */
  await goto(APP_URL + '#studio');
  const opened = await waitFor(`!!document.querySelector('[data-role=studio-agent]')`, 25000);
  check('工作台打开且 agent 区域存在', opened);
  await sleep(500);

  await type('帮我补全缺席的人物和物品');
  await send();

  const gotFirst = await waitFor(
    `document.querySelectorAll('[data-role=agent-step]').length >= 1`,
    30000,
  );
  check('第一个动作跑起来了', gotFirst);
  if (!gotFirst) {
    // 没跑起来时把现场打出来：光说「超时」看不出是路由没接上、还是界面卡住了
    const diag = await evaluate(`JSON.stringify({
      tail: document.body.innerText.slice(-600),
      hasInput: !!document.querySelector('[data-role=agent-input]'),
      hasAbort: !!document.querySelector('[data-role=agent-abort]'),
      hasPlan: !!document.querySelector('[data-role=agent-plan]'),
      turns: document.querySelectorAll('[data-role=agent-turn]').length,
    })`);
    console.log('    现场：', diag);
    try {
      const s = await (await fetch(MOCK_STATS)).json();
      console.log('    假上游：', JSON.stringify(s.byBranch), 'marks', JSON.stringify(s.marks));
    } catch {
      /* ignore */
    }
  }
  let steps = await stepText();
  check(
    '模型把 entry 写成 title，依然读成功（别名归一）',
    steps.includes('读了「潮汐槽」'),
    steps.slice(0, 200).replace(/\n/g, ' / '),
  );
  check(
    '不再出现「缺少标题」',
    !steps.includes('缺少标题'),
  );
  // 「补全」这类活儿要把相关条目的正文都读进来，一轮该能放多个动作
  const readBoth = await waitFor(
    `document.querySelectorAll('[data-role=agent-step]').length >= 2`,
    20000,
  );
  check('一轮里把两条都读了（不是一条一条磨）', readBoth);
  steps = await stepText();
  check('第二条也读成功', steps.includes('读了「守塔人」'), steps.slice(0, 240).replace(/\n/g, ' / '));

  // 第二轮：把缺的条目提议出来
  const gotSecond = await waitFor(
    `document.querySelectorAll('[data-role=agent-step]').length >= 4`,
    30000,
  );
  check('读到内容后它接着动手了（不是卡在原地）', gotSecond);
  const finished = await waitFor(
    `!!document.querySelector('[data-role=agent-send]') && !document.querySelector('[data-role=agent-abort]')`,
    40000,
  );
  check('这一轮正常收尾（没被护栏中止）', finished);
  check(
    '没有被判「打转」停掉',
    !(await evaluate(`!!document.querySelector('[data-role=agent-stuck]')`)),
  );

  const review = JSON.parse(await readStore('review'));
  const titles = JSON.parse(await readStore('entries')).map((e) => e.title);
  const proposed = review.filter((r) => r.origin === 'agent').map((r) => r.title);
  check(
    '缺的条目进的是审查队列',
    ['守灯人阿棠', '潮线石'].every((t) => proposed.includes(t)),
    proposed.join(','),
  );
  check(
    '而且**没有**直接落库（AI 提议、人拍板）',
    !titles.includes('守灯人阿棠') && !titles.includes('潮线石'),
    titles.join(','),
  );
  await shot(join(OUT, '1-alias-ok.png'));

  /* ---------------- 2. 真缺参数时报错要能照着重写 ---------------- */
  // 换一段新会话：假上游按「整份历程里第一句作者的话」认场景，
  // 留着上一段的作者的话会把场景路由串掉。
  await evaluate(`document.querySelector('[data-role=agent-new-thread]').click(); 'new'`);
  await sleep(600);

  await type('帮我补全胡写的人物和物品');
  await send();

  const gotBad = await waitFor(
    `document.querySelectorAll('[data-role=agent-step]').length >= 1`,
    30000,
  );
  check('轴模型的动作也开始跑了', gotBad);
  steps = await stepText();
  check(
    '报错点名缺的是哪个参数',
    steps.includes('缺少必填参数 entry'),
    steps.slice(0, 240).replace(/\n/g, ' / '),
  );
  check('报错说清了「这个工具认的参数名是」', steps.includes('这个工具认的参数名是'));
  check('报错回显了「你这次给的是」', steps.includes('你这次给的是'));

  // 攒够几次「调用写错」→ 护栏该插「照参数名重写」那条，然后停下
  const stuck = await waitFor(`!!document.querySelector('[data-role=agent-stuck]')`, 60000);
  check('连着写错之后它停下来了（不无限重试）', stuck);
  const stuckTag = await evaluate(
    `document.querySelector('[data-role=agent-stuck]')?.innerText ?? ''`,
  );
  const stuckBody = await evaluate(
    `[...document.querySelectorAll('[data-role=agent-turn]')].slice(-1)[0]?.innerText ?? ''`,
  );
  check(
    '停下时说的是「它把动作写错了」',
    stuckTag.includes('把动作写错了') && stuckBody.includes('把动作写错了'),
    `标记="${stuckTag}" 正文="${stuckBody.slice(0, 60)}"`,
  );
  check(
    '**不许**冒充成「它没查到」',
    !stuckTag.includes('没查到有用的东西') && !stuckBody.includes('没查到有用的东西'),
  );

  const stats = await (await fetch(MOCK_STATS)).json();
  const marks = stats.marks || {};
  check(
    '护栏插的是「照参数名重写」那条（不是「去问作者」那条）',
    (marks.badCallNudge ?? 0) >= 1 && !(marks.stuckNudge ?? 0),
    JSON.stringify(marks),
  );
  check('请求没有落到 unknown 分支', (stats.byBranch?.agent ?? 0) > 0 && !(stats.byBranch?.unknown ?? 0),
    JSON.stringify(stats.byBranch));
  await shot(join(OUT, '2-badcall.png'));

  /* ---------------- 3. 没有未捕获异常 ---------------- */
  const uncaught = client.events.filter(
    (e) => e.method === 'Runtime.exceptionThrown' && !/ResizeObserver/.test(JSON.stringify(e.params)),
  );
  check('没有未捕获异常', uncaught.length === 0, JSON.stringify(uncaught).slice(0, 300));

  try {
    chrome.kill();
  } catch {
    /* ignore */
  }
}

main()
  .catch((e) => {
    check('脚本执行未抛错', false, String(e && e.stack ? e.stack : e).slice(0, 600));
  })
  .finally(() => {
    const bad = results.filter((r) => !r.ok);
    console.log('');
    console.log(`端到端验证（agent 参数）：${results.length - bad.length}/${results.length} 通过。`);
    for (const b of bad) console.log(`  ✗ ${b.name}${b.detail ? ' — ' + b.detail : ''}`);
    process.exit(bad.length ? 1 : 0);
  });
