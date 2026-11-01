/**
 * 开发期端到端验证：资料库（docs）——「直接输入」与「上传文件」两条入库路径
 *
 * 覆盖：
 *   1. 点击「直接输入 / 粘贴文本」不会误触发文件选择框
 *   2. 空内容时「保存为资料」按钮禁用，输入后可用
 *   3. 保存后资料出现在列表，标题留空时自动取正文首行
 *   4. 保存的内容能被「查看文本」原样读回
 *   5. 刷新后仍在（IndexedDB 持久化）
 *   6. 回归：拖拽 .txt 文件导入的老路径没被改坏
 *
 * 前置：node server.mjs（默认 5188，需已构建最新 dist）
 * 用法：node .dev/e2e-docs.mjs
 */
import { spawn } from 'node:child_process';
import { writeFileSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const CHROME = 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const APP_URL = 'http://127.0.0.1:5188/';
const OUT = '.shots/docs';
const PORT = 9370;
const profile = mkdtempSync(join(tmpdir(), 'cdp-docs-'));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const BODY = '北境灯塔的燃料清单\n\n鲸油：每月两桶，由南港补给船送来。\n松脂：冬季备用，遇潮会失效。';

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
  const waitFor = async (expr, timeout = 20000, step = 300) => {
    const t0 = Date.now();
    while (Date.now() - t0 < timeout) {
      if (await evaluate(expr)) return true;
      await sleep(step);
    }
    return false;
  };
  const goto = async (url) => {
    await client.send('Page.navigate', { url: 'about:blank' });
    await sleep(300);
    await client.send('Page.navigate', { url });
  };

  /* ---------------- 0. 直接写库塞一个最小世界 ---------------- */
  await client.send('Page.navigate', { url: APP_URL });
  await sleep(1500);
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
    const wid = 'wd_docs';
    const world = { id: wid, name: '资料库测试世界', tagline: '', summary: '## 概览\\n测试用', genre: '测试',
      tone: '', themeColor: '#2f6fb0', createdAt: t, updatedAt: t };
    const cat = { id: 'ct_plc', worldId: wid, name: '地点', icon: '📍', fieldDefs: [], order: 0, createdAt: t, updatedAt: t };
    const put = (store, items) => new Promise((res, rej) => {
      const tx = db.transaction(store, 'readwrite');
      items.forEach((i) => tx.objectStore(store).put(i));
      tx.oncomplete = () => res();
      tx.onerror = () => rej(tx.error);
    });
    await put('worlds', [world]);
    await put('categories', [cat]);
    localStorage.setItem('worldforge:settings', JSON.stringify({
      ai: { provider: 'custom', baseUrl: 'http://127.0.0.1:5190/v1', apiKey: 'k', model: 'm', temperature: 0.8, contextLimit: 60, vision: true },
      activeWorldId: wid
    }));
    db.close();
    return 'seeded';
  })()`);
  check('预置测试世界', seeded === 'seeded');

  await goto(APP_URL + '#docs');
  const pageReady = await waitFor(
    `!!document.querySelector('[data-role=docs-compose-open]') && document.body.textContent.includes('资料库')`,
    20000,
  );
  check('资料库页面打开且带「直接输入」入口', pageReady);
  await shot(`${OUT}-page.png`);

  /* ---------------- 1. 入口不误触发文件选择 ---------------- */
  await evaluate(`(() => {
    window.__fileOpen = 0;
    const inp = document.querySelector('input[type=file]');
    inp.click = () => { window.__fileOpen++; };
    return 'patched';
  })()`);

  await evaluate(`document.querySelector('[data-role=docs-compose-open]').click(); 'clicked'`);
  const modalOk = await waitFor(`!!document.querySelector('[data-role=docs-compose-body]')`, 8000);
  check('弹窗打开且文本区可输入', modalOk);
  const noFileDialog = await evaluate(`window.__fileOpen === 0`);
  check('点入口没有误弹文件选择框', noFileDialog);

  /* ---------------- 2. 空内容禁用保存 ---------------- */
  const disabledEmpty = await evaluate(
    `document.querySelector('[data-role=docs-compose-save]').disabled === true`,
  );
  check('空内容时「保存为资料」禁用', disabledEmpty);

  /* ---------------- 3. 输入正文（等价于粘贴） ---------------- */
  await evaluate(`(() => {
    const ta = document.querySelector('[data-role=docs-compose-body]');
    const setter = Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, 'value').set;
    setter.call(ta, ${JSON.stringify(BODY)});
    ta.dispatchEvent(new Event('input', { bubbles: true }));
    return 'typed';
  })()`);
  const enabledNow = await waitFor(
    `document.querySelector('[data-role=docs-compose-save]').disabled === false`,
    5000,
  );
  check('输入后保存按钮可用', enabledNow);
  const charShown = await evaluate(`/\\d+ 字/.test(document.querySelector('.modal').textContent)`);
  check('弹窗内实时显示字数', charShown);
  await shot(`${OUT}-compose.png`);

  /* ---------------- 4. 保存（标题留空 → 取正文首行） ---------------- */
  await evaluate(`document.querySelector('[data-role=docs-compose-save]').click(); 'saved'`);
  const savedOk = await waitFor(
    `!document.querySelector('[data-role=docs-compose-body]') &&
     document.body.textContent.includes('北境灯塔的燃料清单')`,
    10000,
  );
  check('保存后弹窗关闭、列表出现该资料', savedOk);
  const autoNamed = await evaluate(
    `[...document.querySelectorAll('.review-item')].some(function (n) {
       return n.textContent.includes('北境灯塔的燃料清单') && /\\d+ 字/.test(n.textContent);
     })`,
  );
  check('标题自动取正文首行，且元信息正常', autoNamed);
  await shot(`${OUT}-saved.png`);

  /* ---------------- 5. 查看文本能读回内容 ---------------- */
  await evaluate(
    `[...document.querySelectorAll('.review-item button')].find(function (b) {
       return b.textContent.trim() === '查看文本';
     }).click(); 'view'`,
  );
  const readBack = await waitFor(
    `(function () {
       const m = document.querySelector('.modal');
       return !!m && m.textContent.includes('鲸油：每月两桶') && m.textContent.includes('松脂');
     })()`,
    8000,
  );
  check('查看文本能原样读回在线输入的内容', readBack);
  await evaluate(`document.querySelector('.modal-close')?.click(); 'closed'`);
  await sleep(400);

  /* ---------------- 6. 刷新后仍在 ---------------- */
  await goto(APP_URL + '#docs');
  const persisted = await waitFor(
    `document.body.textContent.includes('北境灯塔的燃料清单')`,
    20000,
  );
  check('刷新后在线输入的资料仍在（已持久化）', persisted);

  /* ---------------- 7. 回归：拖文件导入没被改坏 ---------------- */
  const dropped = await evaluate(`(async () => {
    const file = new File(['这是从文件导入的旧设定，讲的是南港的潮汐。'], '旧设定.txt', { type: 'text/plain' });
    const dt = new DataTransfer();
    dt.items.add(file);
    const zone = [...document.querySelectorAll('.card')].find(function (c) {
      return c.textContent.includes('拖到这里');
    });
    if (!zone) return 'no-zone';
    zone.dispatchEvent(new DragEvent('drop', { bubbles: true, cancelable: true, dataTransfer: dt }));
    return 'dropped';
  })()`);
  check('拖拽投放区仍在', dropped === 'dropped');
  const fileImported = await waitFor(`document.body.textContent.includes('旧设定')`, 12000);
  check('回归：上传文件路径仍能导入', fileImported);

  /* ---------------- 8. 本页 Ctrl+V 长文本 → 直接进入录入 ---------------- */
  await goto(APP_URL + '#docs');
  await waitFor(`!!document.querySelector('[data-role=docs-compose-open]')`, 20000);

  const PASTE = '南港潮汐表：每月初一、十五为大潮，灯塔补给船都挑这两天上岸卸货，其余日子只能泊在外海等潮。';
  await evaluate(`(() => {
    const dt = new DataTransfer();
    dt.setData('text/plain', ${JSON.stringify(PASTE)});
    const ev = new Event('paste', { bubbles: true });
    ev.clipboardData = dt;
    window.dispatchEvent(ev);
    return 'pasted';
  })()`);
  const pasteModal = await waitFor(`!!document.querySelector('[data-role=docs-compose-body]')`, 6000);
  check('在本页 Ctrl+V 长文本 → 直接打开录入弹窗', pasteModal);
  const pasteFilled = await evaluate(
    `document.querySelector('[data-role=docs-compose-body]').value.includes('南港潮汐表')`,
  );
  check('粘贴内容已填入正文', pasteFilled);
  await shot(`${OUT}-paste.png`);

  await evaluate(`document.querySelector('.modal-close')?.click(); 'closed'`);
  await waitFor(`!document.querySelector('[data-role=docs-compose-body]')`, 5000);
  await evaluate(`(() => {
    const dt = new DataTransfer();
    dt.setData('text/plain', '太短了');
    const ev = new Event('paste', { bubbles: true });
    ev.clipboardData = dt;
    window.dispatchEvent(ev);
    return 'pasted-short';
  })()`);
  await sleep(600);
  const shortIgnored = await evaluate(`!document.querySelector('[data-role=docs-compose-body]')`);
  check('剪贴板内容太短时不接管（不打扰普通粘贴）', shortIgnored);

  /* ---------------- 9. 没有控制台异常 ---------------- */
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
