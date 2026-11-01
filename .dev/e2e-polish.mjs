/**
 * 开发期端到端验证：**批量打磨走任务队列**。
 *
 * 这条链路要盯住的不只是「按钮点了有反应」，还有几条只有批量场景才暴露的纪律：
 *
 *   1. **多选之后是「加入队列」，不是「当场跑完」。** 面板把活儿交出去就该撒手 ——
 *      进度在右下角那条队列上，切页不中断，回来照样看得到。
 *   2. **不改就不入队**。模型原样返回的条目不能占审查队列的位置 ——
 *      作者要连着审十几张卡，多一张空 diff 就是让他多读一遍。
 *   3. **一条翻车不毁一批**。某一条模型答非所问时，那一条在队列里记成失败，
 *      其余照常跑完并入队，谁也不连坐。
 *   4. **同批可整批处理**。一次排出来的提议带同一个批号，审查页据此归组，
 *      并能「采纳这一批」—— 十几条一条条点太折磨人。
 *   5. **同一条不重复排**。连点两下不该排出两件（那会让同一条被两个活儿同时改）；
 *      已经有待审修订的更该在入队前就被拦下。
 *
 * 前置：
 *   npx vite build                 （e2e 跑的是构建产物）
 *   node server.mjs                （5188）
 *   node .dev/mock-upstream.mjs 5190
 * 用法：node .dev/e2e-polish.mjs
 */
import { spawn } from 'node:child_process';
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const CHROME = 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const APP_URL = process.env.APP_URL || 'http://127.0.0.1:5188/';
const MOCK_BASE = process.env.MOCK_URL || 'http://127.0.0.1:5190/v1';
const MOCK_ORIGIN = new URL(MOCK_BASE).origin;
const OUT = '.shots/polish';
const PORT = 9384;
const profile = mkdtempSync(join(tmpdir(), 'cdp-polish-'));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/**
 * 每条打磨都是一次模型往返，拖慢一点才抓得住「正在打磨」那一刻。
 * 1 秒 × 四条 = 4 秒跑道，够脚本在队列还活着的时候做完「再点一次」那一步。
 */
const SLOW_MS = 1000;

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
 * 预置：一个世界 + 五条条目，每条都带着一个**明确的意图**。
 *
 *   - 涨潮纪：正文厚、有概述、有标签、有关联 —— 一条都挑不出毛病，
 *     用来验「智能挑选不会把好条目也选上」和「模型判定无需改动 → 不入队」。
 *   - 潮汐槽 / 灯塔守：薄、缺概述、缺标签、无关联 —— 该被挑出来也真的会被改。
 *   - 畸形打磨标记：正文里带着触发词，让假上游回一段「能解析、但没有 content」的 JSON，
 *     用来验「答非所问的那一条在队列里记成失败，而不是被当成『无需改动』」。
 *   - 余烬教团：什么都齐，只当背景。
 */
const LONG_BODY =
  '涨潮纪以海面第一次被记录的上涨为元年，此后每一年都以前一年的最高水位为刻度重新标记。' +
  '历法由灯塔的观测者维持：他们每天在塔顶的刻石上记下水位，冬至那天把所有刻度归零，再重新刻一遍。' +
  '这让历法本身成了一种权力 —— 谁能解释水位，谁就能解释时间。城邦之间的条约、婚书、债务都以此为准，' +
  '因此争夺观测权的斗争从来没有停过。到了近代，刻石被更精密的铜环取代，但仪式仍然照旧：' +
  '人们怕的不是数字不准，而是没人再相信那个数字。';

/** 对照组二号：余烬教团。既是「不该被挑出来」的样本，也是打磨时补关联的落点 */
const EMBER_BODY =
  '余烬教团以解释水位与历法为业，影响力遍及沿海城邦。教团的祭司要经过七年观测训练才能获得解释权，' +
  '他们记录每一次异常涨落，并把无法解释的记录封进塔底的铜柜。教团从不预言水位，只说「已经发生的事意味着什么」——' +
  '这让它在政治上极难被驳倒。城邦之间的条约、婚书、债务都以教团校准的时间为准，' +
  '因此谁握住教团，谁就握住了沿岸的秩序。铜环取代刻石之后，教团的权力不减反增：仪器越精密，越需要人来校准。';

const SEED = `(async () => {
  try {
    const open = indexedDB.open('worldforge', 5);
    const db = await new Promise((res, rej) => {
      open.onsuccess = () => res(open.result);
      open.onerror = () => rej(open.error);
    });
    const t = Date.now();
    const wid = 'wd_pol';
    const world = { id: wid, name: '打磨测试世界', tagline: '海面每年上涨三尺',
      summary: '## 概览\\n\\n海水不可逆地上涨，沿海城邦逐年内迁。', genre: '低魔海洋',
      tone: '冷峻克制，不写抒情句', themeColor: '#0e7c8a', createdAt: t, updatedAt: t };
    const cat = { id: 'ct_sys', worldId: wid, name: '体系', icon: '⚙️', fieldDefs: [], order: 0, createdAt: t, updatedAt: t };
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
        tags: ['历法'], content: ${JSON.stringify('## 概览\n\n' + LONG_BODY)} }),
      mk({ id: 'en_trough', title: '潮汐槽', summary: '',
        content: '## 概览\\n\\n海面下降时露出的浅槽，可以用来停船。' }),
      mk({ id: 'en_keeper', title: '灯塔守', summary: '',
        content: '## 概览\\n\\n守着灯塔记录水位的人。' }),
      mk({ id: 'en_bad', title: '畸形打磨标记', summary: '',
        content: '## 概览\\n\\n这条正文里写着畸形打磨四个字，用来触发假上游的答非所问分支。' }),
      // 这条什么都齐：长正文、有概述、有标签、有关联 —— 它不该被「挑出待打磨的」选中
      mk({ id: 'en_ember', title: '余烬教团', summary: '把持历法与航权的教团', tags: ['势力'],
        content: ${JSON.stringify('## 概览\n\n' + EMBER_BODY)} }),
    ]);
    await put('relations', [
      { id: 'rl_seed', worldId: wid, fromEntryId: 'en_tide', toEntryId: 'en_ember',
        type: '相关', note: '历法与教权同源', status: 'canon', createdAt: t },
    ]);
    localStorage.setItem('worldforge:settings', JSON.stringify({
      ai: { provider: 'custom', baseUrl: '${MOCK_BASE}', apiKey: 'k', model: 'm',
            temperature: 0.8, contextLimit: 60, vision: true },
      activeWorldId: wid
    }));
    localStorage.setItem('worldforge:agentMode', 'auto');
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
  /** 点某一行的勾选框（批量模式下点整行 = 切换勾选） */
  const pick = async (id) => {
    await evaluate(`document.querySelector('[data-role=entry-row][data-entry-id=${id}]').click(); 'x'`);
    await sleep(120);
  };
  const click = async (role) => {
    await evaluate(`document.querySelector('[data-role=${role}]').click(); 'go'`);
    await sleep(150);
  };
  /** 眼下浮着的提示条说了什么（提示 3.6 秒后自己消失，要趁热读） */
  const toastText = () =>
    evaluate(
      `[...document.querySelectorAll('.toast')].map((x) => x.textContent.trim()).join(' | ')`,
    );
  /**
   * 任务舱的清单只在展开时才渲染 —— 直接读会得到空串，
   * 断言会以「什么都没排上」的形状失败。所以读之前先确保它是开的。
   */
  const dockOpen = async () => {
    const open = await evaluate(`!!document.querySelector('[data-role=task-dock-panel]')`);
    if (!open) await click('task-dock-toggle');
  };
  const dockJobs = async () => {
    await dockOpen();
    return JSON.parse(
      await evaluate(`JSON.stringify([...document.querySelectorAll('[data-role=task-job]')].map((el) => ({
        status: el.getAttribute('data-status'),
        label: el.querySelector('[data-role=task-job-label]')?.textContent || '',
        sub: el.querySelector('[data-role=task-job-status]')?.textContent || '',
        error: el.querySelector('[data-role=task-job-error]')?.textContent || '',
      })))`),
    );
  };
  const dockSummary = () =>
    evaluate(`document.querySelector('[data-role=task-dock-summary]')?.textContent || ''`);
  const trackText = () =>
    evaluate(`document.querySelector('[data-role=batch-track-text]')?.textContent || ''`);

  /* ---------------- 0. 预置 + 拖慢假上游 ---------------- */
  await fetch(`${MOCK_ORIGIN}/__mock-stats/reset`).catch(() => {});
  await fetch(`${MOCK_ORIGIN}/__mock-delay?ms=${SLOW_MS}`).catch(() => {});

  await client.send('Page.navigate', { url: APP_URL });
  await sleep(1800);
  check('预置测试世界（四条待打磨 + 一条对照组）', (await evaluate(SEED)) === 'seeded');

  // 预置写的是 localStorage，而应用已经加载过了 —— 必须整页重载。
  // 注意 `Page.navigate` 到只差 hash 的 URL 是同文档导航、不会重载。
  await client.send('Page.reload');
  await sleep(2000);

  /* ---------------- 1. 进入批量模式 ---------------- */
  await goRoute('entries');
  check(
    // 条目库现在是 Wiki 的「编辑」子页 —— 页标题跟着那一页走（叫 Wiki）
    'Wiki 的「编辑」子页渲染出来了',
    (await evaluate(`document.querySelector('.page-title')?.textContent`)) === 'Wiki',
  );
  check('一开始没有批量面板', (await evaluate(`!document.querySelector('[data-role=entries-batch]')`)) === true);

  await click('entries-batch-toggle');
  check('点「批量打磨」后面板出现', await evaluate(`!!document.querySelector('[data-role=entries-batch]')`));
  check('一开始选中 0 条', await evaluate(`!!document.querySelector('[data-role=batch-count]')?.textContent.includes('0')`));

  /* ---------------- 2. 智能挑选 ---------------- */
  await click('batch-smart');
  const countText = await evaluate(`document.querySelector('[data-role=batch-count]')?.textContent || ''`);
  check('智能挑选选中了 3 条（三条「该打磨的」）', countText.includes('3'), countText);
  check(
    '对照组「涨潮纪」没被选上（它什么都不缺）',
    (await evaluate(
      `document.querySelector('[data-role=batch-check][data-entry-id=en_tide]')?.getAttribute('aria-checked')`,
    )) === 'false',
  );
  check(
    '被挑中的行标出了原因',
    (await evaluate(
      `document.querySelector('[data-role=entry-row][data-entry-id=en_trough] [data-role=entry-reason]')?.textContent || ''`,
    )).includes('缺概述'),
  );
  await shot(`${OUT}-1-smart.png`);

  /* ---------------- 3. 加入队列：不是当场跑完，而是排进右下角 ---------------- */
  // 手工把对照组也勾上：它什么都不缺，但「无需改动」这条判断要由**模型**来做 ——
  // 这才是「不改就不入队」那条纪律的正面样本（前一步的智能挑选本来就该放过它）。
  await pick('en_tide');
  const pickedTitles = await evaluate(
    `[...document.querySelectorAll('[data-role=entry-row].picked .entry-item-title')].map((x) => x.textContent.slice(0,3)).join('、')`,
  );
  check(
    '选中的是那四条（三条该打磨的 + 手工补上的对照组）',
    ['潮汐槽', '灯塔守', '畸形打磨标记', '涨潮纪'].every((n) => pickedTitles.includes(n.slice(0, 3))),
    pickedTitles,
  );

  await click('batch-enqueue');
  check(
    '点「加入队列」后给了一句交代（排上几件、去哪儿等）',
    (await toastText()).includes('已排上 4 件'),
    await toastText(),
  );
  check(
    '挑中的行清空了（它们已经交出去了，不再占着勾选框）',
    (await evaluate(`document.querySelector('[data-role=batch-count]')?.textContent || ''`)).includes('0'),
  );
  check(
    '面板摘出这一批的进度（不是页内进度条，是队列里的实况）',
    (await trackText()).includes('本批 4 件') && (await trackText()).includes('正在做'),
    await trackText(),
  );
  check(
    '还在跑，所以面板给的是「停掉这一批」而不是「去审查」',
    await evaluate(`!!document.querySelector('[data-role=batch-stop]')`),
  );
  check(
    '侧栏「条目库」那一格出现工作动画（页面里没有进度条了，这是「哪一页在干活」的线索）',
    await evaluate(`!!document.querySelector('[data-role=nav-wiki] [data-role=nav-working]')`),
  );

  const queued = await dockJobs();
  check(
    '右下角的队列里正好排上四件（一件在跑、其余排着）',
    queued.length === 4 && queued.filter((j) => j.status === 'running' || j.status === 'queued').length >= 3,
    queued.map((j) => `${j.status}:${j.label}`).join(' / '),
  );
  check(
    '四件分别是那四条，名字对得上',
    ['潮汐槽', '灯塔守', '畸形打磨标记', '涨潮纪'].every((n) =>
      queued.some((j) => j.label.includes(n)),
    ),
    queued.map((j) => j.label).join('、'),
  );
  check(
    '舱体收起态也把话说全了（正在做什么 + 后面还压着几件）',
    (await dockSummary()).includes('正在打磨') && (await dockSummary()).includes('还有'),
    await dockSummary(),
  );
  await shot(`${OUT}-2-queued.png`);

  /* ---------------- 4. 同一条不重复排 ---------------- */
  // 队列还活着的时候再点一次，不该排出第二件 —— 同一条目被两个活儿同时改，
  // 两份修订会互相覆盖。去重看的是**还在队里**的那条，不是界面上有没有转圈。
  await click('batch-clear');
  await pick('en_bad'); // 最后一件，队列还排不到它，肯定还活着
  await click('batch-enqueue');
  check(
    '已经在队列里的那条再点一次，被挡下了（没有排出第二件）',
    (await toastText()).includes('已经在队列里'),
    await toastText(),
  );
  check('队列里的件数没变，还是四件', (await dockJobs()).length === 4);

  /* ---------------- 5. 切页不中断，一条翻车不堵后面的 ---------------- */
  await goRoute('dashboard');
  await sleep(500);
  check(
    '切到总览后队列还在（它挂在路由外壳上，不随页面卸载）',
    (await evaluate(`!!document.querySelector('[data-role=task-dock]')`)) === true,
  );
  check(
    '切到总览后侧栏「条目库」仍在转圈（活儿没被页面卸载带走）',
    await evaluate(`!!document.querySelector('[data-role=nav-wiki] [data-role=nav-working]')`),
  );
  const settled = await waitFor(
    `!/正在/.test(document.querySelector('[data-role=task-dock-summary]')?.textContent || '')`,
    60000,
  );
  check('打磨在别的页面上跑完了', settled);
  check(
    '跑完之后侧栏那格也就不转了',
    (await evaluate(`!!document.querySelector('[data-role=nav-wiki] [data-role=nav-working]')`)) === false,
  );
  await sleep(400);

  const done = await dockJobs();
  check(
    '四件都有了下落：三件做完、一件失败',
    done.filter((j) => j.status === 'done').length === 3 &&
      done.filter((j) => j.status === 'error').length === 1,
    done.map((j) => `${j.status}:${j.label}`).join(' / '),
  );
  check(
    '失败的那件是答非所问那条，且写着原因（不是静默消失）',
    done.some((j) => j.status === 'error' && j.label.includes('畸形打磨标记') && j.error.trim().length > 0),
    done.find((j) => j.status === 'error')?.error || '(无)',
  );
  check(
    '一件翻车没有堵住后面的（它后面那件照样做完了）',
    done.filter((j) => j.status === 'done').some((j) => j.label.includes('涨潮纪')),
  );
  check(
    '舱体的交代是「1 件没做成」',
    (await dockSummary()).includes('1 件没做成'),
    await dockSummary(),
  );
  await shot(`${OUT}-3-dock.png`);

  /* ---------------- 6. 库里落的和队列说的一致 ---------------- */
  const items = await review();
  const updates = items.filter((r) => r.kind === 'update-entry');
  const rels = items.filter((r) => r.kind === 'relation');
  check('库里落了 2 条条目修订', updates.length === 2, `update-entry ${updates.length} 条`);
  check(
    '修订挂在那两条薄条目上',
    updates.map((r) => r.targetEntryId).sort().join(',') === 'en_keeper,en_trough',
    updates.map((r) => r.targetEntryId).join('、'),
  );
  check(
    '答非所问的那条没被当成「无需改动」（它没进审查队列）',
    !items.some((r) => r.targetEntryId === 'en_bad'),
  );
  check('判定无需改动的那条确实没进队列', !items.some((r) => r.targetEntryId === 'en_tide'));
  check('打磨时补的关联也各自成了一条提议', rels.length === 2, `relation ${rels.length} 条`);

  const batchIds = new Set([...updates, ...rels].map((r) => r.batchId).filter(Boolean));
  check(
    '同一次排出来的提议共用一个批号（审查页据此归组）',
    batchIds.size === 1,
    `${batchIds.size} 个：${[...batchIds].join('、')}`,
  );
  check(
    '修订带上了逐条的 diff（通知/审核时不用再猜改了哪儿）',
    (updates[0]?.changes ?? []).some((c) => c.field === 'content'),
  );

  /* ---------------- 6b. 同一批还在待审时，不重复打磨同一条 ---------------- */
  // 已经有待审修订的条目再排一次，会摆出两份互相覆盖的修订 —— 作者不知道该按哪份改。
  // 所以它们在**入队之前**就该被拦下，连排都不排。
  await goRoute('entries');
  await click('entries-batch-toggle');
  await click('batch-clear');
  await pick('en_trough');
  await pick('en_keeper');
  await click('batch-enqueue');
  const heldToast = await toastText();
  check(
    '已有待审修订的条目在入队前就被拦下，并说明了原因',
    heldToast.includes('已有待审的修订'),
    heldToast,
  );
  check('队列里一件都没多（拦在入队之前，不是排上了再撤）', (await dockJobs()).length === 4);
  const afterSecond = await review();
  check(
    '没有叠出第二份同目标修订（队列里仍是 2 条）',
    afterSecond.filter((r) => r.kind === 'update-entry').length === 2,
    `update-entry ${afterSecond.filter((r) => r.kind === 'update-entry').length} 条`,
  );

  /* ---------------- 7. 审查页：整批处理 ---------------- */
  await goRoute('review');
  await waitFor(`!!document.querySelector('[data-role=review-batch]')`, 15000);
  const batchHead = await evaluate(`document.querySelector('[data-role=review-batch-count]')?.textContent || ''`);
  check('审查页把同一批归到了一起', batchHead.includes('4'), batchHead);
  check(
    '批头给了「采纳这一批」的入口',
    await evaluate(`!!document.querySelector('[data-role=review-batch-accept]')`),
  );
  await shot(`${OUT}-4-review.png`);

  await click('review-batch-accept');
  await sleep(1200);
  const entryAfter = JSON.parse(await readStore('entries')).find((e) => e.id === 'en_trough');
  check(
    '整批采纳后，条目正文真的变了（打磨结果落了库）',
    (entryAfter?.content || '').includes('打磨补充'),
    (entryAfter?.content || '').slice(-30),
  );
  const relAfter = JSON.parse(await readStore('relations'));
  check(
    '同批的关系提议跟着一起落地',
    relAfter.some((r) => r.toEntryId === 'en_ember' && r.fromEntryId === 'en_trough'),
    `关系共 ${relAfter.length} 条`,
  );

  /* ---------------- 8. 工作台 agent 也能批量打磨 ---------------- */
  await goRoute('studio');
  await waitFor(`!!document.querySelector('[data-role=agent-input]')`, 20000);
  await evaluate(`(() => {
    const el = document.querySelector('[data-role=agent-input]');
    const set = Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, 'value').set;
    set.call(el, '帮我打磨这几条');
    el.dispatchEvent(new Event('input', { bubbles: true }));
    return 'typed';
  })()`);
  await sleep(200);
  await click('agent-send');
  const agentDone = await waitFor(
    `[...document.querySelectorAll('[data-role=agent-step]')].some((x) => x.textContent.includes('打磨'))`,
    60000,
  );
  check('agent 调用了「批量打磨」这一步', agentDone);
  await sleep(1500);
  const agentItems = (await review()).filter((r) => r.origin === 'agent');
  check(
    'agent 打磨出来的东西同样进了审查队列，没有直接落库',
    agentItems.length > 0,
    `agent 提议 ${agentItems.length} 条`,
  );
  check(
    'agent 提议也带批号，能整批处理',
    agentItems.some((r) => !!r.batchId),
  );
  await shot(`${OUT}-5-agent.png`);

  /* ---------------- 9. 收尾 ---------------- */
  await fetch(`${MOCK_ORIGIN}/__mock-delay?ms=0`).catch(() => {});
  const stats = await (await fetch(`${MOCK_ORIGIN}/__mock-stats`)).json();
  check(
    '打磨请求都落到了 polish 分支（没有串到 expand）',
    (stats.byBranch.polish ?? 0) >= 4 && (stats.byBranch.unknown ?? 0) === 0,
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
    failed.forEach((f) => console.log('  ✗ ' + f.name + (f.detail ? ' — ' + f.detail : '')));
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
