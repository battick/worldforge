/**
 * 开发期端到端验证：复现用户遇到的「打开本地数据库超时」
 *
 * 场景（真实成因）：某个 WorldForge 标签页（后被浏览器冻结）曾发起过
 * 带版本号的升级请求 —— 该请求被另一个旧连接阻塞后永远排队，
 * 并把后续所有 open（包括不带版本号的）全部饿死。
 * 用户新开的页面 init 12 秒超时 → 之前只会报一句干巴巴的错。
 *
 * 验证点：
 *   1. 超时后出现错误卡，且错误卡上有「复制诊断日志」和展开的日志内容
 *   2. 诊断日志包含：idb-open:timeout 事件 + post-mortem 的数据库清单（能看出 worldforge@v几）
 *   3. 释放占用后点「关好了，重试」→ 应用恢复（不刷新页面）
 *   4. 僵尸升级把版本顶到 v3 却没建 pieces store 时，应用能自愈补齐（升级到 v4）
 *
 * 前置：node server.mjs（默认 5188，需已构建最新 dist）
 * 用法：node .dev/e2e-timeout-db.mjs
 */
import { spawn } from 'node:child_process';
import { writeFileSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const CHROME = 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const APP_URL = 'http://127.0.0.1:5188/';
const OUT = '.shots/timeout';
const PORT = 9365;
const profile = mkdtempSync(join(tmpdir(), 'cdp-timeout-'));
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
      throw new Error('页面执行出错：' + JSON.stringify(r.exceptionDetails).slice(0, 300));
    }
    return r.result?.value;
  };
  const shot = async (path) => {
    const s = await client.send('Page.captureScreenshot', { format: 'png' });
    writeFileSync(path, Buffer.from(s.data, 'base64'));
    console.log('  截图 →', path);
  };
  const waitFor = async (expr, timeout = 30000, step = 400) => {
    const t0 = Date.now();
    while (Date.now() - t0 < timeout) {
      if (await evaluate(expr)) return true;
      await sleep(step);
    }
    return false;
  };
  const clickBtn = async (text) =>
    evaluate(
      `[...document.querySelectorAll('button')].find(b => b.textContent.includes(${JSON.stringify(text)}))?.click(); 'ok'`,
    );

  /* ---------------- 1. 标签页 A（同源纯文本资源页）：建 v1 库 + 占住连接 + 发僵尸请求 ----------------
   * 用同源的 JS 静态资源当「被冻结的旧标签页」：浏览器以纯文本文档渲染它，
   * 不执行任何应用代码，但同源、能访问同一个 IndexedDB。
   * 先把 v1 库建好、连接占住、僵尸 v3 请求入队，都就绪后再开标签页 B 加载应用 ——
   * 顺序确定，不会竞态。（注意：/__wf-ping 会被 SPA 回退成 index.html，不能用。） */
  const indexHtml = await (await fetch(APP_URL)).text();
  const asset = indexHtml.match(/assets\/index-[^"]+\.js/)?.[0];
  if (!asset) throw new Error('没找到应用 JS 资源路径');
  await client.send('Page.navigate', { url: `http://127.0.0.1:5188/${asset}` });
  await sleep(500);
  await evaluate(`
    (async () => {
      const o = indexedDB.open('worldforge', 1);
      o.onupgradeneeded = () => {
        for (const n of ['worlds','categories','entries','relations','docs','review']) {
          if (!o.result.objectStoreNames.contains(n)) {
            const s = o.result.createObjectStore(n, { keyPath: 'id' });
            if (n !== 'worlds') s.createIndex('worldId', 'worldId', { unique: false });
          }
        }
      };
      await new Promise((res) => { o.onsuccess = res; o.onerror = res; });
      window.__holdV1 = o.result;
      // 占住之后立刻发出注定被阻塞的升级请求（不带 onupgradeneeded，模拟僵尸）。
      // 它会永远排队，并饿死标签页 B 随后的一切 open —— 正是用户超时报错的成因。
      try { indexedDB.open('worldforge', 3); } catch (e) { /* ignore */ }
      return 'v1 held, zombie queued';
    })()
  `);
  const held = await evaluate(`!!window.__holdV1`);
  check('模拟旧连接占用 v1 数据库 + 僵尸升级请求已入队', held);

  /* ---------------- 标签页 B：加载应用，open 必被饿死 ---------------- */
  const newTarget = await (
    await fetch(`http://127.0.0.1:${PORT}/json/new?${encodeURIComponent(APP_URL)}`, {
      method: 'PUT',
    })
  ).json();
  const clientB = makeClient(newTarget.webSocketDebuggerUrl);
  await clientB.ready;
  await clientB.send('Page.enable');
  await clientB.send('Runtime.enable');
  const evaluateB = async (expression) => {
    const r = await clientB.send('Runtime.evaluate', {
      expression,
      returnByValue: true,
      awaitPromise: true,
    });
    if (r.exceptionDetails) {
      throw new Error('页面执行出错：' + JSON.stringify(r.exceptionDetails).slice(0, 300));
    }
    return r.result?.value;
  };
  const waitForB = async (expr, timeout = 30000, step = 400) => {
    const t0 = Date.now();
    while (Date.now() - t0 < timeout) {
      if (await evaluateB(expr)) return true;
      await sleep(step);
    }
    return false;
  };
  const clickBtnB = async (text) =>
    evaluateB(
      `[...document.querySelectorAll('button')].find(b => b.textContent.includes(${JSON.stringify(text)}))?.click(); 'ok'`,
    );

  /* ---------------- 2. 12 秒后应出现带针对性指引 + 诊断日志的错误卡 ---------------- */
  const errShown = await waitForB(
    `(document.body?.textContent ?? '').includes('数据库被僵死的排队请求卡住了')`,
    25000,
  );
  check('超时后出现错误卡（不再无限转圈）', errShown);
  await clientB.send('Page.captureScreenshot', { format: 'png' }).then(async (s) => {
    writeFileSync(`${OUT}-error.png`, Buffer.from(s.data, 'base64'));
    console.log('  截图 →', `${OUT}-error.png`);
  });

  const bodyText = await evaluateB(`document.body.textContent`);
  check('错误信息提示了超时原因', bodyText.includes('打开本地数据库超时'));
  check('判定为「僵死队列」场景（针对性卡片）', bodyText.includes('僵死的排队请求'));
  check('指明刷新无效、必须重启浏览器进程', bodyText.includes('重启浏览器'));
  check('给出任务管理器操作步骤', bodyText.includes('任务管理器'));
  check('告知数据库还在、数据没丢（含版本）', /worldforge v\d/.test(bodyText));
  check('错误卡提供「复制诊断日志」按钮', bodyText.includes('复制诊断日志'));
  check('重试按钮文案针对重启场景', bodyText.includes('我已彻底重启浏览器，重试'));

  // 展开诊断日志并检查内容
  const diagText = await evaluateB(`document.querySelector('details pre')?.textContent ?? ''`);
  check('诊断日志包含 idb-open:timeout 事件', diagText.includes('idb-open:timeout'));
  check('诊断日志包含 post-mortem 数据库清单', diagText.includes('indexedDB.databases'));
  check(
    '数据库清单能看到 worldforge 卡在 v1',
    /worldforge@v1/.test(diagText),
    diagText.match(/worldforge@\d+/)?.[0] ?? '未找到',
  );
  check('诊断日志包含环境信息（UA）', diagText.includes('UA:'));

  /* ---------------- 3. 释放占用 + 点重试 → 应用恢复 ---------------- */
  await evaluate(`window.__holdV1 && window.__holdV1.close(); 'released'`);
  await sleep(600); // 让排队的僵尸升级请求先完成（它会把版本顶到 v3 但不建 store）
  await clickBtnB('重试');

  const recovered = await waitForB(
    `!!document.querySelector('.brand-name') && !document.body.textContent.includes('数据库被僵死的排队请求卡住了')`,
    25000,
  );
  check('释放占用后点「重试」应用恢复（无需刷新）', recovered);
  await clientB.send('Page.captureScreenshot', { format: 'png' }).then(async (s) => {
    writeFileSync(`${OUT}-recovered.png`, Buffer.from(s.data, 'base64'));
    console.log('  截图 →', `${OUT}-recovered.png`);
  });

  /* ---------------- 4. 僵尸升级没建 pieces store → 应用应自愈补齐 ---------------- */
  // 僵尸把版本顶到 v3 却没建 store；应用 init 会发现缺 store 并升级到 v4 补齐
  const healed = await waitForB(
    `(async () => {
      const v = await Promise.race([
        new Promise((res) => {
          const o = indexedDB.open('worldforge');
          o.onsuccess = () => { res(o.result.objectStoreNames.contains('pieces') ? o.result.version : 0); o.result.close(); };
          o.onerror = () => res(0);
        }),
        new Promise((res) => setTimeout(() => res(0), 5000)),
      ]);
      return v >= 4;
    })()`,
    30000,
  );
  check('缺 store 的库被自愈补齐（pieces store 已建）', healed);

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
