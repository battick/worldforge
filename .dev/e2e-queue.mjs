/**
 * 开发期端到端验证：**任务队列（右下角那个提示）**。
 *
 * 为什么要有这一条：
 * 界面上有一类活儿是「一次一件、但作者想一次点好几下」的 —— 一致性检查里逐条生成修订、
 * 条目列表里逐条打磨。它们原先各自调 `useAITask(key).run()`，而那个 `run()` 有个刻意的约束：
 * **同一个 key 还跑着就直接返回 null**。单发场景没问题，可作者手快连点三条时，后两条会
 * **静默消失**：按钮闪一下、什么都没发生、也没有任何交代。
 *
 * 所以本脚本盯的第一件事就是那个回归：
 *   1. 连点三条「让 AI 生成修订方案」→ **三条都排上队**，逐件跑完，三条修订都进审查队列；
 *      （换回老实现，这里只会剩最后一条 —— 这条断言就是为此写的）
 *   2. 同一条条目上的第二条问题**不许**再排 —— 那是「同一条目两份待审修订」那个坑；
 *   3. 收起态也要把话说全（正在做什么 + 后面还压着几件），且**切页不丢**；
 *   4. 撤单真的撤掉（不产生修订）、失败的那件带着错误与「重试」摆在面板里；
 *   5. 条目列表的「AI 打磨」同样走这条队列（证明这队列是通用设施，不是给一致性检查专用的）。
 *
 * 前置：
 *   npx vite build                 （e2e 跑的是构建产物）
 *   node server.mjs                （5188）
 *   node .dev/mock-upstream.mjs 5190
 * 用法：node .dev/e2e-queue.mjs
 */
import { spawn } from 'node:child_process';
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const CHROME = 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const APP_URL = process.env.APP_URL || 'http://127.0.0.1:5188/';
const MOCK_BASE = process.env.MOCK_URL || 'http://127.0.0.1:5190/v1';
const MOCK_ORIGIN = new URL(MOCK_BASE).origin;
const OUT = '.shots/queue';
const PORT = 9388;
const profile = mkdtempSync(join(tmpdir(), 'cdp-queue-'));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** 拖慢回包：要有足够长的窗口把「1 件在跑 + 2 件排队」那一幕点出来 */
const SLOW_MS = 900;

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
 * 预置：一个世界 + 七条条目。
 *
 * 世界名起成「多修订标记」是为了让假上游走 `consistency-many` 那个分支（五条问题），
 * 而其中**前两条盯着同一个条目**（匠人同盟）—— 那正是「同一条目不该有两份待审修订」
 * 这条纪律要被撞到的地方；第三条盯烬石、第四条盯烬落盆地；第五条指向库里没有的条目。
 * 于是能点的「生成修订」按钮正好三处（匠人同盟算一处）。
 *
 * 另外三条（涨潮纪 / 余烬教团 / 北方灰原）是留给条目列表那条路径的；
 * 「畸形打磨」那条专门让打磨**失败**，用来验证失败件在面板里的样子与「重试」。
 */
const SEED = `(async () => {
  try {
    const open = indexedDB.open('worldforge', 5);
    const db = await new Promise((res, rej) => {
      open.onsuccess = () => res(open.result);
      open.onerror = () => rej(open.error);
    });
    const t = Date.now();
    const wid = 'wd_q';
    const world = { id: wid, name: '多修订标记的世界', tagline: '海面每年上涨三尺',
      summary: '## 概览\\n\\n海水不可逆地上涨，沿海城邦逐年内迁。', genre: '低魔海洋',
      tone: '冷峻', themeColor: '#0e7c8a', createdAt: t, updatedAt: t };
    const cat = { id: 'ct_geo', worldId: wid, name: '地理', icon: '🗺️', fieldDefs: [], order: 0, createdAt: t, updatedAt: t };
    const mk = (id, title, sum, content) => ({ id, worldId: wid, categoryId: 'ct_geo', title, aliases: [], summary: sum,
      content: content || ('## 概览\\n\\n' + sum), tags: [], fields: {}, status: 'canon', sourceRefs: [], createdAt: t, updatedAt: t });
    const put = (store, items) => new Promise((res, rej) => {
      const tx = db.transaction(store, 'readwrite');
      items.forEach((i) => tx.objectStore(store).put(i));
      tx.oncomplete = () => res();
      tx.onerror = () => rej(tx.error);
    });
    await put('worlds', [world]);
    await put('categories', [cat]);
    await put('entries', [
      mk('en_guild', '匠人同盟', '以烬石锻造为业的行会'),
      mk('en_ember', '烬石', '可燃烧的矿石，是城邦唯一的能源'),
      mk('en_basin', '烬落盆地', '内陆盆地，人口密集，靠烬石开采为生'),
      mk('en_tide', '涨潮纪', '以海面第一次上涨为元年的历法'),
      mk('en_order', '余烬教团', '供奉余烬的教团，认定火是水的反面'),
      mk('en_waste', '北方灰原', '灰云最厚处，寸草不生'),
      mk('en_odd', '畸形打磨的记录', '这条的正文会让假上游答非所问',
         '## 概览\\n\\n畸形打磨：这条专门用来验证「读不懂」不会被当成「没什么可改」。'),
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
      await sleep(100);
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

  /** 面板展开（收起态也要能断言，所以不能无脑点） */
  const openDock = async () => {
    if (!(await evaluate(`!!document.querySelector('[data-role=task-dock-panel]')`))) {
      await evaluate(`document.querySelector('[data-role=task-dock-toggle]').click(); 'x'`);
      await sleep(120);
    }
  };
  /**
   * 面板里那一串「状态:名字」。先确保面板是展开的 —— 收起时那些行根本不在 DOM 里，
   * 直接读会得到一个空串，然后断言就会以「什么都没排上」的形状失败（假阴性）。
   */
  const dockJobs = async () => {
    await openDock();
    return evaluate(
      `[...document.querySelectorAll('[data-role=task-job]')].map((el) => el.getAttribute('data-status') + ':' + (el.querySelector('[data-role=task-job-label]')?.textContent || '')).join(' | ')`,
    );
  };
  /** 只取还没结束的那些（前面几批跑完的还挂在列表里） */
  const liveJobs = (dump) =>
    dump.split(' | ').filter((r) => r.startsWith('running:') || r.startsWith('queued:'));
  const pillText = async () =>
    (await evaluate(`document.querySelector('[data-role=task-dock-summary]')?.textContent || ''`)) || '';

  /* ---------------- 0. 预置 + 拖慢假上游 ---------------- */
  await fetch(`${MOCK_ORIGIN}/__mock-stats/reset`).catch(() => {});
  await fetch(`${MOCK_ORIGIN}/__mock-delay?ms=${SLOW_MS}`).catch(() => {});

  await client.send('Page.navigate', { url: APP_URL });
  await sleep(1800);
  check('预置测试世界（含可用于打磨的条目）', (await evaluate(SEED)) === 'seeded');

  // localStorage 是应用**加载之后**才写进去的，内存里那份还是旧的；必须 reload。
  await client.send('Page.reload');
  await sleep(2200);
  await evaluate(`location.hash = 'consistency'; 'x'`);
  await sleep(800);

  /* ---------------- 1. 一开始没有队列提示 ---------------- */
  check(
    '没活儿的时候右下角是干净的（不占地方）',
    await evaluate(`!document.querySelector('[data-role=task-dock]')`),
  );

  /* ---------------- 2. 审计出五条问题 ---------------- */
  await evaluate(`document.querySelector('[data-role=consist-audit]').click(); 'go'`);
  await waitFor(`!document.querySelector('[data-role=consist-audit] .spinner')`, 30000);
  await sleep(500);
  check(
    '五条问题摆出来了',
    (await evaluate(`document.querySelectorAll('[data-role=consist-issue]').length`)) === 5,
    `实际 ${await evaluate(`document.querySelectorAll('[data-role=consist-issue]').length`)} 张`,
  );
  check(
    '四处能点「让 AI 生成修订方案」（两条问题盯着同一条条目，所以各有一个按钮）',
    (await evaluate(`document.querySelectorAll('[data-role=consist-fix]').length`)) === 4,
    `实际 ${await evaluate(`document.querySelectorAll('[data-role=consist-fix]').length`)} 个`,
  );

  /* ---------------- 3. 一口气连点三下 ----------------
   * 这是本脚本的核心回归：老实现下这里只会排上最后一下。 */
  await evaluate(`(() => {
    const card = (i) => document.querySelector('[data-role=consist-issue][data-idx="' + i + '"]');
    const btns = [0, 1, 2, 3].map((i) => card(i)?.querySelector('[data-role=consist-fix]')).filter(Boolean);
    btns.forEach((b) => b.click());
    return btns.length;
  })()`);
  await sleep(200);
  check(
    '被挡下的那一下有话说（「同一条条目一次只改一份」），不是按了没反应',
    await evaluate(`document.body.innerText.includes('同一条条目一次只改一份')`),
  );

  const dump1 = await dockJobs();
  const live1 = liveJobs(dump1);
  const fold = (title) => `为《${title}》生成修订方案`;
  check(
    '一口气连点三下：三件都排上了队（老实现这里只会剩最后一件）',
    live1.length === 3 &&
      live1[0] === `running:${fold('匠人同盟')}` &&
      live1.includes(`queued:${fold('烬石')}`) &&
      live1.includes(`queued:${fold('烬落盆地')}`),
    dump1,
  );
  check(
    '正在跑的那件是第一个点下去的（顺序 = 点下去的顺序）',
    live1[0] === `running:${fold('匠人同盟')}`,
    live1.join(' | '),
  );

  const jobCount = await evaluate(`document.querySelectorAll('[data-role=task-job]').length`);
  check('面板里就是三件（同一条条目上的第二条问题没有再排一遍）', jobCount === 3, `实际 ${jobCount} 行`);
  await shot(`${OUT}-0-dock-panel.png`);

  await evaluate(`document.querySelector('[data-role=task-dock-toggle]').click(); 'x'`);
  await sleep(120);
  const pill = await pillText();
  check(
    '收起态也把话说全：正在做什么 + 后面还压着几件',
    pill.includes('为《匠人同盟》生成修订方案') && pill.includes('还有 2 件'),
    pill,
  );
  check(
    '胶囊上有个数（一眼看得出堆了几件）',
    (await evaluate(`document.querySelector('[data-role=task-dock-badge]')?.textContent`)) === '3',
  );
  await shot(`${OUT}-1-running.png`);

  /* ---------------- 4. 切页不丢 ---------------- */
  await goRoute('dashboard');
  const onDashboard = await evaluate(`location.hash === '#dashboard'`);
  const pillElsewhere = await pillText();
  check(
    '切到别的页面，队列提示还在、说得还一样（它挂在 Shell 上，不属于哪个页面）',
    onDashboard && pillElsewhere.includes('生成修订方案'),
    pillElsewhere,
  );

  await goRoute('consistency');

  /* ---------------- 5. 三件都跑完 ---------------- */
  const allDone = await waitFor(
    `!document.querySelector('[data-role=task-dock-badge]')`,
    60000,
  );
  check('三件都跑完了', allDone);
  const donePill = await pillText();
  check('跑完的胶囊说得清楚：队列已清空 · 共完成 3 件', donePill.includes('共完成 3 件'), donePill);

  await sleep(300);
  let items = await review();
  const updates = items.filter((r) => r.kind === 'update-entry');
  check('三件活儿都留下了成果：三条修订进了审查队列', updates.length === 3, `update-entry ${updates.length} 条`);
  check(
    '三条修订各自挂在不同的条目上（匠人同盟 / 烬石 / 烬落盆地）',
    new Set(updates.map((u) => u.targetEntryId)).size === 3,
    updates.map((u) => u.targetEntryId).join(' / '),
  );
  const issues = items.filter((r) => r.kind === 'consistency');
  check(
    '生成成功的那三条问题被标成已处理',
    issues.filter((i) => i.status === 'accepted').length === 3,
    issues.map((i) => i.status).join(','),
  );
  check(
    '同一条条目上的第二条问题原样留着（没被顺手做掉，也没生成第二份修订）',
    issues.filter((i) => i.status === 'pending').length === 2,
    issues.filter((i) => i.status === 'pending').map((i) => i.title).join(' / '),
  );

  /* ---------------- 6. 条目列表：单条打磨同样走这条队列 ---------------- */
  await goRoute('entries');
  await sleep(400);
  check(
    '条目行上有「AI 打磨」这颗按钮',
    (await evaluate(`document.querySelectorAll('[data-role=entry-polish]').length`)) >= 4,
    `${await evaluate(`document.querySelectorAll('[data-role=entry-polish]').length`)} 颗`,
  );

  // 连点三条（匠人同盟那种「已有待审修订」的会被挡下，所以挑没被占的三条）
  const clicked = await evaluate(`(() => {
    const ids = ['en_tide', 'en_order', 'en_waste'];
    const btns = ids.map((id) => document.querySelector('[data-role=entry-polish][data-entry-id=' + id + ']'));
    btns.forEach((b) => b && b.click());
    return btns.filter(Boolean).length;
  })()`);
  check('挑到三条可打磨的条目', clicked === 3);
  await sleep(200);
  const dump2 = await dockJobs();
  const live2 = liveJobs(dump2);
  check(
    '连点三条打磨：三件都排上了队',
    live2.length === 3 &&
      live2[0] === 'running:打磨《涨潮纪》' &&
      live2.includes('queued:打磨《余烬教团》') &&
      live2.includes('queued:打磨《北方灰原》'),
    dump2,
  );
  check(
    '排上的那条按钮变成「已排上」的样子（不用猜自己点到没有）',
    await evaluate(`!!document.querySelector('[data-role=entry-polish][data-entry-id=en_tide] .spinner')`),
  );
  await shot(`${OUT}-2-polish-queued.png`);

  /* ---------------- 7. 撤单：真的撤掉，不留痕迹 ---------------- */
  await openDock();
  const canceledLabel = await evaluate(`(() => {
    const rows = [...document.querySelectorAll('[data-role=task-job]')];
    const target = rows.find((r) => r.getAttribute('data-status') === 'queued');
    const label = target?.querySelector('[data-role=task-job-label]')?.textContent || '';
    target?.querySelector('[data-role=task-job-cancel]')?.click();
    return label;
  })()`);
  await sleep(250);
  const dump3 = await dockJobs();
  check(
    '撤掉排队中的那一件：它立刻变成「已撤单」，不再等在那儿',
    !!canceledLabel && dump3.includes('canceled:' + canceledLabel),
    `撤的是「${canceledLabel}」— ${dump3}`,
  );

  const polishDone = await waitFor(`!document.querySelector('[data-role=task-dock-badge]')`, 60000);
  check('剩下两件打磨跑完了', polishDone);
  await sleep(400);
  items = await review();
  check(
    '撤单的那件没留下成果：只多了两条修订',
    items.filter((r) => r.kind === 'update-entry').length === 5,
    `update-entry 共 ${items.filter((r) => r.kind === 'update-entry').length} 条`,
  );

  /* ---------------- 8. 失败的那件：错误摆在面板里，可以重试 ---------------- */
  await evaluate(
    `document.querySelector('[data-role=entry-polish][data-entry-id=en_odd]').click(); 'x'`,
  );
  const failed = await waitFor(
    `!!document.querySelector('[data-role=task-job][data-status=error]')`,
    40000,
  );
  await openDock();
  check('读不懂的那条如实报失败（不冒充「没什么可改」）', failed);
  const errText = await evaluate(
    `document.querySelector('[data-role=task-job][data-status=error] [data-role=task-job-error]')?.textContent || ''`,
  );
  check('面板里写清了失败原因', errText.length > 4, errText.slice(0, 60));
  check(
    '胶囊换了神情：红边 + 「1 件没做成」',
    (await pillText()).includes('1 件没做成'),
    await pillText(),
  );
  check(
    '失败的那件带着「重试」按钮（跑法还在，才重试得动）',
    await evaluate(
      `!!document.querySelector('[data-role=task-job][data-status=error] [data-role=task-job-retry]')`,
    ),
  );
  await shot(`${OUT}-3-failed.png`);

  await evaluate(`(() => {
    document.querySelector('[data-role=task-job][data-status=error] [data-role=task-job-retry]').click();
    return 'x';
  })()`);
  await sleep(300);
  // 先离开失败态（回到排队/正在做），再以同样的原因失败回来 —— 两步都要看到，
  // 否则「它跑了没有」这件事本身没被证实
  const leftError = await waitFor(
    `!document.querySelector('[data-role=task-job][data-status=error]')`,
    8000,
  );
  const backToError = await waitFor(
    `!!document.querySelector('[data-role=task-job][data-status=error]')`,
    40000,
  );
  check(
    '重试真的又跑了一遍（先离开失败态，再以同样的原因失败回来）',
    leftError && backToError,
    `离开失败态 ${leftError} / 再次失败 ${backToError}`,
  );

  /* ---------------- 9. 清空已完成 ---------------- */
  await openDock();
  await evaluate(`document.querySelector('[data-role=task-dock-clear]').click(); 'x'`);
  await sleep(250);
  check(
    '清空之后右下角又安静了',
    await evaluate(`!document.querySelector('[data-role=task-dock]')`),
  );

  /* ---------------- 10. 全是同一批活儿（没有请求跑偏） ---------------- */
  const stats = await (await fetch(`${MOCK_ORIGIN}/__mock-stats`)).json();
  check(
    '假上游没有收到「认不出来的请求」',
    (stats.byBranch.unknown ?? 0) === 0,
    JSON.stringify(stats.byBranch),
  );
  check(
    '一致性修订走了三条（不是一条）—— 与界面上排上三件对得上',
    (stats.byBranch['consistency-fix'] ?? 0) === 3,
    JSON.stringify(stats.byBranch),
  );
  // 四次，一次不多一次不少：
  //   涨潮纪、北方灰原各一次（成功）＋ 畸形那条一次（答非所问）＋ 它的重试一次
  // 撤掉的那件**一次请求都没发出去** —— 撤单省的是真金白银，这条断言就是在盯这个。
  check(
    '打磨请求正好四次（撤掉的那件一次都没发出去）',
    (stats.byBranch.polish ?? 0) === 4,
    JSON.stringify(stats.byBranch),
  );

  /* ---------------- 11. 没有未捕获异常 ---------------- */
  // 假上游故意不发 CORS 头 —— 于是每次请求都是「直连被拦 → 改走本机转发」，
  // 控制台里必然留两条 CORS 报错。那是设计内的路径，不是故障。
  const fatal = client.events.filter((e) => {
    if (e.method === 'Runtime.exceptionThrown') return true;
    if (e.method !== 'Log.entryAdded' || e.params?.entry?.level !== 'error') return false;
    const text = e.params.entry.text || '';
    const url = e.params.entry.url || '';
    if (
      /blocked by CORS policy|net::ERR_FAILED/.test(text) &&
      (text.includes(MOCK_ORIGIN) || url.includes(MOCK_ORIGIN) || !url)
    ) {
      return false;
    }
    return true;
  });
  check(
    '全程没有未捕获异常 / 没有 error 级日志',
    fatal.length === 0,
    fatal.map((e) => JSON.stringify(e.params).slice(0, 160)).join(' || '),
  );

  // 收尾：把假上游的「慢回包」关掉。
  // 延迟是**跨脚本共享**的服务端状态 —— 留着不还原，下一个脚本就无辜受害：
  // 这里设的 900ms 曾一路带到 e2e-onboarding，把它的「AI 读一遍」搅成空回包，
  // 表现出来是一堆和队列毫不相干的红（排查了半天才发现是上一支脚本没打扫）。
  await fetch(`${MOCK_ORIGIN}/__mock-delay?ms=0`).catch(() => {});

  const failedChecks = results.filter((r) => !r.ok);
  console.log(`\n任务队列端到端：${results.length - failedChecks.length}/${results.length}`);
  if (failedChecks.length) {
    console.log('失败项：');
    for (const f of failedChecks) console.log(`  ✗ ${f.name} ${f.detail}`);
  }
  client.close();
  chrome.kill();
  process.exit(failedChecks.length ? 1 : 0);
}

main().catch((e) => {
  console.error(e);
  chrome.kill();
  process.exit(1);
});
