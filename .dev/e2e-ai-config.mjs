/**
 * 开发期端到端验证：设置页里「更细的 AI 配置」
 *
 * 覆盖：
 *   1. 型号可以手填任意 ID（列表之外的名字照样用）
 *   2. 点「选型号」自动去厂商拉一次，拉回来的就摆在那里
 *   3. 三组候选各摆各位：最近用过 / 厂商返回的 / 内置兜底，同一个型号不重复出现
 *   4. 明显不是对话模型的（向量、语音）排到后面并标出来，而不是被藏起来
 *   5. 搜索能筛，一搜索就不再摆「最近用过」
 *   6. 点一个型号就选中，面板关上
 *   7. 拉过一次就缓存住，重开面板不再重复请求；点「重新获取」才会再拉
 *   8. 厂商报错（401）与返回错误页（非 JSON）都要把原因摆出来
 *   9. 切服务商记住各家的型号；切到「自定义」不清掉作者填的地址
 *  10. 采样参数（token 上限 / top_p）与额外请求头 / 请求体**真的进了请求**
 *      （测试连接自带 16 的短上限，所以这里验的是「它在请求体里」，见下面那行断言；
 *      「设置里的上限会进请求体」由 unit-ai-config.mjs 的请求体构造一节负责）
 *  11. JSON 模式三态真的改变了 response_format
 *  12. 关掉流式后请求里 stream=false
 *  13. 额外请求体写歪了就地报红，不许静默忽略
 *
 * 前置：
 *   node server.mjs                 （5188，需已构建最新 dist）
 *   node .dev/mock-upstream.mjs 5190 --cors
 * 用法：node .dev/e2e-ai-config.mjs
 */
import { spawn } from 'node:child_process';
import { writeFileSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const CHROME = 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const APP_URL = 'http://127.0.0.1:5188/';
const MOCK = 'http://127.0.0.1:5190';
const MOCK_URL = `${MOCK}/v1`;
const OUT = '.shots/ai-config';
const PORT = 9381;
const profile = mkdtempSync(join(tmpdir(), 'cdp-aicfg-'));
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
  const waitFor = async (expr, timeout = 20000, step = 250) => {
    const t0 = Date.now();
    while (Date.now() - t0 < timeout) {
      if (await evaluate(expr)) return true;
      await sleep(step);
    }
    return false;
  };
  /** 输入框 / 文本域：走原生 setter + input 事件，React 的受控组件才认 */
  const setInput = (sel, value) =>
    evaluate(`(() => {
      const el = document.querySelector(${JSON.stringify(sel)});
      if (!el) return 'not-found';
      const proto = el.tagName === 'TEXTAREA'
        ? window.HTMLTextAreaElement.prototype : window.HTMLInputElement.prototype;
      Object.getOwnPropertyDescriptor(proto, 'value').set.call(el, ${JSON.stringify(value)});
      el.dispatchEvent(new Event('input', { bubbles: true }));
      return 'ok';
    })()`);
  const click = (sel) =>
    evaluate(`(() => {
      const el = document.querySelector(${JSON.stringify(sel)});
      if (!el) return 'not-found';
      el.click();
      return 'ok';
    })()`);
  /**
   * 失焦。
   *
   * 手填的型号是**靠失焦那一刻**才记进「最近用过」的（每敲一个字就记的话，
   * 那组会塞满 d / de / dee）。而 React 17 之后 `onBlur` 其实是挂在 `focusout` 上的，
   * 光派发一个不冒泡的 `blur` 事件它收不到 —— 必须走 focusout。
   */
  const blur = (sel) =>
    evaluate(`(() => {
      const el = document.querySelector(${JSON.stringify(sel)});
      if (!el) return 'not-found';
      el.focus();
      el.blur();
      el.dispatchEvent(new FocusEvent('focusout', { bubbles: true }));
      return 'ok';
    })()`);
  const setSelect = (sel, value) =>
    evaluate(`(() => {
      const el = document.querySelector(${JSON.stringify(sel)});
      if (!el) return 'not-found';
      Object.getOwnPropertyDescriptor(window.HTMLSelectElement.prototype, 'value').set.call(el, ${JSON.stringify(value)});
      el.dispatchEvent(new Event('change', { bubbles: true }));
      return 'ok';
    })()`);
  const stats = () => evaluate(`fetch('${MOCK}/__mock-stats').then(r => r.json())`);
  const setModelsMode = (mode) => evaluate(`fetch('${MOCK}/__mock-models?mode=${mode}').then(r => r.text())`);
  /** 设置里当前存着的样子 —— 界面上看不出来的那部分配置靠它 */
  const savedAI = () =>
    evaluate(`JSON.parse(localStorage.getItem('worldforge:settings') || '{}').ai || {}`);
  const panelText = `(document.querySelector('[data-role=model-status]')?.textContent || '')`;
  const itemIds = (group) =>
    `JSON.stringify([...document.querySelectorAll('[data-role=model-group][data-group=${group}] [data-role=model-item]')].map(b => b.dataset.modelId))`;

  /* ---------------- 0. 配好假上游 ---------------- */
  await client.send('Page.navigate', { url: APP_URL });
  await sleep(2500);
  await setModelsMode('ok');
  // 统计是跨脚本累加的，不归零的话「拉了几次」这条断言会被上一次的残留绊倒
  await evaluate(`fetch('${MOCK}/__mock-stats/reset').then(r => r.text())`);
  await evaluate(`(() => {
    localStorage.clear();
    localStorage.setItem('worldforge:settings', JSON.stringify({
      ai: { provider: 'deepseek', baseUrl: '${MOCK_URL}', apiKey: 'k', model: 'deepseek-chat',
            temperature: 0.8, contextLimit: 60, vision: true }
    }));
    return 'ok';
  })()`);
  await client.send('Page.navigate', { url: `${APP_URL}?r=settings#settings` });
  await sleep(2200);

  /* ---------------- 1. 型号：手填任意 ID ---------------- */
  console.log('\n[1] 型号可以手填');
  check('设置页打开了', await evaluate(`!!document.querySelector('[data-role=model-input]')`));
  check(
    '一开始显示的还是存着的那个型号',
    (await evaluate(`document.querySelector('[data-role=model-input]').value`)) === 'deepseek-chat',
  );
  await setInput('[data-role=model-input]', 'my-private-gateway-v2');
  await blur('[data-role=model-input]');
  await sleep(400);
  const afterTyped = await savedAI();
  check('手填的型号存进了设置（列表之外的名字照样能用）', afterTyped.model === 'my-private-gateway-v2', afterTyped.model);
  check(
    '手填的型号也进了「最近用过」',
    (afterTyped.recentModels ?? []).includes('my-private-gateway-v2'),
    JSON.stringify(afterTyped.recentModels),
  );

  /* ---------------- 2. 打开面板：自动去厂商拉一次 ---------------- */
  console.log('\n[2] 打开面板自动拉取');
  await click('[data-role=model-toggle]');
  check('面板打开了', await evaluate(`!!document.querySelector('[data-role=model-panel]')`));
  const gotList = await waitFor(`${panelText}.includes('4')`, 20000);
  check('自动向厂商拉了一次并在状态里报出数量', gotList, await evaluate(panelText));
  const s1 = await stats();
  check('确实请求了 /v1/models（不是本地凑的）', s1.modelsFetched === 1, `modelsFetched=${s1.modelsFetched}`);
  await shot(`${OUT}-1-panel.png`);

  /* ---------------- 3. 三组候选各摆各位 ---------------- */
  console.log('\n[3] 三组候选');
  const fetchedIds = JSON.parse(await evaluate(itemIds('fetched')));
  check('「厂商返回的列表」里有 mock-ultra-9', fetchedIds.includes('mock-ultra-9'), fetchedIds.join(','));
  check('重复的条目被去掉了（5 条 → 4 个唯一型号）', fetchedIds.length === 4, fetchedIds.join(','));
  const builtinIds = JSON.parse(await evaluate(itemIds('builtin')));
  check(
    '内置兜底那组摆着 deepseek-chat（还没拉到清单时能直接用的那几个）',
    builtinIds.includes('deepseek-chat'),
    builtinIds.join(','),
  );
  check(
    '同一个型号不会两组各出现一次',
    !fetchedIds.some((x) => builtinIds.includes(x)),
    `fetched=[${fetchedIds}] builtin=[${builtinIds}]`,
  );
  const recentIds = JSON.parse(await evaluate(itemIds('recent')));
  check('「最近用过」那组里有刚手填的那个', recentIds.includes('my-private-gateway-v2'), recentIds.join(','));

  /* ---------------- 4. 非对话模型：排后面 + 标出来 ---------------- */
  console.log('\n[4] 非对话模型的处理');
  check(
    '向量模型被标了「可能不是对话模型」',
    await evaluate(`!!document.querySelector('[data-model-id="text-embedding-3-small"] .mp-tag')`),
  );
  check(
    '但它没有被藏起来（猜错了顶多多看一眼，藏起来就找不到了）',
    fetchedIds.includes('text-embedding-3-small'),
  );
  check(
    '对话模型排在非对话模型前面',
    fetchedIds.indexOf('mock-ultra-9') < fetchedIds.indexOf('text-embedding-3-small'),
    fetchedIds.join(','),
  );

  /* ---------------- 5. 搜索 ---------------- */
  console.log('\n[5] 搜索');
  await setInput('[data-role=model-search]', 'ultra');
  await sleep(300);
  check(
    '搜索把两组一起筛了',
    (await evaluate(itemIds('fetched'))).includes('mock-ultra-9') &&
      !(await evaluate(itemIds('fetched'))).includes('tts-1'),
  );
  check(
    '一搜索就不再摆「最近用过」（不匹配的名字只是噪音）',
    (await evaluate(itemIds('recent'))) === '[]',
    await evaluate(itemIds('recent')),
  );
  await setInput('[data-role=model-search]', 'zzz-nope');
  await sleep(300);
  check('搜不到时说清楚，并提示可以手填', await evaluate(`!!document.querySelector('.mp-empty')`));
  await setInput('[data-role=model-search]', '');
  await sleep(250);

  /* ---------------- 6. 点一个就选中 ---------------- */
  console.log('\n[6] 选中');
  await click('[data-model-id="mock-ultra-9"]');
  await sleep(400);
  check(
    '输入框变成了选中的那个',
    (await evaluate(`document.querySelector('[data-role=model-input]').value`)) === 'mock-ultra-9',
  );
  check('面板自动关上了', !(await evaluate(`!!document.querySelector('[data-role=model-panel]')`)));

  /* ---------------- 7. 缓存：重开不再拉，点重新获取才拉 ---------------- */
  console.log('\n[7] 缓存与重新获取');
  await click('[data-role=model-toggle]');
  await sleep(900);
  const s2 = await stats();
  check('重开面板用的还是缓存，没有重复请求', s2.modelsFetched === 1, `modelsFetched=${s2.modelsFetched}`);
  check('但列表照样在（缓存是拿来用的，不是拿来重新拉的）', (await evaluate(itemIds('fetched'))).includes('mock-mini-3'));
  await click('[data-role=model-refresh]');
  const refreshed = await waitFor(`true`, 1200);
  await sleep(1200);
  const s3 = await stats();
  check('点「重新获取」才会再拉一次', s3.modelsFetched === 2 && refreshed, `modelsFetched=${s3.modelsFetched}`);

  /* ---------------- 8. 拉失败时把原因摆出来 ---------------- */
  console.log('\n[8] 拉失败');
  await setModelsMode('fail');
  await click('[data-role=model-refresh]');
  const failed = await waitFor(`!!document.querySelector('.mp-err')`, 15000);
  const failText = await evaluate(`document.querySelector('.mp-err')?.textContent || ''`);
  check('厂商报错时把状态码与原因摆出来（不是一句「失败了」）', failed && failText.includes('401'), failText.slice(0, 90));
  await setModelsMode('html');
  await click('[data-role=model-refresh]');
  const badShape = await waitFor(`${panelText}.includes('JSON') || !!document.querySelector('.mp-err')`, 15000);
  const badText = await evaluate(`document.querySelector('.mp-err')?.textContent || ''`);
  check('厂商返回错误页（不是 JSON）时说清是这么回事', badShape && badText.includes('JSON'), badText.slice(0, 90));
  check(
    '拉失败不会把上一份好清单扔掉',
    (await evaluate(itemIds('fetched'))).includes('mock-mini-3'),
  );
  await setModelsMode('ok');
  await click('[data-role=model-refresh]');
  await waitFor(`!document.querySelector('.mp-err')`, 15000);
  await click('[data-role=model-toggle]');
  await sleep(300);

  /* ---------------- 9. 切服务商 ---------------- */
  console.log('\n[9] 切服务商');
  await setSelect('[data-role=ai-provider]', 'openai');
  await sleep(500);
  const toOpenai = await savedAI();
  check('新家有内置兜底时用它第一个', toOpenai.model === 'gpt-4o-mini', toOpenai.model);
  check('新家自带地址时换地址', toOpenai.baseUrl === 'https://api.openai.com/v1', toOpenai.baseUrl);
  check('刚选的那个型号被记到旧家名下', toOpenai.modelByProvider?.deepseek === 'mock-ultra-9', JSON.stringify(toOpenai.modelByProvider));

  await setSelect('[data-role=ai-provider]', 'deepseek');
  await sleep(500);
  const back = await savedAI();
  check('切回来拿到自己挑过的那个（而不是又被覆盖成默认）', back.model === 'mock-ultra-9', back.model);
  check('地址也跟着回来', back.baseUrl === MOCK_URL, back.baseUrl);
  check(
    '地址被改过时会摆出「恢复官方地址」',
    await evaluate(`!!document.querySelector('[data-role=ai-base-url-reset]')`),
  );
  await click('[data-role=ai-base-url-reset]');
  await sleep(400);
  check(
    '点它就回到官方地址（记着改过的地址不等于把人困住）',
    (await savedAI()).baseUrl === 'https://api.deepseek.com/v1',
    (await savedAI()).baseUrl,
  );
  check(
    '恢复之后那个按钮就收起来了',
    !(await evaluate(`!!document.querySelector('[data-role=ai-base-url-reset]')`)),
  );
  // 后面的流程还要连假上游，把地址填回去
  await setInput('[data-role=ai-base-url]', MOCK_URL);
  await sleep(400);
  check('把地址填回假上游', (await savedAI()).baseUrl === MOCK_URL, (await savedAI()).baseUrl);

  await setSelect('[data-role=ai-provider]', 'custom');
  await sleep(400);
  const toCustom = await savedAI();
  check(
    '切到「自定义」不会清掉作者填的地址',
    toCustom.baseUrl === MOCK_URL,
    toCustom.baseUrl,
  );
  await setSelect('[data-role=ai-provider]', 'deepseek');
  await sleep(400);

  /* ---------------- 10. 采样参数 → 真的进请求 ---------------- */
  console.log('\n[10] 采样参数真的进了请求');
  await setInput('[data-role=ai-max-tokens]', '2048');
  await sleep(300);
  await setInput('[data-role=ai-top-p]', '0.5');
  await sleep(300);
  check(
    '设置里存下了 token 上限与 top_p',
    (await savedAI()).maxTokens === 2048 && (await savedAI()).topP === 0.5,
    JSON.stringify({ maxTokens: (await savedAI()).maxTokens, topP: (await savedAI()).topP }),
  );

  /* ---------------- 11. 高级区 ---------------- */
  console.log('\n[11] 高级区');
  check('默认是收起来的', !(await evaluate(`!!document.querySelector('[data-role=ai-advanced]')`)));
  await click('[data-role=ai-advanced-toggle]');
  await sleep(300);
  check('点开后出现', await evaluate(`!!document.querySelector('[data-role=ai-advanced]')`));
  await setSelect('[data-role=ai-json-mode]', 'auto');
  await sleep(200);

  await setInput('[data-role=ai-extra-headers]', '{ "X-Wf-Extra": "yes"');
  await sleep(300);
  check('额外请求头写歪了就地报红', await evaluate(`!!document.querySelector('.adv-warn')`));
  const warnText = await evaluate(`document.querySelector('.adv-warn')?.textContent || ''`);
  check('报错里点名是哪一栏', warnText.includes('请求头') || warnText.includes('headers'), warnText.slice(0, 80));
  await setInput('[data-role=ai-extra-headers]', '{ "X-Wf-Extra": "yes" }');
  await sleep(300);
  check('改对了红字就消失', !(await evaluate(`!!document.querySelector('.adv-warn')`)));
  await setInput('[data-role=ai-extra-body]', '{ "top_k": 40 }');
  await sleep(300);
  await evaluate(`document.querySelector('[data-role=ai-advanced]').scrollIntoView({ block: 'center' }); 'ok'`);
  await sleep(400);
  await shot(`${OUT}-2-advanced.png`);

  /* ---------------- 12. 这一整套配置发出去是什么样 ---------------- */
  console.log('\n[12] 发出去的请求');
  /**
   * 点「测试连接」，并等**厂商那边真的收到**一趟对话请求。
   *
   * 不能等界面上那句「连接成功」—— 页面上本来就有别的 `.banner.info`（存储那块），
   * 一等等到的就是它，统计于是读在请求发出之前（踩过）。等厂商收到的次数才准。
   */
  const runTest = async () => {
    const before = (await stats()).chatCount;
    const clicked = await evaluate(`(() => {
      const b = [...document.querySelectorAll('button')].find(x => x.textContent.includes('测试连接'));
      if (!b) return 'not-found';
      b.click();
      return 'ok';
    })()`);
    const arrived = await waitFor(
      `fetch('${MOCK}/__mock-stats').then(r => r.json()).then(s => s.chatCount > ${before})`,
      30000,
    );
    return { clicked, arrived, s: await stats() };
  };

  const t1 = await runTest();
  check('点「测试连接」', t1.clicked === 'ok');
  check('厂商那边真的收到了这一趟对话请求', t1.arrived, `chatCount=${t1.s.chatCount}`);
  check(
    '界面上报出连接成功（说明这些参数厂商那边全都吃得下）',
    await evaluate(`document.querySelector('[data-role=ai-test-result]')?.dataset.ok === '1'`),
    await evaluate(`document.querySelector('[data-role=ai-test-result]')?.textContent?.slice(0,90) || ''`),
  );
  check(
    'token 上限进了请求体 —— 测试连接自带 16 的短上限，刻意压过设置里的 2048',
    t1.s.lastBody?.max_tokens === 16,
    JSON.stringify(t1.s.lastBody?.max_tokens),
  );
  check('top_p 进了请求体', t1.s.lastBody?.top_p === 0.5, JSON.stringify(t1.s.lastBody?.top_p));
  check('额外请求体被合并进去了', t1.s.lastBody?.top_k === 40, JSON.stringify(t1.s.lastBody?.top_k));
  check(
    '额外请求体没有把 messages 顶掉',
    t1.s.lastMessageCount >= 2,
    `lastMessageCount=${t1.s.lastMessageCount}`,
  );
  check(
    '额外请求头真的发出去了',
    t1.s.lastHeaders?.['x-wf-extra'] === 'yes',
    JSON.stringify(t1.s.lastHeaders?.['x-wf-extra']),
  );
  check(
    'jsonMode=auto 时测试连接不带 response_format',
    t1.s.lastBody?.response_format === undefined,
    JSON.stringify(t1.s.lastBody?.response_format),
  );

  /* ---------------- 13. JSON 模式三态 ---------------- */
  console.log('\n[13] JSON 模式');
  check('高级区还开着（下面要改里面那一项）', await evaluate(`!!document.querySelector('[data-role=ai-advanced]')`));
  await setSelect('[data-role=ai-json-mode]', 'always');
  await sleep(300);
  const t2 = await runTest();
  check(
    'jsonMode=always 之后，连测试连接都带上了 json_object',
    t2.s.lastBody?.response_format?.type === 'json_object',
    JSON.stringify(t2.s.lastBody?.response_format),
  );
  await setSelect('[data-role=ai-json-mode]', 'auto');
  await sleep(300);

  /* ---------------- 14. 关掉流式 ---------------- */
  console.log('\n[14] 关掉流式');
  await click('[data-role=ai-stream]');
  await sleep(300);
  check('开关状态存下来了', (await savedAI()).stream === false);
  const t3 = await runTest();
  check('请求里 stream 变成了 false', t3.s.lastBody?.stream === false, JSON.stringify(t3.s.lastBody?.stream));
  check(
    '这一趟照样连得上（关流式不等于把路堵了）',
    await evaluate(`document.querySelector('[data-role=ai-test-result]')?.dataset.ok === '1'`),
  );
  await click('[data-role=ai-stream]');
  await sleep(300);
  check('再打开就回到流式', (await savedAI()).stream === true);
  await shot(`${OUT}-3-done.png`);

  /* ---------------- 15. 没有未捕获异常 ---------------- */
  const errors = client.events
    .filter((e) => e.method === 'Runtime.exceptionThrown')
    .map((e) => e.params.exceptionDetails?.exception?.description ?? 'unknown');
  check('没有未捕获异常', errors.length === 0, errors.slice(0, 2).join(' / '));

  chrome.kill();
  const failed2 = results.filter((r) => !r.ok);
  console.log(`\n结果：${results.length - failed2.length}/${results.length} 通过`);
  if (failed2.length) {
    console.log('失败项：', failed2.map((f) => f.name).join('、'));
    process.exit(1);
  }
}

main().catch((e) => {
  console.error('验证脚本异常：', e);
  chrome.kill();
  process.exit(1);
});
