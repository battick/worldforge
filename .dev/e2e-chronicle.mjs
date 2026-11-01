/**
 * 开发期端到端验证：「时间与关系」的第一支 —— **编年**（ChronicleView）。
 *
 * 编年已经接管了从前「时间」那一支的位置（旧点轴从右下角「旧的」进），
 * 所以它身上有几条**别人不许拆**的规矩，全都得在浏览器里真验一遍：
 *
 *   1. 卡片**绝不重叠**，顺序永远单调 —— 这是作者点名的硬要求。
 *      挤在同一刻的那些「就地铺开」，而且必须如实报数（`chron-pushed`）。
 *   2. 「位置就是时间」：拖卡片改先后要**真落库**，池子里拖上来也一样。
 *   3. 「轴距只是看法」：切比例 / 均匀，`at` 一个字节都不许动。
 *   4. 「看法」收在「显示」浮层里（它们原来堵在画布上方，作者说挡美感），
 *      所以浮层要打得开、收得起、里面的开关真能用。
 *   5. AI 排版按下去**什么都不会变**，只进审查队列 —— 这是从旧轴移植过来的链路。
 *
 * 前置：node server.mjs（5188，需已构建最新 dist）+ node .dev/mock-upstream.mjs（5190）
 * 用法：node .dev/e2e-chronicle.mjs
 */
import { spawn } from 'node:child_process';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const CHROME = 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const APP_URL = process.env.APP_URL || 'http://127.0.0.1:5188/';
const PORT = 9377;
const profile = mkdtempSync(join(tmpdir(), 'cdp-chron-e2e-'));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const results = [];
const check = (name, ok, detail = '') => {
  results.push({ name, ok, detail });
  console.log(`  ${ok ? '✓' : '✗'} ${name}${detail ? ' — ' + detail : ''}`);
};

/**
 * 演示世界：五条上轴的 + 两条留在池子里的。
 *
 * 形状是挑过的：**两条挨在同一刻**（9 与 9.05，就位要铺开）、
 * 一条至今（往右画到边）、一条没给终点的「一段」（画虚线）、三个纪元各占一段，
 * 池子里留两条用来验「拖上轨」。
 */
const SEED = `(async () => {
  try {
    // 不写死版本号：库的版本由应用自己定
    const db = await new Promise((res, rej) => {
      const o = indexedDB.open('worldforge');
      o.onsuccess = () => res(o.result);
      o.onerror = () => rej(o.error);
    });
    const t = Date.now();
    const wid = 'wd_chr';
    const world = { id: wid, name: '原初宇宙', tagline: '海面每年上涨三尺', summary: '',
      genre: '', tone: '', themeColor: '#2f6fb0', createdAt: t, updatedAt: t };
    const cats = [
      { id: 'ct_e', worldId: wid, name: '事件', icon: '❖', fieldDefs: [], order: 0, createdAt: t, updatedAt: t },
    ];
    const mk = (id, title, time) => Object.assign(
      { id, worldId: wid, categoryId: 'ct_e', title, summary: title + '的简介。',
        aliases: [], tags: [], fields: {}, status: 'canon', sourceRefs: [], content: '',
        createdAt: t, updatedAt: t }, time ? { time } : {});
    const entries = [
      mk('e_zhong', '沉钟', { kind: 'point', from: '前潮纪三年', to: '', at: 3, era: '前潮纪', weight: 'minor' }),
      // 挨在同一刻的两条 —— 它们必须**铺开**，不许叠
      mk('e_gan', '巡检港', { kind: 'point', from: '涨潮纪九年', to: '', at: 9, era: '涨潮纪', weight: 'major' }),
      mk('e_tide', '涨潮纪', { kind: 'range', from: '元年', to: '四十八年', at: 9.05, toAt: 48, era: '涨潮纪', weight: 'major' }),
      mk('e_si', '巡察司', { kind: 'range', from: '涨潮纪十四年', to: '三十九年', at: 14, toAt: 39, era: '涨潮纪', weight: 'normal' }),
      // 没给终点的「一段」：轨上画虚线
      mk('e_ce', '潮位册', { kind: 'range', from: '涨潮纪十八年', to: '', at: 18, era: '涨潮纪', weight: 'minor' }),
      mk('e_deng', '灯台', { kind: 'point', from: '退潮纪二年', to: '', at: 25, era: '退潮纪', weight: 'normal' }),
      mk('e_yu', '余烬教团', { kind: 'ongoing', from: '退潮纪八年', to: '', at: 29, era: '退潮纪', weight: 'major' }),
      // 池子里的
      mk('e_lv', '潮律'),
      mk('e_bei', '巡检碑'),
    ];
    const put = (s, items) => new Promise((res, rej) => {
      const tx = db.transaction(s, 'readwrite');
      items.forEach((i) => tx.objectStore(s).put(i));
      tx.oncomplete = () => res();
      tx.onerror = () => rej(tx.error);
    });
    await put('worlds', [world]);
    await put('categories', cats);
    await put('entries', entries);
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
    '--headless=new', '--disable-gpu', '--no-sandbox', '--hide-scrollbars', '--no-first-run',
    '--disable-extensions', `--remote-debugging-port=${PORT}`, `--user-data-dir=${profile}`,
    '--window-size=1560,1000', 'about:blank',
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
      throw new Error('页面执行出错：' + JSON.stringify(r.exceptionDetails).slice(0, 400));
    }
    return r.result?.value;
  };
  const waitFor = async (expr, timeout = 20000, step = 250) => {
    const t0 = Date.now();
    while (Date.now() - t0 < timeout) {
      if (await evaluate(expr)) return true;
      await sleep(step);
    }
    return false;
  };
  const openDb = `(async () => {
    const db = await new Promise((res) => {
      const o = indexedDB.open('worldforge');
      o.onsuccess = () => res(o.result);
      o.onerror = () => res(null);
    });
    if (!db) return null;
    const all = (s) => new Promise((res) => {
      const q = db.transaction(s, 'readonly').objectStore(s).getAll();
      q.onsuccess = () => res(q.result ?? []);
    });
    return { db, all };
  })()`;
  /** 读库里的一条条目 —— 界面上的东西是不是真落了库，只看这个 */
  const readEntry = async (id) =>
    evaluate(`(async () => {
      const { db, all } = await ${openDb};
      const rows = await all('entries');
      const hit = rows.find((r) => r.id === ${JSON.stringify(id)}) ?? null;
      db.close();
      return hit;
    })()`);
  const readOps = async () =>
    evaluate(`(async () => {
      const { db, all } = await ${openDb};
      const rows = await all('ops');
      db.close();
      return rows.length;
    })()`);
  const readReview = async () =>
    evaluate(`(async () => {
      const { db, all } = await ${openDb};
      const rows = await all('review');
      db.close();
      return rows.map((r) => ({ kind: r.kind, status: r.status }));
    })()`);
  /** 卡片两两比矩形 —— 重叠与否由浏览器说了算，不靠截图看 */
  const cardsAudit = async () =>
    JSON.parse(
      await evaluate(`JSON.stringify((() => {
        const es = [...document.querySelectorAll('[data-role=chron-item]')];
        const hit = [];
        for (let i = 0; i < es.length; i++) {
          for (let j = i + 1; j < es.length; j++) {
            const a = es[i].getBoundingClientRect(), b = es[j].getBoundingClientRect();
            const ox = Math.min(a.right, b.right) - Math.max(a.left, b.left);
            const oy = Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top);
            if (ox > 0.5 && oy > 0.5) hit.push(es[i].dataset.id + '×' + es[j].dataset.id);
          }
        }
        const lefts = es.map((e) => Number(e.dataset.left));
        let ordered = true;
        for (let i = 1; i < lefts.length; i++) if (lefts[i] < lefts[i - 1]) ordered = false;
        return {
          n: es.length,
          ids: es.map((e) => e.dataset.id),
          hit,
          ordered,
          pushed: es.filter((e) => e.dataset.pushed === '1').map((e) => e.dataset.id),
          pushedLegend: (() => {
            const el = document.querySelector('[data-role=chron-pushed]');
            return el ? Number(el.dataset.count) : 0;
          })(),
        };
      })())`),
    );

  /* 顺序有讲究：先让应用自己建库，再写演示数据，最后 reload */
  await client.send('Page.navigate', { url: `${APP_URL}?chron-e2e=1#graph` });
  await sleep(3500);
  console.log('预置:', await evaluate(SEED));
  await client.send('Page.reload');
  await sleep(3500);

  /* ---------------- A. 第一入口与四层读法 ---------------- */
  check(
    '「时间与关系」默认就落在编年（切换位上有「编年」这一支）',
    !!(await evaluate(`!!document.querySelector('[data-role=graph-view-chronicle]')`)) &&
      !!(await evaluate(`!!document.querySelector('[data-role=chron-stage]')`)),
  );
  await evaluate(`document.querySelector('[data-role=graph-view-chronicle]').click(); 'ok'`);
  check('切过去之后画布画出来了', await waitFor(`!!document.querySelector('[data-role=chron-stage]')`));
  await sleep(900);

  let a = await cardsAudit();
  check('轴上的卡片数 = 设了时间的条目数', a.n === 7, `卡片 ${a.n} 张`);
  check('卡片**没有一张重叠**', a.hit.length === 0, a.hit.join(', ') || '两两都不相交');
  check('卡片顺序单调（左边的一定是更早的）', a.ordered);
  check('纪元带分得出三段', (await evaluate(`document.querySelectorAll('[data-role=chron-era]').length`)) === 3);
  const railKinds = JSON.parse(
    await evaluate(`JSON.stringify({
      bars: [...document.querySelectorAll('[data-role=chron-bar]')].map((b) => b.dataset.kind),
      nodes: document.querySelectorAll('[data-role=chron-node]').length,
      dashed: document.querySelectorAll('[data-role=chron-bar].dashed').length,
      ongoing: document.querySelectorAll('[data-role=chron-bar].ongoing').length,
      ticks: document.querySelectorAll('.chron-tick').length,
    })`),
  );
  check(
    '轨上的画法分得出形态：点 3 / 区间 4（其中虚线 1、至今 1）',
    railKinds.nodes === 3 && railKinds.bars.length === 4 && railKinds.dashed === 1 && railKinds.ongoing === 1,
    JSON.stringify(railKinds),
  );
  check('刻度尺有刻度（按轴长定疏密，不是固定五根）', railKinds.ticks >= 3, `${railKinds.ticks} 根`);
  check(
    '整页没有横向溢出（横滚只发生在画布里）',
    !(await evaluate(`document.documentElement.scrollWidth > window.innerWidth + 2`)),
  );

  /* ---------------- A2. 版式：一张纸 / 纪元分段 / 字体比例 ---------------- */
  /*
   * 这三条都是作者看完第一版之后点名的：
   *   · 「最右侧的编年卡片不符合这个风格……和总体的布局都有些割裂」→ 右栏与展墙**同一张纸**；
   *   · 纪元是首尾相接的 → 墙沿那条色线该**一段接一段铺满**；
   *   · 「字体过大，有种头重脚轻的，要适量留白」→ 标题有上限、卡里有内边距。
   * 全都用实测值判，不靠看截图。
   */
  const look = JSON.parse(
    await evaluate(`JSON.stringify((() => {
      const side = document.querySelector('.chron-side');
      const stage = document.querySelector('[data-role=chron-stage]');
      const H = (e) => Math.round(e.getBoundingClientRect().height);
      const chrome = ['.chron-side', '[data-role=chron-brief]', '[data-role=chron-pool]']
        .map((s) => document.querySelector(s))
        .filter(Boolean)
        .filter((e) => {
          const c = getComputedStyle(e);
          return parseFloat(c.borderTopLeftRadius) > 0 || c.boxShadow !== 'none';
        })
        .map((e) => (e.className || '').toString().slice(0, 24));
      const eras = [...document.querySelectorAll('[data-role=chron-era]')]
        .map((e) => e.getBoundingClientRect())
        .sort((a, b) => a.left - b.left)
        .map((r) => [Math.round(r.left), Math.round(r.right)]);
      const gaps = [];
      for (let i = 1; i < eras.length; i++) {
        const g = eras[i][0] - eras[i - 1][1];
        if (Math.abs(g) > 1) gaps.push(g);
      }
      const canvas = document.querySelector('.chron-canvas').getBoundingClientRect();
      const card = document.querySelector('[data-role=chron-item]');
      const cs = getComputedStyle(card);
      return {
        sideH: side ? H(side) : null,
        stageH: stage ? H(stage) : null,
        chrome, gaps,
        /* 注意：这段注释在**模板字符串**里，不能出现反引号。
           getBoundingClientRect 给的是**视口坐标**，不能拿它跟画布的「宽度」比 ——
           差的是画布左沿的偏移（左边有侧栏）。要比就比左右沿。 */
        spanFrom: eras.length ? eras[0][0] : null,
        spanTo: eras.length ? eras[eras.length - 1][1] : null,
        canvasL: Math.round(canvas.left),
        canvasR: Math.round(canvas.right),
        title: parseFloat(getComputedStyle(card.querySelector('.chron-title')).fontSize),
        pad: [parseFloat(cs.paddingTop), parseFloat(cs.paddingBottom)],
      };
    })())`),
  );
  check(
    '右栏与展墙同高（同一张纸的两半，栏线通到底）',
    Math.abs(look.sideH - look.stageH) <= 2,
    `右栏 ${look.sideH} / 展墙 ${look.stageH}`,
  );
  check(
    '右栏里没有「卡片」那套外壳（圆角 / 投影）',
    look.chrome.length === 0,
    look.chrome.join(', ') || '干干净净',
  );
  check(
    '纪元带的色段首尾相接、铺满整条轴',
    look.gaps.length === 0 &&
      Math.abs(look.spanFrom - look.canvasL) <= 1 &&
      Math.abs(look.spanTo - look.canvasR) <= 1,
    `段间缝隙 ${JSON.stringify(look.gaps)}；覆盖 ${look.spanFrom}→${look.spanTo} / 轴 ${look.canvasL}→${look.canvasR}`,
  );
  check(
    '卡片标题不过大（≤ 21.5px）且卡内有留白（上下 ≥ 16px）',
    look.title <= 21.5 && look.pad[0] >= 16 && look.pad[1] >= 16,
    `标题 ${look.title}px / 内边距 ${look.pad.join(' / ')}`,
  );

  /* ---------------- A3. 卡片高度一致 + 下方留白 + 查看详情 ---------------- */
  /*
   * 这三条是作者这一轮点名的：
   *   · 「统一卡片高度一致」→ 全墙一个高度，不按分量分高低；
   *   · 「字体卡下方留有空间，大概二倍个字体高度」→ 下内边距 ≈ 2× 标题字号；
   *   · 「鼠标移到卡片上会出现查看详情文字，点击后跳转到对应条目」→
   *     悬停时那行字亮出来（默认透明），点一下（没拖）打开条目编辑器。
   */
  const cardLook = JSON.parse(
    await evaluate(`JSON.stringify((() => {
      const cards = [...document.querySelectorAll('[data-role=chron-item]')];
      const hs = cards.map((c) => Math.round(c.getBoundingClientRect().height));
      const pads = cards.map((c) => parseFloat(getComputedStyle(c).paddingBottom));
      const titles = cards.map((c) => parseFloat(getComputedStyle(c.querySelector('.chron-title')).fontSize));
      const view = document.querySelector('[data-role=chron-view-hint]');
      const lane = document.querySelector('[data-role=chron-add-lane]');
      const sc = document.querySelector('.chron-scroll');
      let laneInfo = null;
      if (lane && sc) {
        const before = lane.getBoundingClientRect().left;
        const keep = sc.scrollLeft;
        sc.scrollLeft = keep + 900;
        laneInfo = {
          inScroll: !!lane.closest('.chron-scroll'),
          before: Math.round(before),
          after: Math.round(lane.getBoundingClientRect().left),
        };
        sc.scrollLeft = keep;
      }
      return {
        hs, pads, titles,
        uniform: hs.every((h) => Math.abs(h - hs[0]) <= 1),
        /* 下内边距都 ≈ 自己标题字号的两倍（差 1px 内） */
        bottomSpace: pads.every((p, i) => Math.abs(p - titles[i] * 2) <= 1),
        viewHidden: view ? getComputedStyle(view).opacity === '0' : null,
        viewText: view ? view.textContent.trim() : null,
        lane: laneInfo,
      };
    })())`),
  );
  check(
    '卡片高度全墙一致',
    cardLook.uniform,
    `高度 ${[...new Set(cardLook.hs)].join(' / ')}`,
  );
  check(
    '卡内下方留白 ≈ 二倍标题字号',
    cardLook.bottomSpace,
    `下边距 ${cardLook.pads.join(',')} / 标题 ${cardLook.titles.join(',')}`,
  );
  check(
    '悬停的「查看详情」默认看不见（悬停才亮）',
    cardLook.viewHidden === true && cardLook.viewText === '查看详情',
    `${cardLook.viewText} / 透明=${cardLook.viewHidden}`,
  );
  check(
    '「在这一刻新建一条」的带子在滚动区外（横滚带不走它）',
    (() => {
      const r = cardLook.lane;
      return r && !r.inScroll && Math.abs(r.before - r.after) <= 1;
    })(),
    `滚 900px：${cardLook.lane?.before} → ${cardLook.lane?.after}（在滚动区里=${cardLook.lane?.inScroll}）`,
  );
  /* 点卡片（不拖）= 打开这一条的条目编辑器 —— 「查看详情」说的就是这件事 */
  await evaluate(`(() => {
    const card = document.querySelector('[data-role=chron-item]');
    window.__cardId = card.dataset.id;
    const r = card.getBoundingClientRect();
    card.dispatchEvent(new MouseEvent('mousedown', {
      bubbles: true, button: 0, clientX: r.left + r.width / 2, clientY: r.top + 24 }));
    return 'down';
  })()`);
  await evaluate(`window.dispatchEvent(new MouseEvent('mouseup', { bubbles: true })); 'up'`);
  const editorOpened = await waitFor(`!!document.querySelector('[data-role=entry-close]')`, 8000);
  check('点卡片 → 条目编辑器打开了（跳到对应条目）', editorOpened);
  await evaluate(`document.querySelector('[data-role=entry-close]').click(); 'close'`);
  await sleep(500);

  /* ---------------- A4. 卡片不可选字（治「闪烁的插入点」）+ 点轨选卡 ---------------- */
  /*
   * 卡片是可拖的，按下拖动时浏览器会顺手开始一次文本选择，标题上冒出一个
   * 闪烁的插入点（I 形光标）跟着指针走。所以整卡、轨上的点与条都该禁掉选中。
   * 这条断言就是防它哪次又被加回来。
   */
  const selLook = JSON.parse(
    await evaluate(`JSON.stringify((() => {
      const card = document.querySelector('[data-role=chron-item]');
      const node = document.querySelector('[data-role=chron-node]');
      const bar = document.querySelector('[data-role=chron-bar]');
      return {
        card: card ? getComputedStyle(card).userSelect : null,
        node: node ? getComputedStyle(node).userSelect : null,
        bar: bar ? getComputedStyle(bar).userSelect : null,
      };
    })())`),
  );
  check(
    '卡片/轨点/轨条都不可选中（不会有闪烁的插入点）',
    selLook.card === 'none' && selLook.node === 'none' && selLook.bar === 'none',
    `卡=${selLook.card} / 点=${selLook.node} / 条=${selLook.bar}`,
  );

  /* 点甘特轨上的一个点 → 上面那张卡滚到眼前**并选中**（右栏注记跟着换） */
  await evaluate(`(() => {
    const node = document.querySelector('[data-role=chron-node]');
    window.__railId = node.dataset.id;
    const r = node.getBoundingClientRect();
    node.dispatchEvent(new MouseEvent('mousedown', {
      bubbles: true, button: 0, clientX: r.left + r.width / 2, clientY: r.top + r.height / 2 }));
    return 'down';
  })()`);
  await evaluate(`window.dispatchEvent(new MouseEvent('mouseup', { bubbles: true })); 'up'`);
  await sleep(600);
  const railSel = JSON.parse(
    await evaluate(`JSON.stringify({
      panelId: document.querySelector('[data-role=chron-panel]')?.dataset.id ?? null,
      railId: window.__railId,
    })`),
  );
  check(
    '点轨上的点 → 右栏注记切到那条（上下对上了）',
    railSel.panelId === railSel.railId && railSel.panelId != null,
    `右栏=${railSel.panelId} / 点的=${railSel.railId}`,
  );

  /* ---------------- B. 挨在同一刻的两条必须就地铺开 ---------------- */
  const tie = ['e_gan', 'e_tide'];
  check('同一刻的两条都被就地铺开了', tie.every((id) => a.pushed.includes(id)), a.pushed.join(', '));
  check(
    '图例如实报出铺开了几张',
    a.pushedLegend === a.pushed.length && a.pushedLegend > 0,
    `图例 ${a.pushedLegend} / 实际 ${a.pushed.length}`,
  );

  /* ---------------- C. 拖卡片改先后 → 真落库 ---------------- */
  const before = (await readEntry('e_zhong')).time.at;
  const opsBefore = await readOps();
  const drag = JSON.parse(
    await evaluate(`(() => {
      const canvas = document.querySelector('.chron-canvas');
      const card = document.querySelector('[data-role=chron-item]');
      const r = card.getBoundingClientRect();
      const x0 = r.left + r.width / 2;
      const y = r.top + 24;
      card.dispatchEvent(new MouseEvent('mousedown', {
        bubbles: true, button: 0, clientX: x0, clientY: y }));
      return JSON.stringify({ id: card.dataset.id, x0, y,
        target: Math.round(canvas.getBoundingClientRect().left) + 520 });
    })()`),
  );
  for (const k of [0.35, 0.7, 1]) {
    const x = Math.round(drag.x0 + (drag.target - drag.x0) * k);
    await evaluate(`window.dispatchEvent(new MouseEvent('mousemove', {
      bubbles: true, button: 0, clientX: ${x}, clientY: ${drag.y} })); 'ok'`);
    await sleep(120);
  }
  await evaluate(`window.dispatchEvent(new MouseEvent('mouseup', { bubbles: true })); 'ok'`);
  await sleep(1000);
  const after = (await readEntry(drag.id)).time.at;
  check('把第一张往右拖 → 它的 at 真的变了', after !== before, `${before} → ${after}`);
  check('改位置留了痕（操作日志多了一条）', (await readOps()) > opsBefore, `${opsBefore} → ${await readOps()}`);

  /* ---------------- D. 池子里的拖上轨 ---------------- */
  const poolN = await evaluate(`document.querySelectorAll('[data-role=chron-pool-row]').length`);
  check('池子里列着还没上轴的条目', poolN === 2, `${poolN} 条`);
  await evaluate(`(() => {
    const row = document.querySelector('[data-role=chron-pool-row]');
    const r = row.getBoundingClientRect();
    window.__poolId = row.dataset.id;
    row.dispatchEvent(new MouseEvent('mousedown', {
      bubbles: true, button: 0, clientX: r.left + 40, clientY: r.top + 10 }));
    return 'ok';
  })()`);
  const poolTarget = await evaluate(
    `Math.round(document.querySelector('.chron-canvas').getBoundingClientRect().left) + 700`,
  );
  await evaluate(`window.dispatchEvent(new MouseEvent('mousemove', {
    bubbles: true, button: 0, clientX: ${poolTarget}, clientY: 300 })); 'ok'`);
  await sleep(150);
  await evaluate(`window.dispatchEvent(new MouseEvent('mouseup', {
    bubbles: true, clientX: ${poolTarget}, clientY: 300 })); 'ok'`);
  await sleep(1200);
  const pooled = JSON.parse(
    await evaluate(`JSON.stringify({ id: window.__poolId })`),
  );
  const dropped = await readEntry(pooled.id);
  check('拖上轨的那条真的有了时间', !!dropped.time && typeof dropped.time.at === 'number',
    `${pooled.id} at=${dropped.time?.at}`);
  check(
    '池子跟着少了一条',
    (await evaluate(`document.querySelectorAll('[data-role=chron-pool-row]').length`)) === 1,
  );

  /* ---------------- D2. 点两下落位（从旧轴移植过来的第二条通道） ---------------- */
  /*
   * 池子里的一行：拖上去是一条路，**点一下它、再点画布任意一处**是另一条路。
   * 编年接管时间那一支之后，旧轴有的功能一个都不能少 —— 这条通道就是从那边
   * 原样搬来的。（`.click()` 的 detail===0 走的是键盘那条路，与旧轴同一套判法。）
   */
  const pendingRowId = await evaluate(
    `(() => { const r = document.querySelector('[data-role=chron-pool-row]'); return r ? r.dataset.id : null; })()`,
  );
  await evaluate(`document.querySelector('[data-role=chron-pool-row]').click(); 'pick'`);
  const bannerShown = await waitFor(`!!document.querySelector('[data-role=chron-place-banner]')`, 6000);
  check('点一下池子里的条目 → 出现「点轴上任意一处」的横幅', bannerShown);
  const pendingAt = await evaluate(
    `Math.round(document.querySelector('.chron-canvas').getBoundingClientRect().left) + 300`,
  );
  await evaluate(`(() => {
    const wall = document.querySelector('[data-role=chron-wall]');
    const r = wall.getBoundingClientRect();
    wall.dispatchEvent(new MouseEvent('mousedown', {
      bubbles: true, button: 0, clientX: ${pendingAt}, clientY: r.top + r.height / 2 }));
    return 'ok';
  })()`);
  await sleep(1000);
  const pendingEntry = await readEntry(pendingRowId);
  check(
    '再点画布一处 → 那条真的落在了轴上（横幅消失、池子清空）',
    !!pendingEntry.time && typeof pendingEntry.time.at === 'number' &&
      !(await evaluate(`!!document.querySelector('[data-role=chron-place-banner]')`)) &&
      (await evaluate(`document.querySelectorAll('[data-role=chron-pool-row]').length`)) === 0,
    `at=${pendingEntry.time?.at}`,
  );

  /* ---------------- E. 纪元带筛选 ---------------- */
  const beforeFilter = (await cardsAudit()).n;
  /* 属性值一定要加引号：CSS 里中文标识符不合法，不加会静默选不中 */
  await evaluate(`document.querySelector('[data-role=chron-era][data-era="涨潮纪"]').click(); 'ok'`);
  await sleep(700);
  const filtered = await cardsAudit();
  check(
    '点纪元带 → 只看这一段',
    filtered.n > 0 && filtered.n < beforeFilter,
    `${beforeFilter} → ${filtered.n}`,
  );
  check('筛完仍然没有一张重叠', filtered.hit.length === 0, filtered.hit.join(', '));
  await evaluate(`document.querySelector('[data-role=chron-era][data-era="涨潮纪"]').click(); 'ok'`);
  await sleep(700);
  check('再点一下回到全部', (await cardsAudit()).n > filtered.n);

  /* ---------------- F. 「显示」浮层：看法收在里面 ---------------- */
  check(
    '画布上方**不再有工具条**（看法搬到底下去了）',
    !(await evaluate(`!!document.querySelector('.page-head ~ .chron-tools, .row.chron-tools')`)) &&
      !!(await evaluate(`!!document.querySelector('[data-role=chron-footbar] [data-role=chron-tools]')`)),
  );
  await evaluate(`document.querySelector('[data-role=chron-tools-more]').click(); 'ok'`);
  await sleep(500);
  check(
    '「显示」打得开，里面有比例 / 均匀',
    await evaluate(`!!document.querySelector('[data-role=chron-more] [data-role=chron-scale-even]')`),
  );
  const atsBeforeEven = JSON.parse(
    await evaluate(`JSON.stringify([...document.querySelectorAll('[data-role=chron-item]')]
      .map((e) => e.dataset.x))`),
  );
  /* 快照要现取：中间拖了一条池子条目上轴，早先那份已经不是同一批了 */
  const idsBeforeEven = (await cardsAudit()).ids.join(',');
  await evaluate(`document.querySelector('[data-role=chron-scale-even]').click(); 'ok'`);
  await sleep(1100);
  const evenView = await cardsAudit();
  check('切「均匀」之后仍然一张不重叠、顺序也没乱', evenView.hit.length === 0 && evenView.ordered);
  check(
    '「轴距只是看法」：切了模式，轴上的还是同一批条目、同一个先后',
    evenView.ids.join(',') === idsBeforeEven,
    evenView.ids.length + ' 条',
  );
  check(
    '均匀模式下卡片等距铺开（原来挤的那些不再需要铺开）',
    evenView.pushed.length === 0,
    evenView.pushed.join(', ') || '没有铺开的了',
  );
  const evenEntry = await readEntry('e_gan');
  check('切模式没有动数据：条目里那个 at 一个字节都没变', evenEntry.time.at === 9, `at=${evenEntry.time.at}`);
  await evaluate(`document.querySelector('[data-role=chron-scale-prop]').click(); 'ok'`);
  await sleep(700);
  await evaluate(`document.querySelector('[data-role=chron-more-mask]').click(); 'ok'`);
  await sleep(400);
  check('点别处浮层就收起来', !(await evaluate(`!!document.querySelector('[data-role=chron-more]')`)));
  check(
    '收起来之后卡片位置回到比例那一套',
    JSON.parse(await evaluate(`JSON.stringify([...document.querySelectorAll('[data-role=chron-item]')]
      .map((e) => e.dataset.x))`)).join(',') === atsBeforeEven.join(','),
  );

  /* ---------------- G. AI 排版：移植过来的那条链路 ---------------- */
  await fetch('http://127.0.0.1:5190/__mock-stats/reset').catch(() => {});
  const posBeforeAi = await evaluate(`document.querySelector('[data-role=chron-item]').dataset.left`);
  // 「AI 自动排版」现在是「AI 行为」下拉里的一条二级命令，得先点开菜单
  await evaluate(`document.querySelector('[data-role=chron-ai-toggle]').click(); 'ok'`);
  await evaluate(`document.querySelector('[data-role=chron-ai-layout]').click(); 'ok'`);
  const gotBanner = await waitFor(`!!document.querySelector('[data-role=chron-layout-plan]')`, 25000);
  check('AI 排版按下去之后出现了「有待审方案」的横幅', gotBanner);
  const review = await readReview();
  check(
    '方案进了审查队列，不是直接落库',
    review.some((r) => r.kind === 'timeline-layout' && r.status === 'pending'),
    JSON.stringify(review),
  );
  check(
    '采纳之前轴上一点都没动（卡片位置照旧）',
    (await evaluate(`document.querySelector('[data-role=chron-item]').dataset.left`)) === posBeforeAi,
  );

  /* ---------------- G2. 「旧的」：旧的那支点轴从这个口子进 ---------------- */
  check(
    '编年右下角留着「旧的」链接',
    (await evaluate(`document.querySelector('[data-role=chron-old-view]')?.textContent?.trim()`)) === '旧的',
  );
  await evaluate(`document.querySelector('[data-role=chron-old-view]').click(); 'old'`);
  const oldAxis = await waitFor(`!!document.querySelector('[data-role=tl-axis]')`, 8000);
  check('点「旧的」→ 旧的那支点轴画出来了（同一份数据的另一种读法）', oldAxis);
  await evaluate(`document.querySelector('[data-role=graph-view-chronicle]').click(); 'back'`);
  await sleep(600);
  check(
    '点「编年」切回来，切换位上没有第三个入口',
    (await evaluate(
      `!!document.querySelector('[data-role=chron-stage]') && !document.querySelector('[data-role=graph-view-time]')`,
    )) === true,
  );

  /* ---------------- H. 刷新之后还在 ---------------- */
  await client.send('Page.reload');
  await sleep(3500);
  await evaluate(`document.querySelector('[data-role=graph-view-chronicle]').click(); 'ok'`);
  await sleep(1200);
  const reloaded = await cardsAudit();
  check('刷新之后照样进得去、卡片照样不重叠', reloaded.n >= 7 && reloaded.hit.length === 0,
    `${reloaded.n} 张`);
  check('拖过的那条位置还在', (await readEntry(drag.id)).time.at === after, `at=${after}`);

  /* ---------------- I. 没有异常 ---------------- */
  const errs = client.events
    .filter((e) => e.method === 'Runtime.exceptionThrown')
    .map((e) => e.params.exceptionDetails?.exception?.description?.slice(0, 200));
  const cons = client.events
    .filter((e) => e.method === 'Runtime.consoleAPICalled' && e.params.type === 'error')
    .map((e) => e.params.args.map((a) => a.value ?? a.description).join(' ').slice(0, 200));
  check('没有未捕获异常', errs.length === 0, errs.join(' | '));
  check('控制台没有 error 级日志', cons.length === 0, cons.join(' | '));

  client.close();
} catch (e) {
  check('脚本跑到底', false, e.message);
}

const failed = results.filter((r) => !r.ok).length;
console.log(`\n编年端到端：${results.length - failed}/${results.length}`);
if (failed) process.exitCode = 1;
chrome.kill();
