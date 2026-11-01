/**
 * 开发期端到端验证：IndexedDB 升级被旧连接占用时的表现
 *
 * 场景：数据库在 v1（旧标签页持有连接 —— 模拟被浏览器休眠的后台标签），
 * 新打开的页面要升级到 v2。
 *
 * 背景（浏览器硬性行为，决定了这里的全部设计）：
 *   - 被阻塞的「带版本号 open」请求会一直排队，并把后续所有 open 饿死（含无版本号的）；
 *   - 页面刷新也不会取消它。
 *   所以升级请求一旦发出就不能放弃 —— 必须等占用者关闭后自动完成。
 *
 * 预期：
 *   1. 应用照常打开（无版本号连接不受阻塞，数据可读，空状态引导页可见）
 *   2. 升级被占用 → 显示「正在升级数据库/等待其他标签页释放」指引界面
 *   3. 释放占用（模拟用户关闭旧标签页）→ 升级自动完成，应用自动恢复
 *   4. 数据库最终为 v2，drafts store 存在
 *
 * 前置：node server.mjs --port 5188
 * 用法：node .dev/e2e-blocked-db.mjs <appUrl>
 */
import { spawn } from 'node:child_process';
import { writeFileSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const CHROME = 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const [, , APP_URL = 'http://127.0.0.1:5188/', OUT = '.shots/blocked'] = process.argv;
/** 与 src/storage/indexeddb.ts 的 DB_VERSION 保持一致；升版本时改这一处 */
const DB_VERSION = 5;

const PORT = 9357;
const profile = mkdtempSync(join(tmpdir(), 'cdp-blocked-'));
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
  return { ready, send, close: () => ws.close() };
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

  /* ---------------- 1. 模拟旧标签页：以 v1 打开并一直占着连接 ---------------- */
  await client.send('Page.addScriptToEvaluateOnNewDocument', {
    source: `
      (() => {
        try {
          const o = indexedDB.open('worldforge', 1);
          o.onupgradeneeded = () => {
            for (const n of ['worlds','categories','entries','relations','docs','review']) {
              if (!o.result.objectStoreNames.contains(n)) {
                const s = o.result.createObjectStore(n, { keyPath: 'id' });
                if (n !== 'worlds') s.createIndex('worldId', 'worldId', { unique: false });
              }
            }
          };
          o.onsuccess = () => { window.__holdV1 = o.result; };
        } catch (e) { /* 库已是更高版本时忽略 */ }
      })();
    `,
  });
  await client.send('Page.navigate', { url: APP_URL });
  await sleep(1500);

  check('模拟旧连接占用 v1 数据库', await evaluate(`!!window.__holdV1`));

  /* ---------------- 2. 应用应能完成初始化（不无限转圈、不报错） ---------------- */
  const noErrorCard = await waitFor(
    `!document.body.textContent.includes('无法打开本地数据库') && !document.body.textContent.includes('正在打开你的世界观库')`,
    20000,
  );
  check('被占用时应用能完成初始化（不卡转圈、不报错）', noErrorCard);

  /* ---------------- 3. 升级等待界面：给出关闭其他标签页的指引 ---------------- */
  // blocked 立即触发 onBlocked → 等待界面马上出现（此时应用整体切换为指引卡）
  const waitingShown = await waitFor(
    `document.body.textContent.includes('正在升级数据库')`,
    15000,
  );
  check('显示升级等待界面（指引关闭其他标签页）', waitingShown);
  const waitingText = await evaluate(`document.body.textContent`);
  check(
    '指引里说清了「关闭后会自动完成」',
    waitingText.includes('自动完成') && waitingText.includes('关闭'),
  );
  check('升级等待界面提供「复制诊断日志」入口', waitingText.includes('复制诊断日志'));
  await shot(`${OUT}-waiting.png`);

  /* ---------------- 4. 释放占用（模拟关闭旧标签页）→ 自动完成升级 ---------------- */
  await evaluate(`window.__holdV1 && window.__holdV1.close(); 'released'`);
  const recovered = await waitFor(
    `!!document.querySelector('.brand-name') && !document.body.textContent.includes('正在升级数据库')`,
    20000,
  );
  check('释放占用后升级自动完成（无需刷新）', recovered);

  // 升级完成后应用恢复正常界面（全新库 → 空状态引导页）
  const startPageOk = await evaluate(
    `!!document.querySelector('.ob-hello') || document.body.textContent.includes('还没有世界')`,
  );
  check('升级完成后应用界面正常（空状态引导页可见）', startPageOk);

  const version = await evaluate(`(async () => {
    const r = await new Promise((res, rej) => {
      const o = indexedDB.open('worldforge');
      o.onsuccess = () => { res(o.result.version); o.result.close(); };
      o.onerror = () => rej(o.error);
    });
    return r;
  })()`);
  check(`数据库已升级到最新版本（v${DB_VERSION}）`, version === DB_VERSION, `当前版本 = ${version}`);

  // 读 store 清单必须用不带版本号的 open：带着低版本号去开一个已升级的库会直接抛 VersionError
  const storesOk = await evaluate(`(async () => {
    try {
      return await new Promise((res, rej) => {
        const o = indexedDB.open('worldforge');
        o.onsuccess = () => {
          const names = o.result.objectStoreNames;
          const need = ['drafts', 'pieces', 'ops', 'chats'];
          res(need.every((n) => names.contains(n)));
          o.result.close();
        };
        o.onerror = () => rej(o.error);
      });
    } catch { return false; }
  })()`);
  check('drafts / pieces / ops / chats store 都在（草稿、杂物间、操作日志、会话可用）', storesOk);
  await shot(`${OUT}-recovered.png`);

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
