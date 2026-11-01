/**
 * 开发期端到端验证：工作台内置 agent 的三档「放手程度」是否真的按约定工作。
 *
 * 覆盖：
 *   1. 计划模式：动作先摆出来等确认；确认前库里一个字都没改
 *   2. 点「执行」→ 动作真的落库（条目 + 关系），工具回执逐条给出结果
 *   3. 操作日志记下了 agent 的动作，并且那一步可撤销
 *   4. 撤销「新建条目」→ 条目被回收，挂在它上面的关系一并清掉（不留悬空线）
 *   5. 直接执行模式：写操作立刻落地，不再弹计划卡
 *   6. 不需要动手的一轮：plan 给 [] → 直接出答复，不弹计划卡
 *   7. 操作日志页能把这些都列出来
 *   8. 提示泡与候选答案**点一下就交给它**（不再只填进输入框让作者再按一次回车）
 *   9. 清点式任务（「把提到过、还没建的补全」）的三件要紧事：
 *      它得给自己立账（清单摆在作者看得见的地方）、**失败过的动作要能重来**、
 *      **清单没清空不许半路收工**（催它，催不动就如实交代还剩几条）
 *  10. 说了要接着做却没给动作 → 说破一次；再犯 → 如实标「这句承诺没兑现」
 *  11. 答完之后给出「下一步」：只有**把话交回来**的那一轮才摆建议、点一下就发起；
 *      而且它记得上一句（跨轮记忆只发给模型，所以由假上游的 `history` 兜着看）
 *  12. 没有未捕获异常
 *
 * 前置：
 *   npx vite build                 （e2e 跑的是构建产物）
 *   node server.mjs                （5188）
 *   node .dev/mock-upstream.mjs 5190 --cors
 * 用法：node .dev/e2e-studio-agent.mjs
 */
import { spawn } from 'node:child_process';
import { writeFileSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const CHROME = 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const APP_URL = 'http://127.0.0.1:5188/';
const MOCK_URL = 'http://127.0.0.1:5190/v1';
const MOCK_STATS = 'http://127.0.0.1:5190/__mock-stats';
const OUT = '.shots/agent';
const PORT = 9374;
const profile = mkdtempSync(join(tmpdir(), 'cdp-agent-'));
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
    console.log('  截图 →', path);
  };
  const waitFor = async (expr, timeout = 25000, step = 250) => {
    const t0 = Date.now();
    while (Date.now() - t0 < timeout) {
      if (await evaluate(expr)) return true;
      await sleep(step);
    }
    return false;
  };
  /**
   * 等某个表达式给出「非空的值」，并把它带回来。
   *
   * `waitFor` 只能回答「有没有」，读到状态还得再问一次 —— 而中间态（比如「清单立起来了、
   * 但还有没勾的」）可能只存在几百毫秒，两次调用之间的空档就够它变掉了。
   * 要断言一个**转瞬即逝**的状态时用这个：取到的那一刻就把值带回来。
   */
  const waitValue = async (expr, timeout = 25000, step = 150) => {
    const t0 = Date.now();
    while (Date.now() - t0 < timeout) {
      const v = await evaluate(expr);
      if (v) return v;
      await sleep(step);
    }
    return null;
  };
  const goto = async (url) => {
    await client.send('Page.navigate', { url: 'about:blank' });
    await sleep(250);
    await client.send('Page.navigate', { url });
  };

  /** 往 agent 输入框里打字（走 native setter，React 才收得到） */
  const type = async (text) => {
    // 输入框在 agent 跑着的时候是 disabled 的，而 React **会丢弃 disabled 元素上的
    // 输入事件** —— 抢着打字会静默失效，后面变成「发送键一直不可用」的假失败。
    // 所以先等它可输入。
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
  /** 等发送键可用再点（打完字 React 还要一帧才把 disabled 去掉） */
  const send = async () => {
    // 用空安全写法：agent 还在跑的时候输入区显示的是「停下」，根本没有这个按钮，
    // 直接读 .disabled 会抛 TypeError，把等待变成假失败
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
        tail: document.body.innerText.slice(-200),
      })`);
      throw new Error('发送键不可用，当前状态：' + state);
    }
    await evaluate(`document.querySelector('[data-role=agent-send]').click(); 'sent'`);
  };
  /**
   * 等 agent 这一轮**真的收尾**。
   *
   * 为什么不能点完发送就 `waitFor('[data-role=agent-send]')`：React 换了按钮才算「在跑」，
   * 而点完到换按钮之间有一帧空隙 —— 那一瞬「发送」还在 DOM 里，等待会**在开跑之前**
   * 就返回。踩过：于是紧接着读的假上游统计只包含第 1 个请求，断言红成「循环没插话」，
   * 而实际上是那一刻它还没来得及插。（推演了十几分钟，方向全错。）
   * 所以先等「停下」出现（确实在跑），再等它变回「发送」。
   */
  const awaitAgentDone = async () => {
    await waitFor(`!!document.querySelector('[data-role=agent-abort]')`, 8000);
    return waitFor(`!!document.querySelector('[data-role=agent-send]')`, 120000);
  };

  /** 直接读 IndexedDB，绕开界面内存态 —— 库里到底改没改，以它为准 */
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
  const titlesOf = async () => (JSON.parse(await readStore('entries')) || []).map((e) => e.title);

  /**
   * 等库里的某件事成立。
   *
   * 写库是异步的（IndexedDB 事务 + React 状态回灌）—— 拿固定睡眠去赌它跑完，
   * 快了会假红、慢了会白白拖时间。
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

  /* ---------------- 0. 预置一个最小世界 ---------------- */
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
    const wid = 'wd_agent';
    const world = { id: wid, name: '涨潮纪测试世界', tagline: '海每年上涨三尺', summary: '## 概览\\n海水不可逆地上涨。', genre: '低魔海洋',
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
      mk('en_keeper', '守塔人', '负责报时与维护灯塔的人'),
    ]);
    localStorage.setItem('worldforge:settings', JSON.stringify({
      ai: { provider: 'custom', baseUrl: '${MOCK_URL}', apiKey: 'k', model: 'm', temperature: 0.8, contextLimit: 60, vision: true },
      activeWorldId: wid
    }));
    localStorage.setItem('worldforge:agentMode', 'plan');
    db.close();
    return 'seeded';
  })()`);
  check('预置测试世界', seeded === 'seeded');

  /* ---------------- 1. 计划模式：先摆出来，不动手 ---------------- */
  await goto(APP_URL + '#studio');
  const opened = await waitFor(`!!document.querySelector('[data-role=studio-agent]')`, 25000);
  check('工作台打开且 agent 区域存在', opened);
  await sleep(600);
  const defaultPlan = await evaluate(
    `document.querySelector('[data-role=agent-mode-plan]').className.includes('on')`,
  );
  check('默认停在计划模式', defaultPlan);

  await type('把缺的那条核心规则补上，并连好关系');
  await send();
  const planShown = await waitFor(
    `document.querySelectorAll('[data-role=agent-plan]').length > 0`,
    30000,
  );
  check('计划模式：动作先摆出来等确认', planShown);
  const planItems = await evaluate(
    `document.querySelectorAll('[data-role=agent-plan] .ag-plan-item').length`,
  );
  check('计划卡里列出了全部 5 个动作', planItems === 5, `实际 ${planItems} 个`);

  const beforeTitles = await titlesOf();
  check('确认之前，库里一个字都没改', !beforeTitles.includes('潮汐律'));
  await shot(`${OUT}-1-plan.png`);

  /* ---------------- 2. 点执行 → 新增的先进审查，不直接落库 ---------------- */
  await evaluate(`document.querySelector('[data-role=agent-plan-run]').click(); 'run'`);
  const stepsDone = await waitFor(
    `document.querySelectorAll('[data-role=agent-step].done').length >= 4`,
    40000,
  );
  check('执行后逐条给出工具回执', stepsDone);
  await waitFor(`!!document.querySelector('[data-role=agent-send]')`, 40000);
  await sleep(500);

  // 这里是这次改动的核心：agent 可以自己联想，但不能替作者定稿 ——
  // 它新建的东西一律先进审查队列，采纳了才算数。
  const afterTitles = await titlesOf();
  check(
    '新建的条目没有直接入库（先进审查队列）',
    !afterTitles.includes('潮汐律'),
    afterTitles.join(' / '),
  );
  const rels = JSON.parse(await readStore('relations'));
  check('关系也没有直接连上（它牵着一个还没批的条目）', rels.length === 0, `实际 ${rels.length} 条`);

  const review = JSON.parse(await readStore('review'));
  const pending = review.filter((r) => r.status === 'pending');
  check('审查队列里多了两条提议（条目 + 关系）', pending.length === 2, `实际 ${pending.length} 条`);
  check('提议标了来源：工作台 agent', pending.every((r) => r.origin === 'agent'));
  check('提议带上了 agent 当时给的理由', pending.every((r) => !!r.rationale));
  const entryProposal = pending.find((r) => r.kind === 'create-entry');
  const relProposal = pending.find((r) => r.kind === 'relation');
  check(
    '关系提议挂在待审条目的 id 上（采纳那条时才能一起生效）',
    !!relProposal && relProposal.relationDraft?.fromEntryId === entryProposal?.entryDraft?.id,
    `关系 from=${relProposal?.relationDraft?.fromEntryId} / 草稿 id=${entryProposal?.entryDraft?.id}`,
  );
  const reviewJumps = await evaluate(
    `document.querySelectorAll('[data-role=agent-step-review]').length`,
  );
  check('回执上挂着「去审查」的入口（提了案就得看得到案子在哪）', reviewJumps >= 2, `实际 ${reviewJumps} 个`);

  const ops = JSON.parse(await readStore('ops'));
  const agentOps = ops.filter((o) => o.actor === 'agent');
  check('操作日志记下了 agent 的动作', agentOps.length >= 3, `实际 ${agentOps.length} 条`);
  const proposes = agentOps.filter((o) => o.action === 'propose');
  check(
    '提议本身也留了痕，而且可以撤回',
    proposes.length === 2 && proposes.every((o) => o.undo),
    `实际 ${proposes.length} 条`,
  );
  // note 是「只记一笔、不改数据」，本来就没有可撤回的东西 —— 它不该有快照
  const mutating = agentOps.filter((o) => o.action !== 'note');
  check(
    '改数据的日志都带着撤销快照',
    mutating.length > 0 && mutating.every((o) => o.undo),
    `可撤 ${mutating.length} 条`,
  );
  check(
    '纯记录的 note 没有撤销快照（没有可撤的东西）',
    agentOps.filter((o) => o.action === 'note').every((o) => !o.undo),
  );
  const hasNote = agentOps.some((o) => o.entity === 'note');
  check('随手记也留了痕（note 不改数据、只记一笔）', hasNote);
  await shot(`${OUT}-2-done.png`);

  /* ---------------- 3. 撤回提议：连挂在它上面的关系提议一起收回 ---------------- */
  const undoClicked = await evaluate(`(() => {
    const acts = [...document.querySelectorAll('[data-role=agent-step]')];
    const target = acts.find((a) => a.textContent.includes('潮汐律') && a.querySelector('[data-role=agent-step-undo]'));
    if (!target) return 'none';
    target.querySelector('[data-role=agent-step-undo]').click();
    return 'clicked';
  })()`);
  check('回执上能找到「撤回这一步」的入口', undoClicked === 'clicked', undoClicked);

  const withdrawn = await waitFor(
    `(async () => {
      const open = indexedDB.open('worldforge', 5);
      const db = await new Promise((res) => { open.onsuccess = () => res(open.result); });
      const all = await new Promise((res) => {
        const r = db.transaction('review','readonly').objectStore('review').getAll();
        r.onsuccess = () => res(r.result);
      });
      db.close();
      return all.filter((x) => x.status === 'pending').length === 0;
    })()`,
    15000,
  );
  check('撤回提议 → 那条待审记录被收回', withdrawn);
  const reviewAfterUndo = JSON.parse(await readStore('review'));
  const stillPending = reviewAfterUndo.filter((r) => r.status === 'pending').length;
  check(
    '挂在它上面的关系提议一并撤回（不留指向空条目的线）',
    stillPending === 0,
    `剩余 ${stillPending} 条待审`,
  );
  const opsAfterUndo = JSON.parse(await readStore('ops'));
  check(
    '被撤销的那条日志打上了标记（不是删掉）',
    opsAfterUndo.some((o) => o.undone),
  );
  await shot(`${OUT}-3-undone.png`);

  /* ---------------- 4. 直接执行模式 ---------------- */
  await evaluate(`document.querySelector('[data-role=agent-mode-auto]').click(); 'mode'`);
  await sleep(300);
  const autoOn = await evaluate(
    `document.querySelector('[data-role=agent-mode-auto]').className.includes('on')`,
  );
  check('切到直接执行模式', autoOn);

  await type('把水位线的换算规则补上');
  await send();
  const autoProposed = await waitFor(
    `(async () => {
      const open = indexedDB.open('worldforge', 5);
      const db = await new Promise((res) => { open.onsuccess = () => res(open.result); });
      const all = await new Promise((res) => {
        const r = db.transaction('review','readonly').objectStore('review').getAll();
        r.onsuccess = () => res(r.result);
      });
      db.close();
      return all.some((r) => r.status === 'pending' && r.title === '水位线换算');
    })()`,
    30000,
  );
  check('直接执行：动作立刻提交，不用点确认', autoProposed);
  const autoNotLanded = await waitFor(
    `(async () => {
      const open = indexedDB.open('worldforge', 5);
      const db = await new Promise((res) => { open.onsuccess = () => res(open.result); });
      const all = await new Promise((res) => {
        const r = db.transaction('entries','readonly').objectStore('entries').getAll();
        r.onsuccess = () => res(r.result);
      });
      db.close();
      return !all.some((e) => e.title === '水位线换算');
    })()`,
    15000,
  );
  check('但「直接执行」也不越过审查：新建的条目仍然只进队列', autoNotLanded);
  const noPlanCard = await evaluate(
    `document.querySelectorAll('[data-role=agent-plan]').length === 0`,
  );
  check('直接执行时不弹计划卡', noPlanCard);
  await waitFor(`!!document.querySelector('[data-role=agent-send]')`, 30000);
  await sleep(400);
  await shot(`${OUT}-4-auto.png`);

  /* ---------------- 4b. 去审查页采纳 → 这时才真的落库 ---------------- */
  // 提问与提议被收进 UI 之后，作者得有一条路走过去拍板 —— 而且路要走得通。
  await evaluate(`document.querySelector('[data-role=nav-review]').click(); 'go'`);
  const reviewPageReady = await waitFor(
    `document.querySelectorAll('.review-item').length > 0`,
    20000,
  );
  check('审查页列出了 agent 提的案', reviewPageReady);
  const originBadge = await evaluate(
    `document.querySelectorAll('[data-role=review-origin-agent]').length`,
  );
  check('提议标出了来源「工作台 agent 提议」', originBadge >= 1, `实际 ${originBadge} 个`);

  // 关系提议的一端还没落地：这时不能允许采纳，否则库里会多一条断头的线
  const blockedShown = await evaluate(
    `document.querySelectorAll('[data-role=review-blocked]').length`,
  );
  check(
    '依赖待审条目的关系提议：采纳被挡住，并说明了原因',
    blockedShown >= 1,
    `实际 ${blockedShown} 个`,
  );

  // 卡片要按**标题节点精确匹配**挑。
  // 之前用 card.textContent.includes('水位线换算') —— 但关系提议的标题是
  // 「水位线换算 → 涨潮纪」，同样含这个关键词；querySelectorAll 的顺序里它排在前面，
  // 于是 find 拿到的是一直被 missingEnd 挡住的那张关系卡，断言的 'blocked'
  // 其实在说另一件事。这类「选择器撞名」看着像功能坏了，实则是断言选错了靶子。
  const acceptClicked = await evaluate(`(() => {
    const titleOf = (c) => (c.querySelector('[data-role=review-title]')?.textContent || '').trim();
    const card = [...document.querySelectorAll('.review-item')].find((c) => titleOf(c) === '水位线换算');
    if (!card) return 'none';
    const btn = card.querySelector('[data-role=review-accept]');
    if (!btn) return 'nobtn';
    if (btn.disabled) return 'blocked';
    btn.click();
    return 'clicked';
  })()`);
  check('采纳那条待审的条目', acceptClicked === 'clicked', acceptClicked);

  const landed = await waitFor(
    `(async () => {
      const open = indexedDB.open('worldforge', 5);
      const db = await new Promise((res) => { open.onsuccess = () => res(open.result); });
      const all = await new Promise((res) => {
        const r = db.transaction('entries','readonly').objectStore('entries').getAll();
        r.onsuccess = () => res(r.result);
      });
      db.close();
      return all.some((e) => e.title === '水位线换算');
    })()`,
    15000,
  );
  check('采纳之后，条目才真的入库', landed);
  const relFollowed = await waitFor(
    `(async () => {
      const open = indexedDB.open('worldforge', 5);
      const db = await new Promise((res) => { open.onsuccess = () => res(open.result); });
      const all = await new Promise((res) => {
        const r = db.transaction('relations','readonly').objectStore('relations').getAll();
        r.onsuccess = () => res(r.result);
      });
      db.close();
      return all.length >= 1;
    })()`,
    15000,
  );
  check('挂在它上面的关系跟着一起落地（不用再手工连一次）', relFollowed);
  const noZombiePending = await evaluate(
    `document.querySelectorAll('[data-role=review-blocked]').length`,
  );
  check('采纳后不再有卡住的关系提议', noZombiePending === 0, `剩余 ${noZombiePending} 个`);
  await shot(`${OUT}-4b-review.png`);

  // 回工作台：后面几节都在那里
  await evaluate(`document.querySelector('[data-role=nav-studio]').click(); 'go'`);
  await waitFor(`!!document.querySelector('[data-role=studio-agent]')`, 20000);
  await sleep(600);

  /* ---------------- 5. 不需要动手的一轮 ---------------- */
  const turnsBefore = await evaluate(`document.querySelectorAll('[data-role=agent-turn]').length`);
  // 措辞要真的命中假上游的「纯问答」分支（关键词「几条」）。
  // 之前写的是「库里现在有哪些条目」—— 没命中，却因为历史里残留的结果回灌标记
  // 侥幸也拿到了 plan:[]，等于这条断言一直在测别的东西。
  await type('库里现在有几条条目');
  await send();
  const answered = await waitFor(
    `document.querySelectorAll('[data-role=agent-turn]').length >= ${turnsBefore + 2}`,
    30000,
  );
  check('不需要动手的一轮也给出了答复', answered);
  // 断言答复的**内容**，才能证明它真命中了假上游的「纯问答」分支。
  // 这一条以前只看「有没有答复」和「有没有计划卡」—— 而没命中分支时会掉进默认场景，
  // 恰好在那个模式下也不弹卡，于是蒙混过关。
  const answeredByScenario = await evaluate(
    `document.body.innerText.includes('要我把缺口补上吗')`,
  );
  check('答复来自预期的「纯问答」分支', answeredByScenario);
  const noPlanOnAnswer = await evaluate(
    `document.querySelectorAll('[data-role=agent-plan]').length === 0`,
  );
  check('plan 给 [] → 不弹计划卡，答复本身就是终点', noPlanOnAnswer);
  await waitFor(`!!document.querySelector('[data-role=agent-send]')`, 30000);
  await shot(`${OUT}-5-answer.png`);

  /* ---------------- 6. 操作日志页 ---------------- */
  await goto(APP_URL + '#log');
  const logReady = await waitFor(`document.querySelectorAll('[data-role=log-item]').length > 0`, 20000);
  check('操作日志页列出了记录', logReady);
  const agentRows = await evaluate(`document.querySelectorAll('[data-role=log-item].agent').length`);
  check('日志能区分出哪些是 AI 做的', agentRows > 0, `实际 ${agentRows} 条`);
  const undoRows = await evaluate(`document.querySelectorAll('[data-role=log-item].undone').length`);
  check('被撤销的记录在日志里标了出来', undoRows > 0, `实际 ${undoRows} 条`);
  const filterWorks = await evaluate(`(() => {
    document.querySelector('[data-role=log-filter-entity-entry]').click();
    return 'clicked';
  })()`);
  await sleep(400);
  const filtered = await evaluate(`document.querySelectorAll('[data-role=log-item]').length`);
  check('按实体筛选能收窄列表', filterWorks === 'clicked' && filtered > 0, `筛后 ${filtered} 条`);
  await shot(`${OUT}-6-log.png`);

  /* ---------------- 7. 提示泡：点一下就交给它，不必再按回车 ---------------- */
  // 语义变过一次，值得记一笔：这些按钮最早是「填进输入框、再由作者按发送」，
  // 断言写的也是「只是填进去，不替作者发出去」。作者的原话是
  // 「我希望它给一些可选的按钮，点击后自动开始思考和构思」—— 填进去再让他按一次，
  // 等于把「接下来做什么」又推回给了他。所以现在点一下就发出去。
  await goto(APP_URL + '#studio');
  const chipsReady = await waitFor(
    `document.querySelectorAll('[data-role=agent-suggest-item]').length > 0`,
    25000,
  );
  check('工作台备好了可点的提示泡', chipsReady);

  const chipText = await evaluate(
    `document.querySelector('[data-role=agent-suggest-item]').textContent`,
  );
  // 切回计划模式：这一轮照旧要作者拍板才动库 ——「一点就跑」不等于「一点就改库」
  await evaluate(`document.querySelector('[data-role=agent-mode-plan]').click(); 'ok'`);
  await sleep(200);
  const turnsBeforeChip = await evaluate(
    `document.querySelectorAll('[data-role=agent-turn]').length`,
  );
  await evaluate(`document.querySelector('[data-role=agent-suggest-item]').click(); 'ok'`);
  const chipSent = await waitFor(
    `document.querySelectorAll('[data-role=agent-turn]').length > ${turnsBeforeChip}`,
    15000,
  );
  check('点一下提示泡 → 立刻交给它（不必再按回车）', chipSent);
  const chipUserTurn = await evaluate(`(() => {
    const els = [...document.querySelectorAll('[data-role=agent-turn]')];
    for (let i = els.length - 1; i >= 0; i--) if (els[i].classList.contains('user')) return els[i].textContent;
    return '';
  })()`);
  check(
    '交过去的就是那颗按钮上写的那句话',
    String(chipUserTurn).includes(String(chipText)),
    `实际="${String(chipUserTurn).slice(0, 30)}"`,
  );
  const boxCleared = await evaluate(
    `document.querySelector('[data-role=agent-input]').value === ''`,
  );
  check('交出去之后输入框是空的（下一个问题从头写）', boxCleared);
  await shot(`${OUT}-7-suggest-run.png`);

  // 这一轮只为验「一点就跑」，别让它跟后面的断言抢会话 ——
  // 「停下」在「跑动中」和「等拍板」两种状态下都在，按一下就回到空闲。
  const wasRunning = await waitFor(`!!document.querySelector('[data-role=agent-abort]')`, 3000);
  if (wasRunning) {
    await evaluate(`document.querySelector('[data-role=agent-abort]').click(); 'ok'`);
  }
  const backIdle = await waitFor(`!!document.querySelector('[data-role=agent-send]')`, 25000);
  check('这一轮收干净了（该停的停下，该拍板的也不再挂着）', backIdle);

  /* ---------------- 8. 模型没按格式回 → 自己纠正一轮 ---------------- */
  // 真实模型最典型的翻车：整段散文、没有 JSON。老实现就此收工，
  // 作者看到的是「它说完了，然后什么都没发生」，也分不清是模型不想做还是解析丢了。
  const turnsBeforeBroken = await evaluate(
    `document.querySelectorAll('[data-role=agent-turn]').length`,
  );
  const idleBeforeBroken = await waitFor(
    `!!document.querySelector('[data-role=agent-send]')`,
    30000,
  );
  check('上一轮收尾后输入区回到可输入状态', idleBeforeBroken);
  await type('散着说，库里都有什么？');
  await send();
  const flagged = await waitFor(`!!document.querySelector('[data-role=agent-broken]')`, 25000);
  check('没按格式回的那一轮被如实标出来（不是装作正常）', flagged);
  const brokenText = await evaluate(
    `document.querySelector('[data-role=agent-broken]').textContent`,
  );
  check(
    '标的是「已请它重说一遍」而不是就此收工',
    String(brokenText).includes('重说一遍'),
    `实际="${String(brokenText).slice(0, 24)}"`,
  );
  // 纠正轮：假上游看到 agent.sys.repair 那句话才给合规 JSON，能出计划卡就说明它真的又跑了一轮
  const repaired = await waitFor(
    `document.querySelectorAll('[data-role=agent-turn]').length >= ${turnsBeforeBroken + 3}`,
    30000,
  );
  check('补了一轮纠正，而不是让作者干等', repaired);
  const planAfterRepair = await waitFor(`!!document.querySelector('[data-role=agent-plan]')`, 15000);
  check('纠正轮按协议给出了动作（计划卡）', planAfterRepair);
  await shot(`${OUT}-8-broken.png`);
  await evaluate(`document.querySelector('[data-role=agent-plan-skip]').click(); 'ok'`);
  await sleep(400);

  /* ---------------- 9. 刷新后那张没执行的计划卡要说实话 ---------------- */
  // 计划卡还在、但运行态（连同上文）已经丢了 —— 这时界面不能谎称「被你跳过了」：
  // 它压根没被跳过，是作废了。
  await type('把「水位线」的换算规则补上');
  await send();
  const planBeforeReload = await waitFor(`!!document.querySelector('[data-role=agent-plan]')`, 25000);
  check('计划模式下又拿到一张计划卡', planBeforeReload);
  await goto(APP_URL + '#studio');
  await sleep(1600);
  const staleShown = await waitFor(
    `document.body.innerText.includes('这批动作没有执行')`,
    15000,
  );
  check('刷新后如实说明「这批没执行、已作废」', staleShown);
  const noLie = await evaluate(`!document.body.innerText.includes('被你跳过')`);
  check('不会谎称「被你跳过了」', noLie);
  const noZombieCard = await evaluate(
    `document.querySelectorAll('[data-role=agent-plan]').length === 0`,
  );
  check('作废的批次不再挂着可点的计划卡', noZombieCard);
  await shot(`${OUT}-9-stale.png`);

  /* ---------------- 10. 它会问：提问不该被「计划模式」拦住 ---------------- */
  // 拦一个提问等于要作者先批准它提问 —— 说不通，而且作者本来就正等着这个问题。
  await type('只问一句：先干哪个');
  await send();
  const askShown = await waitFor(`!!document.querySelector('[data-role=agent-ask]')`, 30000);
  check('它问出来了（提问块出现）', askShown);
  const noPlanForAsk = await evaluate(
    `document.querySelectorAll('[data-role=agent-plan]').length === 0`,
  );
  check('只是一句提问时不弹计划卡（否则等于要作者先批准它提问）', noPlanForAsk);
  const askQuestion = await evaluate(
    `document.querySelector('[data-role=agent-ask-question]')?.textContent ?? ''`,
  );
  check('把问题本身摆出来了', String(askQuestion).includes('从哪一块下手'), `实际="${askQuestion}"`);
  const askOptions = await evaluate(
    `document.querySelectorAll('[data-role=agent-ask-option]').length`,
  );
  check('给了可点的候选答案', askOptions === 3, `实际 ${askOptions} 个`);
  await shot(`${OUT}-10-ask.png`);

  // 点候选答案 → **直接交给它**。
  // 候选答案是「这个问题该怎么答」——点下去就是要这么答，再让作者按一次回车是多余的。
  const optionText = await evaluate(
    `document.querySelectorAll('[data-role=agent-ask-option]')[0].textContent`,
  );
  const turnsBeforeOption = await evaluate(
    `document.querySelectorAll('[data-role=agent-turn]').length`,
  );
  await evaluate(`document.querySelectorAll('[data-role=agent-ask-option]')[0].click(); 'ok'`);
  const optionSent = await waitFor(
    `document.querySelectorAll('[data-role=agent-turn]').length > ${turnsBeforeOption}`,
    15000,
  );
  check('点候选答案 → 直接交给它（不再让你按回车）', optionSent);
  const optionUserTurn = await evaluate(`(() => {
    const els = [...document.querySelectorAll('[data-role=agent-turn]')];
    for (let i = els.length - 1; i >= 0; i--) if (els[i].classList.contains('user')) return els[i].textContent;
    return '';
  })()`);
  check(
    '交过去的就是那个候选答案本身',
    String(optionUserTurn).includes(String(optionText)),
    `实际="${String(optionUserTurn).slice(0, 30)}"`,
  );
  // 这一轮（点答案触发的那次）收干净再往下走，别让它跟第 11 节的计数抢
  if (await waitFor(`!!document.querySelector('[data-role=agent-abort]')`, 3000)) {
    await evaluate(`document.querySelector('[data-role=agent-abort]').click(); 'ok'`);
  }
  await waitFor(`!!document.querySelector('[data-role=agent-send]')`, 25000);

  /* ---------------- 11. 查不到就问，而且提问后面的动作不许偷偷跑 ---------------- */
  // 真实模型的老毛病：查不到就换个说法再查。这里让假上游一口气给出
  // 「查（必然没结果）+ 问作者 + 还打算建」——提问是终点，后面那条不该被执行。
  await evaluate(`document.querySelector('[data-role=agent-mode-auto]').click(); 'ok'`);
  await sleep(250);
  const opsBeforeAsk = JSON.parse(await readStore('ops')).length;
  await type('拿不准，这个灰屿到底是谁');
  await send();
  const askInBatch = await waitFor(`!!document.querySelector('[data-role=agent-ask]')`, 40000);
  check('查到没有 → 停下来问，而不是硬编一个', askInBatch);
  const skippedAfterAsk = await waitFor(
    `document.querySelectorAll('[data-role=agent-step].skipped').length >= 1`,
    15000,
  );
  check('提问后面的动作被标成跳过（不拿假设当事实）', skippedAfterAsk);
  await waitFor(`!!document.querySelector('[data-role=agent-send]')`, 30000);
  await sleep(400);
  const opsAfterAsk = JSON.parse(await readStore('ops'));
  check(
    '整轮下来一个写操作都没有发生',
    opsAfterAsk.length === opsBeforeAsk,
    `前后 ${opsBeforeAsk} → ${opsAfterAsk.length} 条`,
  );
  const gashimaPending = JSON.parse(await readStore('review')).filter(
    (r) => r.status === 'pending' && r.title.includes('灰屿'),
  ).length;
  check('被跳过的那条新建没有偷偷进审查队列', gashimaPending === 0, `实际 ${gashimaPending} 条`);
  await shot(`${OUT}-11-ask-skips-rest.png`);

  /* ---------------- 12. 打转的护栏：拦住重复，然后停下来 ---------------- */
  // 假上游会一直用同一套参数查同一个不存在的东西（真实模型最典型的打转）。
  // 执行循环该：拦住重复 → 提醒它去问 → 还是不听就停下并如实说明。
  const opsBeforeSpin = JSON.parse(await readStore('ops')).length;
  await type('反复查一下那个不祥的潮信');
  await send();
  const stuckShown = await waitFor(`!!document.querySelector('[data-role=agent-stuck]')`, 60000);
  check('连着几步没收获 → 停下来，而不是一直查', stuckShown);
  const stuckText = await evaluate(
    `document.querySelector('[data-role=agent-stuck]').textContent`,
  );
  check(
    '停下时说得清是为什么（免得作者以为它还在忙）',
    String(stuckText).includes('停下'),
    `实际="${String(stuckText).slice(0, 28)}"`,
  );
  const repeatedBlocked = await evaluate(
    `document.body.innerText.includes('不重复执行')`,
  );
  check('同一件事实质上只跑了一次，重复的那几次被拦下', repeatedBlocked);
  const opsAfterSpin = JSON.parse(await readStore('ops')).length;
  check(
    '打转期间没有产生任何写操作',
    opsAfterSpin === opsBeforeSpin,
    `前后 ${opsBeforeSpin} → ${opsAfterSpin} 条`,
  );
  const spins = await evaluate(
    `document.querySelectorAll('[data-role=agent-step].failed').length`,
  );
  check('被拦下的重复在回执里如实标成失败（不是假装成功）', spins >= 2, `实际 ${spins} 条`);
  await shot(`${OUT}-12-stuck.png`);

  /* ---------------- 13. 时间：先看再写，采纳才上轴 ---------------- */
  // 时间是**条目上的一个可选字段**（`Entry.time`），不是另一张表。这一节要钉住三件事：
  //   ① 动笔之前得先看轴上已经有什么（否则会写出互相矛盾的年代）；
  //   ② agent 提的只是**提议** —— 采纳之前库里一条都不该多出来；
  //   ③ 「至今」必须显式说，位置（at）则一个字都不能让它猜。
  await evaluate(`document.querySelector('[data-role=nav-studio]').click(); 'go'`);
  await waitFor(`!!document.querySelector('[data-role=studio-agent]')`, 20000);
  await waitFor(`!!document.querySelector('[data-role=agent-send]')`, 30000);
  await sleep(400);
  // 这一节要连着跑三轮（读 → 提议 → 收尾），停在直接执行模式最省事；
  // 万一它弹了计划卡，下面每一步都会顺手点掉，免得断言等在一个永远不动的卡上。
  await evaluate(`document.querySelector('[data-role=agent-mode-auto]').click(); 'mode'`);
  await sleep(250);
  const runPlanIfAny = async () => {
    if (await evaluate(`!!document.querySelector('[data-role=agent-plan]')`)) {
      await evaluate(`document.querySelector('[data-role=agent-plan-run]').click(); 'run'`);
      await sleep(500);
    }
  };

  /**
   * 「它跑完了没有」不能看 body 里有没有「新建条目」「看时间轴」这几个字 ——
   * 右侧那栏工具清单里本来就一字不差地印着它们，这种条件**开局就成立**，
   * 测试会抢在这一轮真正落库之前往下走（这地方曾经假绿过一轮）。
   * 等的是**执行记录**：每个动作一条 `[data-role=agent-step]`，跑完才带上 `done`。
   */
  const doneSteps = async () =>
    JSON.parse(
      await evaluate(
        `JSON.stringify([...document.querySelectorAll('[data-role=agent-step].done .ag-act-name')].map((n) => n.textContent.trim()))`,
      ),
    );
  const waitMoreSteps = async (base, extra, timeout = 70000) => {
    const t0 = Date.now();
    let names = await doneSteps();
    while (Date.now() - t0 < timeout) {
      names = await doneSteps();
      if (names.length >= base + extra) break;
      await sleep(250);
    }
    return names;
  };

  const entriesBefore = JSON.parse(await readStore('entries')).length;
  const stepsBefore = (await doneSteps()).length;
  await type('把这两件大事记上时间线');
  await send();
  await runPlanIfAny();
  const round1 = await waitMoreSteps(stepsBefore, 1);
  check(
    '动笔之前先去读了时间轴（先知道轴上已经有什么）',
    round1[stepsBefore] === '看时间轴',
    round1.slice(stepsBefore).join(' / ') || '(没有新动作)',
  );
  await runPlanIfAny();
  const round2 = await waitMoreSteps(stepsBefore, 3);
  const added = round2.slice(stepsBefore);
  check(
    '补一件带时间的事走的是「新建条目」这一步（回执里认得出）',
    added.filter((n) => n === '新建条目').length === 2,
    added.join(' / '),
  );
  await runPlanIfAny();
  // 提议是异步落库的（pushReview → IndexedDB），拿固定睡眠赌它跑完必然假红
  const reviewRows = await waitStore(
    'review',
    (rows) =>
      rows.filter(
        (r) => r.status === 'pending' && r.kind === 'create-entry' && r.entryDraft?.time,
      ).length >= 2,
    15000,
  );

  const entriesAfterPropose = JSON.parse(await readStore('entries'));
  check(
    '提议阶段库里一条都没多 —— 它进的是审查队列',
    entriesAfterPropose.length === entriesBefore,
    `${entriesBefore} → ${entriesAfterPropose.length}`,
  );
  const pendingTimed = reviewRows.filter(
    (r) => r.status === 'pending' && r.kind === 'create-entry' && r.entryDraft?.time,
  );
  check(
    '两条带时间的提议都躺在审查队列里等着拍板',
    pendingTimed.length === 2,
    `实际 ${pendingTimed.length} 条 · 库里 ${reviewRows.length} 条：${reviewRows
      .map((r) => `${r.kind}|${r.title}|${r.entryDraft?.time ? 'time' : '无时间'}`)
      .join(' ; ')}`,
  );
  const majorDraft = pendingTimed.find((r) => r.entryDraft?.title === '灯塔第一次点亮');
  check(
    '时间里带着世界内纪年、纪元和分量（不是光一个标题）',
    majorDraft?.entryDraft?.time?.from === '涨潮纪 12 年' &&
      majorDraft?.entryDraft?.time?.kind === 'point' &&
      majorDraft?.entryDraft?.time?.era === '涨潮纪' &&
      majorDraft?.entryDraft?.time?.weight === 'major',
    JSON.stringify(majorDraft?.entryDraft?.time),
  );
  check(
    '「至今」是显式说的（不是靠「没给到哪天」猜出来的）',
    pendingTimed.find((r) => r.entryDraft?.title === '潮线石的规矩')?.entryDraft?.time?.kind ===
      'ongoing',
    JSON.stringify(pendingTimed.map((r) => [r.entryDraft?.title, r.entryDraft?.time?.kind])),
  );
  check(
    '轴上的位置一个字都没让它猜（at 留空，由 store 补、由作者拖）',
    pendingTimed.every((r) => r.entryDraft?.time?.at === undefined),
    JSON.stringify(pendingTimed.map((r) => r.entryDraft?.time?.at)),
  );
  await shot(`${OUT}-13a-timed-proposed.png`);

  /* ---------------- 14. 审查页：带时间的提议长什么样，采纳之后才上轴 ---------------- */
  await goto(APP_URL + '#review');
  const eventCard = await waitFor(
    `(() => [...document.querySelectorAll('.review-item')].some((c) =>
      (c.querySelector('[data-role=review-title]')?.textContent || '').trim() === '灯塔第一次点亮'))()`,
    20000,
  );
  check('审查页把带时间的提议摆出来了', eventCard);
  const eventCardText = await evaluate(`(() => {
    const titleOf = (c) => (c.querySelector('[data-role=review-title]')?.textContent || '').trim();
    const c = [...document.querySelectorAll('.review-item')].find((x) => titleOf(x) === '灯塔第一次点亮');
    return c ? c.innerText : '';
  })()`);
  check(
    '卡片上看得见纪年、纪元与分量（作者据此判断该不该收）',
    eventCardText.includes('涨潮纪 12 年') &&
      eventCardText.includes('重大') &&
      eventCardText.includes('新建条目'),
    eventCardText.replace(/\n/g, ' ').slice(0, 70),
  );
  check(
    '卡片说清了它会被放在哪（末尾）并给了一个去时间轴的入口',
    eventCardText.includes('末尾') && eventCardText.includes('去时间轴看看'),
  );

  const accepted = await evaluate(`(() => {
    const titleOf = (c) => (c.querySelector('[data-role=review-title]')?.textContent || '').trim();
    const card = [...document.querySelectorAll('.review-item')].find((c) => titleOf(c) === '灯塔第一次点亮');
    const btn = card?.querySelector('[data-role=review-accept]');
    if (!btn) return 'none';
    if (btn.disabled) return 'blocked';
    btn.click();
    return 'clicked';
  })()`);
  check('采纳那条带时间的提议', accepted === 'clicked', accepted);
  const landedEntry = await waitFor(
    `(async () => {
      const open = indexedDB.open('worldforge', 5);
      const db = await new Promise((res) => { open.onsuccess = () => res(open.result); });
      const all = await new Promise((res) => {
        const r = db.transaction('entries','readonly').objectStore('entries').getAll();
        r.onsuccess = () => res(r.result);
      });
      db.close();
      return all.some((e) => e.title === '灯塔第一次点亮');
    })()`,
    15000,
  );
  check('采纳之后它才真的入库', landedEntry);
  const acceptedEntry = JSON.parse(await readStore('entries')).find(
    (e) => e.title === '灯塔第一次点亮',
  );
  check(
    '落库的条目带着纪年、纪元和分量（一样都没丢）',
    acceptedEntry?.time?.from === '涨潮纪 12 年' &&
      acceptedEntry?.time?.era === '涨潮纪' &&
      acceptedEntry?.time?.weight === 'major',
    JSON.stringify(acceptedEntry?.time),
  );
  check(
    '落库时补上了轴上的位置（作者在轴上拖的就是它）',
    typeof acceptedEntry?.time?.at === 'number' && acceptedEntry.time.at > 0,
    String(acceptedEntry?.time?.at),
  );
  const entryOps = JSON.parse(await readStore('ops')).filter(
    (o) => o.entity === 'entry' && o.action === 'create' && o.target === '灯塔第一次点亮',
  );
  check('日志里留了一条条目的新建记录（误收也能退回一步）', entryOps.length >= 1, `实际 ${entryOps.length} 条`);
  await shot(`${OUT}-14a-timed-accepted.png`);

  /* ---------------- 15. 驳回的那条不许上轴 ---------------- */
  await goto(APP_URL + '#review');
  await waitFor(
    `(() => [...document.querySelectorAll('.review-item')].some((c) =>
      (c.querySelector('[data-role=review-title]')?.textContent || '').trim() === '潮线石的规矩'))()`,
    20000,
  );
  const rejected = await evaluate(`(() => {
    const titleOf = (c) => (c.querySelector('[data-role=review-title]')?.textContent || '').trim();
    const card = [...document.querySelectorAll('.review-item')].find((c) => titleOf(c) === '潮线石的规矩');
    const btn = card?.querySelector('[data-role=review-reject]');
    if (!btn) return 'none';
    btn.click();
    return 'clicked';
  })()`);
  check('驳回另一条带时间的提议', rejected === 'clicked', rejected);
  await sleep(900);
  const afterReject = JSON.parse(await readStore('entries'));
  check(
    '被驳回的那条没有悄悄入库',
    !afterReject.some((e) => e.title === '潮线石的规矩'),
    afterReject.map((e) => e.title).join('、'),
  );

  /* ---------------- 16. 轴上真的画出来了 ---------------- */
  // 台账对不代表界面认：时间轴得把它当作自己人来画（节点 + 列表行）。
  // 它不再是独立的一页 —— 落在「关系与时间」的**时间**那一支上。
  await goto(APP_URL + '#graph');
  // 编年已经接管了时间那一支的切换位 —— 点轴从编年右下角的「旧的」进
  const oldLink = await waitFor(`!!document.querySelector('[data-role=chron-old-view]')`, 20000);
  check('编年里留着去旧点轴的「旧的」口子', oldLink);
  await evaluate(`document.querySelector('[data-role=chron-old-view]').click(); 'time'`);
  const drawn = await waitFor(`!!document.querySelector('[data-role=tl-axis]')`, 20000);
  check('切过去就画得出轴，而且轴上有 agent 落下的那条', drawn);
  const drawnTitles = await evaluate(
    `[...document.querySelectorAll('[data-role=tl-list-row]')]
      .map((r) => r.querySelector('.tl-list-title')?.textContent || '').join('|')`,
  );
  check(
    '轴下面的列表里有它（agent 提的和手写的一样是正经条目）',
    drawnTitles.includes('灯塔第一次点亮'),
    drawnTitles,
  );
  check(
    '被驳回的那条不在轴上',
    !drawnTitles.includes('潮线石的规矩'),
    drawnTitles,
  );
  await shot(`${OUT}-16-time-axis.png`);

  /* ---------------- 17. 它少写了括号：解析层补齐，动作照旧执行 ---------------- */
  // 真实翻车（作者贴过来的原话）：它一口气提好几个动作，**每个动作对象少写一个收尾的 `}`**。
  // 末尾逗号修不掉它、截断补齐也看不见它（少在中间，不在末尾），老实现只能整轮判废：
  // 界面说「它没按约定的格式回」→ 请它重说一遍 → 它照抄同一处错 → 再废一轮，
  // **两条写好的提议就这么没了**。作者的原话是「它根本就没补全」。
  //
  // 这一节盯三件事：动作救回来、界面如实说、落库照旧进审查。
  await evaluate(`document.querySelector('[data-role=nav-studio]').click(); 'go'`);
  await waitFor(`!!document.querySelector('[data-role=agent-send]')`, 30000);
  await sleep(400);
  await evaluate(`document.querySelector('[data-role=agent-mode-auto]').click(); 'mode'`);
  await sleep(250);
  await type('这两条少写括号的也照做');
  await send();
  const repairedNote = await waitFor(
    `!!document.querySelector('[data-role=agent-broken][data-kind=repaired]')`,
    30000,
  );
  check('界面如实说「它少写了括号、我补齐了」——既不装作没事，也不报成废品', repairedNote);
  const noteText = await evaluate(
    `document.querySelector('[data-role=agent-broken][data-kind=repaired]')?.textContent || ''`,
  );
  check('那句话点明了是括号的问题', noteText.includes('括号'), noteText.slice(0, 48));
  const twoSteps = await waitFor(
    `document.querySelectorAll('[data-role=agent-step].done').length >= 2`,
    40000,
  );
  check('两个动作都被执行了（老实现这里一个都没有：整轮判废）', twoSteps);
  await waitFor(`!!document.querySelector('[data-role=agent-send]')`, 40000);
  await sleep(700);

  const sloppyPending = JSON.parse(await readStore('review')).filter(
    (r) =>
      r.status === 'pending' &&
      r.kind === 'create-entry' &&
      ['潮纹灯', '潮线尺'].includes(r.entryDraft?.title),
  );
  check(
    '两条都进了审查队列（修的是格式，不是替作者放行）',
    sloppyPending.length === 2,
    `实际 ${sloppyPending.length} 条`,
  );
  const titlesAfterSloppy = await titlesOf();
  check(
    '库里仍旧没有它们（照旧等作者拍板）',
    !titlesAfterSloppy.includes('潮纹灯') && !titlesAfterSloppy.includes('潮线尺'),
    titlesAfterSloppy.join(' / '),
  );
  await shot(`${OUT}-17-sloppy-json.png`);

  /* ---------------- 18. 清点式补全：它得立账、能重试、不许半路收工 ----------------
     作者贴过来的那趟真实对话坏在三处（20 条只读了 3 条就收工 / 把「物品」当分类名撞了三次 /
     分类建好之后同一个动作被当成「做过了」拦下并宣称「已在审查队列中」而队列里一条都没有）。
     这一节把三处逐一钉住：账要看得见、失败过的动作必须能重来、清单没清空不许收工。

     给假上游加 600ms 延迟：清单面板的「还有没勾的」那个中间态只存在于第 2~5 轮之间，
     不带延迟的话整趟跑完不到一秒，轮询根本抓不到它。 */
  await fetch(`${MOCK_STATS}/reset`).catch(() => {});
  await fetch('http://127.0.0.1:5190/__mock-delay?ms=600').catch(() => {});

  await evaluate(`document.querySelector('[data-role=nav-studio]').click(); 'go'`);
  await waitFor(`!!document.querySelector('[data-role=agent-send]')`, 30000);
  await sleep(400);
  await evaluate(`document.querySelector('[data-role=agent-mode-auto]').click(); 'mode'`);
  await sleep(250);

  /**
   * 「同一件事实质上只跑了一次」这个数**要取增量**，不能直接在整个页面上找那句话。
   *
   * 会话从第 1 节起就是同一段，第 12 节（打转）本来就拦下过几次重复、回执里明写着
   * 「不重复执行」—— 直接在整页文本里搜，搜到的是那一条，于是这一节无论如何都会红。
   * （踩过：这里红过一次，看着像「重试被拦」，其实是断言范围错了。）
   */
  const repeatSteps = `[...document.querySelectorAll('[data-role=agent-step]')]
    .filter((x) => x.textContent.includes('不重复执行')).length`;
  const repeatsBefore = await evaluate(repeatSteps);

  await type('把库里所有条目正文里提到、但还没单独建条目的人物和物件逐个清点补全');
  await send();

  // 它一上来就该把「要清点多少条」列出来，而且列在作者看得见的地方
  const ledger = await waitValue(
    `(() => {
      const el = document.querySelector('[data-role=agent-todos]');
      if (!el || Number(el.dataset.total) !== 3) return '';
      if (!el.querySelector('[data-role=agent-todos-open]')) return '';
      return [...el.querySelectorAll('[data-role=agent-todo]')]
        .map((x) => x.textContent.trim()).join(' | ');
    })()`,
    60000,
  );
  check('它给自己立了账，摆在作者看得见的地方（3 条，还有没勾的）', !!ledger, ledger || '没抓到');
  check(
    '账上写的是真事（条目原文），不是一句「进行中」',
    !!ledger && ledger.includes('涨潮纪') && ledger.includes('等重的代价'),
    ledger || '',
  );
  await shot(`${OUT}-18a-todos.png`);

  const ranToEnd = await awaitAgentDone();
  check('这一趟跑到收尾了（不是半路卡住）', ranToEnd);
  await sleep(600);
  const todoText = await evaluate(`document.body.innerText`);
  // ① 分类名对不上时，报错里得带着这个世界现有的分类 —— 照着就能改对，不必去问作者
  check(
    '分类名写错时，回执里带着现有分类清单（照着就能改对）',
    todoText.includes('这个世界的分类只有：') && todoText.includes('体系'),
  );
  check(
    '那句报错同时点破了「内容类型 ≠ 分类」',
    todoText.includes('内容类型'),
  );
  // ② 失败过的动作必须能重来：第 2 轮那三条和第 4 轮那三条参数一模一样
  const repeatsAfter = await evaluate(repeatSteps);
  check(
    '同一个动作在前提变了之后能重来（这一节没多出「不重复执行」）',
    repeatsAfter === repeatsBefore,
    `之前 ${repeatsBefore} 条，之后 ${repeatsAfter} 条`,
  );
  check(
    '「不重复执行」的反面：那三条真的进了审查队列（不是嘴上说说）',
    todoText.includes('清点完了'),
  );

  const catsAfter = JSON.parse(await readStore('categories'));
  check(
    '它自己把缺的分类建出来了（真的落库，不是嘴上说建了）',
    catsAfter.some((c) => c.name === '物品'),
    catsAfter.map((c) => c.name).join('、'),
  );
  const threePending = JSON.parse(await readStore('review')).filter(
    (r) =>
      r.status === 'pending' &&
      r.kind === 'create-entry' &&
      ['诅咒之狼', '黑暗巨蛇', '幽魂'].includes(r.entryDraft?.title),
  );
  check(
    '三条创建提议真的躺在审查队列里（作者那次是「说在队列里、其实一条都没有」）',
    threePending.length === 3,
    `实际 ${threePending.length} 条`,
  );
  const itemCat = catsAfter.find((c) => c.name === '物品');
  check(
    '三条提议都挂在新建的那个分类下面（分类名改对了，不是硬塞进去的）',
    threePending.length === 3 && threePending.every((r) => r.entryDraft?.categoryId === itemCat?.id),
    threePending.map((r) => `${r.entryDraft?.title}→${r.entryDraft?.categoryId}`).join(' ; '),
  );
  // ③ 清单没清空时不许收工：它第 5 轮说了「接下来我将继续检查其他条目」却没给动作
  const todosStats = await (await fetch(MOCK_STATS)).json();
  check(
    '清单没勾完就想收工 → 被追问过（不是就此收掉）',
    (todosStats.marks?.todoNudge ?? 0) >= 1,
    JSON.stringify(todosStats.marks ?? {}),
  );
  check(
    '追问之后它照做了：清单全勾完（面板上写着「都做完了」）',
    await waitFor(`!!document.querySelector('[data-role=agent-todos-clear]')`, 10000),
  );
  const lastTodoState = await evaluate(`(() => {
    const el = document.querySelector('[data-role=agent-todos]');
    return el ? el.dataset.open + '/' + el.dataset.total : '';
  })()`);
  check('面板上一条没剩（0 条没勾）', lastTodoState === '0/3', lastTodoState || '没有面板');

  /* ---------------- 19. 说了要接着做、却没有动作 → 说破它，别让作者一直等 ---------------- */
  await fetch(`${MOCK_STATS}/reset`).catch(() => {});
  await evaluate(`document.querySelector('[data-role=nav-studio]').click(); 'go'`);
  await waitFor(`!!document.querySelector('[data-role=agent-send]')`, 30000);
  await sleep(400);
  await type('再检查一遍还有没有漏掉的人物和物件，说完就停');
  await send();
  await awaitAgentDone();
  await sleep(600);

  const promisedStats = await (await fetch(MOCK_STATS)).json();
  // 失败时把「每一轮带了哪句插话」一并打出来：marks 为空时，光看它分不清
  // 「循环没插」和「插的是另一句」，而这两种要改的地方完全不同。
  const turnsSeen = (promisedStats.agentTurns ?? [])
    .map((t) => `${(t.marks || []).join('+') || '—'} ← ${t.tail}`)
    .join(' ｜ ');
  check(
    '「我接下来还要做…」却没给动作 → 循环说破过一次',
    (promisedStats.marks?.promiseNudge ?? 0) >= 1,
    turnsSeen || JSON.stringify(promisedStats),
  );
  const promisedMark = await waitFor(
    `!!document.querySelector('[data-role=agent-promised]')`,
    10000,
  );
  check('说到底还是没做 → 界面如实标出「这句承诺没兑现」', promisedMark);
  const promisedTurnText = await evaluate(`(() => {
    const turns = [...document.querySelectorAll('[data-role=agent-turn]')];
    return turns.length ? turns[turns.length - 1].innerText : '';
  })()`);
  check(
    '给作者的那句说的是「这句承诺没兑现」，不是一句含混的「已停下」',
    promisedTurnText.includes('承诺') && promisedTurnText.includes('没有兑现'),
    promisedTurnText.replace(/\n/g, ' ').slice(0, 70),
  );
  await shot(`${OUT}-19-promised.png`);

  /* ---------------- 20. 催两次也不做 → 如实交底「还剩几条」，不许悄悄收尾 ---------------- */
  await fetch(`${MOCK_STATS}/reset`).catch(() => {});
  await evaluate(`document.querySelector('[data-role=nav-studio]').click(); 'go'`);
  await waitFor(`!!document.querySelector('[data-role=agent-send]')`, 30000);
  await sleep(400);
  await type('这些条目我清点不完，先停吧');
  await send();
  await awaitAgentDone();
  await sleep(600);

  const leftMark = await waitFor(
    `!!document.querySelector('[data-role=agent-todo-left]')`,
    10000,
  );
  check('清单没做完就停下来 → 界面上单独标了一条「未完成」', leftMark);
  const leftN = await evaluate(
    `document.querySelector('[data-role=agent-todo-left]')?.dataset.n || ''`,
  );
  check('标出来的数字就是还剩几条（2 条）', leftN === '2', String(leftN));
  const leftText = await evaluate(`document.body.innerText`);
  check(
    '给作者的收尾说的是「还剩 2 条没做完」，而不是「已完成」',
    leftText.includes('清单上还有 2 条没做完'),
  );
  const lastOpen = await evaluate(`(() => {
    const el = document.querySelector('[data-role=agent-todos]');
    return el ? el.dataset.open : '';
  })()`);
  check('面板上仍旧挂着那 2 条没勾的（没有为了收尾把它们划掉）', lastOpen === '2', String(lastOpen));
  // 收尾把假上游调回原速，免得影响后面跑别的脚本
  await fetch('http://127.0.0.1:5190/__mock-delay?ms=0').catch(() => {});
  await shot(`${OUT}-20-todo-left.png`);

  /* ---------------- 21. 答完之后给「下一步」，而且记得上一句 ---------------- */
  // 作者的两条原话合成了这一节：
  //   「我希望它能够给出建议，亦或者给一些可选的按钮给用户，比如说『构思 xxx 条目』，
  //     点击后自动开始思考和构思」
  //   「我发现这里的 AI 没有上下文记忆」
  // 假上游场景 16 照着他那趟真实对话演：先查条目（**顺手塞一条不该出现的建议**），
  // 再交回话并给出两条真建议。
  //
  // 跨轮记忆是「只发给模型、界面上一个字都不显示」的东西 —— e2e 从 DOM 里根本看不到，
  // 所以它由假上游的 `history` 那一份眼睛来验（见 recordHistory）。
  await fetch(`${MOCK_STATS}/reset`).catch(() => {});
  await evaluate(`document.querySelector('[data-role=nav-studio]').click(); 'go'`);
  await waitFor(`!!document.querySelector('[data-role=agent-send]')`, 30000);
  await sleep(400);
  await evaluate(`document.querySelector('[data-role=agent-mode-auto]').click(); 'ok'`);
  await sleep(250);

  await type('导师研究魔法与科技结合的真正动机是什么？');
  await send();
  const nextShown = await waitValue(
    `(() => {
      const el = document.querySelector('[data-role=agent-next]');
      if (!el) return '';
      return [...el.querySelectorAll('[data-role=agent-next-item]')]
        .map((x) => x.textContent.trim()).join(' | ');
    })()`,
    60000,
  );
  check('答完之后它自己摆出了「下一步可以做什么」', !!nextShown, nextShown || '没抓到');
  check(
    '建议具体到条目和事情上，不是一句客套',
    !!nextShown && nextShown.includes('神祇的监管'),
    nextShown || '',
  );
  const nextBlocks = await evaluate(`document.querySelectorAll('[data-role=agent-next]').length`);
  check(
    '只有「把话交回来」的那一轮才摆建议（中间那轮还在跑动作，给了也不算）',
    nextBlocks === 1,
    `实际 ${nextBlocks} 块`,
  );
  const suggestHidden = await evaluate(`!document.querySelector('[data-role=agent-suggest]')`);
  check('它给了建议时，下面那排自动出题让位（两排按钮叠着只会互相稀释）', suggestHidden);
  await shot(`${OUT}-21-agent-next.png`);

  // 点一下就发起 —— 不是「填进输入框、再让作者按回车」
  const firstLabel = await evaluate(
    `document.querySelectorAll('[data-role=agent-next-item]')[0].textContent`,
  );
  const turnsBeforeNext = await evaluate(
    `document.querySelectorAll('[data-role=agent-turn]').length`,
  );
  await evaluate(`document.querySelectorAll('[data-role=agent-next-item]')[0].click(); 'ok'`);
  const nextRan = await waitFor(
    `document.querySelectorAll('[data-role=agent-turn]').length > ${turnsBeforeNext}`,
    15000,
  );
  check('点一下建议 → 直接开始做（不必再按回车）', nextRan);
  const nextUserTurn = await evaluate(`(() => {
    const els = [...document.querySelectorAll('[data-role=agent-turn]')];
    for (let i = els.length - 1; i >= 0; i--) if (els[i].classList.contains('user')) return els[i].textContent;
    return '';
  })()`);
  check(
    '交过去的就是那句话本身',
    String(nextUserTurn).includes(String(firstLabel)),
    `实际="${String(nextUserTurn).slice(0, 30)}"`,
  );
  await awaitAgentDone();
  await sleep(500);

  // 跨轮记忆：这一问的请求里必须带着**上一问的原话**
  const memStats = await (await fetch(MOCK_STATS)).json();
  check(
    '这一问的请求里带着上一问的原话（不再每次都是第一次见面）',
    !!memStats.history && String(memStats.history.sample).includes('真正动机'),
    JSON.stringify(memStats.history ?? null).slice(0, 180),
  );
  check(
    '而且带上的是**几轮对话**，不是一句话的碎片',
    !!memStats.history && memStats.history.chars > 60,
    `chars=${memStats.history?.chars ?? 0}`,
  );
  const staleClicks = await evaluate(
    `document.querySelectorAll('[data-role=agent-next-item]:not([disabled])').length`,
  );
  check(
    '翻页之后，上一句下面的按钮不再可点（它已经不在当前话题里了）',
    staleClicks === 0,
    `实际 ${staleClicks} 个`,
  );
  await shot(`${OUT}-21-agent-memory.png`);

  /* ---------------- 22. 没有未捕获异常 ---------------- */
  const errors = client.events
    .filter((e) => e.method === 'Runtime.exceptionThrown')
    .map((e) => e.params.exceptionDetails?.exception?.description ?? 'unknown');
  check('没有未捕获异常', errors.length === 0, errors.slice(0, 2).join(' / '));

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
