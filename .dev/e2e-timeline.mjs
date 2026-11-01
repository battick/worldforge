/**
 * 开发期端到端验证：**条目上的时间**，以及「关系与时间 → 时间」那一支轴。
 *
 * 这一支的主张是「时间不是独立的一域，它是条目上的一个可选属性」，
 * 所以验证也照着这句话来：
 *
 *   1. **空态要能起步**。一条都没设时间时，给的不是「暂无数据」，
 *      而且分得清「一条条目都没有」和「有条目、但都没设时间」这两种情形。
 *   2. **添加是可视化的**。点轴上那一段，新条目就落在那**一刻**（位置由 x 反算），
 *      然后直接开条目编辑器把话说清楚 —— 不再有第二份「事件」说法。
 *   3. **三种形态各来一次**：时间点 / 一段（起始-终结）/ 至今，并且在轴上认得出来。
 *   4. **拖动改的是先后**，并且真的写进条目（刷新还在）。
 *   5. **位置数值决定轴上的距离**；同一纪元连成色带，点图例能只看那一段。
 *   6. **去掉时间 = 离开轴，不是删条目**：条目照旧在库里、在关系图里。
 *   7. **旧版「时间线事件」一次性迁成条目**：时间、纪元、分量照带，
 *      「牵涉到谁」转成关系，迁完旧表清空、只迁一次、日志留痕。
 *   8. **导出设定集**里那一章「大事记」= 设了时间的条目。
 *   9. **排进轴的第一步不是填表**。右边那块「还没排进去」就是这个世界的条目池：
 *      拖一条到轴上任意一处，它就在那个位置上了 —— 位置就是它的时间；
 *      点一下条目、再点轴上任意一处，一样。落位**只写位置、不编时间文本**，
 *      节点如实画成虚线圈，要说得更细就在右侧面板里直接改（改完立刻生效）。
 *  10. **AI 只提议，不替你改**。「AI 自动排版」是个**入队动作**（右下角那条任务队列里
 *      看得见、切页也不断），它读一遍现状、给出一份先后方案，而方案先落在**审查队列**里；
 *      采纳之前轴上一点不动。方案里的位置可以逐条勾选与微调，采纳时只写 `at`/`era`/`weight`，
 *      作者写的时间文字一个字都不动。位置已经全对时它会如实说「不用改」，不再摆一份出来。
 *
 * 前置：
 *   npx vite build
 *   node server.mjs                 （5188）
 *   node .dev/mock-upstream.mjs 5190 [--cors]   （假上游，加不加 --cors 都行：
 *                                  不加时应用会自己回落到本机转发，本脚本只看「有没有意料之外的报错」，
 *                                  CORS 那类日志照 `e2e-onboarding` 的口径剔掉）
 * 用法：node .dev/e2e-timeline.mjs
 */
import { spawn } from 'node:child_process';
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const CHROME = 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const APP_URL = process.env.APP_URL || 'http://127.0.0.1:5188/';
/** 假上游的地址（应用里配的 baseUrl 就是它）。改它要同时改下面的 SEED_* */
const MOCK_ORIGIN = process.env.MOCK_ORIGIN || 'http://127.0.0.1:5190';
const OUT = '.shots/timeline';
const PORT = 9388;
const profile = mkdtempSync(join(tmpdir(), 'cdp-timeline-'));
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
      // 「去掉时间」会弹一个原生 confirm —— 无头页面必须帮它点掉，否则整页冻住
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
 * 预置世界一：三条条目、**一条都没设时间** —— 空轴起步是这一支的第一件事，
 * 先塞满时间就把那段验没了。也刻意**不写旧时间线表**：这条世界只验新模型。
 */
const SEED_A = `(async () => {
  try {
    const open = indexedDB.open('worldforge', 5);
    const db = await new Promise((res, rej) => {
      open.onsuccess = () => res(open.result);
      open.onerror = () => rej(open.error);
    });
    const t = Date.now();
    const wid = 'wd_tl';
    const world = { id: wid, name: '时间轴测试世界', tagline: '海面每年上涨三尺',
      summary: '## 概览\\n\\n潮水逐年上涨，沿岸城邦的内迁史。', genre: '低魔海洋',
      tone: '冷峻克制', themeColor: '#0e7c8a', createdAt: t, updatedAt: t };
    const cat = { id: 'ct_sys', worldId: wid, name: '体系', icon: '⚙️', fieldDefs: [],
      order: 0, createdAt: t, updatedAt: t };
    const mk = (o) => Object.assign({ worldId: wid, categoryId: 'ct_sys', aliases: [], tags: [],
      fields: {}, status: 'canon', sourceRefs: [], createdAt: t, updatedAt: t }, o);
    const put = (store, items) => new Promise((res, rej) => {
      const tx = db.transaction(store, 'readwrite');
      items.forEach((i) => tx.objectStore(store).put(i));
      tx.oncomplete = () => res();
      tx.onerror = () => rej(tx.error);
    });
    await put('worlds', [world]);
    await put('categories', [cat]);
    await put('entries', [
      mk({ id: 'en_tide', title: '涨潮纪', summary: '以海面第一次上涨为元年的历法',
        content: '## 概览\\n\\n历法。' }),
      mk({ id: 'en_trough', title: '潮汐槽', summary: '海面下降时露出的浅槽',
        content: '## 概览\\n\\n浅槽。' }),
      mk({ id: 'en_ember', title: '余烬教团', summary: '把持历法的教团',
        content: '## 概览\\n\\n教团。' }),
    ]);
    // 一条关系：「余烬教团」把持「涨潮纪」——轴上选中前者时右侧能看见它牵着的谁
    await put('relations', [
      { id: 'rl_ember', worldId: wid, fromEntryId: 'en_ember', toEntryId: 'en_tide',
        type: '把持', note: '教团垄断历法', status: 'canon', createdAt: t },
    ]);
    localStorage.setItem('worldforge:settings', JSON.stringify({
      ai: { provider: 'custom', baseUrl: 'http://127.0.0.1:5190/v1', apiKey: 'k', model: 'm',
            temperature: 0.8, contextLimit: 60, vision: true },
      activeWorldId: wid
    }));
    db.close();
    return 'seeded';
  } catch (e) {
    return 'seed-failed: ' + (e && e.message);
  }
})()`;

/**
 * 预置世界二：专门放**旧版「时间线事件」**，用来验一次性迁移。
 *
 * 旧表还留在库里（不升 DB_VERSION 的代价就是它得留一阵子），但只作迁移来源：
 * 一条事件 = 一条带时间的条目，「牵涉到谁」转成关系。
 */
const SEED_B = `(async () => {
  try {
    const open = indexedDB.open('worldforge', 5);
    const db = await new Promise((res, rej) => {
      open.onsuccess = () => res(open.result);
      open.onerror = () => rej(open.error);
    });
    const t = Date.now();
    const wid = 'wd_legacy';
    const world = { id: wid, name: '旧账世界', tagline: '上面还记着老账',
      summary: '## 概览\\n\\n用来验证旧时间线记录的迁移。', genre: '测试',
      tone: '仅用例', themeColor: '#7c5cbf', createdAt: t, updatedAt: t };
    const cat = { id: 'ct_leg', worldId: wid, name: '纪事', icon: '📜', fieldDefs: [],
      order: 0, createdAt: t, updatedAt: t };
    const mk = (o) => Object.assign({ worldId: wid, categoryId: 'ct_leg', aliases: [], tags: [],
      fields: {}, status: 'canon', sourceRefs: [], createdAt: t, updatedAt: t }, o);
    const put = (store, items) => new Promise((res, rej) => {
      const tx = db.transaction(store, 'readwrite');
      items.forEach((i) => tx.objectStore(store).put(i));
      tx.oncomplete = () => res();
      tx.onerror = () => rej(tx.error);
    });
    await put('worlds', [world]);
    await put('categories', [cat]);
    await put('entries', [
      mk({ id: 'en_keep', title: '守灯人', summary: '守灯的老头', content: '## 概览\\n\\n守灯。' }),
      mk({ id: 'en_law', title: '潮律', summary: '沿岸通行的律条', content: '## 概览\\n\\n律条。' }),
    ]);
    // 旧表：两件事，位置沿用 order，牵涉的条目用 entryIds
    await put('timeline', [
      { id: 'tl_old1', worldId: wid, title: '灯塔落成', date: '旧历 3 年', order: 10,
        era: '旧历', weight: 'major', detail: '## 概况\\n\\n第一座灯塔立起来了。',
        entryIds: ['en_keep'], createdAt: t, updatedAt: t },
      { id: 'tl_old2', worldId: wid, title: '潮律颁行', date: '旧历 20 年', order: 40,
        era: '旧历', weight: 'minor', detail: '', entryIds: ['en_law'], createdAt: t, updatedAt: t },
    ]);
    localStorage.setItem('worldforge:settings', JSON.stringify({
      ai: { provider: 'custom', baseUrl: 'http://127.0.0.1:5190/v1', apiKey: 'k', model: 'm',
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
  await client.send('Network.enable').catch(() => {});

  const evaluate = async (expression) => {
    const r = await client.send('Runtime.evaluate', {
      expression,
      returnByValue: true,
      awaitPromise: true,
    });
    if (r.exceptionDetails) {
      // 把出错的表达式一起报出来 —— 只报「页面执行出错」的话，得靠猜才知道是哪一句
      throw new Error(
        '页面执行出错：' +
          JSON.stringify(r.exceptionDetails).slice(0, 300) +
          '\n  表达式：' +
          String(expression).replace(/\s+/g, ' ').slice(0, 200),
      );
    }
    return r.result?.value;
  };
  const shot = async (name) => {
    const s = await client.send('Page.captureScreenshot', { format: 'png' });
    mkdirSync(OUT, { recursive: true });
    writeFileSync(join(OUT, name), Buffer.from(s.data, 'base64'));
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

  /**
   * 等到库里的某件事成立。
   *
   * 迁移、批量写入这些是异步落库的 —— 拿固定睡眠去赌它跑完，快了会假红、慢了会拖时间。
   */
  const waitStore = async (store, pred, timeout = 9000) => {
    const t0 = Date.now();
    let rows = [];
    while (Date.now() - t0 < timeout) {
      rows = JSON.parse(await readStore(store));
      if (pred(rows)) return rows;
      await sleep(200);
    }
    return rows;
  };

  /**
   * 进「时间与关系」并从编年切到**旧的那支点轴**。
   *
   * 时间线已经不单独占一页了，编年也接管了它原先的切换位 —— 现在去点轴只有
   * 一个口子：先进这一页（默认落在编年），再点编年右下角的「旧的」。
   */
  const openTimeView = async () => {
    await evaluate(`document.querySelector('[data-role=nav-graph]').click(); 'go'`);
    await sleep(400);
    // 视图状态跟着人走：上一次若已经停在点轴上，这里就是终点，别再找入口
    if (await evaluate(`!!document.querySelector('[data-role=tl-axis]')`)) return;
    // 不在点轴：若也不在编年（比如上次停在关系那一支），先回编年
    if (!(await evaluate(`!!document.querySelector('[data-role=chron-old-view]')`))) {
      await evaluate(`document.querySelector('[data-role=graph-view-chronicle]').click(); 'chron'`);
      await sleep(400);
    }
    await evaluate(`document.querySelector('[data-role=chron-old-view]').click(); 'time'`);
    await sleep(400);
  };

  /** 轴上的条目（库里那份，按位置数值排） */
  const timed = async () => {
    const wid = await activeWorldId();
    return JSON.parse(await readStore('entries'))
      .filter((e) => e.worldId === wid && e.time)
      .sort((a, b) => (a.time.at ?? 0) - (b.time.at ?? 0));
  };
  /** 库里全部条目（含没设时间的） */
  const allEntries = async () => {
    const wid = await activeWorldId();
    return JSON.parse(await readStore('entries')).filter((e) => e.worldId === wid);
  };
  let widCache = null;
  const activeWorldId = async () => {
    if (!widCache) {
      widCache = await evaluate(
        `JSON.parse(localStorage.getItem('worldforge:settings')).activeWorldId`,
      );
    }
    return widCache;
  };

  /** 页面上的节点：id → {x, order, r, era, kind, notime}，用来验「位置真的按数值摆」 */
  const nodes = async () =>
    JSON.parse(
      await evaluate(`JSON.stringify([...document.querySelectorAll('[data-role=tl-node]')].map((g) => ({
        id: g.dataset.id, x: Number(g.dataset.x), order: Number(g.dataset.order),
        r: Number(g.dataset.r), era: g.dataset.era, kind: g.dataset.kind,
        notime: g.dataset.notime })))`),
    );

  /** 在轴下方那条带子上点一下（按容器比例定位）：点哪儿就该落在哪儿 */
  const clickLaneAt = async (ratio) => {
    await evaluate(`(() => {
      const lane = document.querySelector('[data-role=tl-add-lane]');
      const r = lane.getBoundingClientRect();
      const x = r.left + r.width * ${ratio};
      const y = r.top + r.height / 2;
      lane.dispatchEvent(new MouseEvent('click', { bubbles: true, clientX: x, clientY: y }));
      return 'clicked';
    })()`);
    await sleep(360);
  };

  /** 把某个节点从轴上拖到另一处（比例定位） */
  const dragNodeTo = async (id, ratio) => {
    await evaluate(`(() => {
      const svg = document.querySelector('[data-role=tl-axis]');
      const g = document.querySelector('[data-role=tl-node][data-id=${id}]');
      const sr = svg.getBoundingClientRect();
      const gr = g.getBoundingClientRect();
      const fromX = gr.left + gr.width / 2;
      g.dispatchEvent(new MouseEvent('mousedown', {
        bubbles: true, clientX: fromX, clientY: gr.top + gr.height / 2 }));
      window.dispatchEvent(new MouseEvent('mousemove', {
        bubbles: true, clientX: fromX + 30, clientY: 0 }));
      window.dispatchEvent(new MouseEvent('mousemove', {
        bubbles: true, clientX: sr.left + sr.width * ${ratio}, clientY: 0 }));
      window.dispatchEvent(new MouseEvent('mouseup', { bubbles: true }));
      return 'dragged';
    })()`);
    await sleep(360);
  };

  /** 池子里此刻列出来的行（页面上那一份） */
  const poolRows = async () =>
    JSON.parse(
      await evaluate(`JSON.stringify([...document.querySelectorAll('[data-role=tl-pool-row]')].map((b) => ({
        id: b.dataset.id, title: b.querySelector('.tl-pool-title').textContent,
        carrying: b.dataset.carrying })))`),
    );

  /**
   * 把池子里的一条拖到轴上：**按住 → 移到轴上 → 先不松手**。
   *
   * 中途的样子要读回来看 —— 只验最后落没落位的话，「拖的时候到底有没有反馈」
   * 就没人验了，而那恰恰是「拖」比「填表」好用的全部理由。
   */
  const poolDragTo = async (id, ratio) => {
    // ① 按住。**一次 evaluate 只做一件事** —— 中间必须让出时间，React 才来得及
    //    把这一帧渲染出来；一口气把 down/move/读 DOM 全塞进同一个同步脚本里，
    //    读到的永远是上一帧（卡片还没出现），那是假红。
    const at = (sel) =>
      `document.querySelector('${sel}').getBoundingClientRect()`;
    await evaluate(`(() => {
      const rr = ${at(`[data-role=tl-pool-row][data-id=${id}]`)};
      window.__tlFrom = { x: rr.left + rr.width / 2, y: rr.top + rr.height / 2 };
      document.querySelector('[data-role=tl-pool-row][data-id=${id}]').dispatchEvent(
        new MouseEvent('mousedown', { bubbles: true, clientX: window.__tlFrom.x, clientY: window.__tlFrom.y }));
      return 'down';
    })()`);
    await sleep(140);

    // ② 移到轴上（先小挪一下再挪到目标 —— 真人也是这样）
    await evaluate(`(() => {
      const sr = ${at('[data-role=tl-axis]')};
      const to = { x: sr.left + sr.width * ${ratio}, y: sr.top + sr.height / 2 };
      window.dispatchEvent(new MouseEvent('mousemove', { bubbles: true,
        clientX: window.__tlFrom.x, clientY: window.__tlFrom.y - 24 }));
      window.dispatchEvent(new MouseEvent('mousemove', { bubbles: true, clientX: to.x, clientY: to.y }));
      return 'move';
    })()`);
    await sleep(180);

    // ③ 先不松手：把中途的样子读下来
    const dragMid = await evaluate(`JSON.stringify((() => {
      const card = document.querySelector('[data-role=tl-carry]');
      return {
        card: !!card,
        cardTitle: card ? card.querySelector('.tl-carry-title').textContent : '',
        cardText: card ? card.textContent : '',
        row: document.querySelector('[data-role=tl-pool-row][data-id=${id}]').dataset.carrying,
        ghost: !!document.querySelector('.tl-ghost-line'),
        ghostLabel: document.querySelector('.tl-ghost-label')
          ? document.querySelector('.tl-ghost-label').textContent : '',
      };
    })())`);

    // ④ 松手 = 落在那里
    await evaluate(`(() => {
      const sr = ${at('[data-role=tl-axis]')};
      window.dispatchEvent(new MouseEvent('mouseup', { bubbles: true,
        clientX: sr.left + sr.width * ${ratio}, clientY: sr.top + sr.height / 2 }));
      window.__tlFrom = null;
      return 'released';
    })()`);
    await sleep(520);
    return JSON.parse(dragMid);
  };

  /**
   * 像真人那样点一下池子里的一行：**按下 + 松开**。
   *
   * 用 `.click()` 只能走到键盘那一条路（`detail === 0`）—— 鼠标那条路在松开的那一刻
   * 就判完了「这是拖还是点」，不派发 mousedown/mouseup 永远到不了它。
   */
  const clickPoolRow = async (id) => {
    await evaluate(`(() => {
      const row = document.querySelector('[data-role=tl-pool-row][data-id=${id}]');
      const rr = row.getBoundingClientRect();
      const x = rr.left + rr.width / 2, y = rr.top + rr.height / 2;
      row.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, clientX: x, clientY: y }));
      window.dispatchEvent(new MouseEvent('mouseup', { bubbles: true, clientX: x, clientY: y }));
      return 'clicked';
    })()`);
    await sleep(360);
  };

  /** 在轴上某个比例位置点一下（点的是铺满全轴的那块透明底板） */
  const clickAxisAt = async (ratio) => {
    await evaluate(`(() => {
      const sr = document.querySelector('[data-role=tl-axis]').getBoundingClientRect();
      const x = sr.left + sr.width * ${ratio}, y = sr.top + sr.height / 2;
      document.querySelector('[data-role=tl-blank]').dispatchEvent(
        new MouseEvent('mousedown', { bubbles: true, clientX: x, clientY: y }));
      window.dispatchEvent(new MouseEvent('mouseup', { bubbles: true, clientX: x, clientY: y }));
      return 'x';
    })()`);
    await sleep(460);
  };

  /** 只把指针挪到轴上某处（不点）—— 看幽灵线有没有跟上 */
  const hoverAxisAt = async (ratio) => {
    await evaluate(`(() => {
      const svg = document.querySelector('[data-role=tl-axis]');
      const sr = svg.getBoundingClientRect();
      svg.dispatchEvent(new MouseEvent('mousemove', { bubbles: true,
        clientX: sr.left + sr.width * ${ratio}, clientY: sr.top + sr.height / 2 }));
      return 'x';
    })()`);
    await sleep(220);
  };

  /**
   * 改一个输入框：真的聚焦、真的输入、真的让它失焦。
   * 记一笔：无头 Chrome 里 `el.blur()` **什么都不会发生**（文档没有焦点，
   * 浏览器直接跳过），必须显式派发一个 focusout。这不是产品的问题：
   * 真人用键盘/鼠标离开输入框时，浏览器发的就是 focusout。
   */
  const setInput = async (role, value) => {
    await evaluate(`(() => {
      const el = document.querySelector('[data-role=${role}]');
      const proto = el.tagName === 'TEXTAREA' ? window.HTMLTextAreaElement : window.HTMLInputElement;
      el.focus();
      const set = Object.getOwnPropertyDescriptor(proto.prototype, 'value').set;
      set.call(el, ${JSON.stringify(value)});
      el.dispatchEvent(new Event('input', { bubbles: true }));
      el.dispatchEvent(new FocusEvent('focusout', { bubbles: true }));
      return el.value;
    })()`);
    await sleep(280);
  };

  /** 下拉框（三选一/权重）也要走真事件才会触发 React 的 onChange */
  const setSelect = async (role, value) => {
    await evaluate(`(() => {
      const el = document.querySelector('[data-role=${role}]');
      const set = Object.getOwnPropertyDescriptor(window.HTMLSelectElement.prototype, 'value').set;
      set.call(el, ${JSON.stringify(value)});
      el.dispatchEvent(new Event('change', { bubbles: true }));
      return el.value;
    })()`);
    await sleep(240);
  };

  const click = async (role) => {
    await evaluate(`document.querySelector('[data-role=${role}]').click(); 'x'`);
    await sleep(300);
  };

  const clickOk = (role) =>
    evaluate(`(() => { const b = document.querySelector('[data-role=${role}]'); if (!b) return false; b.click(); return true; })()`);

  /** 在条目编辑器里把时间设成指定形态（编辑器得已经开着） */
  const setTimeInEditor = async ({ kind, from, to, at, toAt, era, weight }) => {
    await clickOk('entry-tab-time');
    await sleep(280);
    // 还没有时间就先按下「设个时间」；已经有就直接改
    if (await evaluate(`!!document.querySelector('[data-role=entry-time-set]')`)) {
      await click('entry-time-set');
    }
    if (kind) {
      await click(`entry-time-kind-${kind}`);
    }
    if (from !== undefined) await setInput('entry-time-from', from);
    if (kind === 'range' && to !== undefined) {
      // 「终结」这个框只有选了「一段」才会出现
      await waitFor(`!!document.querySelector('[data-role=entry-time-to]')`, 4000);
      await setInput('entry-time-to', to);
    }
    if (at !== undefined) await setInput('entry-time-at', String(at));
    if (toAt !== undefined) await setInput('entry-time-toat', String(toAt));
    if (era !== undefined) await setInput('entry-time-era', era);
    if (weight) await setSelect('entry-time-weight', weight);
  };

  const saveEditor = async () => {
    await click('entry-save');
    await sleep(400);
    await click('entry-close');
    await sleep(400);
  };

  /** 假上游的统计 —— 用来证实「提示词真的把现状交给了模型」而不是接口通了就算过 */
  const mockStats = async () => {
    try {
      return await (await fetch(`${MOCK_ORIGIN}/__mock-stats`)).json();
    } catch {
      return {};
    }
  };
  const mockCmd = (path) => fetch(`${MOCK_ORIGIN}${path}`).catch(() => {});

  /** 某个世界里的某类审查提议（读库，不看页面） */
  const reviewOf = async (kind) =>
    JSON.parse(await readStore('review')).filter((r) => r.kind === kind);

  /** 轴上的位置快照：「条目名@位置」连起来 —— 用来断言「一组位置一点没动」 */
  const axisSig = async () => (await timed()).map((e) => `${e.title}@${e.time.at}`).join('|');

  let fatal = null;
  try {
    /* ---------------- 0. 预置世界一（有条目、一条都没设时间） ---------------- */
    await client.send('Page.navigate', { url: APP_URL });
    await sleep(1600);
    check('预置测试世界（三条条目，一条都没设时间）', (await evaluate(SEED_A)) === 'seeded');
    // 预置写的是 localStorage，应用已经加载过了 —— 必须整页重载
    await client.send('Page.reload');
    await sleep(1900);

    const gateWorlds = await waitStore('worlds', (ws) =>
      !!ws.find((w) => w.id === 'wd_tl')?.timelineMigratedAt,
    );
    const gate = gateWorlds.find((w) => w.id === 'wd_tl');
    check(
      '迁移闸门关上了（这条世界旧表里什么都没有，也算「已经迁过」）',
      typeof gate?.timelineMigratedAt === 'number',
      String(gate?.timelineMigratedAt),
    );

    /* ---------------- 1. 空态：分得清「没有条目」和「有、但一条都没排进来」 ---------------- */
    await openTimeView();
    check(
      '从编年的「旧的」进得到点轴那一支（导航和切换位里都没有独立入口了）',
      await waitFor(`!!document.querySelector('[data-role=tl-axis], [data-role=tl-empty-add]')`, 12000),
    );
    // 空态两种：一条条目都没有 / 有条目但都没排进去。这里的文案必须点明是后者，
    // 否则作者会以为「这个功能坏了」，而不是「还差一步」。
    const emptyText = await evaluate(`document.body.innerText`);
    check(
      '空态说的是「有条目、但一条都还没排进轴」，不是一句暂无数据',
      emptyText.includes('还没有哪条排进时间轴') && emptyText.includes('一条都还没排进轴'),
      emptyText.split('\n').find((l) => l.includes('还没有哪条')) ?? '',
    );
    check(
      '空轴自己就是落点：轴上写着「把右边的条目拖过来」，池子就摆在旁边',
      (await evaluate(
        `!!document.querySelector('[data-role=tl-axis-hint]') && !!document.querySelector('[data-role=tl-pool]')`,
      )) === true,
    );
    check(
      '空态给了一条明确的路（新建一条 / 去看关系）',
      (await evaluate(
        `!!document.querySelector('[data-role=tl-empty-add]') && !!document.querySelector('[data-role=tl-empty-relations]')`,
      )) === true,
    );
    await shot('01-empty.png');

    /* ---------------- 2. 从空态起步：添下第一条 ---------------- */
    await click('tl-empty-add');
    let evs = await timed();
    check('添下第一条就真的落库了（还是一条条目，不是另开一张表）', evs.length === 1, `${evs.length} 条`);
    check(
      '落库时就带着时间（位置 10，时间文本还空着）',
      evs[0]?.time?.at === 10 && evs[0]?.time?.kind === 'point' && evs[0]?.time?.from === '',
      JSON.stringify(evs[0]?.time),
    );
    check(
      '添完直接开条目编辑器（标题框就在最上面，不用再去找）',
      await waitFor(`!!document.querySelector('[data-role=entry-title]')`, 6000),
    );
    await shot('02-first.png');

    /* ---------------- 3. 把这条说清楚：时间点形态 ---------------- */
    await setInput('entry-title', '海面第一次上涨');
    const titleDom = await evaluate(`(() => {
      const ins = [...document.querySelectorAll('[data-role=entry-title]')];
      return JSON.stringify({ n: ins.length, v: ins.map((i) => i.value),
        save: document.querySelector('[data-role=entry-save]')?.disabled });
    })()`);
    await setTimeInEditor({
      kind: 'point',
      from: '元年',
      era: '涨潮纪',
      weight: 'major',
    });
    await saveEditor();
    evs = await timed();
    check(
      '标题 / 时间文本 / 纪元都写进条目里了',
      evs[0].title === '海面第一次上涨' && evs[0].time.from === '元年' && evs[0].time.era === '涨潮纪',
      `${JSON.stringify({ t: evs[0].title, f: evs[0].time.from, e: evs[0].time.era })} DOM=${titleDom}`,
    );
    check('分量也存下来了（轴上会画得更大）', evs[0].time.weight === 'major', evs[0].time.weight);
    check('形态是显式的「时间点」', evs[0].time.kind === 'point', evs[0].time.kind);

    /* ---------------- 4. 可视化添加：点哪儿落哪儿 ---------------- */
    await clickLaneAt(0.8);
    const nodes1 = await nodes();
    check('在轴上点一下就又能添一条（不是只能从按钮加）', nodes1.length === 2, `节点 ${nodes1.length}`);
    const e2 = (await timed()).slice().sort((a, b) => a.time.at - b.time.at);
    check(
      '新条目落在**点击的位置**（点得靠右 → 位置数值更大），不是一律排到末尾',
      e2[1].time.at > e2[0].time.at,
      `at ${e2.map((x) => x.time.at).join(' → ')}`,
    );
    const xByOrder = nodes1.slice().sort((a, b) => a.order - b.order);
    check(
      '轴上的 x 也真的跟着位置数值走（右边的数值大、画得也靠右）',
      xByOrder[1].x > xByOrder[0].x,
      `x ${xByOrder.map((n) => n.x).join(' → ')}`,
    );
    check('重大那条的节点画得更大', (await nodes()).find((n) => n.id === e2[0].id).r > 8);

    await setInput('entry-title', '潮汐槽干涸');
    await setTimeInEditor({ kind: 'point', from: '涨潮纪 40 年', era: '涨潮纪', weight: 'normal' });
    await saveEditor();
    await shot('03-two-nodes.png');

    /* ---------------- 5. 三种形态：一段 / 至今 ---------------- */
    // 「一段」：起点 + 终结，并且给终点一个数值 —— 这样轴上画出来的是**按比例**的实线，
    // 长短就代表真实跨度（不给终点数值就只画一段虚线，长度没有意义）。
    await clickLaneAt(0.55);
    await setInput('entry-title', '余烬教团分裂');
    await setTimeInEditor({
      kind: 'range',
      from: '烬落纪 3 年',
      to: '烬落纪 41 年',
      era: '烬落纪',
      weight: 'normal',
      at: 55,
      toAt: 95,
    });
    await saveEditor();
    let range = (await timed()).find((e) => e.title === '余烬教团分裂');
    check(
      '「一段」两端都存下来了（起点 + 终结，还有终点的位置）',
      range?.time?.kind === 'range' &&
        range.time.from === '烬落纪 3 年' &&
        range.time.to === '烬落纪 41 年' &&
        range.time.toAt === 95,
      JSON.stringify(range?.time),
    );
    const rangeNode = (await nodes()).find((n) => n.id === range.id);
    check('节点上标出了它的形态（一段）', rangeNode?.kind === 'range', rangeNode?.kind);
    const spans = JSON.parse(
      await evaluate(
        `JSON.stringify([...document.querySelectorAll('[data-role=tl-span]')].map((g) => g.querySelector('line')?.getAttribute('stroke-dasharray') ?? 'solid'))`,
      ),
    );
    check(
      '轴上给「一段」画了横杠（比例模式下是实线，长度就是真实跨度）',
      spans.length === 1 && spans[0] === 'solid',
      JSON.stringify(spans),
    );

    // 「至今」：起了个头、还没结束 —— 轴上一直画到最右边，而且是虚线
    await clickLaneAt(0.9);
    await setInput('entry-title', '最后一座灯塔熄灭');
    await setTimeInEditor({ kind: 'ongoing', from: '烬落纪 60 年', era: '烬落纪', weight: 'minor' });
    await saveEditor();
    const ongoing = (await timed()).find((e) => e.title === '最后一座灯塔熄灭');
    check(
      '「至今」是显式的一态（to 空着不等于至今）',
      ongoing?.time?.kind === 'ongoing' && ongoing.time.to === '',
      JSON.stringify(ongoing?.time),
    );
    const ongoingNode = (await nodes()).find((n) => n.id === ongoing.id);
    check('节点上标出了它的形态（至今）', ongoingNode?.kind === 'ongoing', ongoingNode?.kind);
    const ongoingSpan = JSON.parse(
      await evaluate(`JSON.stringify((() => {
        const g = document.querySelector('[data-role=tl-node][data-kind=ongoing] [data-role=tl-span]');
        const svg = document.querySelector('[data-role=tl-axis]');
        if (!g) return null;
        const line = g.querySelector('line');
        return { end: Number(line.getAttribute('x2')), width: Number(svg.getAttribute('width')) };
      })())`),
    );
    check(
      '「至今」一直画到轴的右端（不是画一小截就没了）',
      !!ongoingSpan && ongoingSpan.end > ongoingSpan.width - 60,
      JSON.stringify(ongoingSpan),
    );
    await shot('04-three-kinds.png');

    /* ---------------- 6. 中间插入 + 末端的「再往后一条」 ---------------- */
    await clickLaneAt(0.3);
    await setInput('entry-title', '灰烬议会成立');
    await setTimeInEditor({ kind: 'point', from: '烬落纪 12 年', era: '烬落纪', weight: 'normal' });
    await saveEditor();
    const mid = (await timed()).find((e) => e.title === '灰烬议会成立');
    const sortedNow = (await timed()).sort((a, b) => a.time.at - b.time.at);
    const midIdx = sortedNow.findIndex((e) => e.title === '灰烬议会成立');
    check(
      '点在中间：新条目插在中间，不是又排到最后',
      midIdx > 0 && midIdx < sortedNow.length - 1,
      `第 ${midIdx + 1} 位 / 共 ${sortedNow.length}`,
    );

    await clickLaneAt(0.99);
    await setInput('entry-title', '最后的钟声');
    await setTimeInEditor({ kind: 'point', from: '烬落纪 99 年', era: '烬落纪', weight: 'normal' });
    await saveEditor();
    const six = await timed();
    const last = six.find((e) => e.title === '最后的钟声');
    const maxBefore = Math.max(...six.filter((e) => e.title !== '最后的钟声').map((e) => e.time.at));
    check(
      '点在轴的最右端：落在末尾之后，并且拉开了一步（不是叠在末尾那条身上）',
      last.time.at > maxBefore,
      `新 ${last.time.at} > 原最大 ${maxBefore}`,
    );
    check(
      '轴上现在有六条（都是点出来的，不是填表填出来的）',
      six.length === 6,
      String(six.length),
    );
    check(
      '位置是「点哪儿落哪儿」算出来的，六条各不相同',
      new Set(six.map((e) => e.time.at)).size === 6,
      six.map((e) => e.time.at).join(' / '),
    );
    // 五条挨得不远的事摆到一起，最容易露出「名字压名字」的毛病 ——
    // 压在一起等于那几条看不见，比一个节点叠着另一个更糟（至少节点还能数出来）。
    const collisions = JSON.parse(
      await evaluate(`JSON.stringify((() => {
        const texts = [...document.querySelectorAll('[data-role=tl-axis] text.tl-node-label')];
        const rects = texts.map((t) => {
          const b = t.getBBox();
          return { s: t.textContent, x1: b.x, x2: b.x + b.width, y1: b.y, y2: b.y + b.height };
        });
        const hits = [];
        for (let i = 0; i < rects.length; i++) {
          for (let j = i + 1; j < rects.length; j++) {
            const a = rects[i], b = rects[j];
            if (a.x1 < b.x2 && b.x1 < a.x2 && a.y1 < b.y2 && b.y1 < a.y2) hits.push(a.s + ' ↔ ' + b.s);
          }
        }
        return hits;
      })())`),
    );
    check(
      '轴上的条目名没有互相压字（挨得近就上下让开，不是叠着写）',
      collisions.length === 0,
      collisions.join(' / '),
    );
    await shot('05-five-nodes.png');

    /* ---------------- 7. 拖动改先后 ---------------- */
    const beforeDrag = (await timed()).find((e) => e.title === '海面第一次上涨');
    await dragNodeTo(beforeDrag.id, 0.62);
    const afterDrag = (await timed()).find((e) => e.id === beforeDrag.id);
    check(
      '拖动节点改了它的先后（位置数值真的变了）',
      afterDrag.time.at !== beforeDrag.time.at,
      `${beforeDrag.time.at} → ${afterDrag.time.at}`,
    );
    check('拖完没有把它拖出轴（条目还在）', (await timed()).length === 6);

    /* ---------------- 8. 纪元：色带与图例 ---------------- */
    const bands = JSON.parse(
      await evaluate(
        `JSON.stringify([...document.querySelectorAll('[data-role=tl-band]')].map((r) => r.dataset.era))`,
      ),
    );
    check('同一纪元的几条连成一条色带', bands.includes('涨潮纪'), bands.join('、') || '(没有色带)');
    const legend = JSON.parse(
      await evaluate(
        `JSON.stringify([...document.querySelectorAll('[data-role=tl-legend-era]')].map((r) => r.dataset.era))`,
      ),
    );
    check(
      '图例列出了所有纪元',
      legend.includes('涨潮纪') && legend.includes('烬落纪'),
      legend.join('、'),
    );
    const emberNodes = (await nodes()).filter((n) => n.era === '烬落纪').length;
    // 点「烬落纪」那条图例 chip（不是第一个 —— 按首次出现的顺序，第一个是涨潮纪）
    await evaluate(
      `document.querySelector('[data-role=tl-legend-era][data-era=烬落纪]').click(); 'x'`,
    );
    await sleep(320);
    const filtered = await nodes();
    check(
      '点图例只看那一段：轴上只剩这个纪元的几条',
      filtered.length === emberNodes && filtered.every((n) => n.era === '烬落纪'),
      `${filtered.length} 条 / 期望 ${emberNodes}`,
    );
    await click('tl-legend-clear');
    check('能一键看回全部', (await nodes()).length === 6, `${(await nodes()).length} 条`);

    /* ---------------- 9. 轴距：比例 / 均匀 ---------------- */
    const ordersBefore = (await timed()).map((e) => `${e.id}:${e.time.at}`).join(',');
    const propX = (await nodes()).slice().sort((a, b) => a.order - b.order).map((n) => n.x);
    const propGap1 = propX[1] - propX[0];
    const propGap2 = propX[2] - propX[1];
    check(
      '按数值比例：间距反映位置数值的差（不是平均分）',
      Math.abs(propGap1 - propGap2) > 1,
      `间距 ${propGap1} / ${propGap2}`,
    );
    await click('tl-scale-even');
    await sleep(200);
    const evenX = (await nodes()).slice().sort((a, b) => a.order - b.order).map((n) => n.x);
    const evenGap1 = evenX[1] - evenX[0];
    const evenGap2 = evenX[2] - evenX[1];
    check(
      '均匀铺开：一条挨一条，间距相等',
      Math.abs(evenGap1 - evenGap2) < 2,
      `间距 ${evenGap1} / ${evenGap2}`,
    );
    await click('tl-scale-prop');
    check(
      '切回比例，位置数值一点没变（轴距只是看法，不是数据）',
      (await timed()).map((e) => `${e.id}:${e.time.at}`).join(',') === ordersBefore,
      ordersBefore,
    );

    /* ---------------- 10. 疏密 ---------------- */
    const w0 = await evaluate(
      `Number(document.querySelector('[data-role=tl-axis]').getAttribute('width'))`,
    );
    await click('tl-zoom-in');
    const w1 = await evaluate(
      `Number(document.querySelector('[data-role=tl-axis]').getAttribute('width'))`,
    );
    check('疏密：放宽之后轴变长了（挤在一起时才看得清）', w1 > w0, `${w0} → ${w1}`);
    await click('tl-relayout');
    check(
      '复位视图把轴宽、筛选、只看重大一起还原',
      (await evaluate(
        `Number(document.querySelector('[data-role=tl-axis]').getAttribute('width'))`,
      )) === w0 && (await nodes()).length === 6,
    );

    /* ---------------- 11. 选中一条：右侧快速看一眼，并看见它牵着的谁 ---------------- */
    await evaluate(
      `document.querySelector('[data-role=tl-list-row][data-id=${beforeDrag.id}]').click(); 'x'`,
    );
    await sleep(320);
    check('点列表里的一行就能选中它（右侧面板出来了）', await waitFor(`!!document.querySelector('[data-role=tl-panel]')`, 4000));
    const whenText = await evaluate(
      `document.querySelector('[data-role=tl-panel-when]')?.textContent ?? ''`,
    );
    const panelText = await evaluate(
      `document.querySelector('[data-role=tl-panel]')?.innerText ?? ''`,
    );
    check(
      '面板上看得见它的时间（念得出来，不是一个裸字段）',
      whenText.includes('元年') && panelText.includes('涨潮纪'),
      whenText.trim().slice(0, 40),
    );
    check(
      '这条还没牵谁，面板就不摆一块空的关系区（没内容就别占地方）',
      (await evaluate(`document.querySelectorAll('[data-role=tl-panel-rel]').length`)) === 0,
    );
    check(
      '面板给了下一步的去处（打开条目 / 把时间去掉）',
      (await evaluate(
        `!!document.querySelector('[data-role=tl-panel-open]') && !!document.querySelector('[data-role=tl-panel-unset]')`,
      )) === true,
    );
    await shot('06-panel.png');

    /* ---------------- 12. 排进时间轴：拖上去，或者点两下 ----------------
     * 排轴的第一步不该是填表 —— 条目早就在库里了，缺的只是「它落在什么时候」。
     * 右边那块「还没排进去」就是入口：拖到轴上任意一处，它就在那儿了；
     * 落位**不编时间文本**：位置是明确的，说法留白，节点如实画成虚线圈。 */
    const untimedNow = (await allEntries()).filter((e) => !e.time);
    const p0 = await poolRows();
    check(
      '池子里列的就是库里所有还没排进去的条目（一处不多、一处不少）',
      p0.length === untimedNow.length && untimedNow.every((e) => p0.some((h) => h.id === e.id)),
      `池子 ${p0.length} 条 / 库里没排的 ${untimedNow.length} 条`,
    );
    const timedIds = new Set((await timed()).map((e) => e.id));
    check(
      '已经在轴上的不会又冒在池子里 —— 两处加起来正好是全部条目',
      !p0.some((h) => timedIds.has(h.id)),
      p0.map((h) => h.title).join('、'),
    );

    // 「潮汐槽」是种子世界里的一条：没时间、也没关系 —— 拿它走「拖」的那一路。
    const trough = (await allEntries()).find((e) => e.title === '潮汐槽');
    check(
      '（前提）「潮汐槽」确实还没排进轴',
      !(await timed()).some((e) => e.id === trough.id),
      (await timed()).map((e) => e.title).join('、'),
    );

    await setInput('tl-pool-search', '潮汐');
    const p1 = await poolRows();
    check(
      '打字就能筛：收窄了，而且留下的每条名字里都有这个词',
      p1.length > 0 && p1.length < p0.length && p1.every((h) => h.title.includes('潮汐')),
      `${p0.length} → ${p1.length} 条：${p1.map((h) => h.title).join('、')}`,
    );
    check(
      '轴上确实没有叫「潮汐槽」的 —— 池子里那条是轴外的',
      !(await timed()).some((e) => e.title === '潮汐槽'),
    );
    check(
      '它就在筛选结果里（轴外的条目照样搜得到）',
      p1.some((h) => h.id === trough.id),
      p1.map((h) => h.id).join(','),
    );
    await setInput('tl-pool-search', '');

    /* ---- 拖：按住 → 移到轴上 → 松手 ---- */
    const maxAtBefore = Math.max(...(await timed()).map((e) => e.time.at));
    const dragMid = await poolDragTo(trough.id, 0.72);
    check('拖着的时候手指上跟着一张卡片（不是「按下去没反应」）', dragMid.card === true, JSON.stringify(dragMid));
    check('卡片上写着拖的是哪一条', dragMid.cardTitle === '潮汐槽', dragMid.cardTitle);
    check('卡片顺带说清松手会落在哪个位置', /落在 \d/.test(dragMid.cardText), dragMid.cardText);
    check('池子里那一行画淡了 —— 它正在被搬走', dragMid.row === '1', String(dragMid.row));
    check(
      '轴上出现了幽灵线，标着落点的数值',
      dragMid.ghost === true && dragMid.ghostLabel.trim() !== '',
      `${dragMid.ghost} / ${dragMid.ghostLabel}`,
    );

    const placedRow = (
      await waitStore('entries', (rows) => rows.some((e) => e.id === trough.id && e.time))
    ).find((e) => e.id === trough.id);
    check(
      '松手就排好了 —— 库里真的有了位置（不是只在界面上画了画）',
      !!placedRow?.time,
      JSON.stringify(placedRow?.time),
    );
    check(
      '落点就是拖到的地方，不是一律排到末尾',
      typeof placedRow.time.at === 'number' && placedRow.time.at < maxAtBefore && placedRow.time.at > 0,
      `落点 ${placedRow.time.at}，原有最大 ${maxAtBefore}`,
    );
    check(
      '没有替他编时间文本 —— 只给了位置，说法留白',
      placedRow.time.from === '' && placedRow.time.kind === 'point',
      JSON.stringify(placedRow.time),
    );
    const troughNode = (await nodes()).find((n) => n.id === trough.id);
    check('轴上出现了它', !!troughNode, (await nodes()).map((n) => n.id).join(','));
    check(
      '而且如实标成「位置定了、时间文字还没写」（虚线圈）',
      troughNode?.notime === '1',
      JSON.stringify(troughNode),
    );
    check(
      '图例里交代了虚线圈是什么意思（不然没人看得懂）',
      (await evaluate(`!!document.querySelector('[data-role=tl-notime-legend]')`)) === true,
    );
    check(
      '拖完它就从池子里没了 —— 同一件事不会同时挂在两处',
      !(await poolRows()).some((h) => h.id === trough.id),
    );
    check(
      '轴下那份「按时间排开」里立刻有它',
      (
        await evaluate(
          `[...document.querySelectorAll('[data-role=tl-list-row]')].map((r) => r.dataset.id).join(',')`,
        )
      ).includes(trough.id),
    );
    check(
      '拖完顺手选中它 —— 接着就能在右边把时间说清楚',
      (await evaluate(`document.querySelector('[data-role=tl-panel]')?.dataset.id ?? ''`)) === trough.id,
    );
    await shot('07-pool-drag.png');

    /* ---- 点两下：点一下池子里的条目，再点轴上任意一处 ----
     * 「余烬教团」在种子世界里牵着「涨潮纪」，留给第 13 节验「面板读的是库里的关系」。
     * 顺带也是个回归点：上一次拖拽是在轴上松的手，那之后**第一次点击**必须照常算数
     * （不能因为「上一次是拖」就被吃掉）。 */
    const ember = (await allEntries()).find((e) => e.title === '余烬教团');
    await clickPoolRow(ember.id);
    check(
      '点一下池子里的条目 = 等着落位（横幅说清这一下要干什么）',
      await waitFor(`!!document.querySelector('[data-role=tl-place-banner]')`, 4000),
    );
    const bannerText = await evaluate(
      `document.querySelector('[data-role=tl-place-banner]')?.innerText ?? ''`,
    );
    check('横幅里点名了是哪一条', bannerText.includes('余烬教团'), bannerText.split('\n')[0]);

    await hoverAxisAt(0.35);
    const hoverGhost = JSON.parse(
      await evaluate(`JSON.stringify({
        ghost: !!document.querySelector('.tl-ghost-line'),
        label: document.querySelector('.tl-ghost-label')?.textContent ?? '' })`),
    );
    check(
      '指针在轴上，幽灵线先亮出会落在哪个数',
      hoverGhost.ghost === true && hoverGhost.label.trim() !== '',
      JSON.stringify(hoverGhost),
    );

    const axisCount = (await nodes()).length;
    await clickAxisAt(0.35);
    const emberRow = (
      await waitStore('entries', (rows) => rows.some((e) => e.id === ember.id && e.time))
    ).find((e) => e.id === ember.id);
    check('再点轴上任意一处就落位了', !!emberRow?.time, JSON.stringify(emberRow?.time));
    check('轴上多了一条', (await nodes()).length === axisCount + 1, `${axisCount} → ${(await nodes()).length}`);
    check(
      '落位之后「等着落位」自己收掉了（不用再手动退）',
      (await evaluate(`!!document.querySelector('[data-role=tl-place-banner]')`)) === false,
    );

    /* ---- Esc 也能退，而且什么都不改 ----
     * 这一路用 `.click()`（`detail === 0`）走键盘那条入口 —— 顺手把辅助通道也验了。 */
    const tideEntry = (await allEntries()).find((e) => e.title === '涨潮纪');
    await evaluate(`document.querySelector('[data-role=tl-pool-row][data-id=${tideEntry.id}]').click(); 'x'`);
    await waitFor(`!!document.querySelector('[data-role=tl-place-banner]')`, 4000);
    await shot('07b-place-pending.png');
    await evaluate(`window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' })); 'x'`);
    await sleep(300);
    check(
      '按 Esc 能退出「等着落位」，而且没有偷偷把它排进去',
      (await evaluate(`!!document.querySelector('[data-role=tl-place-banner]')`)) === false &&
        !(await allEntries()).find((e) => e.id === tideEntry.id).time,
      '「涨潮纪」仍然没时间',
    );

    /* ---- 说得更细：面板里直接改，改完立刻生效 ----
     * 落位只给了位置。要把「什么时候」说成人话，就在这儿写 —— 不必翻进条目编辑器
     * 翻到「时间」那一页（那一页打开时默认还在「内容」上，等于要翻两次）。 */
    await evaluate(`document.querySelector('[data-role=tl-list-row][data-id=${trough.id}]').click(); 'x'`);
    await sleep(320);
    check(
      '面板里就有「它什么时候」这一块',
      (await evaluate(`!!document.querySelector('[data-role=tl-quick]')`)) === true,
    );

    await setInput('tl-quick-from', '涨潮纪 1 年');
    const afterFrom = (await allEntries()).find((e) => e.id === trough.id);
    check(
      '写下的时间文本立刻落库（不是要再按一次保存）',
      afterFrom?.time?.from === '涨潮纪 1 年',
      JSON.stringify(afterFrom?.time),
    );
    check(
      '面板顶上的「它什么时候」当场跟着改',
      (
        await evaluate(`document.querySelector('[data-role=tl-panel-when]')?.textContent ?? ''`)
      ).includes('涨潮纪 1 年'),
    );

    const rBefore = (await nodes()).find((n) => n.id === trough.id).r;
    await click('tl-quick-weight-major');
    const afterWeight = (await allEntries()).find((e) => e.id === trough.id);
    check('点一下「分量」就存下来了', afterWeight?.time?.weight === 'major', afterWeight?.time?.weight);
    check(
      '轴上那条当场画得更大（改的是同一份数据，不是另存一份）',
      (await nodes()).find((n) => n.id === trough.id).r > rBefore,
      `r ${rBefore} → ${(await nodes()).find((n) => n.id === trough.id).r}`,
    );

    await setInput('tl-quick-era', '涨潮纪');
    await click('tl-quick-kind-range');
    await setInput('tl-quick-to', '涨潮纪 40 年');
    const afterRange = (await allEntries()).find((e) => e.id === trough.id);
    check(
      '换成「一段」之后终结那一栏才出现，而且存下来了',
      afterRange?.time?.kind === 'range' && afterRange.time.to === '涨潮纪 40 年',
      JSON.stringify(afterRange?.time),
    );
    check('纪元也存下来了（轴上会连成色带）', afterRange.time.era === '涨潮纪', afterRange.time.era);

    await setInput('tl-quick-at', '7');
    const afterAt = (await allEntries()).find((e) => e.id === trough.id);
    check('面板里能直接写精确位置（更细的规划就用它）', afterAt?.time?.at === 7, String(afterAt?.time?.at));
    const movedNode = (await nodes()).find((n) => n.id === trough.id);
    check('写完之后节点落到了「7」该在的地方', movedNode?.order === 7, JSON.stringify(movedNode));
    check(
      '时间文字补齐之后虚线圈就没了 —— 它不再是「待补」',
      movedNode?.notime === '0',
      JSON.stringify(movedNode),
    );
    await shot('07c-quick-time.png');

    /* ---------------- 12b. AI 自动排版：提案进审查队列，采纳才动轴 ----------------
     * 这一支的主张：**AI 只提议，改不改是作者的事**。三件事都得验到 ——
     * ① 按下之后它进的是**任务队列**（右下角看得见、切页也不断），不是当场跑；
     * ② 出的是**一份方案**，先落在审查队列里，而轴上一点不动；
     * ③ 采纳（或「改一改再采纳」）之后位置才真的变，而且变的是条目本身。
     */
    // 假上游的「慢回包」是**跨脚本共享**的状态：先给 600ms，不然它瞬时回完，
    // 「正在跑」那一刻根本抓不到，这一节就成了靠碰运气 sleep。跑完立刻归零（见本节末尾）。
    await mockCmd('/__mock-stats/reset');
    await mockCmd('/__mock-delay?ms=600');

    const axisBefore = await axisSig();
    const plansBefore = (await reviewOf('timeline-layout')).length;

    // 「AI 自动排版」现在藏在「AI 行为」下拉里：先点开菜单再点二级命令
    await click('tl-ai-toggle');
    await click('tl-ai-layout');
    // 点完菜单就收起来了；再点开一次，看那条二级命令已经进入「正在排版」（disabled）
    await click('tl-ai-toggle');
    check(
      '按下之后这条命令进入「正在排版」（这一下是**入队**，不是当场跑完）',
      await waitFor(`document.querySelector('[data-role=tl-ai-layout]')?.disabled === true`, 4000),
    );
    await click('tl-ai-toggle');
    // 展开右下角那份队列：它是收起态的，不点开就只有一个胶囊，什么都读不到
    await click('task-dock-toggle');
    await sleep(220);
    const dockText = await evaluate(
      `document.querySelector('[data-role=task-dock-panel]')?.innerText ?? ''`,
    );
    check(
      '它排进了右下角那条任务队列（看得出是「为谁排一遍」）',
      dockText.includes('排一遍时间轴'),
      dockText.split('\n').slice(0, 3).join(' · '),
    );
    await shot('08-layout-queued.png');

    // 等它出方案：这件活儿的回执会说清「提交了几处待确认」
    await waitFor(
      `(document.querySelector('[data-role=task-job-status]')?.textContent || '').includes('等你在审查队列里确认')`,
      25000,
    );
    const jobNote = await evaluate(
      `document.querySelector('[data-role=task-job-status]')?.textContent ?? ''`,
    );
    check('做完的回执说清了「提交了几处改动待确认」', jobNote.includes('3 处改动'), jobNote);
    check(
      '**采纳之前，轴上的位置一个都没动**（AI 只提议，不替你改）',
      (await axisSig()) === axisBefore,
      await axisSig(),
    );
    const plans = await reviewOf('timeline-layout');
    check(
      '出的是一份排版方案，先落在审查队列里（0 → 1，而且是待你决定）',
      plans.length === plansBefore + 1 && plans[0].status === 'pending',
      `${plansBefore} → ${plans.length}`,
    );
    // 一个看不见「每条此刻排在哪儿」的模型根本排不了版 —— 这一句验的就是提示词里带着现状
    const ms = await mockStats();
    check(
      '提示词真的把「现在排在哪儿、什么纪元」交给了模型',
      (ms.layoutParsed ?? 0) >= 3 && ms.byBranch?.['timeline-layout'] === 1,
      `读回 ${ms.layoutParsed} 条 / 调了 ${ms.byBranch?.['timeline-layout']} 次`,
    );

    /* ---- 轴上那条横幅：提了案，就得让人一眼看到案子在哪 ---- */
    const planBanner = await evaluate(
      `document.querySelector('[data-role=tl-layout-plan]')?.innerText ?? ''`,
    );
    check(
      '轴上点明了「有一份方案等你确认」+ 几处改动',
      planBanner.includes('等你确认') && planBanner.includes('3'),
      planBanner.split('\n')[0],
    );
    await click('tl-layout-go');
    await waitFor(`!!document.querySelector('[data-role=rv-layout]')`, 10000);
    check(
      '横幅上的「去审查」直接落到审查队列',
      (await evaluate(`document.querySelector('.page-title')?.textContent ?? ''`)).includes('审查'),
    );

    /* ---- 整张方案读一遍 ---- */
    const planRows = async () =>
      JSON.parse(
        await evaluate(`JSON.stringify([...document.querySelectorAll('[data-role=rv-layout-row]')].map((r) => ({
          id: r.dataset.id, at: Number(r.dataset.at), from: r.dataset.from,
          reason: r.querySelector('[data-role=rv-layout-reason]')?.textContent ?? '' })))`),
      );
    const rows1 = await planRows();
    check('整张方案摆在一张表里（一行一条，不是 N 张各说各的卡）', rows1.length === 3, `${rows1.length} 行`);
    check(
      '每行都写着「从哪儿 → 到哪儿」—— 原本就没排进轴的那条如实留白，不编一个假的前位',
      rows1.every((r) => r.at > 0) && rows1.filter((r) => r.from === '').length === 1,
      rows1.map((r) => `${r.from || '（未排进轴）'}→${r.at}`).join(' , '),
    );
    const tideRow = rows1.find((r) => r.id === tideEntry.id);
    check(
      '原本在池子里的那条被标成「未排进轴 → 111」',
      !!tideRow && tideRow.from === '' && tideRow.at === 111,
      JSON.stringify(tideRow),
    );
    check(
      '每行都带着 AI 的依据（看得见它凭什么这么排）',
      rows1.every((r) => r.reason.length > 6),
      rows1.map((r) => r.reason.slice(0, 8)).join(' | '),
    );
    const emberFrom = (await allEntries()).find((e) => e.id === ember.id)?.time?.from ?? '';
    await shot('08b-layout-plan.png');

    /* ---- 改一改再采纳：不勾的不改，位置还能逐条调 ----
     * 这是「整批采纳」给不了的粒度 —— AI 排的十条里常常只想按其中几条。 */
    await click('review-edit');
    await waitFor(`!!document.querySelector('[data-role=rv-layout-edit-row]')`, 4000);
    const editRowCount = await evaluate(
      `document.querySelectorAll('[data-role=rv-layout-edit-row]').length`,
    );
    check(
      '「改一改再采纳」打开的是**逐行清单**（不是条目正文那套表单）',
      editRowCount === 3,
      `${editRowCount} 行`,
    );
    await evaluate(`(() => {
      const rows = [...document.querySelectorAll('[data-role=rv-layout-edit-row]')];
      rows[1].querySelector('[data-role=rv-layout-edit-on]').click();
      const el = rows[2].querySelector('[data-role=rv-layout-edit-at]');
      const set = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
      set.call(el, '500');
      el.dispatchEvent(new Event('input', { bubbles: true }));
      return 'edited';
    })()`);
    await sleep(240);
    await click('rv-layout-edit-save');
    await sleep(360);
    const rows2 = await planRows();
    check(
      '不勾的那条从方案里退了出去（只按你想按的）',
      rows2.length === 2 && !rows2.some((r) => r.id === trough.id),
      rows2.map((r) => r.id).join(','),
    );
    check(
      '改过的位置留在方案上（333 → 500）',
      rows2.some((r) => r.id === ember.id && r.at === 500),
      JSON.stringify(rows2),
    );

    /* ---- 采纳：到这一步才真的写库 ---- */
    await click('review-accept');
    await sleep(1200);
    const tideAfter = (await allEntries()).find((e) => e.id === tideEntry.id);
    const emberAfter = (await allEntries()).find((e) => e.id === ember.id);
    const troughAfter = (await allEntries()).find((e) => e.id === trough.id);
    check(
      '采纳之后「涨潮纪」真的排上了轴（位置 111，纪元也补上了）',
      tideAfter?.time?.at === 111 && tideAfter.time.era === '涨潮纪',
      JSON.stringify(tideAfter?.time),
    );
    check(
      '**它没有替作者编一个日期**：位置定了，时间文字还是空的（轴上仍画虚线圈）',
      tideAfter?.time?.from === '',
      JSON.stringify(tideAfter?.time?.from),
    );
    check(
      '改过的位置按改后的落（500，不是 AI 给的 333）',
      emberAfter?.time?.at === 500,
      String(emberAfter?.time?.at),
    );
    check(
      '分量那一档也落了（AI 说的 major 写进去了）',
      emberAfter?.time?.weight === 'major',
      String(emberAfter?.time?.weight),
    );
    check(
      '没勾的那条一动不动（它自己的时间文字也没被碰过）',
      troughAfter?.time?.at === 7,
      String(troughAfter?.time?.at),
    );
    check(
      'AI 一个字都没改时间文本（原样留着作者写的说法）',
      emberAfter?.time?.from === emberFrom,
      `${emberFrom} → ${emberAfter?.time?.from}`,
    );

    /* ---- 回到轴上看：位置真的变了，方案也不在待确认里了 ---- */
    await openTimeView();
    const tideNode = (await nodes()).find((n) => n.id === tideEntry.id);
    check(
      '轴上多出了它，而且落在「111」该在的地方',
      !!tideNode && tideNode.order === 111,
      JSON.stringify(tideNode),
    );
    check(
      '方案已经不在「待确认」里了（横幅收掉了）',
      (await evaluate(`!!document.querySelector('[data-role=tl-layout-plan]')`)) === false,
    );

    /* ---- 再来一遍：位置全对时，它该如实说「不用改」，而不是再摆一份 ---- */
    await mockCmd('/__mock-delay?ms=0');
    const sigBefore2 = await axisSig();
    await click('tl-ai-toggle');
    await click('tl-ai-layout');
    const saidNoChange = await waitFor(
      `(document.querySelector('[data-role=task-job-status]')?.textContent || '').includes('已经对了')`,
      25000,
    );
    check(
      '第二遍它说「现在的顺序已经对了，没有改动」—— 而不是再摆一份一模一样的方案出来',
      saidNoChange,
      await evaluate(`document.querySelector('[data-role=task-job-status]')?.textContent ?? ''`),
    );
    check(
      '所以审查队列里没有多出第二份方案',
      (await reviewOf('timeline-layout')).length === 1,
      String((await reviewOf('timeline-layout')).length),
    );
    check('轴上也没被重排一遍（零处改动就是零处）', (await axisSig()) === sigBefore2, await axisSig());
    await shot('08c-layout-applied.png');

    /* ---------------- 13. 刷新之后还在（轴读的是条目，不是页面状态） ---------------- */
    await client.send('Page.reload');
    await sleep(1900);
    await openTimeView();
    // 拿库里的条数当基准，而不是写死一个数字 —— 数字一变，断言就得跟着改，
    // 那种「改数据」的噪音会掩盖真正的回归。
    const timedNow = (await timed()).length;
    const backOk = await waitFor(
      `document.querySelectorAll('[data-role=tl-node]').length === ${timedNow}`,
      20000,
    );
    check('刷新之后排好的都还在（不是页面里的临时状态）', backOk, `库里 ${timedNow} 条`);
    const titles = await evaluate(
      `[...document.querySelectorAll('[data-role=tl-list-row]')]
         .map((r) => r.querySelector('.tl-list-title')?.textContent || '').join('|')`,
    );
    check(
      '顺序与内容都没变',
      titles.includes('海面第一次上涨') && titles.includes('余烬教团分裂') && titles.includes('潮汐槽'),
      titles,
    );
    check(
      '面板里刚写的时间文本也还在',
      (
        await evaluate(
          `document.querySelector('[data-role=tl-list-row][data-id=${trough.id}]')?.innerText ?? ''`,
        )
      ).includes('涨潮纪 1 年'),
    );

    // 面板上「它牵着的条目」读的必须是库里的关系，不是页面里攒的临时状态 ——
    // 所以换一条**已经有关系**的（种子世界里的「余烬教团」牵着「涨潮纪」）来看。
    await evaluate(
      `document.querySelector('[data-role=tl-list-row][data-id=${ember.id}]').click(); 'x'`,
    );
    await sleep(320);
    const relBack = await evaluate(`document.querySelectorAll('[data-role=tl-panel-rel]').length`);
    const relsOfEmber = JSON.parse(await readStore('relations')).filter(
      (r) => r.fromEntryId === ember.id || r.toEntryId === ember.id,
    ).length;
    check(
      '「它牵着的条目」念的就是库里的关系（刷新之后一条不少）',
      relBack === relsOfEmber,
      `面板 ${relBack} 条 / 库里 ${relsOfEmber} 条`,
    );
    const relText = await evaluate(
      `[...document.querySelectorAll('[data-role=tl-panel-rel]')].map((b) => b.innerText).join('|')`,
    );
    check('念得出牵的是谁、是什么关系', relText.includes('涨潮纪') && relText.includes('把持'), relText);

    /* ---------------- 14. 去掉时间 = 离开轴，不是删条目 ---------------- */
    const victim = (await timed()).find((e) => e.title === '余烬教团分裂');
    await evaluate(
      `document.querySelector('[data-role=tl-list-row][data-id=${victim.id}]').click(); 'x'`,
    );
    await sleep(320);
    await click('tl-panel-unset');
    await sleep(700);
    const victimAfter = (await allEntries()).find((e) => e.id === victim.id);
    check(
      '去掉时间之后条目本身还在（只是没有「什么时候」了）',
      !!victimAfter && victimAfter.time === undefined,
      JSON.stringify(victimAfter?.time ?? null),
    );
    check(
      '它从轴上消失了',
      (await nodes()).every((n) => n.id !== victim.id),
      `${(await nodes()).length} 条留在轴上`,
    );

    await evaluate(`document.querySelector('[data-role=nav-log]').click(); 'go'`);
    await waitFor(`!!document.querySelector('[data-role=log-undo]')`, 10000);
    const logText = await evaluate(`document.body.innerText`);
    check(
      '这一步在操作日志里留了痕，而且认得出是哪一条（可退回）',
      logText.includes('余烬教团分裂'),
      logText.split('\n').filter((l) => l.includes('余烬教团分裂')).join(' | ').slice(0, 80),
    );
    await click('log-undo');
    await sleep(1000);
    const victimRestored = (await allEntries()).find((e) => e.id === victim.id);
    check(
      '撤销之后时间回来了 —— 轴上的一次误操作不会真的丢数据',
      !!victimRestored?.time && victimRestored.time.from === '烬落纪 3 年',
      JSON.stringify(victimRestored?.time),
    );

    /* ---------------- 15. 旧版「时间线事件」一次性迁成条目 ---------------- */
    // 旧表还留在库里（不升 DB_VERSION 的代价就是它得留一阵子），但只作迁移来源。
    // 换一条世界，看它是不是真的把老账折成了条目 —— 而且只折一次。
    check('预置第二条世界（上面记着旧版时间线事件）', (await evaluate(SEED_B)) === 'seeded');
    widCache = null;
    await client.send('Page.reload');
    await sleep(2100);
    const legacyEntries = await allEntries();
    const migrated = legacyEntries.filter((e) => e.time);
    check(
      '旧的两件事都变成了**条目**（一件事件 = 一条带时间的条目）',
      migrated.length === 2 &&
        migrated.some((e) => e.title === '灯塔落成') &&
        migrated.some((e) => e.title === '潮律颁行'),
      migrated.map((e) => e.title).join('、'),
    );
    const keptEvent = migrated.find((e) => e.title === '灯塔落成');
    check(
      '时间、纪元、分量、正文全都照带过来了',
      keptEvent?.time?.from === '旧历 3 年' &&
        keptEvent?.time?.era === '旧历' &&
        keptEvent?.time?.weight === 'major' &&
        (keptEvent?.content ?? '').includes('第一座灯塔'),
      JSON.stringify({ f: keptEvent?.time?.from, e: keptEvent?.time?.era, w: keptEvent?.time?.weight }),
    );
    check(
      '轴上的先后一点没乱（位置沿用了原来的次序）',
      migrated.find((e) => e.title === '灯塔落成').time.at <
        migrated.find((e) => e.title === '潮律颁行').time.at,
      migrated.map((e) => `${e.title}:${e.time.at}`).join(' / '),
    );
    const legacyRels = JSON.parse(await readStore('relations')).filter(
      (r) => r.worldId === 'wd_legacy',
    );
    check(
      '「这件事牵涉到谁」转成了关系（图谱里的连线因此没丢）',
      legacyRels.length === 2 &&
        legacyRels.every((r) => r.status === 'pending') &&
        legacyRels.some((r) => r.toEntryId === 'en_keep') &&
        legacyRels.some((r) => r.toEntryId === 'en_law'),
      legacyRels.map((r) => `${r.fromEntryId}→${r.toEntryId}`).join(' / '),
    );
    const legacyLeft = JSON.parse(await readStore('timeline')).filter(
      (e) => e.worldId === 'wd_legacy',
    );
    check('迁完旧表清空（它已经变成条目了，不该两份并存）', legacyLeft.length === 0, `${legacyLeft.length} 条残留`);
    const legacyWorld = JSON.parse(await readStore('worlds')).find((w) => w.id === 'wd_legacy');
    check(
      '迁移闸门关上了（只迁一次，不会每次打开都重复迁）',
      typeof legacyWorld?.timelineMigratedAt === 'number',
      String(legacyWorld?.timelineMigratedAt),
    );
    const migrateOps = JSON.parse(await readStore('ops')).filter(
      (o) => o.target === '旧账世界' && (o.detail ?? '').includes('迁'),
    );
    check('操作日志里留了痕（替作者改库，他得看得见）', migrateOps.length >= 1, `${migrateOps.length} 条`);

    // 再刷一次：不许又长出一份
    await client.send('Page.reload');
    await sleep(2000);
    const again = (await allEntries()).filter((e) => e.time);
    check(
      '再打开一次不会重复迁（迁移是幂等的）',
      again.length === 2 && (await timed()).length === 2,
      `${again.length} 条`,
    );

    // 迁过来的两条在轴上画得出来（台账对不代表界面认）
    await openTimeView();
    const legacyAxis = await waitFor(
      `document.querySelectorAll('[data-role=tl-node]').length === 2`,
      12000,
    );
    check('迁过来的两条在轴上真的画得出来', legacyAxis);
    await shot('07-migrated.png');

    // 选中迁过来的一条：右侧面板得列出它的「牵涉」—— 这正是「关系就是关系，
    // 不用另存一份」那句主张要验的东西（旧版是把 linkedEntryIds 抄在事件自己身上的，
    // 于是同一件事有两份说法、迟早对不上）。
    await evaluate(
      `document.querySelector('[data-role=tl-list-row][data-id=${keptEvent.id}]').click(); 'x'`,
    );
    await sleep(340);
    const migRel = await evaluate(
      `JSON.stringify([...document.querySelectorAll('[data-role=tl-panel-rel]')].map((b) => b.textContent.trim()))`,
    );
    check(
      '面板上列出了它牵涉的条目（迁过来的牵连变成了真关系）',
      migRel.includes('守灯人'),
      migRel,
    );
    // 牵涉的那条自己没在轴上（它没设时间）—— 点它就该直接把条目打开，
    // 而不是把人卡在「这一条找不到」上。
    await click('tl-panel-rel');
    check(
      '点它 → 那条不在轴上，就直接开它的条目编辑器',
      await waitFor(`!!document.querySelector('[data-role=entry-title]')`, 5000),
    );
    await click('entry-close');
    await sleep(300);

    /* ---------------- 16. 导出设定集：那一章「大事记」= 设了时间的条目 ---------------- */
    await evaluate(`document.querySelector('[data-role=nav-export]').click(); 'go'`);
    const expOk = await waitFor(`!!document.querySelector('[data-role=exp-include-timeline]')`, 12000);
    check('导出页认得出这一块（「大事记」那个选项还在）', expOk);
    const readMd = async () =>
      evaluate(`document.querySelector('[data-role=exp-preview]')?.innerText || ''`);
    const md = await readMd();
    const seg = md.includes('## 大事记') ? md.split('## 大事记')[1].split('\n## ')[0] : '';
    check('设定集里有一章「大事记」', !!seg, seg.slice(0, 60).replace(/\n/g, ' '));
    check(
      '按纪元分成小节（同一段时间读起来是连着的）',
      seg.includes('### 旧历'),
      (seg.match(/^### .+$/gm) || []).join(' / '),
    );
    check(
      '一条事件那段读得出「什么时候」（一起头就写时间，不是只有标题）',
      seg.includes('旧历 3 年') && seg.includes('灯塔落成'),
      seg.split('\n').find((l) => l.includes('灯塔落成')) ?? '',
    );
    const ordered = (await timed()).map((e) => e.title);
    const idx = ordered.map((x) => seg.indexOf(x));
    check(
      '大事记里的先后与轴上的先后一致（不是随便一个顺序）',
      idx.every((v) => v >= 0) && idx.every((v, i) => i === 0 || v > idx[i - 1]),
      ordered.join(' → '),
    );
    check(
      '它牵着的条目在导出稿里是能跳转的内链（不是 [[ ]] 方括号）',
      seg.includes('[守灯人](#守灯人)') && !seg.includes('[[守灯人]]'),
      seg.split('\n').filter((l) => l.includes('关联')).join(' | '),
    );
    /* 用户点名的：导出稿里不许再出现裸的 [[ ]] 语法，目录也得是真链接 */
    check(
      '整份设定集里没有残留的 [[ ]] 内链语法',
      !/\[\[[^\]\n]+\]\]/.test(md),
      (md.match(/\[\[[^\]\n]+\]\]/g) || []).slice(0, 3).join(' | '),
    );
    check(
      '目录里的条目是能跳回去的链接',
      md.includes('- [守灯人](#守灯人)') || md.includes('  - [守灯人](#守灯人)'),
      (md.match(/- \[[^\]]+\]\(#[^)]+\)/g) || []).slice(0, 3).join(' | '),
    );
    await click('exp-include-timeline');
    const mdOff = await readMd();
    check(
      '关掉这个选项，大事记整章就不写了（导出范围由作者定）',
      !mdOff.includes('## 大事记') && mdOff.length < md.length,
      `${md.length} → ${mdOff.length}`,
    );
    await click('exp-include-timeline');
    await shot('08-export.png');

    /* ---------------- 17. 收尾 ---------------- */
    await openTimeView();
    await sleep(400);
    await shot('09-final.png');
    const uncaught = client.events.filter((e) => e.method === 'Runtime.exceptionThrown');
    check(
      '没有未捕获异常',
      uncaught.length === 0,
      uncaught
        .map((e) => e.params.exceptionDetails?.exception?.description ?? '')
        .join(' | ')
        .slice(0, 240),
    );
    const logErrors = client.events
      .filter((e) => e.method === 'Log.entryAdded' && e.params.entry.level === 'error')
      .map((e) => ({ url: e.params.entry.url || '', text: e.params.entry.text || '' }))
      // 假上游发不发 CORS 头是**启动参数**（`--cors`）决定的，不是产品行为：不发时浏览器拦下
      // 直连、应用自动改走本机转发（`e2e-onboarding` 专门验的就是那条路）。这一类日志跟本页
      // 要验的东西无关，留着只会让这条断言无辜变红、还指不到真凶 —— 所以先剔出去。
      .filter((e) => {
        const host = MOCK_ORIGIN.replace(/^https?:\/\//, '');
        return (
          !e.url.includes(host) && !e.text.includes(host) && !/blocked by CORS policy/.test(e.text)
        );
      })
      .map((e) => e.text);
    check('控制台没有 error 级日志', logErrors.length === 0, logErrors.join(' | ').slice(0, 600));
  } catch (e) {
    fatal = e;
  } finally {
    try {
      chrome.kill();
    } catch {
      /* ignore */
    }
  }

  const failed = results.filter((r) => !r.ok);
  console.log(`\n时间轴端到端：${results.length - failed.length}/${results.length}`);
  if (fatal) {
    console.error('运行中断：', fatal.message);
    process.exitCode = 1;
  }
  if (failed.length) process.exitCode = 1;
}

main();
