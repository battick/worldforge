/**
 * i18n 端到端验证（开发期脚本，不属于产品代码）
 *
 * 用真实 Chrome（CDP）验证：
 *   1. 默认（跟随系统）渲染成中文，<html lang> 与标题同步；
 *   2. 在「设置 → 界面语言」里点 English 后，整个界面立刻切到英文；
 *   3. 偏好写进 localStorage，刷新后仍然生效；
 *   4. 切回「跟随系统」会清掉偏好；
 *   5. 起始页（没有世界时的引导页）也跟随语言切换；
 *   6. 全程没有页面报错。
 *
 * 用法：
 *   node .dev/e2e-i18n.mjs [baseUrl]        # 默认 http://127.0.0.1:4173
 */
import { spawn } from 'node:child_process';
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const CHROME = 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const BASE = process.argv[2] ?? 'http://127.0.0.1:4173';
const PORT = 9335;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const failures = [];
const check = (name, ok, detail = '') => {
  console.log(`${ok ? '  ✓' : '  ✗'} ${name}${ok || !detail ? '' : `  →  ${detail}`}`);
  if (!ok) failures.push(name);
};

const profile = mkdtempSync(join(tmpdir(), 'cdp-i18n-'));
const chrome = spawn(
  CHROME,
  [
    '--headless=new',
    '--disable-gpu',
    '--no-sandbox',
    '--hide-scrollbars',
    '--no-first-run',
    '--disable-extensions',
    '--lang=zh-CN',
    `--remote-debugging-port=${PORT}`,
    `--user-data-dir=${profile}`,
    '--window-size=1440,920',
    'about:blank',
  ],
  { stdio: 'ignore' },
);

function makeClient(wsUrl) {
  const ws = new WebSocket(wsUrl);
  let id = 0;
  const pending = new Map();
  const events = [];
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
  const ready = new Promise((resolve, reject) => {
    ws.onopen = () => resolve();
    ws.onerror = (e) => reject(new Error('WebSocket 连接失败: ' + e.message));
  });
  return { ready, send, events, close: () => ws.close() };
}

async function waitForDevtools() {
  for (let i = 0; i < 80; i++) {
    try {
      if ((await fetch(`http://127.0.0.1:${PORT}/json/version`)).ok) return;
    } catch {
      /* not up yet */
    }
    await sleep(250);
  }
  throw new Error('DevTools 端口未就绪');
}

try {
  await waitForDevtools();
  const targets = await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json();
  const page = targets.find((t) => t.type === 'page');
  const client = makeClient(page.webSocketDebuggerUrl);
  await client.ready;
  await client.send('Page.enable');
  await client.send('Runtime.enable');
  await client.send('Log.enable').catch(() => {});
  await client.send('Emulation.setLocaleOverride', { locale: 'zh-CN' }).catch(() => {});

  const evalJs = async (expression) => {
    const r = await client.send('Runtime.evaluate', {
      expression,
      returnByValue: true,
      awaitPromise: true,
    });
    if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description ?? 'eval failed');
    return r.result?.value;
  };

  const SNAP = `(() => ({
    lang: document.documentElement.lang,
    title: document.title,
    h1: document.querySelector('h1.page-title')?.textContent?.trim() ?? null,
    nav: [...document.querySelectorAll('.nav-item')].map((b) => b.textContent.trim()).join('|'),
    body: document.body.innerText,
    stored: localStorage.getItem('worldforge:locale'),
    cards: [...document.querySelectorAll('.card-title')].map((e) => e.textContent.trim()).join('|'),
  }))()`;

  const SHOTS = '.shots';
  const shot = async (name) => {
    mkdirSync(SHOTS, { recursive: true });
    const s = await client.send('Page.captureScreenshot', { format: 'png' });
    const p = `${SHOTS}/i18n-${name}.png`;
    writeFileSync(p, Buffer.from(s.data, 'base64'));
    console.log(`  截图 → ${p}`);
  };

  const ORIGIN = new URL(BASE).origin;
  const goto = async (hash) => {
    const nav = await client.send('Page.navigate', { url: `${BASE}/${hash}` });
    let lastErr = '';
    let lastState = '';
    // 导航后执行上下文会换新，轮询到目标源上的文档就绪为止
    for (let i = 0; i < 60; i++) {
      await sleep(250);
      try {
        const state = await evalJs(
          `location.origin === ${JSON.stringify(ORIGIN)} ? document.readyState : 'blank'`,
        );
        lastState = String(state);
        if (state === 'complete' || state === 'interactive') {
          await sleep(1100);
          return await evalJs(SNAP);
        }
      } catch (e) {
        lastErr = e.message;
      }
    }
    console.error('navigate result:', JSON.stringify(nav));
    console.error('last state:', lastState, '| last error:', lastErr);
    console.error(
      'recent events:',
      client.events.slice(-8).map((e) => e.method).join(', '),
    );
    throw new Error(`页面没有就绪：${BASE}/${hash}`);
  };
  const clickText = (text, sel = 'button') => evalJs(`(() => {
    const el = [...document.querySelectorAll(${JSON.stringify(sel)})]
      .find((b) => b.textContent.trim() === ${JSON.stringify(text)});
    if (!el) return false;
    el.click();
    return true;
  })()`);

  console.log('\n[1] 默认语言（跟随系统，headless 设为 zh-CN）');
  let s = await goto('#settings');
  check('<html lang> = zh-CN', s.lang === 'zh-CN', s.lang);
  check('标题为中文', s.title === 'WorldForge · 个人世界观知识库', s.title);
  check('设置页标题为「设置」', s.h1 === '设置', String(s.h1));
  check('侧栏导航为中文', s.nav.includes('设置') && s.nav.includes('世界总览'), s.nav.slice(0, 60));
  check('界面语言卡片存在', s.cards.includes('界面语言'), s.cards);
  check('没有写入 locale 偏好（跟随系统）', s.stored === null, String(s.stored));
  await shot('settings-zh');

  console.log('\n[2] 点 English 切换到英文');
  check('找到 English 按钮并点击', await clickText('English'));
  await sleep(700);
  s = await evalJs(SNAP);
  check('<html lang> = en', s.lang === 'en', s.lang);
  check('标题变英文', s.title === 'WorldForge · Personal Worldbuilding Library', s.title);
  check('设置页标题变 Settings', s.h1 === 'Settings', String(s.h1));
  check('侧栏导航变英文', s.nav.includes('Settings') && s.nav.includes('World overview'), s.nav.slice(0, 80));
  check('语言卡片变 Interface language', s.cards.includes('Interface language'), s.cards);
  check('偏好写入 localStorage', s.stored === 'en-US', String(s.stored));
  await shot('settings-en');

  console.log('\n[3] 刷新后仍为英文（持久化）');
  s = await goto('#settings');
  check('刷新后标题仍为英文', s.title === 'WorldForge · Personal Worldbuilding Library', s.title);
  check('刷新后导航仍为英文', s.nav.includes('Settings'), s.nav.slice(0, 60));

  console.log('\n[4] 起始页也跟随语言');
  s = await goto('');
  check('起始页渲染为英文', s.body.includes('Drop in whatever you have'), s.body.slice(0, 90));
  await shot('start-en');

  console.log('\n[5] 切回「跟随系统」');
  await goto('#settings');
  check('找到 Follow system 按钮并点击', await clickText('Follow system'));
  await sleep(700);
  s = await evalJs(SNAP);
  check('去掉 locale 偏好', s.stored === null, String(s.stored));
  check('跟随系统后回到中文（headless 语言为 zh-CN）', s.lang === 'zh-CN', s.lang);
  check('设置页标题回到「设置」', s.h1 === '设置', String(s.h1));

  console.log('\n[6] 页面错误');
  const errors = [];
  for (const e of client.events) {
    if (e.method === 'Runtime.exceptionThrown') {
      errors.push('EXCEPTION: ' + (e.params.exceptionDetails?.exception?.description ?? ''));
    } else if (e.method === 'Log.entryAdded' && e.params.entry.level === 'error') {
      errors.push('LOG: ' + e.params.entry.text);
    } else if (e.method === 'Runtime.consoleAPICalled' && e.params.type === 'error') {
      errors.push('CONSOLE: ' + e.params.args.map((a) => a.value ?? a.description).join(' '));
    }
  }
  // 页面没有 favicon，浏览器会自动请求 /favicon.ico 并拿到 404 —— 与本次验证无关
  const real = errors.filter((t) => !/Failed to load resource.*404/i.test(t));
  const missing = real.filter((t) => /\[i18n\]/.test(t));
  check('没有控制台报错', real.length === 0, real.slice(0, 5).join(' / '));
  check('没有缺失文案告警', missing.length === 0, missing.slice(0, 5).join(' / '));

  client.close();
} finally {
  chrome.kill();
}

console.log('');
if (failures.length) {
  console.error(`i18n e2e 失败：${failures.length} 项`);
  failures.forEach((f) => console.error('  - ' + f));
  process.exit(1);
}
console.log('i18n e2e 全部通过。');
