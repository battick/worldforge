/**
 * 开发期端到端验证：型号可用性自动探测
 *
 * 覆盖：
 *   1. 拉完清单**自动**开始探测（作者不用点任何东西）
 *   2. 探测**不污染**对话侧的计数（它一次打几十条，混进去会把别的断言的账算错）
 *   3. 五种真实失败各归各位：余额不足（橙）/ 型号不存在 / 钥匙不对 / 限流 / 2xx 但没内容
 *   4. **非对话模型（向量、语音）根本不探** —— 不是探了不显示，是没发请求
 *   5. 悬停说明里点出原因，且「余额不足」与「型号不存在」是两句不同的话
 *   6. 左边那条短矩形**真的看得见**（有宽度、在视野里）—— 不是「元素存在」就算数
 *   7. 结论进缓存：重开面板不重复打，颜色照样在
 *   8. **选中一个型号时也会单独探它**（作者提的第二个时机）
 *   9. 探测中点「停止」真的停得下来，并且如实说「没探到的仍是未知」
 *  10. 连着几个都连不上就**别硬探**（剩下几十个白打一遍，还看不出新东西）
 *  11. **上限是作者定的**：默认 40，能改成任意条数、也能勾「不限制」把整份清单探完，
 *      改完那一轮真的只打这么多条；这一项**只住在选型号面板里**（设置页不再摆第二个入口）
 *  12. 全程没有未捕获异常
 *
 * 前置：
 *   python -m http.server 5188 --directory dist --bind 127.0.0.1   （需已构建最新 dist）
 *   node .dev/mock-upstream.mjs 5190 --cors
 * 用法：node .dev/e2e-model-probe.mjs
 */
import { spawn } from 'node:child_process';
import { writeFileSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const CHROME = 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const APP_URL = 'http://127.0.0.1:5188/';
const MOCK = 'http://127.0.0.1:5190';
const MOCK_URL = `${MOCK}/v1`;
const OUT = '.shots/probe';
const PORT = 9387;
const profile = mkdtempSync(join(tmpdir(), 'cdp-probe-'));
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
    '--window-size=1560,1040',
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
  const waitFor = async (expr, timeout = 20000, step = 200) => {
    const t0 = Date.now();
    while (Date.now() - t0 < timeout) {
      if (await evaluate(expr)) return true;
      await sleep(step);
    }
    return false;
  };
  const click = (sel) =>
    evaluate(`(() => {
      const el = document.querySelector(${JSON.stringify(sel)});
      if (!el) return 'not-found';
      el.click();
      return 'ok';
    })()`);
  const stats = () => evaluate(`fetch('${MOCK}/__mock-stats').then(r => r.json())`);
  const setModelsMode = (mode) => evaluate(`fetch('${MOCK}/__mock-models?mode=${mode}').then(r => r.text())`);
  const setProbeMode = (mode) => evaluate(`fetch('${MOCK}/__mock-probe?mode=${mode}').then(r => r.text())`);
  const setDelay = (ms) => evaluate(`fetch('${MOCK}/__mock-delay?ms=${ms}').then(r => r.text())`);

  /**
   * 取某条型号左边那条短矩形的状态。
   *
   * 用 `[data-model-id=...]` 定位整行、再取行内那一条 —— 不用 `querySelectorAll` 按下标取，
   * 那样加一条型号就全错位了（踩过同类：用 `textContent.includes` 挑元素挑到了另一张卡）。
   */
  const strip = (id) =>
    `(() => {
      const el = document.querySelector('[data-model-id="${id}"] [data-role=model-avail]');
      return el ? JSON.stringify({ tone: el.dataset.tone, state: el.dataset.state, title: el.title }) : 'null';
    })()`;
  const stripOf = async (id) => JSON.parse((await evaluate(strip(id))) ?? 'null');

  /**
   * 往受控输入框里塞值。
   *
   * 直接改 `.value` React 收不到（它在 value 上挂了自己的 setter），必须走原生 setter
   * 再派发一次 `input`。这是本项目里所有 e2e 的统一写法。
   */
  const setValue = (sel, v) =>
    evaluate(`(() => {
      const el = document.querySelector(${JSON.stringify(sel)});
      if (!el) return 'not-found';
      const proto = el instanceof HTMLTextAreaElement ? HTMLTextAreaElement : HTMLInputElement;
      const set = Object.getOwnPropertyDescriptor(proto.prototype, 'value').set;
      set.call(el, ${JSON.stringify(v)});
      el.dispatchEvent(new Event('input', { bubbles: true }));
      el.dispatchEvent(new Event('change', { bubbles: true }));
      return 'ok';
    })()`);

  const probeText = `(document.querySelector('[data-role=model-probe-text]')?.textContent || '')`;
  /** 已经出结论的条数（`idle` = 没探、`busy` = 正在探） */
  const settled = `[...document.querySelectorAll('[data-role=model-avail]')].filter(e => e.dataset.tone !== 'idle' && e.dataset.tone !== 'busy').length`;

  /* ---------------- 0. 配好假上游 ---------------- */
  await client.send('Page.navigate', { url: APP_URL });
  await sleep(2500);
  await setModelsMode('probe');
  await setProbeMode('ok');
  await setDelay(0);
  // 统计是跨脚本累加的，不归零的话「探了几条」会被上一次的残留绊倒
  await evaluate(`fetch('${MOCK}/__mock-stats/reset').then(r => r.text())`);
  await setModelsMode('probe');
  await evaluate(`(() => {
    localStorage.clear();
    localStorage.setItem('worldforge:settings', JSON.stringify({
      ai: { provider: 'deepseek', baseUrl: '${MOCK_URL}', apiKey: 'k', model: 'deepseek-chat',
            temperature: 0.8, contextLimit: 60, vision: true }
    }));
    return 'ok';
  })()`);
  await client.send('Page.navigate', { url: `${APP_URL}?r=probe#settings` });
  await sleep(2200);

  /* ---------------- 1. 拉完清单自动开始探测 ---------------- */
  console.log('\n[1] 拉完清单就自动探');
  check('设置页打开了', await evaluate(`!!document.querySelector('[data-role=model-input]')`));
  const beforeOpen = await stats();
  await click('[data-role=model-toggle]');
  check('面板打开了', await evaluate(`!!document.querySelector('[data-role=model-panel]')`));
  const listed = await waitFor(`(document.querySelector('[data-role=model-status]')?.textContent || '').includes('8')`, 20000);
  check('清单拉回来了（8 个型号，含 4 个账面有、实际用不了的）', listed);
  const autoRan = await waitFor(`${settled} >= 7`, 30000);
  const afterProbe = await stats();
  check(
    '作者没点任何东西，探测自己跑起来了',
    afterProbe.probeCount >= 7,
    `probeCount=${afterProbe.probeCount}`,
  );
  check('确实探完了 7 条（非对话模型不算）', autoRan, `已出结论 ${await evaluate(settled)} 条`);
  /**
   * 这条是整套设计的支点：探测走的也是 `/chat/completions`，如果它被算进对话计数，
   * 「哪个功能分支被调用过」「unknown === 0」这些断言就会被几十条探测整个淹掉。
   */
  check(
    '探测**没有**被算成一次对话请求（否则别的 e2e 的账全乱了）',
    afterProbe.chatCount === beforeOpen.chatCount,
    `chatCount: ${beforeOpen.chatCount} → ${afterProbe.chatCount}`,
  );
  check(
    '探测也没顶掉「最近一次请求体」（那是验设置页开关的唯一凭据）',
    afterProbe.lastBody === beforeOpen.lastBody,
    JSON.stringify(afterProbe.lastBody)?.slice(0, 60),
  );
  check(
    '探测请求确实带的是它自己的型号',
    (afterProbe.probeModels ?? []).includes('mock-ultra-9'),
    (afterProbe.probeModels ?? []).join(','),
  );
  await shot(`${OUT}-1-panel.png`);

  /* ---------------- 2. 四种结论各归各位 ---------------- */
  console.log('\n[2] 结论与颜色');
  const good = await stripOf('mock-ultra-9');
  const balance = await stripOf('mock-no-balance');
  const missing = await stripOf('mock-missing-model');
  const badKey = await stripOf('mock-bad-key');
  const throttled = await stripOf('mock-throttled');
  const empty = await stripOf('mock-empty-content');

  check('真的回话的 → 绿、状态 ok', good?.tone === 'ok' && good?.state === 'ok', JSON.stringify(good));
  check(
    '渠道报余额不足的 → 橙（单独一档，作者要做的事和别的都不一样）',
    balance?.tone === 'warn' && balance?.state === 'noBalance',
    JSON.stringify(balance),
  );
  check(
    '型号不存在的 → 红、状态 noModel',
    missing?.tone === 'bad' && missing?.state === 'noModel',
    JSON.stringify(missing),
  );
  check('钥匙不对的 → 红、状态 noAuth', badKey?.state === 'noAuth', JSON.stringify(badKey));
  check('被限流的 → state rateLimited', throttled?.state === 'rateLimited', JSON.stringify(throttled));
  check(
    '**2xx 但一条内容都没有**不算可用（「通了」不等于「说得上话」）',
    empty?.tone === 'bad' && empty?.state === 'noContent',
    JSON.stringify(empty),
  );
  check(
    '同一个渠道里六种结论各不相同（不是一片同色）',
    new Set([good, balance, missing, badKey, throttled, empty].map((x) => x?.state)).size === 6,
  );

  /* ---------------- 3. 非对话模型根本不探 ---------------- */
  console.log('\n[3] 非对话模型不探');
  const tts = await stripOf('tts-1');
  check('语音模型没有结论（竖条保持灰的）', tts?.tone === 'idle', JSON.stringify(tts));
  check(
    '而且**根本没发过它的请求**（不是探了不显示）',
    !(afterProbe.probeModels ?? []).includes('tts-1'),
    (afterProbe.probeModels ?? []).join(','),
  );

  /* ---------------- 4. 悬停说明说清原因 ---------------- */
  console.log('\n[4] 悬停说明');
  check(
    '「余额不足」那条的说明里写着余额（不是只有一句「有问题」）',
    (balance?.title ?? '').includes('余额'),
    balance?.title,
  );
  check(
    '「型号不存在」那条写的是另一件事（两句话必须不一样）',
    (missing?.title ?? '').includes('不存在') && !(missing?.title ?? '').includes('余额'),
    missing?.title,
  );
  check(
    '说明里带着厂商原话 —— 排查的唯一线索',
    (balance?.title ?? '').includes('insufficient'),
    balance?.title,
  );

  /* ---------------- 5. 汇总与图例 ---------------- */
  console.log('\n[5] 汇总与图例');
  const text = await evaluate(probeText);
  check('汇总报出「可用 2」', text.includes('2') && text.includes('可用'), text);
  check('汇总报出「有问题 5」', text.includes('5'), text);
  const legend = await evaluate(`!!document.querySelector('[data-role=model-probe-legend]')`);
  check('有图例解释那些颜色（不然三个颜色只能靠猜）', legend);
  const legendText = await evaluate(
    `(document.querySelector('[data-role=model-probe-legend]')?.textContent || '')`,
  );
  check('图例说清了绿/橙/红/灰各自什么意思', /绿/.test(legendText) && /橙/.test(legendText), legendText.slice(0, 80));

  /* ---------------- 6. 短矩形真的看得见 ---------------- */
  console.log('\n[6] 那条短矩形是看得见的');
  const box = JSON.parse(
    await evaluate(`(() => {
      const el = document.querySelector('[data-model-id="mock-no-balance"] [data-role=model-avail]');
      if (!el) return JSON.stringify({ missing: true });
      const r = el.getBoundingClientRect();
      return JSON.stringify({ w: Math.round(r.width), h: Math.round(r.height),
        top: Math.round(r.top), bottom: Math.round(r.bottom), vh: window.innerHeight });
    })()`),
  );
  check('它有宽度也有高度（不是一条 0px 的隐形元素）', box.w >= 2 && box.h >= 8, JSON.stringify(box));
  check('它落在视野里（不用往下滚才看得见）', box.top >= 0 && box.bottom <= box.vh, JSON.stringify(box));

  /* ---------------- 7. 结论进缓存 ---------------- */
  console.log('\n[7] 缓存：重开不重复打');
  const beforeReopen = await stats();
  await click('[data-role=model-toggle]');
  await sleep(600);
  await click('[data-role=model-toggle]');
  await sleep(1400);
  const afterReopen = await stats();
  check(
    '重开面板没有再探一遍',
    afterReopen.probeCount === beforeReopen.probeCount,
    `${beforeReopen.probeCount} → ${afterReopen.probeCount}`,
  );
  const cached = await stripOf('mock-no-balance');
  check('但结论还在（缓存是拿来用的，不是拿来重新算的）', cached?.state === 'noBalance', JSON.stringify(cached));

  /* ---------------- 8. 选中型号时也会单独探 ---------------- */
  console.log('\n[8] 选中一个型号时也会测');
  const beforePick = await stats();
  await click('[data-model-id="tts-1"]');
  await sleep(1200);
  const afterPick = await stats();
  check(
    '点了那个从没探过的型号 → 它被单独探了一次',
    (afterPick.probeModels ?? []).includes('tts-1'),
    (afterPick.probeModels ?? []).join(','),
  );
  check(
    '只探了选中的那一个（不是顺手又打了一遍全场）',
    afterPick.probeCount - beforePick.probeCount <= 2,
    `${beforePick.probeCount} → ${afterPick.probeCount}`,
  );

  /* ---------------- 9. 停止探测 ---------------- */
  console.log('\n[9] 探测中能停下来');
  await setDelay(700);
  await click('[data-role=model-toggle]');
  await sleep(500);
  await click('[data-role=model-probe-recheck]');
  const stopShown = await waitFor(`!!document.querySelector('[data-role=model-probe-stop]')`, 8000);
  check('重新探测开始后按钮变成「停止」', stopShown);
  await click('[data-role=model-probe-stop]');
  const stopped = await waitFor(`${probeText}.includes('已停止')`, 8000);
  check('停下来之后如实说「没探到的仍是未知」', stopped, await evaluate(probeText));
  check('停止按钮也收掉了', !(await evaluate(`!!document.querySelector('[data-role=model-probe-stop]')`)));
  await shot(`${OUT}-2-stopped.png`);
  await setDelay(0);

  /* ---------------- 10. 连不上就别硬探 ---------------- */
  console.log('\n[10] 连不上时收手');
  await setProbeMode('down');
  const beforeDown = await stats();
  await click('[data-role=model-probe-recheck]');
  const gaveUp = await waitFor(`${probeText}.includes('连不上')`, 20000);
  const afterDown = await stats();
  const tried = afterDown.probeCount - beforeDown.probeCount;
  check('连着几个连不上时界面说清了是渠道的问题', gaveUp, await evaluate(probeText));
  check('而且**没有再往下打**（没把 7 条全打一遍）', tried < 7, `打了 ${tried} 条`);
  check('但它确实试过（不是压根没开始）', tried >= 3, `打了 ${tried} 条`);
  await setProbeMode('ok');

  /* ---------------- 11. 上限就住在选型号面板里，作者能自己定 ---------------- */
  console.log('\n[11] 探测上限能自己定（只在选型号面板里）');
  await setProbeMode('ok');

  /**
   * 这一项**只有面板里那一个入口**。曾经设置页的 API Key 下方也摆了一份完全一样的
   * 控件（同一个设置的两个门），作者的要求是「没必要」—— 于是就只留面板里这一个。
   * 反着断言「设置页里没有」，这样以后谁又加回去会立刻红。
   */
  check(
    '设置页里没有第二个入口（不摆在 API Key 下面）',
    !(await evaluate(`!!document.querySelector('[data-role=ai-probe-limit]')`)) &&
      !(await evaluate(`!!document.querySelector('[data-role=ai-probe-unlimited]')`)),
  );
  check(
    '面板里那一项默认就是 40（作者没设过时用的那个数）',
    (await evaluate(`document.querySelector('[data-role=model-probe-limit-input]').value`)) === '40',
    await evaluate(`document.querySelector('[data-role=model-probe-limit-input]').value`),
  );
  check(
    '默认没勾「不限制」',
    (await evaluate(`document.querySelector('[data-role=model-probe-unlimited]').checked`)) === false,
  );

  await setValue('[data-role=model-probe-limit-input]', '2');
  await sleep(400);
  const saved = await evaluate(
    `(JSON.parse(localStorage.getItem('worldforge:settings') || '{}').ai || {}).probeLimit`,
  );
  check('改了就真的落进设置里（不是只活在这个面板里）', saved === 2, String(saved));
  await shot(`${OUT}-5-limit-control.png`);

  const beforeSmall = await stats();
  await click('[data-role=model-probe-recheck]');
  await waitFor(`!!document.querySelector('[data-role=model-probe-stop]')`, 8000);
  await waitFor(`!document.querySelector('[data-role=model-probe-stop]')`, 25000);
  const afterSmall = await stats();
  const triedSmall = afterSmall.probeCount - beforeSmall.probeCount;
  check('改成 2 之后这一轮就只打 2 条（上限真的生效）', triedSmall === 2, `打了 ${triedSmall} 条`);
  const textSmall = await evaluate(probeText);
  check('并如实报出还剩几个没探 —— 5 条', /还有\s*5\s*个没探/.test(textSmall), textSmall);
  check('那句话里的「最多探」写的是作者设的 2，不是写死的 40', textSmall.includes('最多探 2 个'), textSmall);

  /* 勾「不限制」：这一轮把整份清单剩下的全探完 */
  await click('[data-role=model-probe-unlimited]');
  await sleep(400);
  check(
    '勾上「不限制」后，框里那个数还摆着（取消勾选时作者填的 2 要能回来）',
    (await evaluate(`document.querySelector('[data-role=model-probe-limit-input]').value`)) === '2',
    await evaluate(`document.querySelector('[data-role=model-probe-limit-input]').value`),
  );
  check(
    '但框被禁用了（不限制时那个数不生效，得让人看得出来）',
    (await evaluate(`document.querySelector('[data-role=model-probe-limit-input]').disabled`)) === true,
  );
  check(
    '并且明说这一轮会全探一遍（代价摆在明面上，不藏着）',
    await evaluate(
      `(document.querySelector('[data-role=model-probe-limit-warn]')?.textContent || '').length > 0`,
    ),
  );

  /**
   * 这里**不能**点「重新探测」——它自带 `force`，会把缓存清光重来一轮，
   * 那样不限制时打的是整个清单 7 条，验不出「接着把没探的补上」。
   * 真正该走的是「关掉再打开面板」：打开时那条路是 `startProbe(fetched)`（不强制），
   * 于是它只补还没结论的那 5 条。
   */
  await click('[data-role=model-toggle]');
  await sleep(500);
  // 这一轮的账单独算：`probeModels` 是**跨节累加**的集合，不归零的话第 8 节手动探过的
  // tts-1 还挂在里面，会让人误以为「不限制连非对话模型也探」
  await evaluate(`fetch('${MOCK}/__mock-stats/reset').then(r => r.text())`);
  await click('[data-role=model-toggle]');
  const allDone = await waitFor(`${settled} >= 7`, 30000);
  check(
    '重开面板后那个数还是 2、勾也还勾着（改的是设置，不是面板里的一时状态）',
    (await evaluate(`document.querySelector('[data-role=model-probe-limit-input]').value`)) === '2' &&
      (await evaluate(`document.querySelector('[data-role=model-probe-unlimited]').checked`)) === true,
    await evaluate(`document.querySelector('[data-role=model-probe-limit-input]').value`),
  );
  const afterAll = await stats();
  check('7 条该探的全有结论了', allDone, `已出结论 ${await evaluate(settled)} 条`);
  check('不限制 → 把剩下那 5 条也补探了（不再被截住）', afterAll.probeCount === 5, `打了 ${afterAll.probeCount} 条`);
  check(
    '非对话模型依然没探过（不限制 ≠ 什么都探）',
    !(afterAll.probeModels ?? []).includes('tts-1'),
    `这一轮探了 ${(afterAll.probeModels ?? []).join(',')}`,
  );
  const textAll = await evaluate(probeText);
  check('探完之后不再有「还有 N 个没探」', !/还有/.test(textAll), textAll);
  await shot(`${OUT}-3-limit.png`);

  /* 改回默认，别把这个设置留给下一个脚本 / 下一次打开 */
  await click('[data-role=model-probe-unlimited]');
  await setValue('[data-role=model-probe-limit-input]', '40');
  await sleep(400);

  /* ---------------- 12. 干净收场 ---------------- */
  console.log('\n[12] 收场');
  const errs = [];
  for (const e of client.events) {
    if (e.method === 'Runtime.exceptionThrown') {
      errs.push('EXCEPTION: ' + (e.params.exceptionDetails?.exception?.description ?? '').slice(0, 200));
    } else if (e.method === 'Runtime.consoleAPICalled' && e.params.type === 'error') {
      errs.push('CONSOLE: ' + e.params.args.map((a) => a.value ?? a.description).join(' ').slice(0, 200));
    }
  }
  check('全程没有未捕获异常 / console.error', errs.length === 0, errs.slice(0, 3).join(' | '));

  const okCount = results.filter((r) => r.ok).length;
  console.log(`\n结果：${okCount}/${results.length} 通过\n`);
  chrome.kill();
  process.exitCode = okCount === results.length ? 0 : 1;
}

main().catch((e) => {
  console.error('脚本崩溃：', e);
  chrome.kill();
  process.exitCode = 1;
});
