/**
 * 开发期截图工具（不属于产品代码）
 * 通过 Chrome DevTools Protocol 打开页面、等待渲染、截图并抓取可见文本。
 *
 * 用法：node .dev/shot.mjs <url> <outPng> [waitMs] [width] [height]
 */
import { spawn } from 'node:child_process';
import { writeFileSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const CHROME = 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const [, , url, outPng, waitMsArg = '3500', wArg = '1440', hArg = '920', evalBefore = ''] =
  process.argv;
const waitMs = Number(waitMsArg);
const width = Number(wArg);
const height = Number(hArg);
const PORT = 9333;

const profile = mkdtempSync(join(tmpdir(), 'cdp-shot-'));

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
    `--window-size=${width},${height}`,
    'about:blank',
  ],
  { stdio: 'ignore' },
);

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function waitForDevtools() {
  for (let i = 0; i < 60; i++) {
    try {
      const res = await fetch(`http://127.0.0.1:${PORT}/json/version`);
      if (res.ok) return;
    } catch {
      /* not up yet */
    }
    await sleep(250);
  }
  throw new Error('DevTools 端口未就绪');
}

function makeClient(wsUrl) {
  const ws = new WebSocket(wsUrl);
  let id = 0;
  const pending = new Map();
  const ready = new Promise((resolve, reject) => {
    ws.onopen = () => resolve();
    ws.onerror = (e) => reject(new Error('WebSocket 连接失败: ' + e.message));
  });
  const events = [];
  ws.onmessage = (ev) => {
    const msg = JSON.parse(ev.data);
    if (msg.id && pending.has(msg.id)) {
      const { resolve, reject } = pending.get(msg.id);
      pending.delete(msg.id);
      msg.error ? reject(new Error(JSON.stringify(msg.error))) : resolve(msg.result);
    } else if (msg.method) {
      events.push(msg);
      // 原生 confirm() 会阻塞无头页面，这里自动点「确定」
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
  await waitForDevtools();
  const targets = await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json();
  const page = targets.find((t) => t.type === 'page');
  if (!page) throw new Error('没有找到页面目标');

  const client = makeClient(page.webSocketDebuggerUrl);
  await client.ready;
  await client.send('Page.enable');
  await client.send('Runtime.enable');

  const errors = [];
  await client.send('Log.enable').catch(() => {});

  await client.send('Page.navigate', { url });
  await sleep(waitMs);

  if (evalBefore) {
    const r = await client.send('Runtime.evaluate', {
      expression: evalBefore,
      returnByValue: true,
      awaitPromise: true,
    });
    console.log('--- 交互脚本结果 ---');
    console.log(JSON.stringify(r.result?.value ?? r.result));
    await sleep(1200);
  }

  const textRes = await client.send('Runtime.evaluate', {
    expression: 'document.body ? document.body.innerText.slice(0, 2000) : ""',
    returnByValue: true,
  });

  const shot = await client.send('Page.captureScreenshot', {
    format: 'png',
    captureBeyondViewport: false,
  });
  writeFileSync(outPng, Buffer.from(shot.data, 'base64'));

  console.log('URL:', url);
  console.log('--- 可见文本 ---');
  console.log((textRes.result?.value ?? '(空)').slice(0, 1500));

  // 采集控制台 / 页面运行时错误
  for (const e of client.events) {
    if (e.method === 'Runtime.exceptionThrown') {
      errors.push('EXCEPTION: ' + (e.params.exceptionDetails?.exception?.description ?? ''));
    } else if (e.method === 'Log.entryAdded' && e.params.entry.level === 'error') {
      errors.push('LOG: ' + e.params.entry.text);
    } else if (e.method === 'Runtime.consoleAPICalled' && e.params.type === 'error') {
      errors.push('CONSOLE: ' + e.params.args.map((a) => a.value ?? a.description).join(' '));
    }
  }
  console.log('--- 页面错误 (' + errors.length + ') ---');
  console.log(errors.length ? errors.slice(0, 10).join('\n') : '(无)');

  console.log('--- 截图已保存 ---');
  console.log(outPng);
  client.close();
} finally {
  chrome.kill();
}
