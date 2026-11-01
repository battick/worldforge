/**
 * 临时目检：只截「AI 行为」菜单的打开态和 hover 态，验证图标/配色。
 * 用法：node .dev/shot-ai-menu.mjs
 * 前置：npm run build && node server.mjs（5188）
 */
import { spawn } from 'node:child_process';
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const CHROME = 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const APP_URL = process.env.APP_URL || 'http://127.0.0.1:5188/';
const PREFIX = '.shots/ai-menu';
const PORT = 9401;
const profile = mkdtempSync(join(tmpdir(), 'cdp-aimenu-'));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const SEED = `(async () => {
  try {
    const open = indexedDB.open('worldforge');
    const db = await new Promise((res, rej) => {
      open.onsuccess = () => res(open.result);
      open.onerror = () => rej(open.error);
    });
    const t = Date.now();
    const wid = 'wd_aimenu';
    const world = { id: wid, name: '原初宇宙', tagline: '海面每年上涨三尺',
      summary: '## 概览\\n\\n潮水逐年上涨。', genre: '低魔海洋', tone: '冷峻克制',
      themeColor: '#2f6fb0', createdAt: t, updatedAt: t };
    const cats = [
      { id: 'ct_place', worldId: wid, name: '地点', icon: '🗺️', fieldDefs: [], order: 0, createdAt: t, updatedAt: t },
    ];
    const mk = (o) => Object.assign({ worldId: wid, aliases: [], tags: [], fields: {}, status: 'canon',
      sourceRefs: [], content: '## 概览\\n\\n正文。', createdAt: t, updatedAt: t }, o);
    const entries = [
      mk({ id: 'e_a', categoryId: 'ct_place', title: '沉钟', summary: '海底的钟声。',
        time: { kind: 'point', from: '前潮纪三年', to: '', at: 3, era: '前潮纪', weight: 'minor' } }),
      mk({ id: 'e_b', categoryId: 'ct_place', title: '巡检港', summary: '母港。',
        time: { kind: 'point', from: '涨潮纪九年', to: '', at: 9, era: '涨潮纪', weight: 'major' } }),
    ];
    await new Promise((res, rej) => {
      const tx = db.transaction(['worlds', 'categories', 'entries', 'relations', 'review'], 'readwrite');
      tx.objectStore('worlds').put(world);
      cats.forEach((c) => tx.objectStore('categories').put(c));
      entries.forEach((e) => tx.objectStore('entries').put(e));
      tx.oncomplete = res; tx.onerror = () => rej(tx.error);
    });
    localStorage.setItem('worldforge:settings', JSON.stringify({
      ai: { provider: 'custom', baseUrl: 'http://127.0.0.1:5190/v1', apiKey: 'k', model: 'm',
            temperature: 0.8, contextLimit: 60, vision: true }, activeWorldId: wid }));
    db.close();
    return 'seeded';
  } catch (e) { return 'seed-failed: ' + (e && e.message); }
})()`;

const chrome = spawn(CHROME, [
  '--headless=new', '--disable-gpu', '--no-sandbox', '--no-first-run',
  '--disable-extensions', `--remote-debugging-port=${PORT}`, `--user-data-dir=${profile}`,
  '--window-size=1560,1080', 'about:blank',
], { stdio: 'ignore' });

async function waitForDevtools() {
  for (let i = 0; i < 80; i++) {
    try { if ((await fetch(`http://127.0.0.1:${PORT}/json/version`)).ok) return; } catch {}
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
    ws.onerror = () => rej(new Error('ws failed'));
  });
  ws.onmessage = (ev) => {
    const msg = JSON.parse(ev.data);
    if (msg.id && pending.has(msg.id)) {
      const { resolve, reject } = pending.get(msg.id);
      pending.delete(msg.id);
      msg.error ? reject(new Error(JSON.stringify(msg.error))) : resolve(msg.result);
    }
  };
  const send = (method, params = {}) => new Promise((resolve, reject) => {
    const mid = ++id;
    pending.set(mid, { resolve, reject });
    ws.send(JSON.stringify({ id: mid, method, params }));
  });
  return { ready, send, close: () => ws.close() };
}

try {
  mkdirSync('.shots', { recursive: true });
  await waitForDevtools();
  const targets = await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json();
  const client = makeClient(targets.find((t) => t.type === 'page').webSocketDebuggerUrl);
  await client.ready;
  await client.send('Page.enable');
  await client.send('Runtime.enable');

  const evaluate = async (expression) => {
    const r = await client.send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true });
    if (r.exceptionDetails) throw new Error(JSON.stringify(r.exceptionDetails).slice(0, 500));
    return r.result?.value;
  };
  const clipShot = async (file, expr) => {
    const box = JSON.parse(await evaluate(expr));
    if (!box) return;
    const s = await client.send('Page.captureScreenshot', {
      format: 'png', captureBeyondViewport: true, clip: { ...box, scale: 2 } });
    writeFileSync(file, Buffer.from(s.data, 'base64'));
    console.log('  截图 →', file);
  };

  await client.send('Page.navigate', { url: `${APP_URL}?chron=1#graph` });
  await sleep(3500);
  console.log('预置:', await evaluate(SEED));
  await client.send('Page.reload');
  await sleep(3500);
  await evaluate(`document.querySelector('[data-role=graph-view-chronicle]').click(); 'ok'`);
  await sleep(1400);

  // 打开 AI 行为菜单
  await evaluate(`document.querySelector('[data-role=chron-ai-toggle]').click(); 'ok'`);
  await sleep(500);
  await clipShot(`${PREFIX}-open.png`, `JSON.stringify((() => {
    const d = document.querySelector('[data-role=chron-ai-pop]').getBoundingClientRect();
    return { x: Math.round(d.left) - 12, y: Math.round(d.top) - 12,
             width: Math.round(d.width) + 24, height: Math.round(d.height) + 24 };
  })())`);

  // hover 第二条（猜时间）—— CSS :hover 只认真实指针，得用 CDP 派发鼠标移动
  const hb = JSON.parse(await evaluate(`JSON.stringify((() => {
    const d = document.querySelector('[data-role=chron-ai-guess]').getBoundingClientRect();
    return { x: Math.round(d.left + d.width / 2), y: Math.round(d.top + d.height / 2) };
  })())`));
  await client.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: hb.x, y: hb.y });
  await sleep(300);
  await clipShot(`${PREFIX}-hover.png`, `JSON.stringify((() => {
    const d = document.querySelector('[data-role=chron-ai-pop]').getBoundingClientRect();
    return { x: Math.round(d.left) - 12, y: Math.round(d.top) - 12,
             width: Math.round(d.width) + 24, height: Math.round(d.height) + 24 };
  })())`);

  client.close();
  chrome.kill();
  console.log('完成');
} catch (e) {
  console.error('失败:', e.message);
  chrome.kill();
  process.exit(1);
}
