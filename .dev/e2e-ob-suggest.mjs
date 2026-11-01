/**
 * 开发期端到端验证：新建世界里那排「点一下就能直接填」的建议答案
 *
 * 覆盖：
 *   1. AI 读懂素材并追问后，问题下面带着建议答案
 *   2. 点「换一批」→ 只换这一个问题的建议，问题本身不动
 *   3. 再点一次还能继续换（每次都真的变了）
 *
 * 前置：
 *   node server.mjs                 （5188，需已构建最新 dist）
 *   node .dev/mock-upstream.mjs 5190
 * 用法：node .dev/e2e-ob-suggest.mjs
 */
import { spawn } from 'node:child_process';
import { writeFileSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const CHROME = 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const APP_URL = 'http://127.0.0.1:5188/';
const MOCK_URL = 'http://127.0.0.1:5190/v1';
const OUT = '.shots/ob-suggest';
const PORT = 9374;
const profile = mkdtempSync(join(tmpdir(), 'cdp-obsg-'));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const MATERIAL =
  '我一直在写一个关于灯塔的故事。海每年上涨三尺，已经涨了四百年。\n' +
  '灯塔是现存最高的人工建筑，也是唯一还按旧历报时的地方。守塔人每天报两次时。';

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
  const click = async (label) =>
    evaluate(`(() => {
      const b = [...document.querySelectorAll('button')].find(function (x) {
        return x.textContent.includes(${JSON.stringify(label)});
      });
      if (!b) return 'not-found';
      b.click();
      return 'ok';
    })()`);
  /** 第一个问题当前的建议答案 */
  const firstSuggest = `JSON.stringify(
    [...document.querySelectorAll('.ob-q')[0].querySelectorAll('.ob-suggest')].map(function (b) {
      return b.textContent.trim();
    })
  )`;

  /* ---------------- 0. 配好假上游 ---------------- */
  await client.send('Page.navigate', { url: APP_URL });
  await sleep(1500);
  await evaluate(`localStorage.setItem('worldforge:settings', JSON.stringify({
    ai: { provider: 'custom', baseUrl: '${MOCK_URL}', apiKey: 'k', model: 'm', temperature: 0.8, contextLimit: 60, vision: true }
  }))`);
  await client.send('Page.navigate', { url: APP_URL + '?e2e=obsg' });
  await sleep(3500);

  /* ---------------- 1. 进入工作台并投喂 ---------------- */
  check('点击「开始新建世界」', (await click('开始新建世界')) === 'ok');
  await sleep(1200);
  check('共创工作台已打开', await evaluate(`!!document.querySelector('.ob')`));

  await evaluate(`(() => {
    const ta = document.querySelector('.ob-composer textarea');
    const setter = Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, 'value').set;
    setter.call(ta, ${JSON.stringify(MATERIAL)});
    ta.dispatchEvent(new Event('input', { bubbles: true }));
    return 'ok';
  })()`);
  check('加进素材', (await click('加进素材')) === 'ok');

  check('点击「让 AI 读一遍」', (await click('让 AI 读一遍')) === 'ok');
  const asked = await waitFor(`document.querySelectorAll('.ob-q').length > 0`, 60000);
  check('AI 给出了追问', asked);
  const questionBefore = await evaluate(`document.querySelector('.ob-q .ob-q-title').textContent`);
  const before = JSON.parse(await evaluate(firstSuggest));
  check('追问下面带着建议答案', before.length > 0, before.join(' / ').slice(0, 60));
  await shot(`${OUT}-asked.png`);

  /* ---------------- 2. 换一批 ---------------- */
  check(
    '点「换一批」',
    (await evaluate(`document.querySelector('[data-role=ob-suggest-refresh]').click(); 'ok'`)) ===
      'ok',
  );
  const changed = await waitFor(
    `JSON.stringify([...document.querySelectorAll('.ob-q')[0].querySelectorAll('.ob-suggest')].map(function (b) { return b.textContent.trim(); })) !== ${JSON.stringify(
      JSON.stringify(before),
    )}`,
    20000,
  );
  check('建议换了一批（内容与之前不同）', changed);
  const after = JSON.parse(await evaluate(firstSuggest));
  check('换后仍然有建议（不是变空）', after.length > 0, after.join(' / ').slice(0, 60));
  const questionAfter = await evaluate(`document.querySelector('.ob-q .ob-q-title').textContent`);
  check('问题本身没被动过（只换建议）', questionAfter === questionBefore, questionAfter);
  await shot(`${OUT}-refreshed.png`);

  /* ---------------- 3. 再点一次还能继续换 ---------------- */
  await evaluate(`document.querySelector('[data-role=ob-suggest-refresh]').click(); 'ok'`);
  const changedAgain = await waitFor(
    `JSON.stringify([...document.querySelectorAll('.ob-q')[0].querySelectorAll('.ob-suggest')].map(function (b) { return b.textContent.trim(); })) !== ${JSON.stringify(
      JSON.stringify(after),
    )}`,
    20000,
  );
  check('再点一次仍能换出新的（不是只换一次）', changedAgain);

  /* ---------------- 4. 没有未捕获异常 ---------------- */
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
