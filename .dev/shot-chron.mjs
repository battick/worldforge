/**
 * 开发期工具：给「编年」视图预置一个**有内容的演示世界**并截图。
 *
 * 为什么不拿真库截图：无头浏览器用的是临时 profile，库永远是空的；而这一页要
 * 评的是「条目一多、纪元一分段之后还看不看得下去」，空库根本看不出问题。
 * 所以这里造一份形状齐全的数据 —— 三个纪元、四种形态、三种分量的条目都有。
 *
 * 用法：node .dev/shot-chron.mjs [outPrefix]
 * 前置：npx vite build && node server.mjs（5188）
 */
import { spawn } from 'node:child_process';
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const CHROME = 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const APP_URL = process.env.APP_URL || 'http://127.0.0.1:5188/';
const PREFIX = process.argv[2] || '.shots/chron';
const PORT = 9399;
const profile = mkdtempSync(join(tmpdir(), 'cdp-chron-'));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
/** 版式自检没过就置上，最后用它决定退出码 */
let layoutFail = false;

/**
 * 演示世界：一个海面逐年上涨的沿岸世界。
 *
 * 数据的形状是**刻意挑的**，每一类都要有一件，否则那一块等于没验：
 *   · 三个纪元（前潮纪 / 涨潮纪 / 退潮纪）—— 纪元带要分得出段；
 *   · 四种形态（时间点 / 一段给了终点 / 一段没给终点 / 至今）—— 轨上的画法各不相同；
 *   · 三种分量都有 —— 卡片大小与菱形大小的层级才看得出来；
 *   · 一件跨纪元的（内迁潮）—— 区间条会同时压在两条纪元带上；
 *   · 两件落在同一刻的 —— 卡片竖着错开那一档要能看见。
 */
const SEED = `(async () => {
  try {
    // **不写死版本号**：库的真实版本由应用自己定，写死会在应用升级后撞上
    // 「requested version is less than the existing version」。这里只借用它的库名。
    const open = indexedDB.open('worldforge');
    const db = await new Promise((res, rej) => {
      open.onsuccess = () => res(open.result);
      open.onerror = () => rej(open.error);
    });
    const t = Date.now();
    const wid = 'wd_chron';
    const world = {
      id: wid, name: '原初宇宙', tagline: '海面每年上涨三尺',
      summary: '## 概览\\n\\n潮水逐年上涨，沿岸城邦的内迁史。',
      genre: '低魔海洋', tone: '冷峻克制', themeColor: '#2f6fb0',
      createdAt: t, updatedAt: t,
    };
    const cats = [
      { id: 'ct_place', worldId: wid, name: '地点', icon: '🗺️', fieldDefs: [], order: 0, createdAt: t, updatedAt: t },
      { id: 'ct_org', worldId: wid, name: '势力', icon: '⚑', fieldDefs: [], order: 1, createdAt: t, updatedAt: t },
      { id: 'ct_event', worldId: wid, name: '事件', icon: '❖', fieldDefs: [], order: 2, createdAt: t, updatedAt: t },
      { id: 'ct_law', worldId: wid, name: '律条', icon: '§', fieldDefs: [], order: 3, createdAt: t, updatedAt: t },
    ];
    const mk = (o) => Object.assign({
      worldId: wid, aliases: [], tags: [], fields: {}, status: 'canon',
      sourceRefs: [], content: '## 概览\\n\\n正文。', createdAt: t, updatedAt: t,
    }, o);
    const tm = (kind, from, to, at, toAt, era, weight) => {
      const o = { kind, from, to, era, weight, at };
      if (toAt !== undefined) o.toAt = toAt;
      return o;
    };
    const entries = [
      // —— 前潮纪 ——
      mk({ id: 'e_zhong', categoryId: 'ct_place', title: '沉钟',
        summary: '海底传上来的钟声，比潮水早出现十一年。没人找得到那座钟。',
        time: tm('point', '前潮纪三年', '', 3, undefined, '前潮纪', 'minor') }),
      mk({ id: 'e_jitan', categoryId: 'ct_org', title: '祭潮坛',
        summary: '前潮纪唯一的公共建筑，后来被海水围成一座孤岛，再后来连岛也没了。',
        time: tm('range', '前潮纪五年', '涨潮纪十二年', 5, 12, '前潮纪', 'normal') }),

      // —— 涨潮纪 ——
      mk({ id: 'e_tide', categoryId: 'ct_law', title: '涨潮纪',
        summary: '以海面第一次上涨为元年的历法。它先是观测记录，两百年后才被追认成纪年。',
        time: tm('range', '元年', '四十八年', 9, 48, '涨潮纪', 'major') }),
      mk({ id: 'e_gan', categoryId: 'ct_place', title: '巡检港',
        summary: '海上巡检体系的母港。选址争议了九年，理由是「这里迟早要淹」——说对了。',
        time: tm('point', '涨潮纪九年', '', 9, undefined, '涨潮纪', 'major') }),
      mk({ id: 'e_si', categoryId: 'ct_org', title: '巡察司',
        summary: '掌巡检、测绘与水情。它的档案是后世唯一可信的潮位记录。',
        time: tm('range', '涨潮纪十四年', '涨潮纪三十九年', 14, 39, '涨潮纪', 'normal') }),
      mk({ id: 'e_zou', categoryId: 'ct_event', title: '走潮',
        summary: '每年最大的一次潮，沿岸各港在那一夜同时敲钟。',
        time: tm('point', '涨潮纪二十二年', '', 22.05, undefined, '涨潮纪', 'minor') }),
      mk({ id: 'e_sheng', categoryId: 'ct_law', title: '潮位册',
        summary: '巡察司逐年记下的水位。数字到后来密得看不清，只能画成线。',
        time: tm('range', '涨潮纪十八年', '', 18, undefined, '涨潮纪', 'minor') }),

      // —— 退潮纪 ——
      // 位置刻意挨着涨潮纪收尾（22 之后就是 25）—— 隔开二三十年的话，整条轴中间会空出
      // 一大片，截出来的图看不出「卡片一多好不好看」，只看得见「这里没东西」。
      mk({ id: 'e_bei', categoryId: 'ct_place', title: '巡检碑',
        summary: '退潮后露出的石碑，记着涨潮纪最高的一次水位。碑文至今没读全。',
        time: tm('point', '退潮纪三年', '', 26, undefined, '退潮纪', 'minor') }),
      mk({ id: 'e_deng', categoryId: 'ct_place', title: '灯台',
        summary: '退潮纪第一座，立在原来的港址上。潮水退到碑下三尺半。',
        time: tm('point', '退潮纪二年', '', 25, undefined, '退潮纪', 'normal') }),
      mk({ id: 'e_lv', categoryId: 'ct_law', title: '潮律',
        summary: '沿岸通行的律条，核心只有一句：碑线以下，不许再建。',
        time: tm('range', '退潮纪五年', '退潮纪二十一年', 27, 36, '退潮纪', 'normal') }),
      mk({ id: 'e_yu', categoryId: 'ct_org', title: '余烬教团',
        summary: '把持历法的教团。它坚持潮水还会回来，所以一年也没停止过测水位。',
        time: tm('ongoing', '退潮纪八年', '', 29, undefined, '退潮纪', 'major') }),
    ];
    const put = (store, items) => new Promise((res, rej) => {
      const tx = db.transaction(store, 'readwrite');
      items.forEach((i) => tx.objectStore(store).put(i));
      tx.oncomplete = () => res();
      tx.onerror = () => rej(tx.error);
    });
    await put('worlds', [world]);
    await put('categories', cats);
    await put('entries', entries);
    await put('relations', [
      { id: 'r1', worldId: wid, fromEntryId: 'e_yu', toEntryId: 'e_tide', type: '把持',
        note: '教团垄断历法', status: 'canon', createdAt: t },
    ]);
    localStorage.setItem('worldforge:settings', JSON.stringify({
      ai: { provider: 'custom', baseUrl: 'http://127.0.0.1:5190/v1', apiKey: 'k', model: 'm',
            temperature: 0.8, contextLimit: 60, vision: true },
      activeWorldId: wid,
    }));
    db.close();
    return 'seeded:' + entries.length;
  } catch (e) {
    return 'seed-failed: ' + (e && e.message);
  }
})()`;

const chrome = spawn(
  CHROME,
  [
    /*
     * 这里**不**带 `--hide-scrollbars`：横向滚动条是这一页的主操作之一，
     * 作者说它「有点 low」，我们把它重做了（见 `.chron-scroll::-webkit-scrollbar`）——
     * 藏起来就永远看不见改成了什么样。
     */
    '--headless=new', '--disable-gpu', '--no-sandbox', '--no-first-run',
    '--disable-extensions', `--remote-debugging-port=${PORT}`, `--user-data-dir=${profile}`,
    '--window-size=1560,1080', 'about:blank',
  ],
  { stdio: 'ignore' },
);

async function waitForDevtools() {
  for (let i = 0; i < 80; i++) {
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
    } else if (msg.method) events.push(msg);
  };
  const send = (method, params = {}) =>
    new Promise((resolve, reject) => {
      const mid = ++id;
      pending.set(mid, { resolve, reject });
      ws.send(JSON.stringify({ id: mid, method, params }));
    });
  return { ready, send, events, close: () => ws.close() };
}

try {
  mkdirSync('.shots', { recursive: true });
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
    if (r.exceptionDetails) throw new Error(JSON.stringify(r.exceptionDetails).slice(0, 500));
    return r.result?.value;
  };
  const shot = async (file) => {
    /*
     * `captureBeyondViewport: true` 是必须的 —— 少了它，无头 Chromium 会把某些
     * 圆角块（页头那颗「编年」chip）当成**另一个图层**、以错位的坐标合成进截图，
     * 于是图上多出一块「不在 DOM 里」的蓝块，而 `elementsFromPoint` 在那个点
     * 谁也找不到（真的是合成器画的，不是页面画的）。带上这个参数就是一次干净的绘制。
     */
    const s = await client.send('Page.captureScreenshot', {
      format: 'png',
      captureBeyondViewport: true,
    });
    writeFileSync(file, Buffer.from(s.data, 'base64'));
    console.log('  截图 →', file);
  };
  /*
   * 局部放大：**不动视口，只对一片区域做 2 倍裁切**。
   *
   * 之前是把视口缩到 980 宽再截 —— 那样页面会横向溢出（这个应用是给宽屏用的），
   * 截出来右边一律被切掉，看着像布局坏了。那是我自己造的假象，不是它真的坏了。
   * 裁切 + `captureBeyondViewport` 不改版式，量到什么就是什么。
   */
  const clipShot = async (file, expr) => {
    const box = JSON.parse(await evaluate(expr));
    if (!box) return;
    const s = await client.send('Page.captureScreenshot', {
      format: 'png',
      captureBeyondViewport: true,
      clip: { ...box, scale: 2 },
    });
    writeFileSync(file, Buffer.from(s.data, 'base64'));
    console.log('  截图 →', file);
  };

  /*
   * 顺序是有讲究的：**先让应用自己建一次库**（它才知道该有哪些 store、该升到几版），
   * 再往这张库里写演示数据，最后 reload 让应用读到。
   * 反过来先写库的话，应用会走一遍「库版本被顶高」的升级路径，而演示数据
   * 是照旧结构写的 —— 两件事叠在一起，失败了也看不出是谁的错。
   */
  await client.send('Page.navigate', { url: `${APP_URL}?chron=1#graph` });
  await sleep(3500);
  console.log('预置:', await evaluate(SEED));
  // 同一文档内的 hash 导航不会重载，必须显式 reload，否则应用读不到刚写的库
  await client.send('Page.reload');
  await sleep(3500);

  await evaluate(`document.querySelector('[data-role=graph-view-chronicle]').click(); 'ok'`);
  await sleep(1400);
  await shot(`${PREFIX}-1-overview.png`);

  /*
   * 页头那一条（说明 → 工具栏 → 横幅 → 纪元带）单独放大截一张。
   * 这几块挨得最近、字也最密，整页缩小看时根本分不清是「压住了」还是「缩糊了」——
   * 前面就吃过这个亏，所以固定拍一张放大图给自己当依据。
   */
  const headBox = JSON.parse(
    await evaluate(`JSON.stringify((() => {
      const d = document.querySelector('.page-desc').getBoundingClientRect();
      const a = document.querySelector('[data-role=chron-stage]').getBoundingClientRect();
      return { x: Math.round(d.left) - 10, y: Math.round(d.top) - 12,
               width: Math.round(a.width) + 20, height: Math.round(a.top - d.top) + 74 };
    })())`),
  );
  const hs = await client.send('Page.captureScreenshot', {
    format: 'png',
    captureBeyondViewport: true,
    clip: { ...headBox, scale: 2 },
  });
  writeFileSync(`${PREFIX}-5-head.png`, Buffer.from(hs.data, 'base64'));
  console.log('  截图 →', `${PREFIX}-5-head.png`);

  // 量一下关键元素真的画出来了、也确实在视野里
  const info = await evaluate(`JSON.stringify((() => {
    const q = (s) => document.querySelector(s);
    const box = (s) => { const e = q(s); if (!e) return null; const r = e.getBoundingClientRect();
      return [Math.round(r.left), Math.round(r.top), Math.round(r.width), Math.round(r.height)]; };
    const items = [...document.querySelectorAll('[data-role=chron-item]')];
    const title = q('[data-role=chron-item] .chron-title');
    const ts = title ? getComputedStyle(title) : null;
    const sc = q('.chron-scroll');
    const sr = sc ? sc.getBoundingClientRect() : null;
    return {
      stage: box('[data-role=chron-stage]'),
      rail: box('[data-role=chron-rail]'),
      eras: [...document.querySelectorAll('[data-role=chron-era]')].map(e => e.dataset.era),
      items: items.length,
      bars: document.querySelectorAll('[data-role=chron-bar]').length,
      nodes: document.querySelectorAll('[data-role=chron-node]').length,
      ticks: document.querySelectorAll('.chron-tick').length,
      canvasW: q('.chron-canvas')?.getBoundingClientRect().width,
      scrollable: sc ? sc.scrollWidth > sc.clientWidth : null,
      titleFont: ts ? [ts.fontFamily.slice(0, 46), ts.fontSize, ts.fontWeight] : null,
      // 「横向也在视野里」的卡片有几张 —— 只数纵向是自欺欺人（轴比屏幕宽得多）
      hCards: sr ? items.filter(e => { const r = e.getBoundingClientRect();
        return r.right > sr.left && r.left < sr.right; }).length : null,
      overflowX: document.documentElement.scrollWidth > window.innerWidth + 2,
      /* 横向滚动条的体检：它到底占了多少地方、是谁在滚 —— 只有量了才知道
         「作者说 low 的那根」有没有被我们的样式接过去（无头浏览器可能用覆盖式滚动条） */
      scrollbar: sc ? {
        reserve: sc.offsetHeight - sc.clientHeight,
        cw: sc.clientWidth, sw: sc.scrollWidth,
        styled: getComputedStyle(sc).scrollbarWidth,
      } : null,
    };
  })())`);
  console.log('探测:', info);

  /*
   * 版式自检：页头那几块**互相压住**了吗。
   * 这一类错最容易被当成「可能是截图缩小的错觉」放过，所以让浏览器自己量 ——
   * 相邻分块只要有一像素以上的交叠就点名报出来。
   */
  const overlaps = await evaluate(`JSON.stringify((() => {
    const sel = [
      ['.page-head', '页头'],
      ['.page-desc', '说明'],
      ['[data-role=chron-stage]', '编年画布'],
      ['[data-role=chron-footbar]', '底部工具条'],
    ];
    const es = sel.map(([s, n]) => [n, document.querySelector(s)])
      .filter(([, e]) => e);
    // 每块的实测矩形自己也打出来 —— 只报「有没有压住」时，很容易被自己的判定条件骗过去
    const boxes = es.map(([n, e]) => {
      const r = e.getBoundingClientRect();
      return n + ' [' + [r.left, r.top, r.right, r.bottom].map(Math.round).join(',') + ']';
    });
    const hit = [];
    for (let i = 0; i < es.length; i++) {
      for (let j = i + 1; j < es.length; j++) {
        const [na, ea] = es[i], [nb, eb] = es[j];
        // 「包含」只认**真的父子**（页头本来就含说明）。
        // 不能用矩形比大小当判据 —— 上一版就是这么放过了「横幅把工具栏整条盖住」那次：
        // 盖住时横幅的矩形正好把工具栏套在里面，于是被当成父子跳过了。
        if (ea.contains(eb) || eb.contains(ea)) continue;
        const a = ea.getBoundingClientRect(), b = eb.getBoundingClientRect();
        const ov = Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top);
        if (ov > 1) hit.push(na + '×' + nb + ' 纵向压住 ' + Math.round(ov) + 'px');
      }
    }
    /*
     * 工具栏必须**在正常流里、也够高**。
     * 它被压扁是没法从「有没有交叠」看出来的（压扁之后谁都不压谁，只是全都裁没了），
     * 而这一类错真的发生过：工具栏抓了甘特轨的类名，被套上绝对定位 + 9px 高 + 裁溢出。
     */
    const bar = document.querySelector('[data-role=chron-tools]');
    const cs = bar ? getComputedStyle(bar) : null;
    if (bar && cs) {
      const h = Math.round(bar.getBoundingClientRect().height);
      if (h < 22) hit.push('工具条只有 ' + h + 'px 高（被压扁了）');
      /* 这一条刻意**允许 relative**（「显示」浮层要挂在它上面定位），只禁 absolute ——
         被甘特轨那套样式劫持时正是 absolute + 9px 高 + 裁溢出 */
      if (cs.position === 'absolute') hit.push('工具条被绝对定位了（position=' + cs.position + '）');
      if (cs.overflow !== 'visible') hit.push('工具条裁溢出（overflow=' + cs.overflow + '）');
    }

    /* **卡片之间不许重叠** —— 作者点名的硬要求，所以拿实测矩形两两比，不靠眼睛看 */
    const cards = [...document.querySelectorAll('[data-role=chron-item]')];
    for (let i = 0; i < cards.length; i++) {
      for (let j = i + 1; j < cards.length; j++) {
        const a = cards[i].getBoundingClientRect();
        const b = cards[j].getBoundingClientRect();
        const ox = Math.min(a.right, b.right) - Math.max(a.left, b.left);
        const oy = Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top);
        if (ox > 0.5 && oy > 0.5) {
          hit.push('卡片重叠 ' + cards[i].dataset.id + ' × ' + cards[j].dataset.id
            + '（' + Math.round(ox) + '×' + Math.round(oy) + 'px）');
        }
      }
    }
    /* 顺序也不许乱：左端坐标必须单调不减 —— 铺开归铺开，谁先谁后不能变 */
    const lefts = cards.map((c) => Number(c.dataset.left));
    for (let i = 1; i < lefts.length; i++) {
      if (lefts[i] < lefts[i - 1]) {
        hit.push('卡片顺序乱了：第 ' + (i + 1) + ' 张排到了前一张左边');
        break;
      }
    }
    /* 被就地铺开的张数：界面必须报出来，不能悄悄让开 */
    const pushedEl = document.querySelector('[data-role=chron-pushed]');
    const pushed = {
      legend: pushedEl ? Number(pushedEl.dataset.count) : 0,
      cards: cards.filter((c) => c.dataset.pushed === '1').length,
    };
    const barInfo = bar && cs ? {
      h: Math.round(bar.getBoundingClientRect().height),
      css: { display: cs.display, position: cs.position, height: cs.height,
             overflow: cs.overflow, align: cs.alignItems, top: cs.top },
      kids: [...bar.children].map(k => {
        const r = k.getBoundingClientRect();
        return k.className.slice(0, 18) + ' [' + [r.left, r.top, r.right, r.bottom]
          .map(Math.round).join(',') + ']';
      }),
    } : null;

    /*
     * 「一张纸」与「字体比例」这两条也是**量出来的**，不是看截图看出来的。
     *
     * 上一版右栏是三个通用「卡片」（圆角 + 描边 + 投影），浮在展墙旁边 ——
     * 作者的原话是「最右侧的编年卡片不符合这个风格……和总体的布局都有些割裂」，
     * 而「字体过大、头重脚轻」光看截图很难说清到什么程度。所以定成两条硬判据：
     *   · 右栏与它里面每一小节**都没有卡片那套外壳**（圆角 0、没有描边、没有投影）；
     *   · 右栏与展墙**一样高**（同一张纸的两半，栏线要通到底）。
     */
    const sheet = document.querySelector('.chron-sheet');
    const stage = document.querySelector('[data-role=chron-stage]');
    const side = document.querySelector('.chron-side');
    const shell = ['.chron-side', '[data-role=chron-brief]', '[data-role=chron-pool]']
      .map((s) => document.querySelector(s)).filter(Boolean);
    for (const el of shell) {
      const c = getComputedStyle(el);
      const tag = (el.className || el.tagName).toString().slice(0, 22);
      if (parseFloat(c.borderTopLeftRadius) > 0) hit.push(tag + ' 还带着圆角');
      if (c.boxShadow !== 'none') hit.push(tag + ' 还带着投影');
      if (el !== side && parseFloat(getComputedStyle(el).borderTopWidth) > 0) {
        hit.push(tag + ' 还带着描边');
      }
    }
    if (sheet && stage && side) {
      const h = (e) => Math.round(e.getBoundingClientRect().height);
      if (Math.abs(h(side) - h(stage)) > 2) {
        hit.push('右栏与展墙不等高（' + h(side) + ' vs ' + h(stage) + '）—— 不像一张纸');
      }
    }

    /* 字体与卡片的比例：标题不许大过 21px，卡内上下留白不许少于 16px */
    const card = document.querySelector('[data-role=chron-item]');
    const cardCS = card ? getComputedStyle(card) : null;
    const titleSize = card ? parseFloat(getComputedStyle(card.querySelector('.chron-title')).fontSize) : 0;
    if (titleSize > 21.5) hit.push('卡片标题 ' + titleSize + 'px 偏大（上限 21.5）');
    if (cardCS && (parseFloat(cardCS.paddingTop) < 16 || parseFloat(cardCS.paddingBottom) < 16)) {
      hit.push('卡片内边距不足：' + cardCS.paddingTop + ' / ' + cardCS.paddingBottom);
    }

    /*
     * 这一轮作者点名的三条：高度全墙一致、下方留白 ≈ 二倍标题字号、
     * 悬停的「查看详情」默认透明；外加「新建一条」的带子要钉住（sticky）。
     */
    const allCards = [...document.querySelectorAll('[data-role=chron-item]')];
    const hs = allCards.map((c) => Math.round(c.getBoundingClientRect().height));
    if (hs.length > 1 && hs.some((h) => Math.abs(h - hs[0]) > 1)) {
      hit.push('卡片高度不齐：' + [...new Set(hs)].join('/'));
    }
    const bad = allCards.filter((c) => {
      const p = parseFloat(getComputedStyle(c).paddingBottom);
      const s = parseFloat(getComputedStyle(c.querySelector('.chron-title')).fontSize);
      return Math.abs(p - s * 2) > 1;
    });
    if (bad.length) hit.push('有 ' + bad.length + ' 张卡的下方留白不是二倍标题字号');
    const view = document.querySelector('[data-role=chron-view-hint]');
    if (!view || getComputedStyle(view).opacity !== '0') hit.push('「查看详情」没有默认隐藏（悬停才该亮）');
    const lane = document.querySelector('[data-role=chron-add-lane]');
    if (lane && lane.closest('.chron-scroll')) {
      hit.push('新建带子还在滚动区里（横滚会把它带走）');
    }
    /* 说明那一行里如果压着别的东西（曾经真出现过一块来路不明的蓝块），按坐标点名 */
    const desc = document.querySelector('.page-desc');
    const dr = desc ? desc.getBoundingClientRect() : null;
    const stack = dr ? [[dr.left + 60, dr.top + 18], [dr.left + dr.width / 2, dr.top + 18]]
      .map(([x, y]) => {
        const at = document.elementsFromPoint(Math.round(x), Math.round(y)).slice(0, 5)
          .map((e) => (e.className || e.tagName).toString().slice(0, 26));
        return Math.round(x) + ',' + Math.round(y) + ' → ' + at.join(' < ');
      }) : null;

    return { boxes, hit, barInfo, pushed, stack, type: {
      titleSize, cardPad: cardCS ? [cardCS.paddingTop, cardCS.paddingBottom] : null,
      sideH: side ? Math.round(side.getBoundingClientRect().height) : null,
      stageH: stage ? Math.round(stage.getBoundingClientRect().height) : null,
    } };
  })())`);
  const audit = JSON.parse(overlaps);
  console.log('版式自检:', audit.boxes.join('  '));
  console.log('  交叠/重叠:', audit.hit.length ? audit.hit : '(无)');
  console.log('  工具条:', JSON.stringify(audit.barInfo));
  console.log('  就地铺开:', JSON.stringify(audit.pushed));
  console.log('  字与留白:', JSON.stringify(audit.type));
  console.log('  说明行上压着谁:', JSON.stringify(audit.stack));
  // 版式坏了就当失败 —— 这类错看截图很容易被当成「缩小的错觉」放过
  if (audit.hit.length) {
    layoutFail = true;
    console.error('版式自检未通过:', audit.hit.join('；'));
  }

  /*
   * 右栏（注记栏）单拍一张：它与展墙是不是**同一张纸**，只有把分栏那一段放大才评得了。
   * 左边多带 90px，好把栏线两边一起框进来；高度跟展墙走，顺便验证栏线通到底。
   */
  await clipShot(
    `${PREFIX}-11-side.png`,
    `JSON.stringify((() => {
      const s = document.querySelector('.chron-side');
      const m = document.querySelector('.chron-main');
      if (!s || !m) return null;
      const r = s.getBoundingClientRect(), mr = m.getBoundingClientRect();
      const top = Math.min(mr.top, r.top), bottom = Math.max(mr.bottom, r.bottom);
      return { x: Math.round(r.left) - 90, y: Math.round(top) - 8,
               width: Math.round(r.width) + 100,
               height: Math.min(760, Math.round(bottom - top)) + 16 };
    })())`,
  );

  /*
   * 选中一张「卡片」→ 右侧面板那一路。
   *
   * 注意**不能点卡片本身**：卡片上的单击（没拖）现在是「打开这条的条目编辑器」
   * （作者点名的规矩，见 ChronicleView 的 `onGrab`），点下去会弹出一个模态框，
   * 截出来的是编辑器而不是右栏。所以这里点甘特轨上那颗菱形 —— 同一件事的另一种形状，
   * 单击仍然只是选中。
   */
  await evaluate(`document.querySelector('[data-role=chron-node]')?.dispatchEvent(
    new MouseEvent('mousedown', { bubbles: true, button: 0, clientX: 0, clientY: 0 })); 'ok'`);
  await evaluate(`window.dispatchEvent(new MouseEvent('mouseup', { bubbles: true })); 'ok'`);
  await sleep(600);
  await shot(`${PREFIX}-2-selected.png`);

  /*
   * 悬停：一句「查看详情」只在鼠标落上去时才亮 —— 它住在卡片下方那段留白里。
   * 这一张同时看两件事：提示与留白的关系、以及悬停时卡片**没有位移**（坐标是有意义的）。
   * 悬停要用真的鼠标移动（CDP 注入），合成的 mouseover 不会触发 `:hover`。
   */
  const hoverBox = JSON.parse(
    await evaluate(`JSON.stringify((() => {
      const c = document.querySelectorAll('[data-role=chron-item]')[0];
      if (!c) return null;
      const r = c.getBoundingClientRect();
      return { x: Math.round(r.left) + r.width / 2, y: Math.round(r.top) + 30,
               box: { x: Math.round(r.left) - 24, y: Math.round(r.top) - 12,
                      width: Math.round(r.width) + 48, height: Math.round(r.height) + 24 } };
    })())`),
  );
  if (hoverBox) {
    await client.send('Input.dispatchMouseEvent', {
      type: 'mouseMoved',
      x: hoverBox.x,
      y: hoverBox.y,
    });
    await sleep(400);
    const op = await evaluate(
      `(() => { const v = document.querySelector('[data-role=chron-view-hint]');
        return v ? getComputedStyle(v).opacity : 'missing'; })()`,
    );
    console.log('悬停「查看详情」透明度:', op);
    const s = await client.send('Page.captureScreenshot', {
      format: 'png',
      captureBeyondViewport: true,
      clip: { ...hoverBox.box, scale: 2 },
    });
    writeFileSync(`${PREFIX}-12-hover.png`, Buffer.from(s.data, 'base64'));
    console.log('  截图 →', `${PREFIX}-12-hover.png`);
    // 移开，别影响后面的截图
    await client.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: 8, y: 8 });
    await sleep(200);
  }

  /*
   * 底座一带：上方是新建带子与横向滚动条，下面是左边三个动作 + 右边图例。
   * 「一个高一个低」「一个有动画一个没有」这类毛病只有把这一条整段放大才评得了。
   */
  const sb = await evaluate(
    `(() => { const sc = document.querySelector('.chron-scroll');
      return sc ? sc.offsetHeight - sc.clientHeight : -1; })()`,
  );
  console.log('横向滚动条厚度:', sb, 'px（0 = 没画出来/覆盖式）');
  /*
   * 带子在不在滚动区里，用**行为**判：滚一段，它的屏幕坐标不许变。
   * 只看 `position` 是自欺欺人 —— sticky 也就不动，却会把可滚宽度撑长一大截。
   */
  const laneMove = await evaluate(`(() => {
    const lane = document.querySelector('[data-role=chron-add-lane]');
    const sc = document.querySelector('.chron-scroll');
    if (!lane || !sc) return null;
    const before = lane.getBoundingClientRect().left;
    const keep = sc.scrollLeft;
    sc.scrollLeft = 900;
    const after = lane.getBoundingClientRect().left;
    const sw = sc.scrollWidth, cw = sc.clientWidth;
    sc.scrollLeft = keep;
    return { before: Math.round(before), after: Math.round(after),
             overflowRatio: +(sw / cw).toFixed(2), sw, cw };
  })()`);
  console.log('新建带子（滚 900px 前后）:', JSON.stringify(laneMove));
  /* 可滚宽度比画布还宽一截 → 到底是哪个元素探出去了（滚到尽头会看到一大片空白） */
  const over = await evaluate(`(() => {
    const sc = document.querySelector('.chron-scroll');
    if (!sc) return null;
    const base = sc.getBoundingClientRect().left - sc.scrollLeft;
    const out = [];
    for (const el of sc.querySelectorAll('*')) {
      const r = el.getBoundingClientRect();
      const right = r.right - base;
      if (right > sc.clientWidth + 8 && r.width > 0) {
        out.push([Math.round(right), (el.className || el.tagName).toString().slice(0, 30),
          Math.round(el.getBoundingClientRect().left - base), Math.round(r.width),
          el.dataset.kind || '', el.dataset.x || '']);
      }
    }
    out.sort((a, b) => b[0] - a[0]);
    return { canvasW: Math.round(sc.querySelector('.chron-canvas').getBoundingClientRect().width),
             scrollW: sc.scrollWidth, worst: out.slice(0, 5) };
  })()`);
  console.log('越界元素:', JSON.stringify(over));

  /*
   * 滚动条在无头浏览器里是「覆盖式」的：不动就不画，所以静态截图里看不到 ——
   * 想确认它长什么样，只能在**滚动的当口**抓一张（这里用真的滚轮事件）。
   */
  const sbBox = await evaluate(
    `JSON.stringify((() => {
      const sc = document.querySelector('.chron-scroll');
      if (!sc) return null;
      const r = sc.getBoundingClientRect();
      return { x: Math.round(r.right) - 120, y: Math.round(r.bottom) - 6 };
    })())`,
  );
  if (sbBox) {
    const b = JSON.parse(sbBox);
    await client.send('Input.dispatchMouseEvent', {
      type: 'mouseWheel',
      x: b.x,
      y: b.y,
      deltaX: 400,
      deltaY: 0,
    });
    await sleep(120);
    await clipShot(
      `${PREFIX}-14-scrollbar.png`,
      `JSON.stringify((() => {
        const sc = document.querySelector('.chron-scroll');
        const r = sc.getBoundingClientRect();
        return { x: Math.round(r.left), y: Math.round(r.bottom) - 40,
                 width: Math.round(r.width), height: 48 };
      })())`,
    );
    await evaluate(`document.querySelector('.chron-scroll').scrollLeft = 0; 'ok'`);
    await sleep(200);
  }
  await clipShot(
    `${PREFIX}-13-footbar.png`,
    `JSON.stringify((() => {
      const f = document.querySelector('[data-role=chron-footbar]');
      if (!f) return null;
      const r = f.getBoundingClientRect();
      return { x: Math.round(r.left) - 8, y: Math.round(r.top) - 56,
               width: Math.round(r.width) + 16, height: Math.round(r.height) + 64 };
    })())`,
  );

  /*
   * 细节放大见上面的 `clipShot`（**不动视口，只对一片区域做 2 倍裁切**）。
   */

  // 卡片：宋体的横细竖粗、眉标与正文的层次、错层的接缝，都在这个尺度上才看得清
  await clipShot(
    `${PREFIX}-4-zoom.png`,
    `JSON.stringify((() => {
      const es = [...document.querySelectorAll('[data-role=chron-item]')].slice(0, 2);
      if (!es.length) return null;
      const rs = es.map(e => e.getBoundingClientRect());
      const l = Math.min(...rs.map(r => r.left)), t = Math.min(...rs.map(r => r.top));
      const r2 = Math.max(...rs.map(r => r.right)), b = Math.max(...rs.map(r => r.bottom));
      return { x: Math.round(l) - 10, y: Math.round(t) - 10,
               width: Math.round(r2 - l) + 20, height: Math.round(b - t) + 20 };
    })())`,
  );

  /*
   * 「就地铺开」的那一处：**挨在一起的那几张卡片的接缝**长什么样，只有放大才评得了。
   *
   * 先滚过去 —— 接缝多半落在视口外（轴有四五千像素），而 `getBoundingClientRect`
   * 不管滚动容器的裁切，不滚就截的话拿到的是一片空白加右边的面板，看着像页面坏了。
   * 顺手先把选中取消掉：右侧面板展开着会挤进裁剪框。
   */
  const seamAt = await evaluate(`(() => {
    const es = [...document.querySelectorAll('[data-role=chron-item]')];
    for (let i = 0; i + 1 < es.length; i++) {
      const a = es[i].getBoundingClientRect(), b = es[i + 1].getBoundingClientRect();
      if (b.left - a.right < 2) {
        document.querySelector('.chron-wall').dispatchEvent(
          new MouseEvent('mousedown', { bubbles: true, button: 0 }));
        const sc = document.querySelector('.chron-scroll');
        sc.scrollLeft = Math.max(0, es[i].offsetLeft - 40);
        return 'seam-at:' + i;
      }
    }
    return 'no-seam';
  })()`);
  console.log('接缝:', seamAt);
  await sleep(800);
  await evaluate(`window.dispatchEvent(new MouseEvent('mouseup', { bubbles: true })); 'ok'`);
  await sleep(400);
  await clipShot(
    `${PREFIX}-10-seam.png`,
    `JSON.stringify((() => {
      /* 只裁**紧挨着的那一对**：被铺开的十张散在整条轴上，
         取它们的外接矩形会横跨四千像素，截出来全是空白 */
      const es = [...document.querySelectorAll('[data-role=chron-item]')];
      for (let i = 0; i + 1 < es.length; i++) {
        const a = es[i].getBoundingClientRect(), b = es[i + 1].getBoundingClientRect();
        if (b.left - a.right < 2) {
          return { x: Math.round(a.left) - 14, y: Math.round(a.top) - 12,
                   width: Math.round(b.right - a.left) + 28,
                   height: Math.round(a.bottom - a.top) + 24 };
        }
      }
      return null;
    })())`,
  );

  /* 滚回轴的最左端再拍轨 —— 裁剪框用的是视口坐标，滚过之后 rail 的左边就是负数了 */
  await evaluate(`document.querySelector('.chron-scroll').scrollLeft = 0; 'ok'`);
  await sleep(700);

  // 轨与刻度：区间条的粗细、名字压在条上的距离、菱形的大小，在这一张里一并看
  await clipShot(
    `${PREFIX}-6-rail.png`,
    `JSON.stringify((() => {
      const a = document.querySelector('[data-role=chron-rail]').getBoundingClientRect();
      const c = document.querySelector('[data-role=chron-ruler]').getBoundingClientRect();
      return { x: Math.round(a.left), y: Math.round(a.top) - 12,
               width: 1180, height: Math.round(c.bottom - a.top) + 24 };
    })())`,
  );

  /*
   * 再拍一张「整条轴」：把视口临时撑到跟画布一样宽，四层读法就一次全看得见。
   * 这不是给作者看的日常样子（日常就是上面那张、横向滚），
   * 而是给**评审**用的 —— 一眼看清纪元怎么分段、跨度有多长。
   */
  await client.send('Emulation.setDeviceMetricsOverride', {
    width: 4700, height: 900, deviceScaleFactor: 1, mobile: false,
  });
  // 页面容器有 `max-width`，不解除的话撑多宽都只是两边多一点白 —— 那不是评审想看的
  await evaluate(`(() => {
    const st = document.createElement('style');
    st.id = 'chron-wide';
    st.textContent = '.page.wide{max-width:none !important}';
    document.head.appendChild(st);
    return 'ok';
  })()`);
  await sleep(2000);
  await shot(`${PREFIX}-3-fullaxis.png`);
  await evaluate(`document.getElementById('chron-wide')?.remove(); 'ok'`);
  await client.send('Emulation.clearDeviceMetricsOverride');
  await sleep(900);

  /*
   * 「显示」浮层：三个动作之外的那些**看法**（比例 / 只看重大 / 疏密）都收在这儿 ——
   * 它们原来堵在页头与画布之间，作者说「有些阻挡美感」。收起来之后得验：
   * 点得开、整块在视口里（它是往上弹的，页面一矮就掉出去）、里面的东西还能用。
   */
  await evaluate(`document.querySelector('[data-role=chron-tools-more]').click(); 'ok'`);
  await sleep(500);
  const moreInfo = await evaluate(`(() => {
    const m = document.querySelector('[data-role=chron-more]');
    if (!m) return JSON.stringify({ open: false });
    const r = m.getBoundingClientRect();
    const f = document.querySelector('[data-role=chron-footbar]').getBoundingClientRect();
    return JSON.stringify({
      open: true,
      inView: r.top >= 0 && r.bottom <= window.innerHeight,
      scaleEven: !!m.querySelector('[data-role=chron-scale-even]'),
      box: [r.left, r.top, r.right, r.bottom].map(Math.round),
      foot: [f.left, f.top, f.right, f.bottom].map(Math.round),
    });
  })()`);
  console.log('显示浮层:', moreInfo);
  const mm = JSON.parse(moreInfo);
  if (!mm.open || !mm.inView || !mm.scaleEven) {
    layoutFail = true;
    console.error('「显示」浮层有问题:', moreInfo);
  }
  await clipShot(
    `${PREFIX}-8-more.png`,
    `JSON.stringify((() => {
      const m = document.querySelector('[data-role=chron-more]');
      const f = document.querySelector('[data-role=chron-footbar]').getBoundingClientRect();
      const r = m.getBoundingClientRect();
      return { x: Math.round(f.left) - 12, y: Math.round(r.top) - 14,
               width: Math.round(f.width) + 24,
               height: Math.round(f.bottom - r.top) + 28 };
    })())`,
  );

  /* 切「均匀」：轴距换一套算法、`at` 一个字节都不动 —— 顺便证明浮层里的东西真能用 */
  await evaluate(`document.querySelector('[data-role=chron-scale-even]').click(); 'ok'`);
  await sleep(1100);
  await shot(`${PREFIX}-9-even.png`);
  await evaluate(`document.querySelector('[data-role=chron-scale-prop]').click(); 'ok'`);
  await sleep(700);
  await evaluate(`document.querySelector('[data-role=chron-more-mask]').click(); 'ok'`);
  await sleep(400);

  /*
   * AI 自动排版：这是从旧轴**移植过来**的那条链路，在编年这一支上必须也走得通。
   *
   * 按下去什么都不会变（刻意的，只入队），所以这里等的是「横幅出现」——
   * 横幅上带着方案条数，它一出现就说明：入队 → 调模型 → 对账 → 进审查队列 这一整条通了。
   */
  await evaluate(`document.querySelector('[data-role=chron-ai-toggle]').click(); 'ok'`);
  await evaluate(`document.querySelector('[data-role=chron-ai-layout]').click(); 'ok'`);
  await sleep(2600);
  /*
   * 横幅的出现本身就是「进了审查队列」的证据：它读的是 `store.review` 里那条
   * 待审的 `timeline-layout`（见 `useTimelineLayout`），不是本地状态。
   */
  const plan = await evaluate(`(() => {
    const b = document.querySelector('[data-role=chron-layout-plan]');
    return JSON.stringify({ banner: !!b, count: b ? Number(b.dataset.count) : null,
                            text: b ? b.textContent.slice(0, 70) : null });
  })()`);
  console.log('AI 排版:', plan);
  if (!JSON.parse(plan).banner) {
    layoutFail = true;
    console.error('AI 排版这条链路没有走通（横幅没出现）');
  }
  await clipShot(
    `${PREFIX}-7-ai.png`,
    `JSON.stringify((() => {
      const d = document.querySelector('.page-desc').getBoundingClientRect();
      const b = document.querySelector('[data-role=chron-layout-plan]');
      const r = b ? b.getBoundingClientRect() : d;
      return { x: Math.round(d.left) - 10, y: Math.round(d.top) - 10,
               width: Math.round(d.width) + 20,
               height: Math.round(Math.max(r.bottom, d.bottom) - d.top) + 40 };
    })())`,
  );

  const errs = client.events
    .filter((e) => e.method === 'Runtime.exceptionThrown')
    .map((e) => e.params.exceptionDetails?.exception?.description?.slice(0, 200));
  const cons = client.events
    .filter((e) => e.method === 'Runtime.consoleAPICalled' && e.params.type === 'error')
    .map((e) => e.params.args.map((a) => a.value ?? a.description).join(' ').slice(0, 200));
  console.log('页面异常:', errs.length ? errs : '(无)');
  console.log('console.error:', cons.length ? cons : '(无)');
  if (errs.length || cons.length) layoutFail = true;

  client.close();
} catch (e) {
  console.error('FAILED:', e.message);
  process.exitCode = 1;
}
if (layoutFail) process.exitCode = 1;
chrome.kill();
