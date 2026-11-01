/**
 * 开发期全页面巡检：依次打开每个路由，记录渲染文本与运行时错误。
 *
 * 产品不再预置演示世界，所以巡检前先直接往 IndexedDB 里塞一个最小世界，
 * 否则所有页面都会停在「还没有世界」的引导页，等于没巡检。
 *
 * 用法：node .dev/sweep.mjs http://127.0.0.1:5188/ .shots/sweep
 */
import { spawn } from 'node:child_process';
import { writeFileSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const CHROME = 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const [, , APP_URL = 'http://127.0.0.1:5188/', OUT = '.shots/sweep'] = process.argv;

const WORLD_NAME = '巡检世界';

const ROUTES = [
  ['dashboard', WORLD_NAME],
  // 「条目库」与「杂物间」并进了 Wiki。`#entries` / `#pieces` 仍然是合法地址
  // （它们是这一页的两个子页），所以那两条也要巡 —— 老链接不能因为改版就断。
  ['wiki', 'Wiki'],
  ['entries', 'Wiki'],
  ['pieces', 'Wiki'],
  ['graph', '时间与关系'],
  ['studio', 'AI 工作台'],
  ['review', '审查队列'],
  ['docs', '资料库'],
  ['consistency', '一致性检查'],
  ['ask', '问答存档'],
  ['log', '操作日志'],
  ['article', '文章审校'],
  ['export', '导出设定集'],
  ['settings', '设置'],
];

/**
 * 直接写库塞一个最小世界（比走一遍共创流程快得多，且不依赖 AI）。
 *
 * 「时间」是条目上的一个可选字段（`Entry.time`），所以这里不再往 `timeline` 表里塞东西，
 * 而是给条目本身设上时间 —— 三种形态各来一条，轴上的时间点 / 区间横杠 / 至今箭头
 * 就都能被巡到。
 */
const SEED = `(async () => {
  try {
    const open = indexedDB.open('worldforge', 5);
    const db = await new Promise((res, rej) => {
      open.onsuccess = () => res(open.result);
      open.onerror = () => rej(open.error);
    });
    const t = Date.now();
    const wid = 'wd_sweep';
    const world = { id: wid, name: ${JSON.stringify(WORLD_NAME)}, tagline: '用于全页面巡检的临时世界',
      summary: '## 概览\\n\\n这是一个用于开发期巡检的临时世界，不参与交付。', genre: '测试',
      tone: '仅用于巡检。', themeColor: '#2f6fb0', createdAt: t, updatedAt: t,
      timelineMigratedAt: t };
    const c1 = { id: 'ct_geo', worldId: wid, name: '地理', icon: '🗺️', fieldDefs: [], order: 0, createdAt: t, updatedAt: t };
    const c2 = { id: 'ct_ppl', worldId: wid, name: '人物', icon: '👤', fieldDefs: [], order: 1, createdAt: t, updatedAt: t };
    const mk = (id, cat, title, sum, time) => ({ id, worldId: wid, categoryId: cat, title, aliases: [], summary: sum,
      content: '## 概览\\n\\n' + sum, tags: ['巡检'], fields: {}, status: 'canon', sourceRefs: [],
      ...(time ? { time } : {}), createdAt: t, updatedAt: t });
    const e1 = mk('en_port', 'ct_geo', '巡检港', '一座用于巡检的港口',
      { kind: 'point', from: '元年初', to: '', at: 10, era: '开港纪', weight: 'major' });
    const e2 = mk('en_man', 'ct_ppl', '巡检人', '一个用于巡检的人',
      { kind: 'range', from: '开港纪 3 年', to: '开港纪 7 年', at: 30, toAt: 70, era: '开港纪', weight: 'normal' });
    // 「至今」那条故意不给纪元：轴上的无色节点也巡一遍
    const e3 = mk('en_stele', 'ct_geo', '巡检碑', '一块还在长高的碑',
      { kind: 'ongoing', from: '开港纪 9 年', to: '', at: 90, era: '', weight: 'minor' });
    const rel = { id: 'rl_x', worldId: wid, fromEntryId: 'en_man', toEntryId: 'en_port',
      type: '位于', note: '巡检关系', status: 'canon', createdAt: t };
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
    localStorage.setItem('worldforge:settings', JSON.stringify({
      ai: { provider: 'custom', baseUrl: 'http://127.0.0.1:5190/v1', apiKey: 'sweep-key',
            model: 'mock-model', temperature: 0.8, contextLimit: 60, vision: true },
      activeWorldId: wid
    }));
    return 'seeded';
  } catch (e) {
    return 'seed-failed: ' + (e && e.message);
  }
})()`;

const PORT = 9357;
const profile = mkdtempSync(join(tmpdir(), 'cdp-sweep-'));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

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
    '--window-size=1440,980',
    'about:blank',
  ],
  { stdio: 'ignore' },
);

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
    } else if (msg.method) {
      events.push(msg);
      if (msg.method === 'Page.javascriptDialogOpening') {
        send('Page.handleJavaScriptDialog', { accept: true }).catch(() => {});
      }
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

try {
  let up = false;
  for (let i = 0; i < 60 && !up; i++) {
    try {
      up = (await fetch(`http://127.0.0.1:${PORT}/json/version`)).ok;
    } catch {
      await sleep(250);
    }
  }
  if (!up) throw new Error('DevTools 未就绪');

  const targets = await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json();
  const page = targets.find((t) => t.type === 'page');
  const client = makeClient(page.webSocketDebuggerUrl);
  await client.ready;
  await client.send('Page.enable');
  await client.send('Runtime.enable');
  await client.send('Log.enable').catch(() => {});

  const evaluate = async (expression) =>
    (await client.send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true }))
      .result?.value;

  // 先加载一次（让应用建好库），再注入一个最小世界，然后重新加载
  await client.send('Page.navigate', { url: APP_URL });
  await sleep(3500);
  const seeded = await evaluate(SEED);
  console.log('种子数据：', seeded);
  if (seeded !== 'seeded') throw new Error('写入巡检世界失败：' + seeded);

  let bad = 0;

  for (const [route, label] of ROUTES) {
    const before = client.events.length;
    await client.send('Page.navigate', {
      url: `${APP_URL.replace(/\/$/, '')}/?r=${route}#${route}`,
    });
    await sleep(2600);

    const info = JSON.parse(
      await evaluate(`JSON.stringify({
        title: document.querySelector('.page-title')?.textContent?.trim() ?? '(无标题)',
        textLen: document.body.innerText.length,
        hasErrorBanner: !!document.querySelector('.banner.danger'),
        stuckOnStart: !!document.querySelector('.ob-hello') && ${JSON.stringify(label)} !== ${JSON.stringify(WORLD_NAME)}
      })`),
    );

    // 只统计本次导航产生的新错误
    const raw = [];
    for (const e of client.events.slice(before)) {
      if (e.method === 'Runtime.exceptionThrown') {
        raw.push('EXCEPTION: ' + (e.params.exceptionDetails?.exception?.description ?? '').slice(0, 160));
      } else if (e.method === 'Log.entryAdded' && e.params.entry.level === 'error') {
        raw.push('LOG: ' + e.params.entry.text.slice(0, 160));
      } else if (e.method === 'Runtime.consoleAPICalled' && e.params.type === 'error') {
        raw.push('CONSOLE: ' + e.params.args.map((a) => a.value ?? a.description).join(' ').slice(0, 160));
      }
    }
    // 假上游刻意不发 CORS 头，所以「浏览器直连」必然被拦一次、随后应用自动改走同源转发 ——
    // 这是设计内的正常路径（其它 e2e 也把它列为预期），不该算作页面出错。
    const corsSeen = raw.some((e) => /blocked by CORS policy/i.test(e));
    const errs = raw.filter((e) => {
      if (/blocked by CORS policy/i.test(e)) return false;
      if (corsSeen && /Failed to load resource: net::ERR_FAILED/.test(e)) return false;
      return true;
    });
    const ignored = raw.length - errs.length;
    if (ignored) console.log(`        （忽略 ${ignored} 条预期内的直连失败：已自动走本地转发）`);

    const titleOk = info.title.includes(label);
    const ok = !errs.length && !info.hasErrorBanner && info.textLen > 200 && titleOk && !info.stuckOnStart;
    if (!ok) bad++;
    console.log(
      `${ok ? 'OK  ' : 'FAIL'}  #${route.padEnd(11)} 标题="${info.title}" 期望≈"${label}" 文本${info.textLen}字` +
        `${info.hasErrorBanner ? ' [错误横幅]' : ''}${info.stuckOnStart ? ' [停在引导页]' : ''}${titleOk ? '' : ' [标题不符]'}`,
    );
    if (errs.length) for (const e of errs.slice(0, 3)) console.log('        ' + e);

    const s = await client.send('Page.captureScreenshot', { format: 'png' });
    writeFileSync(`${OUT}-${route}.png`, Buffer.from(s.data, 'base64'));
  }

  /**
   * 「时间」那一支不是一页，是「关系与时间」里的一个视图 —— 上面的路由循环跑不到它。
   * 所以在收尾时单独切过去看一眼：轴、节点、区间横杠、至今箭头都在不在。
   * （不复用上面的错误收集逻辑，这里只关心「这一支有没有真的渲染出来」。）
   */
  {
    const before = client.events.length;
    // 时间那一支不再占切换位：默认落在编年，从右下角的「旧的」进
    await client.send('Page.navigate', { url: `${APP_URL.replace(/\/$/, '')}/?r=time#graph` });
    await sleep(2600);
    const clicked = await evaluate(
      `(() => { const b = document.querySelector('[data-role="chron-old-view"]');
        if (!b) return 'no-button'; b.click(); return 'clicked'; })()`,
    );
    await sleep(1200);
    const info = JSON.parse(
      await evaluate(`JSON.stringify({
        axis: !!document.querySelector('[data-role="tl-axis"]'),
        nodes: document.querySelectorAll('[data-role="tl-node"]').length,
        spans: document.querySelectorAll('[data-role="tl-span"]').length,
        ongoing: document.body.innerText.includes(${JSON.stringify('至今')}),
        rows: document.querySelectorAll('[data-role="tl-list-row"]').length,
        textLen: document.body.innerText.length
      })`),
    );
    const errs = [];
    for (const e of client.events.slice(before)) {
      if (e.method === 'Runtime.exceptionThrown') {
        errs.push('EXCEPTION: ' + (e.params.exceptionDetails?.exception?.description ?? '').slice(0, 160));
      } else if (e.method === 'Runtime.consoleAPICalled' && e.params.type === 'error') {
        errs.push('CONSOLE: ' + e.params.args.map((a) => a.value ?? a.description).join(' ').slice(0, 160));
      }
    }
    const ok =
      clicked === 'clicked' &&
      info.axis &&
      info.nodes === 3 &&
      info.spans === 2 &&
      info.rows === 3 &&
      info.textLen > 200 &&
      !errs.length;
    if (!ok) bad++;
    console.log(
      `${ok ? 'OK  ' : 'FAIL'}  #graph(time) 节点${info.nodes} 横杠${info.spans} 列表${info.rows}` +
        ` 至今${info.ongoing ? '有' : '无'} 文本${info.textLen}字${clicked === 'clicked' ? '' : ' [切不过去]'}`,
    );
    if (errs.length) for (const e of errs.slice(0, 3)) console.log('        ' + e);
    const s = await client.send('Page.captureScreenshot', { format: 'png' });
    writeFileSync(`${OUT}-graph-time.png`, Buffer.from(s.data, 'base64'));
  }

  /**
   * Wiki 的三个子页不是三条路由，是**同一页的三个页签** —— 上面的路由循环只能
   * 巡到默认那一支（阅读）。所以收尾时单独把三件事都过一遍：默认那一支的
   * **三栏版式**（左目录 / 中正文 / 右信息栏）有没有真的渲染出来、一进来是不是
   * 就摊开了一条正文（不用点任何东西）、点目录能不能换一篇，以及另外两支
   * 有没有各自渲染出来。
   * （不复用上面的错误收集逻辑，这里只关心「这一支有没有真的渲染出来」。）
   */
  {
    const before = client.events.length;
    await client.send('Page.navigate', { url: `${APP_URL.replace(/\/$/, '')}/?r=wiki#wiki` });
    await sleep(2600);

    const layout = JSON.parse(
      await evaluate(`JSON.stringify({
        layout: !!document.querySelector('[data-role="wiki-layout"]'),
        nav: document.querySelectorAll('[data-role="wiki-nav-item"]').length,
        groups: document.querySelectorAll('[data-role="wiki-nav-group"]').length,
        tabs: document.querySelectorAll('[data-role="wiki-tabs"] [data-role^="wiki-tab-"]').length,
        textLen: document.body.innerText.length
      })`),
    );

    // 一进来就该有正文摊着（不用点任何东西）—— 这是「像 wiki」的底线
    const reader = JSON.parse(
      await evaluate(`JSON.stringify({
        art: !!document.querySelector('[data-role="wiki-article"]'),
        title: (document.querySelector('[data-role="wiki-art-title"]')?.textContent || '').trim(),
        body: !!document.querySelector('[data-role="wiki-article"] .md.wiki'),
        outline: !!document.querySelector('[data-role="wiki-outline"]'),
        infobox: !!document.querySelector('[data-role="wiki-infobox"]')
      })`),
    );
    {
      const s = await client.send('Page.captureScreenshot', { format: 'png' });
      writeFileSync(`${OUT}-wiki-read.png`, Buffer.from(s.data, 'base64'));
    }

    // 点目录里的第二条 → 右边该换成它，目录里那条该高亮
    const switched = await evaluate(
      `(() => {
        const items = [...document.querySelectorAll('[data-role="wiki-nav-item"]')];
        const other = items.find((b) => !b.classList.contains('active'));
        if (!other) return 'only-one';
        other.click();
        return other.querySelector('[data-role="wiki-nav-item-title"]')?.textContent.trim() || 'clicked';
      })()`,
    );
    await sleep(700);
    const afterSwitch = await evaluate(
      `(document.querySelector('[data-role="wiki-art-title"]')?.textContent || '').trim()`,
    );

    const tabChecks = {};
    for (const [tab, probe] of [
      ['entries', '[data-role="entries-batch-toggle"]'],
      ['pieces', '.pz-quick'],
      ['display', '[data-role="wiki-layout"]'],
    ]) {
      await evaluate(`document.querySelector('[data-role="wiki-tab-${tab}"]')?.click(); 'tab'`);
      await sleep(700);
      tabChecks[tab] = await evaluate(`!!document.querySelector('${probe}')`);
    }

    const errs = [];
    for (const e of client.events.slice(before)) {
      if (e.method === 'Runtime.exceptionThrown') {
        errs.push('EXCEPTION: ' + (e.params.exceptionDetails?.exception?.description ?? '').slice(0, 160));
      } else if (e.method === 'Runtime.consoleAPICalled' && e.params.type === 'error') {
        errs.push('CONSOLE: ' + e.params.args.map((a) => a.value ?? a.description).join(' ').slice(0, 160));
      }
    }
    const ok =
      layout.layout &&
      layout.nav === 3 &&
      layout.groups >= 1 &&
      layout.tabs === 3 &&
      layout.textLen > 200 &&
      reader.art &&
      !!reader.title &&
      reader.body &&
      reader.infobox &&
      switched !== 'only-one' &&
      afterSwitch === switched &&
      tabChecks.entries &&
      tabChecks.pieces &&
      tabChecks.display &&
      !errs.length;
    if (!ok) bad++;
    console.log(
      `${ok ? 'OK  ' : 'FAIL'}  #wiki(子页) 目录${layout.nav}条/分组${layout.groups} 页签${layout.tabs}` +
        ` 正文${reader.art ? '有' : '无'}(《${reader.title}》) 排版${reader.body ? '有' : '无'}` +
        ` 信息栏${reader.infobox ? '有' : '无'} 换篇${switched === 'only-one' ? '无第二条' : `《${afterSwitch}》`}` +
        ` 编辑支${tabChecks.entries ? '有' : '无'} 杂物支${tabChecks.pieces ? '有' : '无'}`,
    );
    if (errs.length) for (const e of errs.slice(0, 3)) console.log('        ' + e);
    const s = await client.send('Page.captureScreenshot', { format: 'png' });
    writeFileSync(`${OUT}-wiki-tabs.png`, Buffer.from(s.data, 'base64'));
  }

  console.log(`\n巡检完成：${ROUTES.length + 2 - bad}/${ROUTES.length + 2} 个页面正常。`);
  client.close();
} catch (e) {
  console.error('巡检失败：', e.message);
  process.exitCode = 1;
} finally {
  chrome.kill();
}
