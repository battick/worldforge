/**
 * 开发期端到端验证：关系图谱的「直接编辑」能力
 *
 * 用户诉求：图谱上能快速改连线、改节点名、改颜色，悬停还能弹出信息卡。
 *
 * 验证点：
 *   1. 悬停节点 → 预览卡出现，含标题/分类/简介/关联摘要
 *   2. 双击节点 → 画布内联改名 → 落库（IndexedDB 里 title 变了）
 *   3. 右键节点 → 菜单出现 → 选色 → 条目 color 落库、圆点 fill 跟着变
 *   4. 图例点分类圆点 → 分类色板浮层 → 改分类色 → 分类 color 落库、该分类下节点变色
 *   5. 连线模式：点两个节点 → 新关系落库（canon）
 *   6. 点连线 → 侧栏连线编辑器 → 改类型 / 反转方向 / 删除，逐步落库
 *   7. 悬停连线 → 出现连线信息卡；重名/同名重复连线会被拦下
 *   8. 刷新后所有改动仍在（持久化）
 *   9. 同一页的两支：关系 ↔ 时间（轴上的东西就是设了时间的那些条目）
 *  10. 条目一多时的可读性：圆的大小/透明度跟着联系的多少走，稀疏时自动收手
 *
 * 前置：node server.mjs（默认 5188，需已构建最新 dist）
 * 用法：node .dev/e2e-graph.mjs
 */
import { spawn } from 'node:child_process';
import { writeFileSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const CHROME = 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const APP_URL = 'http://127.0.0.1:5188/';
const OUT = '.shots/graph';
const PORT = 9366;
const profile = mkdtempSync(join(tmpdir(), 'cdp-graph-'));
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
    }
  };
  const send = (method, params = {}) =>
    new Promise((resolve, reject) => {
      const mid = ++id;
      pending.set(mid, { resolve, reject });
      ws.send(JSON.stringify({ id: mid, method, params }));
    });
  return { ready, send };
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
  const shot = async (path) => {
    const s = await client.send('Page.captureScreenshot', { format: 'png' });
    writeFileSync(path, Buffer.from(s.data, 'base64'));
    console.log('  截图 →', path);
  };
  /** 读库里的一条记录（绕过界面，验证真的落库了） */
  const readDb = async (store, id) =>
    evaluate(`(async () => {
      const db = await new Promise((res) => {
        const o = indexedDB.open('worldforge');
        o.onsuccess = () => res(o.result);
        o.onerror = () => res(null);
      });
      if (!db) return null;
      const rec = await new Promise((res) => {
        const q = db.transaction(${JSON.stringify(store)}, 'readonly').objectStore(${JSON.stringify(store)}).get(${JSON.stringify(id)});
        q.onsuccess = () => res(q.result ?? null);
        q.onerror = () => res(null);
      });
      db.close();
      return rec;
    })()`);
  const allRels = async () =>
    evaluate(`(async () => {
      const db = await new Promise((res) => {
        const o = indexedDB.open('worldforge');
        o.onsuccess = () => res(o.result);
      });
      const rows = await new Promise((res) => {
        const q = db.transaction('relations','readonly').objectStore('relations').getAll();
        q.onsuccess = () => res(q.result ?? []);
      });
      db.close();
      return rows;
    })()`);

  /* ---------------- 0. 播种一个最小世界（3 条目 / 2 分类 / 1 关系） ---------------- */
  await client.send('Page.navigate', { url: APP_URL });
  await sleep(1500);
  const seeded = await evaluate(`(async () => {
    try {
      const db = await new Promise((res, rej) => {
        const o = indexedDB.open('worldforge');
        o.onsuccess = () => res(o.result);
        o.onerror = () => rej(o.error);
      });
      const t = Date.now();
      const wid = 'wd_graph';
      const world = { id: wid, name: '图谱测试', tagline: '图谱交互用例', summary: '## 概览\\n\\n用于验证图谱交互。',
        genre: '测试', tone: '仅用例。', themeColor: '#2f6fb0', createdAt: t, updatedAt: t };
      const c1 = { id: 'ct_g1', worldId: wid, name: '地理', icon: '🗺️', fieldDefs: [], order: 0, createdAt: t, updatedAt: t };
      const c2 = { id: 'ct_g2', worldId: wid, name: '人物', icon: '👤', fieldDefs: [], order: 1, createdAt: t, updatedAt: t };
      const mk = (id, cat, title, sum, tags, time) => ({ id, worldId: wid, categoryId: cat, title, aliases: ['别名A'],
        summary: sum, content: '## 概览\\n\\n' + sum, tags, fields: {}, status: 'canon', sourceRefs: [],
        ...(time ? { time } : {}), createdAt: t, updatedAt: t });
      // 两条设了时间、一条没设 —— 切到时间那一支时，「轴上只有一半」才看得出来
      const e1 = mk('en_g1', 'ct_g1', '灰港', '一座常年被雾笼罩的港口城市，关税极高。', ['港口', '雾'],
        { kind: 'point', from: '雾历 12 年', to: '', at: 10, era: '雾历', weight: 'major' });
      const e2 = mk('en_g2', 'ct_g2', '守灯人', '负责维护灯塔的老人，据说认识每一艘船。', ['灯塔'],
        { kind: 'ongoing', from: '雾历 30 年', to: '', at: 30, era: '雾历', weight: 'normal' });
      const e3 = mk('en_g3', 'ct_g1', '北境冰原', '大陆最北端的无人区。', ['北境']);
      const rel = { id: 'rl_g1', worldId: wid, fromEntryId: 'en_g2', toEntryId: 'en_g1',
        type: '位于', note: '守灯人常驻灰港灯塔', status: 'canon', createdAt: t };
      const put = (store, items) => new Promise((res, rej) => {
        const tx = db.transaction(store, 'readwrite');
        items.forEach((i) => tx.objectStore(store).put(i));
        tx.oncomplete = () => res();
        tx.onerror = () => rej(tx.error);
      });
      await put('worlds', [world]);
      await put('categories', [c1, c2]);
      await put('entries', [e1, e2, e3]);
      await put('relations', [rel]);
      db.close();
      localStorage.setItem('worldforge:settings', JSON.stringify({
        ai: { provider: 'custom', baseUrl: 'http://127.0.0.1:5190/v1', apiKey: 'graph-key',
              model: 'mock-model', temperature: 0.8, contextLimit: 60, vision: true },
        activeWorldId: wid
      }));
      return 'seeded';
    } catch (e) { return 'seed-failed: ' + (e && e.message); }
  })()`);
  check('播种最小世界', seeded === 'seeded', String(seeded));

  /* ---------------- 1. 打开图谱页 ---------------- */
  await client.send('Page.navigate', { url: APP_URL + '?t=1#graph' });
  // 默认支已经换成编年 —— 这一支验的是关系网，先点回关系
  await waitFor(`!!document.querySelector('[data-role=graph-view-relations]')`, 20000);
  await evaluate(`document.querySelector('[data-role=graph-view-relations]').click(); 'ok'`);
  const graphReady = await waitFor(`!!document.querySelector('[data-node="en_g1"]')`, 20000);
  check('图谱渲染出节点', graphReady);
  const nodeCount = await evaluate(`document.querySelectorAll('[data-node]').length`);
  check('节点数量正确', nodeCount === 3, `${nodeCount} 个`);
  await sleep(1200); // 让力导向布局稳定，便于悬停命中

  /* ---------------- 2. 悬停节点 → 预览卡 ---------------- */
  await evaluate(`(() => {
    const g = document.querySelector('[data-node="en_g1"]');
    g.dispatchEvent(new MouseEvent('mouseover', { bubbles: true }));
    return 'ok';
  })()`);
  const hoverShown = await waitFor(`!!document.querySelector('.gx-hover')`, 4000);
  check('悬停节点出现预览卡', hoverShown);
  const hoverText = await evaluate(`document.querySelector('.gx-hover')?.innerText ?? ''`);
  check('预览卡含标题', hoverText.includes('灰港'));
  check('预览卡含分类', hoverText.includes('地理'));
  check('预览卡含简介', hoverText.includes('被雾笼罩'));
  check('预览卡含别名/标签', hoverText.includes('又名') && hoverText.includes('港口'));
  check('预览卡含关联摘要', hoverText.includes('关联'));
  await shot(`${OUT}-hover.png`);

  /* ---------------- 3. 双击改名 ---------------- */
  await evaluate(`(() => {
    const g = document.querySelector('[data-node="en_g1"]');
    g.dispatchEvent(new MouseEvent('mouseover', { bubbles: true }));
    g.dispatchEvent(new MouseEvent('dblclick', { bubbles: true }));
    return 'ok';
  })()`);
  const renameShown = await waitFor(`!!document.querySelector('.gx-rename')`, 4000);
  check('双击节点出现内联改名输入框', renameShown);
  await shot(`${OUT}-rename.png`);
  await evaluate(`(() => {
    const input = document.querySelector('.gx-rename');
    const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
    setter.call(input, '雾港');
    input.dispatchEvent(new Event('input', { bubbles: true }));
    input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
    return 'ok';
  })()`);
  const renamed = await waitFor(
    `document.body.innerText.includes('已改名为') || document.querySelector('[data-node="en_g1"] text')?.textContent === '雾港'`,
    5000,
  );
  check('改名后界面更新', renamed);
  const dbEntry = await readDb('entries', 'en_g1');
  check('改名已落库', dbEntry?.title === '雾港', `库里 title = ${dbEntry?.title}`);
  const labelText = await evaluate(
    `document.querySelector('[data-node="en_g1"] text')?.textContent ?? ''`,
  );
  check('图谱标签同步为新名字', labelText.includes('雾港'), labelText);

  /* ---------------- 4. 右键菜单改节点颜色 ---------------- */
  await evaluate(`(() => {
    const g = document.querySelector('[data-node="en_g2"]');
    const r = g.getBoundingClientRect();
    g.dispatchEvent(new MouseEvent('mouseover', { bubbles: true }));
    g.dispatchEvent(new MouseEvent('contextmenu', {
      bubbles: true, clientX: r.left + r.width / 2, clientY: r.top + r.height / 2,
    }));
    return 'ok';
  })()`);
  const menuShown = await waitFor(`!!document.querySelector('.gx-menu')`, 4000);
  check('右键节点弹出快捷菜单', menuShown);
  const menuText = await evaluate(`document.querySelector('.gx-menu')?.innerText ?? ''`);
  check('菜单含改名/颜色/连线/删除', ['改名', '节点颜色', '从此节点连线', '删除条目'].every((s) => menuText.includes(s)));
  await shot(`${OUT}-menu.png`);
  await evaluate(`(() => {
    document.querySelector('.gx-menu .gx-swatch[title="#17805a"]').click();
    return 'ok';
  })()`);
  await sleep(500);
  const colored = await readDb('entries', 'en_g2');
  check('节点颜色已落库', colored?.color === '#17805a', `color = ${colored?.color}`);
  const fill = await evaluate(
    `document.querySelector('[data-node="en_g2"] [data-role="node-dot"]')?.getAttribute('fill') ?? ''`,
  );
  check('画布节点跟着变色', fill === '#17805a', fill);

  /* ---------------- 5. 图例改分类颜色 ---------------- */
  await evaluate(`(() => {
    document.querySelectorAll('.legend-dot-btn')[0].click();
    return 'ok';
  })()`);
  const popShown = await waitFor(`!!document.querySelector('.gx-cat-pop')`, 4000);
  check('点图例圆点弹出分类色板', popShown);
  await evaluate(`(() => {
    document.querySelector('.gx-cat-pop .gx-swatch[title="#7c5cbf"]').click();
    return 'ok';
  })()`);
  await sleep(500);
  const cat = await readDb('categories', 'ct_g1');
  check('分类颜色已落库', cat?.color === '#7c5cbf', `color = ${cat?.color}`);
  const e3Fill = await evaluate(
    `document.querySelector('[data-node="en_g3"] [data-role="node-dot"]')?.getAttribute('fill') ?? ''`,
  );
  check('分类下节点继承新颜色', e3Fill === '#7c5cbf', e3Fill);

  /* ---------------- 6. 连线模式新建关系 ---------------- */
  const relCountBefore = (await allRels()).length;
  await evaluate(`(() => {
    const g = document.querySelector('[data-node="en_g1"]');
    g.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, clientX: 10, clientY: 10 }));
    window.dispatchEvent(new MouseEvent('mouseup', { bubbles: true }));
    return 'ok';
  })()`);
  await sleep(400);
  const selectedPanel = await evaluate(`document.body.innerText.includes('节点色')`);
  check('单击节点 → 侧栏变成条目快速编辑', selectedPanel);
  await shot(`${OUT}-panel.png`);

  await evaluate(`(() => {
    [...document.querySelectorAll('.page-actions button')].find((b) => b.textContent.includes('连线')).click();
    return 'ok';
  })()`);
  const linking = await waitFor(`document.body.innerText.includes('连线模式')`, 4000);
  check('进入连线模式（顶部给出提示）', linking);
  await evaluate(`(() => {
    const g = document.querySelector('[data-node="en_g3"]');
    g.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, clientX: 10, clientY: 10 }));
    return 'ok';
  })()`);
  await sleep(800);
  const relsAfter = await allRels();
  check('点两个节点即建立关系', relsAfter.length === relCountBefore + 1, `${relCountBefore} → ${relsAfter.length}`);
  const newRel = relsAfter.find((r) => r.id !== 'rl_g1');
  check(
    '新关系方向与状态正确',
    newRel?.fromEntryId === 'en_g1' && newRel?.toEntryId === 'en_g3' && newRel?.status === 'canon',
    JSON.stringify(newRel && { f: newRel.fromEntryId, t: newRel.toEntryId, s: newRel.status }),
  );
  check('新连线自动选中，侧栏出现连线编辑器', await waitFor(`document.body.innerText.includes('已连上')`, 4000));
  await shot(`${OUT}-new-link.png`);

  /* ---------------- 7. 重复连线被拦下 ---------------- */
  await evaluate(`(() => {
    [...document.querySelectorAll('.page-actions button')].find((b) => b.textContent.includes('连线')).click();
    return 'ok';
  })()`);
  await evaluate(`(() => {
    const g = document.querySelector('[data-node="en_g3"]');
    g.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, clientX: 10, clientY: 10 }));
    return 'ok';
  })()`);
  await sleep(600);
  const dupRels = await allRels();
  check('重复连线被拦下（不会建第二条）', dupRels.length === relCountBefore + 1, `${dupRels.length} 条`);

  /* ---------------- 8. 悬停连线 → 连线信息卡 ---------------- */
  await evaluate(`(() => {
    const g = document.querySelector('[data-link="rl_g1"]');
    g.dispatchEvent(new MouseEvent('mouseover', { bubbles: true }));
    return 'ok';
  })()`);
  const linkHover = await waitFor(`!!document.querySelector('.gx-hover-link')`, 4000);
  check('悬停连线出现信息卡', linkHover);
  const linkHoverText = await evaluate(
    `document.querySelector('.gx-hover-link')?.innerText ?? ''`,
  );
  check('连线卡含两端与类型', linkHoverText.includes('守灯人') && linkHoverText.includes('位于'), linkHoverText.replace(/\n/g, ' / '));
  await shot(`${OUT}-link-hover.png`);

  /* ---------------- 9. 连线编辑：类型 / 反转 / 删除 ---------------- */
  await evaluate(`(() => {
    const g = document.querySelector('[data-link="rl_g1"]');
    g.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
    return 'ok';
  })()`);
  const relEditor = await waitFor(`!!document.querySelector('#gx-type-list') && document.body.innerText.includes('类型')`, 4000);
  check('点连线打开侧栏连线编辑器', relEditor);
  await evaluate(`(() => {
    const input = [...document.querySelectorAll('.gx-panel input')].find((i) => i.getAttribute('list') === 'gx-type-list');
    const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
    setter.call(input, '守卫');
    input.dispatchEvent(new Event('input', { bubbles: true }));
    return 'ok';
  })()`);
  await sleep(500);
  const relAfterType = await readDb('relations', 'rl_g1');
  check('改关系类型已落库', relAfterType?.type === '守卫', `type = ${relAfterType?.type}`);

  await evaluate(`(() => {
    [...document.querySelectorAll('.gx-panel button')].find((b) => b.textContent.includes('反转')).click();
    return 'ok';
  })()`);
  await sleep(500);
  const relAfterSwap = await readDb('relations', 'rl_g1');
  check(
    '反转方向已落库',
    relAfterSwap?.fromEntryId === 'en_g1' && relAfterSwap?.toEntryId === 'en_g2',
    `from=${relAfterSwap?.fromEntryId} to=${relAfterSwap?.toEntryId}`,
  );

  await evaluate(`(() => {
    [...document.querySelectorAll('.gx-panel button')].find((b) => b.textContent.includes('删除连线')).click();
    return 'ok';
  })()`);
  await sleep(600);
  const relAfterDelete = await readDb('relations', 'rl_g1');
  check('删除连线已落库', relAfterDelete === null, String(relAfterDelete && 'still-there'));

  /* ---------------- 10. 同一页的两支：关系 ↔ 时间 ---------------- */
  // 「时间线」已经不单独占一页了：它是「关系与时间」里的一个视图分支，
  // 而轴上画的**就是条目本身**（设了时间的那些）。这一节盯住这个归属：
  //   · 两个切换入口都在，标题是「关系与时间」（不再叫关系图谱）；
  //   · 切到时间 → 画布让位给轴，轴上只有设了时间的那两条（没设的不许出现）；
  //   · 切回关系 → 画布回来，节点一个不少（两支共用一份数据，不是两套库）。
  const titleText = await evaluate(
    `document.querySelector('.page-title')?.textContent?.trim() ?? ''`,
  );
  check('页名已经是「时间与关系」', titleText.includes('时间与关系'), titleText);
  check(
    '两个视图入口都在（编年与关系；时间那一支不再占切换位）',
    (await evaluate(
      `!!document.querySelector('[data-role=graph-view-relations]') && !!document.querySelector('[data-role=graph-view-chronicle]') && !document.querySelector('[data-role=graph-view-time]')`,
    )) === true,
  );
  // 这一节开头在 #graph 上，但上面第 9 节删掉了最后一条连线，画面里节点还在
  check(
    '关系那一支眼下是画布（节点在）',
    (await evaluate(`document.querySelectorAll('[data-node]').length`)) >= 1,
  );

  await evaluate(`document.querySelector('[data-role=graph-view-chronicle]').click(); 'ok'`);
  await sleep(400);
  await evaluate(`document.querySelector('[data-role=chron-old-view]').click(); 'ok'`);
  const axisShown = await waitFor(`!!document.querySelector('[data-role=tl-axis]')`, 6000);
  check('切到时间那一支，轴画出来了', axisShown);
  const axisNodes = await evaluate(`document.querySelectorAll('[data-role=tl-node]').length`);
  check('轴上只有设了时间的那两条', axisNodes === 2, `${axisNodes} 条`);
  const axisTitles = await evaluate(
    `[...document.querySelectorAll('[data-role=tl-list-row]')]
       .map((r) => r.querySelector('.tl-list-title')?.textContent || '').join('|')`,
  );
  check(
    '没设时间的那条不在轴上（它仍旧是关系图里的一员）',
    axisTitles.includes('雾港') && axisTitles.includes('守灯人') && !axisTitles.includes('北境冰原'),
    axisTitles,
  );
  await shot(`${OUT}-time-axis.png`);

  await evaluate(`document.querySelector('[data-role=graph-view-relations]').click(); 'ok'`);
  const canvasBack = await waitFor(`document.querySelectorAll('[data-node]').length >= 1`, 6000);
  check('切回关系，画布和节点都回来了（两支共用一份数据）', canvasBack);

  /* ---------------- 11. 刷新后改动仍在 ---------------- */
  await client.send('Page.navigate', { url: APP_URL + '?t=2#graph' });
  await waitFor(`!!document.querySelector('[data-role=graph-view-relations]')`, 20000);
  await evaluate(`document.querySelector('[data-role=graph-view-relations]').click(); 'ok'`);
  await waitFor(`!!document.querySelector('[data-node="en_g1"]')`, 20000);
  await sleep(1000);
  const persistedLabel = await evaluate(
    `document.querySelector('[data-node="en_g1"] text')?.textContent ?? ''`,
  );
  const persistedFill = await evaluate(
    `document.querySelector('[data-node="en_g2"] [data-role="node-dot"]')?.getAttribute('fill') ?? ''`,
  );
  check('刷新后新名字仍在', persistedLabel.includes('雾港'), persistedLabel);
  check('刷新后节点颜色仍在', persistedFill === '#17805a', persistedFill);
  await shot(`${OUT}-persisted.png`);

  /* ---------------- 12. 条目一多：圆的轻重跟着联系走 ---------------- */
  // 条目一多，图谱就会糊成一片：几十个一样大的圆、几十行一样黑的名字 ——
  // 谁也看不出哪里是枢纽。这一节把「联系多少 → 圆多大 / 有多实」这条刻度钉死，
  // 包括它在**稀疏时自动收手**（十几个点的时候压暗只会把好好一张图看糊）。
  const dense = await evaluate(`(async () => {
    try {
      const db = await new Promise((res, rej) => {
        const o = indexedDB.open('worldforge');
        o.onsuccess = () => res(o.result);
        o.onerror = () => rej(o.error);
      });
      const t = Date.now();
      const wid = 'wd_graph';
      const cL = { id: 'ct_g3', worldId: wid, name: '长尾', icon: '📦', fieldDefs: [], order: 2, createdAt: t, updatedAt: t };
      const mk = (id, cat, title) => ({ id, worldId: wid, categoryId: cat, title, aliases: [],
        summary: '用来铺密度的条目。', content: '## 概览\\n\\n铺密度。', tags: [], fields: {},
        status: 'canon', sourceRefs: [], createdAt: t, updatedAt: t });
      const hub = mk('en_hub', 'ct_g1', '潮汐律');
      const friends = Array.from({ length: 12 }, (_, i) => mk('en_f' + i, 'ct_g2', '从属 ' + (i + 1)));
      const lonely = Array.from({ length: 50 }, (_, i) => mk('en_l' + i, 'ct_g3', '边角 ' + (i + 1)));
      const rels = [
        { id: 'rl_hub_g1', worldId: wid, fromEntryId: 'en_hub', toEntryId: 'en_g1', type: '牵涉', note: '', status: 'canon', createdAt: t },
        ...friends.map((f, i) => ({ id: 'rl_hub_f' + i, worldId: wid, fromEntryId: 'en_hub', toEntryId: f.id, type: '牵涉', note: '', status: 'canon', createdAt: t })),
      ];
      const put = (store, items) => new Promise((res, rej) => {
        const tx = db.transaction(store, 'readwrite');
        items.forEach((i) => tx.objectStore(store).put(i));
        tx.oncomplete = () => res();
        tx.onerror = () => rej(tx.error);
      });
      await put('categories', [cL]);
      await put('entries', [hub, ...friends, ...lonely]);
      await put('relations', rels);
      db.close();
      return 'ok';
    } catch (e) { return 'failed: ' + (e && e.message); }
  })()`);
  check('铺一张密图：1 个枢纽（13 条线）+ 12 个从属 + 50 个长尾', dense === 'ok', String(dense));

  await client.send('Page.navigate', { url: APP_URL + '?t=3#graph' });
  await waitFor(`!!document.querySelector('[data-role=graph-view-relations]')`, 20000);
  await evaluate(`document.querySelector('[data-role=graph-view-relations]').click(); 'ok'`);
  const denseCount = await waitFor(`document.querySelectorAll('[data-node]').length >= 66`, 25000);
  check(
    '66 个条目都画上了（原来 3 条 + 新铺 63 条）',
    denseCount,
    `${await evaluate(`document.querySelectorAll('[data-node]').length`)} 个`,
  );
  await sleep(1500); // 让力导向先跑一会儿，属性读取不受影响，但截图好看些

  /** 把画面上每个节点的可见刻度读回来（半径 / 圆点透明度 / 名字透明度 / 名字字号） */
  const metrics = async () =>
    JSON.parse(
      await evaluate(`JSON.stringify(Object.fromEntries(
        [...document.querySelectorAll('[data-node]')].map((g) => {
          const dot = g.querySelector('[data-role=node-dot]');
          const lab = g.querySelector('[data-role=node-label]');
          return [g.getAttribute('data-node'), {
            deg: +(g.getAttribute('data-degree') || 0),
            r: +(dot?.getAttribute('r') || 0),
            o: +(dot?.getAttribute('opacity') || 0),
            lo: +(lab?.getAttribute('opacity') || 0),
            fs: +(lab?.getAttribute('font-size') || 0),
          }];
        })))`),
    );

  const m = await metrics();
  const hub = m.en_hub ?? { deg: 0, r: 0, o: 0, lo: 0, fs: 0 };
  const friend = m.en_f0 ?? { deg: 0, r: 0, o: 0, lo: 0, fs: 0 };
  const lonely = m.en_l0 ?? { deg: 0, r: 0, o: 0, lo: 0, fs: 0 };
  check('枢纽的度数是 13（12 个从属 + 雾港）', hub.deg === 13, `实际 ${hub.deg}`);
  check(
    '联得多的圆更大：枢纽 > 从属 > 孤立',
    hub.r > friend.r + 3 && friend.r > lonely.r + 1,
    `枢纽 ${hub.r.toFixed(1)} / 从属 ${friend.r.toFixed(1)} / 孤立 ${lonely.r.toFixed(1)}`,
  );
  check(
    '透明度也跟着走：枢纽最实，只连一条的已经淡下去',
    hub.o > friend.o + 0.4 && friend.o > lonely.o,
    `枢纽 ${hub.o.toFixed(2)} / 从属 ${friend.o.toFixed(2)} / 孤立 ${lonely.o.toFixed(2)}`,
  );
  check(
    '名字同理：孤立条目的名字几乎只剩个点',
    hub.lo > lonely.lo + 0.5 && hub.fs > lonely.fs,
    `枢纽 ${hub.lo.toFixed(2)}@${hub.fs.toFixed(1)}px / 孤立 ${lonely.lo.toFixed(2)}@${lonely.fs.toFixed(1)}px`,
  );
  check(
    '图例里画出了这条刻度的样子',
    (await evaluate(`!!document.querySelector('[data-role=graph-weight-legend] svg circle')`)) === true,
  );
  check(
    '概览里报出最密的那条（这是刻度的另一端）',
    (await evaluate(`document.querySelector('[data-role=graph-max-degree]')?.textContent?.trim()`)) === '13',
  );
  await shot(`${OUT}-dense.png`);

  // 选中枢纽 → 它那一圈亮着、名字都读得清；与它无关的一律退到很淡
  // （选中是在 mouseup 上落地的：mousedown 只是开始拖，没拖才算单击）
  await evaluate(`(() => {
    const g = document.querySelector('[data-node="en_hub"]');
    g.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, clientX: 10, clientY: 10 }));
    window.dispatchEvent(new MouseEvent('mouseup', { bubbles: true }));
    return 'ok';
  })()`);
  await sleep(600);
  const mSel = (await metrics());
  check(
    '选中枢纽 → 它自己往外扩一点（临时强调，不参与刻度）',
    (mSel.en_hub?.r ?? 0) > hub.r + 3,
    `${hub.r.toFixed(1)} → ${mSel.en_hub?.r?.toFixed(1)}`,
  );
  check(
    '选中枢纽 → 它牵着的那一圈名字都读得清了',
    (mSel.en_f0?.lo ?? 0) === 1,
    `从属的名字 ${friend.lo.toFixed(2)} → ${mSel.en_f0?.lo?.toFixed(2)}`,
  );
  check(
    '选中枢纽 → 与它无关的条目退到很淡',
    (mSel.en_l0?.o ?? 1) < lonely.o * 0.4,
    `孤立点 ${lonely.o.toFixed(2)} → ${mSel.en_l0?.o?.toFixed(3)}`,
  );
  await shot(`${OUT}-dense-focus.png`);

  // 关掉「按联系轻重」→ 回到一律一样大
  await evaluate(`(() => {
    document.querySelector('.graph-svg').dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
    document.querySelector('[data-role=graph-by-weight]').click();
    return 'ok';
  })()`);
  await sleep(600);
  const mFlat = await metrics();
  const flatVals = Object.values(mFlat);
  const flatRadii = flatVals.map((x) => x.r);
  check(
    '关掉刻度 → 圆一律一样大（想平着看就平着看）',
    Math.max(...flatRadii) - Math.min(...flatRadii) < 0.001,
    `${Math.min(...flatRadii)} ~ ${Math.max(...flatRadii)}`,
  );
  check('关掉刻度 → 名字也一律看得清', flatVals.every((x) => x.lo === 1));
  await shot(`${OUT}-dense-flat.png`);

  await evaluate(`document.querySelector('[data-role=graph-by-weight]').click(); 'ok'`);
  await sleep(500);
  const mBack = await metrics();
  check(
    '勾回来 → 刻度立刻回来',
    (mBack.en_hub?.r ?? 0) > (mBack.en_l0?.r ?? 0) + 5,
    `${mBack.en_hub?.r?.toFixed(1)} vs ${mBack.en_l0?.r?.toFixed(1)}`,
  );

  // 稀疏时自动收手：只留三个点，谁也不压暗
  await evaluate(`(() => {
    const hide = (name) => {
      const sp = [...document.querySelectorAll('.gx-legend .pointer')].find((s) => s.textContent.includes(name));
      if (sp) sp.click();
      return !!sp;
    };
    return [hide('长尾'), hide('人物')].join(',');
  })()`);
  await sleep(2200);
  const mSparse = await metrics();
  const sparseVals = Object.values(mSparse);
  check('藏掉两批之后画面上只剩三个点', sparseVals.length === 3, `${sparseVals.length} 个`);
  check(
    '点少了就不压暗了（十几个点的时候压暗只会把图看糊）',
    sparseVals.length > 0 && sparseVals.every((x) => x.o === 1),
    sparseVals.map((x) => x.o.toFixed(2)).join(' / '),
  );
  check(
    '但轻重照旧：连得多的还是更大',
    new Set(sparseVals.map((x) => x.r.toFixed(1))).size >= 2,
    sparseVals.map((x) => x.r.toFixed(1)).join(' / '),
  );
  await shot(`${OUT}-sparse.png`);

  /* ---------------- 11. 双向关系：合并成一条双箭头 + 关联处显示双方 ---------------- */
  // 在雾港与守灯人之间铺一对反向关系（A→B 敌对 + B→A 效忠），验证归并
  await evaluate(`(async () => {
    const db = await new Promise((res, rej) => {
      const r = indexedDB.open('worldforge');
      r.onsuccess = () => res(r.result);
      r.onerror = () => rej(r.error);
    });
    const wid = JSON.parse(localStorage.getItem('worldforge:settings') || '{}').activeWorldId;
    const t = Date.now();
    const pair = [
      { id: 'rl_mut_a', worldId: wid, fromEntryId: 'en_g1', toEntryId: 'en_g2', type: '敌对', note: '', status: 'canon', createdAt: t },
      { id: 'rl_mut_b', worldId: wid, fromEntryId: 'en_g2', toEntryId: 'en_g1', type: '效忠', note: '', status: 'canon', createdAt: t },
    ];
    await new Promise((res, rej) => {
      const tx = db.transaction('relations', 'readwrite');
      pair.forEach((i) => tx.objectStore('relations').put(i));
      tx.oncomplete = () => res();
      tx.onerror = () => rej(tx.error);
    });
    db.close();
    return 'seeded';
  })()`);
  await client.send('Page.navigate', { url: APP_URL + '?t=2#graph' });
  await waitFor(`!!document.querySelector('[data-role=graph-view-relations]')`, 20000);
  await evaluate(`document.querySelector('[data-role=graph-view-relations]').click(); 'ok'`);
  await waitFor(`!!document.querySelector('[data-node="en_g1"]')`, 20000);
  await sleep(1200);

  // 图上：这一对反向关系合并成**一条**双箭头边
  const mutualEdge = await evaluate(`(() => {
    const el = document.querySelector('[data-mutual="true"]');
    if (!el) return null;
    const line = el.querySelector('line:not([stroke="transparent"])');
    return {
      found: true,
      dataLink: el.getAttribute('data-link'),
      markerStart: line?.getAttribute('marker-start') ?? null,
      markerEnd: line?.getAttribute('marker-end') ?? null,
      label: el.querySelector('text')?.textContent ?? '',
    };
  })()`);
  check('双向关系合并成一条边（data-mutual）', !!mutualEdge?.found, JSON.stringify(mutualEdge));
  check(
    '这条边两端都带箭头（双箭头）',
    !!mutualEdge?.markerStart && !!mutualEdge?.markerEnd,
    `start=${mutualEdge?.markerStart} end=${mutualEdge?.markerEnd}`,
  );
  check(
    '边上标签是两个方向各一句（敌对 ⇄ 效忠）',
    (mutualEdge?.label ?? '').includes('敌对') && (mutualEdge?.label ?? '').includes('效忠'),
    mutualEdge?.label ?? '',
  );
  await shot(`${OUT}-mutual-edge.png`);

  // 侧栏「关联」：选中雾港，两条反向合成一行、方向显示「⇄」、两个类型都摆出来
  await evaluate(`(() => {
    const g = document.querySelector('[data-node="en_g1"]');
    g.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, clientX: 10, clientY: 10 }));
    window.dispatchEvent(new MouseEvent('mouseup', { bubbles: true }));
    return 'ok';
  })()`);
  await sleep(400);
  const mutualRow = await evaluate(`(() => {
    const rows = [...document.querySelectorAll('.gx-rel-row[data-mutual="true"]')];
    if (!rows.length) return null;
    const r = rows[0];
    return {
      count: rows.length,
      dir: r.querySelector('.gx-rel-dir')?.textContent ?? '',
      inputType: r.querySelector('.gx-rel-type')?.value ?? '',
      text: r.innerText.replace(/\\n/g, ' / '),
    };
  })()`);
  check(
    '侧栏关联把这一对合并成一行（不是两行）',
    mutualRow?.count === 1,
    `rows=${mutualRow?.count}`,
  );
  check('这一行方向是「⇄」（互相）', mutualRow?.dir === '⇄', mutualRow?.dir);
  check(
    '两个方向各摆了自己的类型（出发=敌对在输入框，回来=效忠在后方）',
    mutualRow?.inputType === '敌对' && (mutualRow?.text ?? '').includes('效忠'),
    `input=${mutualRow?.inputType} · ${mutualRow?.text}`,
  );
  await shot(`${OUT}-mutual-sidebar.png`);

  // 点这条双向边 → 连线编辑器要提醒「还有反向的一条」
  await evaluate(`(() => {
    const g = document.querySelector('[data-mutual="true"]');
    g.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
    return 'ok';
  })()`);
  await sleep(400);
  const mutualHint = await evaluate(
    `document.querySelector('[data-role=graph-rel-mutual-hint]')?.textContent ?? ''`,
  );
  check(
    '连线编辑器提醒双向对的另一半（反向那条的类型）',
    mutualHint.includes('效忠'),
    mutualHint,
  );
  await shot(`${OUT}-mutual-editor.png`);

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
