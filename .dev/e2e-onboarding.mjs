/**
 * 开发期端到端验证：新建世界（共创流程）
 *
 * 这条链路是产品的第一入口，必须真机验证：
 *   投喂素材（文字 / 规则 / 图片） → AI 读懂并提问 → 用户回答 → 生成草案
 *   → 提意见修订 → 二次确认 → 真正建库 → 素材进入资料库
 *   → 接着跑一次既有的「生成 → 审查 → 采纳」链路，确认没被改坏
 *
 * 前置：
 *   node server.mjs --port 5188
 *   node .dev/mock-upstream.mjs 5190     （不加 --cors，强制走本机转发）
 *
 * 用法：node .dev/e2e-onboarding.mjs <appUrl> <mockBaseUrl> <outPrefix>
 */
import { spawn } from 'node:child_process';
import { writeFileSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { deflateSync } from 'node:zlib';

const CHROME = 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const [
  ,
  ,
  APP_URL = 'http://127.0.0.1:5188/',
  MOCK_BASE = 'http://127.0.0.1:5190/v1',
  OUT = '.shots/onb',
] = process.argv;
const MOCK_ORIGIN = new URL(MOCK_BASE).origin;

const PORT = 9351;
const profile = mkdtempSync(join(tmpdir(), 'cdp-onb-'));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const results = [];
const check = (name, ok, detail = '') => {
  results.push({ name, ok, detail });
  console.log(`  ${ok ? '✓' : '✗'} ${name}${detail ? ' — ' + detail : ''}`);
};

/* ---------------- 造一张真图片（用于验证读图链路） ---------------- */

function crc32(buf) {
  let c;
  const table = [];
  for (let n = 0; n < 256; n++) {
    c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c >>> 0;
  }
  let crc = 0xffffffff;
  for (const b of buf) crc = table[(crc ^ b) & 0xff] ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([len, body, crc]);
}

/** 生成一张 420x260 的渐变 PNG */
function makePng(path, w = 420, h = 260) {
  const raw = Buffer.alloc((w * 3 + 1) * h);
  let p = 0;
  for (let y = 0; y < h; y++) {
    raw[p++] = 0; // filter: none
    for (let x = 0; x < w; x++) {
      raw[p++] = Math.round((x / w) * 90 + (y / h) * 20);
      raw[p++] = Math.round(120 + (y / h) * 110);
      raw[p++] = Math.round(180 - (x / w) * 70);
    }
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0);
  ihdr.writeUInt32BE(h, 4);
  ihdr[8] = 8;
  ihdr[9] = 2; // truecolor
  const png = Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw)),
    chunk('IEND', Buffer.alloc(0)),
  ]);
  writeFileSync(path, png);
  return path;
}

const imgPath = join(profile, 'reference.png');
makePng(imgPath);

/* ---------------- CDP ---------------- */

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
    } else if (msg.method) {
      events.push(msg);
      if (msg.method === 'Page.javascriptDialogOpening') {
        console.log('  [dialog]', msg.params.type, '→ 自动确认');
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

async function main() {
  // 假上游的统计是**跨脚本累加**的：同一个 mock 进程被别的 e2e（比如工作台 agent）
  // 先跑过一轮，它的计数就会留在 byBranch 里。本节末尾要断言 unknown === 0，
  // 如果不清零，别处留下的 unknown 会被算到本脚本头上 —— 一个纯粹由「跑测试的顺序」
  // 决定的假失败。开跑前先把计数清零，让这段断言只反映本次运行。
  await fetch(`${MOCK_ORIGIN}/__mock-stats/reset`).catch(() => {});
  // 延迟也是**跨脚本共享**的（`/__mock-delay`），而且比计数更阴：计数只影响断言，
  // 延迟会真改回包时序。这一支不需要任何延迟，所以开跑前把它归零 ——
  // 上一支脚本若中途挂了没打扫，这里也不会跟着遭殃。
  // （真踩过：e2e-queue 留下的 900ms 把「让 AI 读一遍」搅成空回包，
  //   一堆和队列毫不相干的红，排查了半天才发现是顺序问题。）
  await fetch(`${MOCK_ORIGIN}/__mock-delay?ms=0`).catch(() => {});

  await waitForDevtools();
  const targets = await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json();
  const client = makeClient(targets.find((t) => t.type === 'page').webSocketDebuggerUrl);
  await client.ready;
  await client.send('Page.enable');
  await client.send('Runtime.enable');
  await client.send('Log.enable').catch(() => {});
  await client.send('DOM.enable');

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

  const click = async (text, exact = false) =>
    evaluate(`(() => {
      const btns = [...document.querySelectorAll('button')];
      const b = btns.find(x => ${exact ? `x.textContent.trim() === ${JSON.stringify(text)}` : `x.textContent.includes(${JSON.stringify(text)})`});
      if (!b) return 'MISSING';
      if (b.disabled) return 'DISABLED';
      b.click();
      return 'ok';
    })()`);

  /** 轮询等待某个条件成立 */
  const waitFor = async (expr, timeout = 60000, step = 500) => {
    const t0 = Date.now();
    while (Date.now() - t0 < timeout) {
      if (await evaluate(expr)) return true;
      await sleep(step);
    }
    return false;
  };
  const textOf = (sel) => evaluate(`document.querySelector(${JSON.stringify(sel)})?.textContent ?? ''`);

  /* ---------------- 1. 打开应用 ---------------- */
  await client.send('Page.navigate', { url: APP_URL });
  await sleep(4000);

  // 注入 AI 配置（指向假上游，无 CORS 头 → 走本机转发）
  await evaluate(`(() => {
    localStorage.setItem('worldforge:settings', JSON.stringify({
      ai: {
        provider: 'custom',
        baseUrl: ${JSON.stringify(MOCK_BASE)},
        apiKey: 'mock-key-for-e2e',
        model: 'mock-model',
        temperature: 0.8,
        contextLimit: 60,
        vision: true
      },
      activeWorldId: null
    }));
    return 'ok';
  })()`);

  // 整页重载（仅改 hash 不会重新挂载）
  await client.send('Page.navigate', { url: APP_URL.replace(/\/$/, '') + '/?e2e=onb' });
  await sleep(4000);

  const boot = await evaluate(`JSON.stringify({
    hasSidebar: !!document.querySelector('.sidebar'),
    worldName: document.querySelector('.world-switch-name')?.textContent ?? '',
    startHeading: document.querySelector('.page-title')?.textContent ?? ''
  })`);
  console.log('\n[1] 首屏（应无任何世界）：', boot);
  check('演示世界已移除，首屏为空状态引导', boot.includes('还没有世界'));
  check('空状态给出「开始新建世界」入口', await evaluate(`!!document.querySelector('.ob-hello')`));
  await shot(`${OUT}-1-start.png`);

  /* ---------------- 2. 进入新建世界 ---------------- */
  check('点击「开始新建世界」', (await click('开始新建世界')) === 'ok');
  await sleep(1200);
  check('共创工作台已打开', await evaluate(`!!document.querySelector('.ob')`));
  check(
    '开场文案不是表单（说明「先别急着想清楚」）',
    (await textOf('.ob-hello-title')).includes('先别急着想清楚'),
  );
  await shot(`${OUT}-2-workbench.png`);

  /* ---------------- 3. 投喂素材 ---------------- */
  const paste = async (text, mode) => {
    if (mode) await click(mode);
    await evaluate(`(() => {
      const ta = document.querySelector('.ob-composer textarea');
      const setter = Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, 'value').set;
      setter.call(ta, ${JSON.stringify(text)});
      ta.dispatchEvent(new Event('input', { bubbles: true }));
      return 'ok';
    })()`);
    return click('加进素材');
  };

  check(
    '粘贴一段旧稿',
    (await paste(
      '我一直在写一个关于灯塔的故事。海每年上涨三尺，已经涨了四百年。\n' +
        '灯塔是现存最高的人工建筑，也是唯一还按旧历报时的地方。守塔人每天报两次时。\n' +
        '城邦为此常年争吵，因为谁掌握灯塔，谁就掌握「现在几点」。',
    )) === 'ok',
  );
  check(
    '现写一条规则',
    (await paste('水不可逆，涨落由物候决定；不要出现现代科技名词。', '定一条规则')) === 'ok',
  );

  // 上传图片（走 CDP 设置 file input，会自动触发 change）
  const doc = await client.send('DOM.getDocument', { depth: -1 });
  const fileNode = await client.send('DOM.querySelector', {
    nodeId: doc.root.nodeId,
    selector: '.ob-left input[type=file]',
  });
  await client.send('DOM.setFileInputFiles', { nodeId: fileNode.nodeId, files: [imgPath] });
  await sleep(1500);

  const mats = await evaluate(`JSON.stringify({
    total: document.querySelectorAll('.ob-mat').length,
    thumbs: document.querySelectorAll('.ob-mat-thumb').length,
    text: [...document.querySelectorAll('.ob-mat-name')].map(n => n.textContent)
  })`);
  console.log('  素材清单：', mats);
  check('三份素材都已进入清单', JSON.parse(mats).total === 3);
  check('图片生成了缩略图（说明真的解码并压缩了）', JSON.parse(mats).thumbs === 1);
  await shot(`${OUT}-3-materials.png`);

  /* ---------------- 4. 让 AI 读一遍 ---------------- */
  check('点击「让 AI 读一遍」', (await click('让 AI 读一遍')) === 'ok');
  // 等的是**正文真的到了**，不是「卡片出现了」—— 出错时也会画一张卡片，
  // 只等 `.ob-card` 会出现「调用失败了也判 ✓」的假绿（这条曾经骗过我们一次）。
  const gotUnderstanding = await waitFor(
    `(document.querySelector('.ob-card .md')?.textContent ?? '').trim().length > 40`,
    60000,
  );
  check('AI 给出了「它读懂什么」', gotUnderstanding);
  const understanding = await textOf('.ob-card .md');
  check('理解内容具体指向材料里的设定', understanding.includes('海面每年上涨'), understanding.slice(0, 40));
  await shot(`${OUT}-4-understanding.png`);

  /* ---------------- 5. 答题 ---------------- */
  const qCount = await evaluate(`document.querySelectorAll('.ob-q').length`);
  check('AI 提出了需要拍板的问题（不是问卷，是 1-5 个）', qCount >= 1 && qCount <= 5, `共 ${qCount} 个`);

  check('点一个 AI 给的建议答案', (await click('会停，但没人知道什么时候')) === 'ok');
  check('第二个问题交给 AI 决定', (await click('你来定')) === 'ok');

  /* ---------------- 6. 第二轮：AI 应收口 ---------------- */
  check('点击「答完，接着聊」', (await click('答完，接着聊')) === 'ok');
  const readyToDraft = await waitFor(
    `[...document.querySelectorAll('.ob-foot button')].some(b => b.textContent.includes('生成设定草案'))`,
    60000,
  );
  check('第二轮后 AI 主动收口，不再追问', readyToDraft);
  await shot(`${OUT}-5-ready.png`);

  /* ---------------- 6.5 「我就是想说」：作者单方面交代（最高优先级） ---------------- */
  check(
    '「不针对问题，我就是想说」入口已出现',
    await evaluate(`document.body.innerText.includes('不针对问题，我就是想说')`),
  );
  await evaluate(`(() => {
    const cards = [...document.querySelectorAll('.ob-card')];
    const card = cards.find(c => c.innerText.includes('不针对问题，我就是想说'));
    if (!card) return 'MISSING';
    const ta = card.querySelector('textarea');
    const setter = Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, 'value').set;
    setter.call(ta, '主角必须是个失败者，不要写成天才。');
    ta.dispatchEvent(new Event('input', { bubbles: true }));
    return 'ok';
  })()`);
  check('点击「记下来」', (await click('记下来')) === 'ok');
  await sleep(400);
  check(
    '交代已入列并计数',
    await evaluate(
      `document.body.innerText.includes('已交代 1 条') && document.body.innerText.includes('主角必须是个失败者')`,
    ),
  );
  await shot(`${OUT}-5b-told.png`);

  /* ---------------- 7. 生成草案 ---------------- */
  check('点击「生成设定草案」', (await click('生成设定草案')) === 'ok');
  const gotProposal = await waitFor(`!!document.querySelector('.ob-world-name')`, 60000);
  check('草案已生成', gotProposal);
  const proposal = await evaluate(`JSON.stringify({
    name: document.querySelector('.ob-world-name')?.value ?? '',
    tone: document.querySelectorAll('.ob-card textarea')[0]?.value?.slice(0, 20) ?? '',
    entries: document.querySelectorAll('.ob-entry').length,
    cats: document.querySelectorAll('.ob-cat-row').length,
    rels: document.querySelectorAll('.ob-rel').length,
    open: document.body.innerText.includes('AI 替你做主')
  })`);
  console.log('  草案：', proposal);
  const p = JSON.parse(proposal);
  check('世界名片有名字', !!p.name, p.name);
  check('生成了条目与分类', p.entries >= 4 && p.cats >= 2, `${p.entries} 条目 / ${p.cats} 分类`);
  check('生成了关系连线', p.rels > 0, `${p.rels} 条`);
  check('列出了 AI 替用户做主的地方', p.open === true);
  check(
    '作者交代的话以最高优先级进了草案规则',
    await evaluate(
      `[...document.querySelectorAll('.ob-card input.input')].some(i => i.value.includes('主角必须是个失败者'))`,
    ),
  );
  await shot(`${OUT}-6-proposal.png`);

  /* ---------------- 8. 提意见修订 ---------------- */
  await evaluate(`(() => {
    const tas = [...document.querySelectorAll('.ob-card textarea')];
    const ta = tas[tas.length - 1];
    const setter = Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, 'value').set;
    setter.call(ta, '再加一条能体现阶层差距的规则');
    ta.dispatchEvent(new Event('input', { bubbles: true }));
    return 'ok';
  })()`);
  check('点击「让 AI 改一版」', (await click('让 AI 改一版')) === 'ok');
  const revised = await waitFor(
    `document.body.innerText.includes('已经改过 1 版') && document.querySelectorAll('.ob-entry').length > ${p.entries}`,
    60000,
  );
  check('修订已生效（条目数增加，版本号 +1）', revised);
  await shot(`${OUT}-7-revised.png`);

  /* ---------------- 9. 取消勾选一条，验证「不勾选不写入」 ---------------- */
  await evaluate(`(() => {
    const cbs = [...document.querySelectorAll('.ob-entry-head input[type=checkbox]')];
    const cb = cbs[cbs.length - 1];
    cb.click();
    return 'ok';
  })()`);
  await sleep(400);
  check(
    '取消勾选后计数立刻反映',
    await evaluate(`document.body.innerText.includes('入选')`),
  );

  /* ---------------- 10. 二次确认 → 创建 ---------------- */
  check('点击「确认创建这个世界」', (await click('确认创建这个世界')) === 'ok');
  await sleep(600);
  const confirmPane = await evaluate(
    `JSON.stringify({ has: !!document.querySelector('.ob-confirm'), text: document.querySelector('.ob-confirm')?.innerText.slice(0, 120) ?? '' })`,
  );
  console.log('  确认面板：', confirmPane);
  check('确认前会再问一次（列出没拍板的地方）', JSON.parse(confirmPane).has);

  check('点击「就这样，创建」', (await click('就这样，创建')) === 'ok');
  const created = await waitFor(`!document.querySelector('.ob')`, 30000);
  check('创建完成，工作台关闭', created);
  await sleep(2200);

  const after = await evaluate(`JSON.stringify({
    hash: location.hash,
    worldName: document.querySelector('.world-switch-name')?.textContent ?? '',
    sidebar: document.querySelector('.sidebar-foot')?.innerText.replace(/\\n/g, ' / ') ?? '',
    title: document.querySelector('.page-title')?.textContent ?? ''
  })`);
  console.log('\n[10] 创建后：', after);
  const a = JSON.parse(after);
  check('当前世界已切到新建的世界', a.worldName.includes('涨潮纪'), a.worldName);
  check('条目/关系已落库', /条目/.test(a.sidebar), a.sidebar);
  await shot(`${OUT}-8-created.png`);

  /* ---------------- 11. 素材是否进了资料库 ---------------- */
  await client.send('Page.navigate', { url: APP_URL.replace(/\/$/, '') + '/?e2e=onb2#docs' });
  await sleep(3500);
  const docsText = await evaluate(`document.body.innerText`);
  console.log('  资料库页面：', docsText.slice(0, 120).replace(/\n/g, ' | '));
  check(
    '投喂的素材已随世界进入资料库',
    docsText.includes('已导入资料') && docsText.includes('reference.png'),
    `${(docsText.match(/已导入资料（(\d+)）/) ?? [])[1] ?? '?'} 份`,
  );
  await shot(`${OUT}-9-docs.png`);

  /* ---------------- 12. 回归：既有 AI 链路还能跑通 ---------------- */
  await client.send('Page.navigate', { url: APP_URL.replace(/\/$/, '') + '/?e2e=onb3#studio' });
  await sleep(3500);
  check('AI 工作台可用', (await click('开始生成')) === 'ok');
  const gen = await waitFor(`!!document.querySelector('.review-item')`, 60000);
  check('生成候选设定成功', gen);
  check('送入审查队列', (await click('送入审查队列')) === 'ok');
  await sleep(2500);
  const beforeAccept = await textOf('.sidebar-foot');
  check('审查队列有条目', (await evaluate(`document.querySelectorAll('.review-title').length`)) > 0);
  check('采纳一条', (await click('采纳', true)) === 'ok');
  await sleep(2500);
  const afterAccept = await textOf('.sidebar-foot');
  check('采纳后条目数增加', beforeAccept !== afterAccept, `${beforeAccept} → ${afterAccept}`);
  await shot(`${OUT}-10-regression.png`);

  /* ---------------- 13. 截断修复：模型返回半截 JSON 也能抢救 ---------------- */
  await client.send('Page.navigate', { url: APP_URL.replace(/\/$/, '') + '/?e2e=onb4#dashboard' });
  await sleep(3500);
  check('打开世界菜单', (await click('涨潮纪')) === 'ok');
  await sleep(400);
  // 菜单项是 div 不是 button，直接点 DOM
  check(
    '点「新建另一个世界」',
    (await evaluate(`(() => {
      const item = [...document.querySelectorAll('.world-menu-item')].find(d => d.textContent.includes('新建另一个世界'));
      if (!item) return 'MISSING';
      item.click();
      return 'ok';
    })()`)) === 'ok',
  );
  await sleep(1200);
  check('共创工作台再次打开', await evaluate(`!!document.querySelector('.ob')`));

  check(
    '粘贴一段材料',
    (await paste('一个关于钟表匠行会的故事：所有钟表在午夜会同时停摆一刻钟。')) === 'ok',
  );
  check('点击「让 AI 读一遍」', (await click('让 AI 读一遍')) === 'ok');
  await waitFor(`document.querySelectorAll('.ob-q').length >= 1`, 60000);

  // 交代里带「模拟截断」触发词 → 假上游会故意返回写到一半的 JSON
  await evaluate(`(() => {
    const cards = [...document.querySelectorAll('.ob-card')];
    const card = cards.find(c => c.innerText.includes('不针对问题，我就是想说'));
    if (!card) return 'MISSING';
    const ta = card.querySelector('textarea');
    const setter = Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, 'value').set;
    setter.call(ta, '模拟截断：这次故意返回半截 JSON，验证前端能修复。');
    ta.dispatchEvent(new Event('input', { bubbles: true }));
    return 'ok';
  })()`);
  check('点击「记下来」', (await click('记下来')) === 'ok');
  await sleep(300);
  check('点击「够了，直接写草案」', (await click('够了，直接写草案')) === 'ok');

  const salvaged = await waitFor(`!!document.querySelector('.ob-world-name')`, 60000);
  check('半截 JSON 被修复，草案仍然生成', salvaged);
  check(
    '没有出现解析失败报错',
    await evaluate(`!document.body.innerText.includes('无法解析模型返回的 JSON')`),
  );
  const entCount = await evaluate(`document.querySelectorAll('.ob-entry').length`);
  check('从截断输出里抢救出了完整条目', entCount >= 1, `${entCount} 条`);
  await shot(`${OUT}-11-truncation-recovered.png`);

  check('退出工作台（不创建这个世界）', (await click('退出（进度会留着）')) === 'ok');

  /* ---------------- 假上游侧证据：图片确实送到了模型 ---------------- */
  const stats = await (await fetch(`${MOCK_ORIGIN}/__mock-stats`)).json();
  console.log('\n[11] 假上游统计：', JSON.stringify(stats));
  check('intake 收到过图片（多模态链路真的通了）', stats.imagesMax >= 1, `imagesMax=${stats.imagesMax}`);
  check('草案修订请求走的是 revise 分支', (stats.byBranch['proposal-revise'] ?? 0) >= 1);
  check('截断模拟走到了 proposal-truncated 分支', (stats.byBranch['proposal-truncated'] ?? 0) >= 1);
  // 失败时把落在 unknown 的请求片段打出来 —— 只报「有几条」等于让人再去猜是哪条。
  const unknownDetail =
    (stats.byBranch.unknown ?? 0) === 0
      ? JSON.stringify(stats.byBranch)
      : `${JSON.stringify(stats.byBranch)} | 样本: ${(stats.unknownSamples ?? []).map((s) => s.replace(/\s+/g, ' ').slice(0, 160)).join(' ‖ ')}`;
  check(
    '没有任何请求落到 unknown 分支（提示词标记与路由一致）',
    (stats.byBranch.unknown ?? 0) === 0,
    unknownDetail,
  );

  /* ---------------- 汇总 ---------------- */
  const bad = [];
  const expected = [];
  for (const e of client.events) {
    if (e.method === 'Runtime.exceptionThrown') {
      bad.push('EXCEPTION: ' + (e.params.exceptionDetails?.exception?.description ?? ''));
    } else if (e.method === 'Log.entryAdded' && e.params.entry.level === 'error') {
      const entry = e.params.entry;
      const url = entry.url || '';
      const text = entry.text || '';
      // 假上游故意不发 CORS 头：浏览器拦下直连、应用改走本机转发 —— 这正是要验证的场景。
      // 注意 CORS 那条日志的 url 有时指向页面而非请求地址，所以文案也要一起判。
      const mockHost = MOCK_ORIGIN.replace(/^https?:\/\//, '');
      if (
        url.includes(mockHost) ||
        text.includes(mockHost) ||
        /blocked by CORS policy/.test(text)
      ) {
        expected.push(text.slice(0, 60));
        continue;
      }
      bad.push('LOG: ' + text);
    } else if (e.method === 'Runtime.consoleAPICalled' && e.params.type === 'error') {
      bad.push('CONSOLE: ' + e.params.args.map((x) => x.value ?? x.description).join(' '));
    }
  }
  console.log(`\n--- 预期内的失败（直连被 CORS 拦，应用已自动改走转发）：${expected.length} 条 ---`);
  check('页面无「意料之外」的运行时报错', bad.length === 0, bad.slice(0, 3).join(' | '));

  const failed = results.filter((r) => !r.ok);
  console.log(`\n===== 结果：${results.length - failed.length}/${results.length} 项通过 =====`);
  if (failed.length) {
    console.log('未通过：');
    failed.forEach((f) => console.log('  ✗ ' + f.name));
    process.exitCode = 1;
  }

  client.close();
}

try {
  await main();
} catch (e) {
  console.error('\n验证脚本失败：', e.message);
  process.exitCode = 1;
} finally {
  chrome.kill();
}
