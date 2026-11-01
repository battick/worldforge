/**
 * 开发期端到端验证：杂物间（pieces）
 *
 * 覆盖：
 *   1. 碎片速记：输入一句话回车 → 卡片出现
 *   2. 图片拖拽入库：DataTransfer 合成 drop 事件 → 缩略图卡片出现
 *   3. 查看弹窗：Markdown 正文渲染、媒体显示
 *   4. 编辑：改标题/标签、关联条目 → 保存后弹窗展示相关条目按钮
 *   5. 置顶：置顶卡片排到最前
 *   6. 刷新后数据仍在（IndexedDB 持久化 + Blob 存活）
 *
 * 前置：node server.mjs（默认 5188，需已构建最新 dist）
 * 用法：node .dev/e2e-pieces.mjs
 */
import { spawn } from 'node:child_process';
import { writeFileSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const CHROME = 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const APP_URL = 'http://127.0.0.1:5188/';
const OUT = '.shots/pieces';
const PORT = 9366;
const profile = mkdtempSync(join(tmpdir(), 'cdp-pieces-'));
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
    } else if (msg.method === 'Page.javascriptDialogOpening') {
      ws.send(JSON.stringify({ id: ++id, method: 'Page.handleJavaScriptDialog', params: { accept: true } }));
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
  const waitFor = async (expr, timeout = 20000, step = 300) => {
    const t0 = Date.now();
    while (Date.now() - t0 < timeout) {
      if (await evaluate(expr)) return true;
      await sleep(step);
    }
    return false;
  };
  /** 走 about:blank 中转，确保是真正的整页加载（直接改 hash 属于同文档跳转，不会重载） */
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
    const wid = 'wd_pz';
    const world = { id: wid, name: '杂物间测试世界', tagline: '', summary: '## 概览\\n测试用', genre: '测试',
      tone: '', themeColor: '#2f6fb0', createdAt: t, updatedAt: t };
    const cat = { id: 'ct_ppl', worldId: wid, name: '人物', icon: '👤', fieldDefs: [], order: 0, createdAt: t, updatedAt: t };
    const ent = { id: 'en_hero', worldId: wid, categoryId: 'ct_ppl', title: '灯塔看守', aliases: [], summary: '守塔人',
      content: '## 概览\\n守塔人。', tags: [], fields: {}, status: 'canon', sourceRefs: [], createdAt: t, updatedAt: t };
    const put = (store, items) => new Promise((res, rej) => {
      const tx = db.transaction(store, 'readwrite');
      items.forEach((i) => tx.objectStore(store).put(i));
      tx.oncomplete = () => res();
      tx.onerror = () => rej(tx.error);
    });
    await put('worlds', [world]);
    await put('categories', [cat]);
    await put('entries', [ent]);
    localStorage.setItem('worldforge:settings', JSON.stringify({
      ai: { provider: 'custom', baseUrl: 'http://127.0.0.1:5190/v1', apiKey: 'k', model: 'm', temperature: 0.8, contextLimit: 60, vision: true },
      activeWorldId: wid
    }));
    db.close();
    return 'seeded';
  })()`);
  check('预置测试世界', seeded === 'seeded');

  await goto(APP_URL + '#pieces');
  const pageReady = await waitFor(`document.body.textContent.includes('杂物间') && !!document.querySelector('.pz-quick')`, 20000);
  check('杂物间页面打开', pageReady);
  await shot(`${OUT}-page.png`);

  /* ---------------- 1. 碎片速记 ---------------- */
  await evaluate(`(() => {
    const input = document.querySelector('.pz-quick input');
    const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
    setter.call(input, '北境的雪其实是有味道的，像铁锈');
    input.dispatchEvent(new Event('input', { bubbles: true }));
    return 'typed';
  })()`);
  await evaluate(`[...document.querySelectorAll('.pz-quick button')].find(b => b.textContent.includes('存下')).click(); 'ok'`);
  const fragOk = await waitFor(`document.body.textContent.includes('北境的雪其实是有味道的')`, 8000);
  check('碎片速记：一句话入库并出现在卡片里', fragOk);

  /* ---------------- 2. 图片拖拽入库 ---------------- */
  const dropped = await evaluate(`(async () => {
    // 1x1 红色 PNG
    const b64 = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';
    const res = await fetch('data:image/png;base64,' + b64);
    const blob = await res.blob();
    const file = new File([blob], '灯塔.png', { type: 'image/png' });
    const dt = new DataTransfer();
    dt.items.add(file);
    const zone = document.querySelector('.pz-drop');
    zone.dispatchEvent(new DragEvent('drop', { bubbles: true, cancelable: true, dataTransfer: dt }));
    return 'dropped';
  })()`);
  check('图片通过 drop 事件投入', dropped === 'dropped');
  const imgOk = await waitFor(`document.body.textContent.includes('灯塔')`, 10000);
  check('图片卡片出现', imgOk);
  await shot(`${OUT}-cards.png`);

  /* ---------------- 3. 查看碎片弹窗 ---------------- */
  await evaluate(`[...document.querySelectorAll('.pz-card')].find(c => c.textContent.includes('北境的雪')).click(); 'ok'`);
  const modalOk = await waitFor(`!!document.querySelector('.modal') && document.querySelector('.modal').textContent.includes('铁锈')`, 8000);
  check('查看弹窗打开且正文可见', modalOk);

  /* ---------------- 4. 编辑：关联条目 + 标签 ---------------- */
  await evaluate(`[...document.querySelectorAll('.modal button')].find(b => b.textContent.includes('编辑')).click(); 'ok'`);
  const editorOk = await waitFor(`document.body.textContent.includes('相关条目')`, 8000);
  check('编辑弹窗打开（含关联条目区）', editorOk);
  await evaluate(`(() => {
    const box = [...document.querySelectorAll('.pz-entry-pick input[type=checkbox]')][0];
    box.click();
    const tagInput = [...document.querySelectorAll('.modal input')].find(i => (i.placeholder || '').includes('未用上'));
    const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
    setter.call(tagInput, '灵感, 北境');
    tagInput.dispatchEvent(new Event('input', { bubbles: true }));
    return 'ok';
  })()`);
  await evaluate(`[...document.querySelectorAll('.modal button')].find(b => b.textContent.trim() === '保存').click(); 'ok'`);
  const saved = await waitFor(
    `(function(){ const m = document.querySelector('.modal'); return !!m && m.textContent.includes('相关条目') && m.textContent.includes('灯塔看守'); })()`,
    10000,
  );
  check('保存后弹窗展示关联条目「灯塔看守」', saved);
  await shot(`${OUT}-linked.png`);
  await evaluate(`document.querySelector('.modal-close')?.click(); 'closed'`);

  /* ---------------- 5. 置顶 ---------------- */
  await evaluate(`[...document.querySelectorAll('.pz-card')].find(c => c.textContent.includes('北境的雪')).click(); 'ok'`);
  await waitFor(`!!document.querySelector('.modal')`, 8000);
  await evaluate(`[...document.querySelectorAll('.modal button')].find(b => b.textContent.includes('置顶') && !b.textContent.includes('取消')).click(); 'ok'`);
  const pinnedFirst = await waitFor(
    `document.querySelectorAll('.pz-card')[0].textContent.includes('北境的雪')`,
    8000,
  );
  check('置顶后排到第一位', pinnedFirst);
  await evaluate(`document.querySelector('.modal-close')?.click(); 'closed'`);

  /* ---------------- 6. 刷新后仍在（持久化 + Blob 存活） ---------------- */
  await goto(APP_URL + '#pieces');
  const persisted = await waitFor(
    `document.body.textContent.includes('北境的雪其实是有味道的') && document.body.textContent.includes('灯塔')`,
    20000,
  );
  check('刷新后文字碎片与图片都还在（媒体 Blob 持久化）', persisted);

  // 图片弹窗里能渲染出 <img>（对象 URL 正常生成）
  await evaluate(`[...document.querySelectorAll('.pz-card')].find(c => c.textContent.includes('灯塔')).click(); 'ok'`);
  const imgRendered = await waitFor(`!!document.querySelector('.modal img')`, 8000);
  check('图片弹窗渲染出原图', imgRendered);
  await shot(`${OUT}-image.png`);

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
