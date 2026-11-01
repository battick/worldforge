/**
 * 开发期单元验证：AI 配置这一层的纯逻辑。
 *
 * 这一轮把「接入的 API 能配多细」铺开成了四组开关（型号、采样、额外请求头 / 请求体、
 * JSON 模式）。它们**全都只体现在「发出去的那个对象长什么样」**，从界面上是看不出来的 ——
 * 你在设置页勾了一个选项，谁来保证它真的进了请求？所以把构造过程抽成纯函数，
 * 在这里逐条钉住。
 *
 * 四节：
 *   [1] 请求体构造（buildChatBody / mergeHeaders / shouldStream）
 *   [2] 型号清单（parseModelList / sortModels / matchModel / buildChoices）
 *   [3] 服务商预设与记忆（switchProvider / rememberModel / PROVIDERS 自检）
 *   [4] 语言包自检（`ai.*` 里的孤儿键 —— 文案写好了没人引用，等于没写）
 *
 * 用法：node .dev/unit-ai-config.mjs
 */
import { execSync } from 'node:child_process';
import { rmSync, readdirSync, readFileSync, writeFileSync, statSync, existsSync } from 'node:fs';
import { join } from 'node:path';

const OUT = '.tmp-ai-config';
// 残留目录清不掉也不影响结论（环境里有一层 node-safe-delete-shim 会拦批量删除）
try {
  rmSync(OUT, { recursive: true, force: true });
} catch {
  /* 直接往残留目录里重写也安全 */
}

// 两个入口：models 会顺着 import 把 client / i18n 带进来。
// `--lib dom` 是给 client.ts 里的 fetch / Response / TextDecoder 用的；
// `--strict` 不能省 —— 少了它，`ExtraParse` 那种联合类型在 `if (!x.ok)` 处收窄不了，
// 整个文件会以一堆「属性不存在」报错，看着像是源码坏了，其实是编译参数没对齐。
execSync(
  `npx tsc src/ai/models.ts src/ai/providers.ts --outDir ${OUT} --module esnext ` +
    `--target es2020 --moduleResolution bundler --lib es2021,dom,dom.iterable ` +
    `--strict --types vite/client --skipLibCheck`,
  { stdio: 'inherit' },
);

/** 给编译产物里所有相对导入补 .js 后缀（tsc 不会自动加，Node ESM 又必须要） */
function patch(dir) {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) patch(p);
    else if (name.endsWith('.js')) {
      const s = readFileSync(p, 'utf8');
      const s2 = s.replace(/from '(\.[^']*)'/g, (m, spec) => {
        if (spec.endsWith('.js') || spec.endsWith('.json')) return m;
        const target = join(dir, spec);
        if (existsSync(target) && statSync(target).isDirectory() && existsSync(join(target, 'index.js'))) {
          return `from '${spec}/index.js'`;
        }
        return `from '${spec}.js'`;
      });
      if (s2 !== s) writeFileSync(p, s2);
    }
  }
}
patch(OUT);

const {
  buildChatBody,
  chat,
  mergeHeaders,
  parseExtraObject,
  readExtras,
  shouldStream,
  AIError,
} = await import(`../${OUT}/ai/client.js`);
const {
  parseModelList,
  sortModels,
  matchModel,
  buildChoices,
} = await import(`../${OUT}/ai/models.js`);
const {
  PROVIDERS,
  PROVIDER_GROUPS,
  switchProvider,
  rememberModel,
  urlOverridden,
  MAX_RECENT_MODELS,
  DEFAULT_AI_SETTINGS,
} = await import(`../${OUT}/ai/providers.js`);
const { PROBE_LIMIT } = await import(`../${OUT}/ai/probe.js`);
const { tGlobal } = await import(`../${OUT}/i18n/translate.js`);

const results = [];
const check = (name, ok, detail = '') => {
  results.push({ name, ok });
  console.log(`  ${ok ? '✓' : '✗'} ${name}${!ok && detail ? ' — ' + detail : ''}`);
};

/** 一份齐活的设置；每个用例只改它关心的那几项 */
const cfg = (patch = {}) => ({
  provider: 'custom',
  baseUrl: 'http://127.0.0.1:5190/v1',
  apiKey: 'k',
  model: 'm',
  temperature: 0.8,
  contextLimit: 60,
  vision: true,
  ...patch,
});

const MSGS = [{ role: 'user', content: 'hi' }];
const body = (patch, streaming = false, options = {}) =>
  buildChatBody(cfg(patch), MSGS, streaming, options);

/** 取「抛出来的那句话」，没抛就返回 null */
const thrown = (fn) => {
  try {
    fn();
    return null;
  } catch (e) {
    return e;
  }
};

/* ------------------------------------------------------------------ */
console.log('\n[1] 请求体构造');

const base = body({});
check(
  '默认只带 model / messages / temperature / stream',
  base.model === 'm' &&
    base.messages === MSGS &&
    base.temperature === 0.8 &&
    base.stream === false,
  JSON.stringify(base),
);
check('没设上限时不带 max_tokens', !('max_tokens' in base));
check('top_p = 1（默认）时不带这个字段', !('top_p' in base));
check('任务没要 JSON 时不带 response_format', !('response_format' in base));

check(
  '本次调用指定的 temperature 盖过设置里的',
  body({ temperature: 0.2 }, false, { temperature: 1.1 }).temperature === 1.1,
);
check('按设置里的 maxTokens 带上 max_tokens', body({ maxTokens: 2048 }).max_tokens === 2048);
check(
  '本次调用明确要的 token 上限优先于设置里的（测试连接那种短请求）',
  body({ maxTokens: 4096 }, false, { maxTokens: 16 }).max_tokens === 16,
  String(body({ maxTokens: 4096 }, false, { maxTokens: 16 }).max_tokens),
);
check('maxTokens 为 0 = 不限制 = 不带这个字段', !('max_tokens' in body({ maxTokens: 0 })));
check('maxTokens 是没填的 undefined 时也不带', !('max_tokens' in body({ maxTokens: undefined })));

check('top_p 在 0 与 1 之间时带上', body({ topP: 0.5 }).top_p === 0.5);
check('top_p = 1 视为「没设」不带', !('top_p' in body({ topP: 1 })));
check('top_p = 0 不合法，不带', !('top_p' in body({ topP: 0 })));
check('top_p 是没填的 undefined 时不带', !('top_p' in body({ topP: undefined })));

check(
  'jsonMode=auto：任务要 JSON 就带 json_object',
  body({ jsonMode: 'auto' }, false, { json: true }).response_format?.type === 'json_object',
);
check(
  'jsonMode=auto：任务不要 JSON 就不带',
  !('response_format' in body({ jsonMode: 'auto' }, false, { json: false })),
);
check(
  'jsonMode=always：任务不要也带上',
  body({ jsonMode: 'always' }, false, { json: false }).response_format?.type === 'json_object',
);
check(
  'jsonMode=never：任务要也不带（网关不认这个字段时选它）',
  !('response_format' in body({ jsonMode: 'never' }, false, { json: true })),
);

const withExtra = body({ extraBody: '{ "top_k": 40, "enable_thinking": false }' });
check('额外请求体里新字段进得去', withExtra.top_k === 40 && withExtra.enable_thinking === false);
check(
  '额外请求体可以顶掉内置字段（自建网关常要这么干）',
  body({ extraBody: '{ "temperature": 0.1 }' }).temperature === 0.1,
);
check(
  '额外请求体不许覆盖 messages',
  body({ extraBody: '{ "messages": [] }' }).messages === MSGS,
);
check('额外请求体为空串时一切照旧、不报错', !('top_k' in body({ extraBody: '   ' })));

const badBody = thrown(() => body({ extraBody: '{ "top_k": 40,, }' }));
check('额外请求体写歪了要抛错（不许静默忽略）', !!badBody && badBody instanceof AIError);
check(
  '报错里点名是「额外请求体」那一栏',
  !!badBody && badBody.message.includes(tGlobal('ai.extra.kind.body')),
  badBody?.message,
);
const arrBody = thrown(() => body({ extraBody: '[1, 2]' }));
check('额外请求体写成数组也要抛错', !!arrBody && arrBody.message.includes('JSON'), arrBody?.message);

/* ------------------------------------------------------------------ */
console.log('\n[2] 额外请求头');

check('没写额外头时不加任何东西', Object.keys(mergeHeaders({ A: '1' }, {})).length === 1);
check(
  '额外头加得进去',
  mergeHeaders({ A: '1' }, { 'X-Api-Version': '2024-01-01' })['X-Api-Version'] === '2024-01-01',
);
const overridden = mergeHeaders({ Authorization: 'Bearer old' }, { authorization: 'Bearer new' });
check(
  '同名字段不分大小写覆盖内置的 Authorization，且不留两个',
  overridden.Authorization === undefined &&
    Object.keys(overridden).filter((k) => k.toLowerCase() === 'authorization').length === 1 &&
    overridden.authorization === 'Bearer new',
  JSON.stringify(overridden),
);
check(
  '数字值转成字符串（请求头只能是字符串）',
  readExtras(cfg({ extraHeaders: '{ "X-N": 3 }' })).headers['X-N'] === '3',
);
check(
  '嵌套结构当没写（写进请求头也没意义）',
  readExtras(cfg({ extraHeaders: '{ "X-Bad": { "a": 1 } }' })).headers['X-Bad'] === undefined,
);
const badHead = thrown(() => buildChatBody(cfg({ extraHeaders: 'oops' }), MSGS, false, {}));
check('额外请求头写歪了要抛错', !!badHead && badHead instanceof AIError);
check(
  '报错里点名是「额外请求头」那一栏',
  !!badHead && badHead.message.includes(tGlobal('ai.extra.kind.headers')),
  badHead?.message,
);
check('parseExtraObject：空栏不算错（别让空栏一直报红）', parseExtraObject('', 'headers').ok === true);
check('parseExtraObject：坏 JSON 返回 not ok 而不是抛', parseExtraObject('{', 'body').ok === false);

/* ------------------------------------------------------------------ */
console.log('\n[3] 流式开关');

const onDelta = () => {};
check('默认（stream 没关）+ 给了回调 → 走流式', shouldStream(cfg(), { onDelta }) === true);
check('关掉 stream 后即使给了回调也不走流式', shouldStream(cfg({ stream: false }), { onDelta }) === false);
check('没给回调 → 不走流式', shouldStream(cfg(), {}) === false);
check('关掉 stream 时请求体里的 stream 也是 false', body({ stream: false }).stream === false);

// 光验「该不该走流式」不够 —— 关掉之后**界面还拿不拿得到内容**才是作者关心的事：
// 上层（工作台、任务表）靠 onDelta 显示「它正在写」，关掉流式若连回调都不补，
// 它们就会一直空着。这一段用假 fetch 把 `chat()` 整条路走一遍。
{
  const realFetch = globalThis.fetch;
  const seen = [];
  globalThis.fetch = async (_url, init) => {
    seen.push(JSON.parse(init.body));
    return new Response(JSON.stringify({ choices: [{ message: { content: '完整的回答' } }] }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
  };
  const chunks = [];
  const full = await chat(cfg({ stream: false }), MSGS, { onDelta: (c) => chunks.push(c) });
  check('关掉流式：请求体里 stream=false', seen[0].stream === false);
  check(
    '关掉流式：拿到全文后补了一次回调（界面不会白等一场）',
    full === '完整的回答' && chunks.length === 1 && chunks[0] === '完整的回答',
    JSON.stringify(chunks),
  );
  check('关掉流式：补的是**一次**，不是把全文拆片假装流式', chunks.length === 1);

  globalThis.fetch = async () =>
    new Response(
      'data: {"choices":[{"delta":{"content":"甲"}}]}\n\n' +
        'data: {"choices":[{"delta":{"content":"乙"}}]}\n\n' +
        'data: [DONE]\n\n',
      { status: 200, headers: { 'Content-Type': 'text/event-stream' } },
    );
  const chunks2 = [];
  const full2 = await chat(cfg(), MSGS, { onDelta: (c) => chunks2.push(c) });
  check('开着流式：按片回调，拼起来是全文', full2 === '甲乙' && chunks2.length === 2, JSON.stringify(chunks2));
  globalThis.fetch = realFetch;
}

/* ------------------------------------------------------------------ */
console.log('\n[4] 型号清单：解析');

const ids = (list) => list.map((m) => m.id).join(',');
check(
  '认 `{ data: [...] }` 这种（OpenAI 官方形状）',
  ids(parseModelList({ data: [{ id: 'gpt-4o' }, { id: 'gpt-4o-mini' }] })) === 'gpt-4o,gpt-4o-mini',
);
check(
  '也认 `{ models: [...] }`',
  ids(parseModelList({ models: [{ id: 'a' }] })) === 'a',
);
check('也认裸数组', ids(parseModelList([{ id: 'a' }, { id: 'b' }])) === 'a,b');
check('条目直接是字符串也认', ids(parseModelList(['a', 'b'])) === 'a,b');
check(
  '换键名（model / name / model_id）也认',
  ids(parseModelList([{ model: 'a' }, { name: 'b' }, { model_id: 'c' }])) === 'a,b,c',
);
check('去重', ids(parseModelList([{ id: 'a' }, { id: 'a' }, { id: 'b' }])) === 'a,b');
check(
  '没有型号名字的条目跳过（null / 数字 / 空串）',
  parseModelList([null, 3, { id: '' }, { id: 'ok' }]).length === 1,
);
check('完全对不上的输入返回空数组而不是抛', parseModelList({ nope: 1 }).length === 0);
check(
  'owned_by 读得出来（聚合站里这个字段很有用）',
  parseModelList({ data: [{ id: 'a', owned_by: 'qwen' }] })[0].ownedBy === 'qwen',
);

/* ------------------------------------------------------------------ */
console.log('\n[5] 型号清单：排序与筛选');

const mixed = parseModelList([
  { id: 'text-embedding-3-small' },
  { id: 'gpt-4o' },
  { id: 'tts-1' },
  { id: 'gpt-4o-mini' },
]);
check(
  '能对话的排在前面，向量 / 语音这类挪到最后',
  ids(mixed) === 'gpt-4o,gpt-4o-mini,text-embedding-3-small,tts-1',
  ids(mixed),
);
check('非对话那几条被标出来（而不是藏起来）', mixed[2].maybeNotChat === true && mixed[0].maybeNotChat === false);
const dated = parseModelList([
  { id: 'old', created: 100 },
  { id: 'new', created: 900 },
  { id: 'mid', created: 500 },
]);
check('给了创建时间时新的在前', ids(dated) === 'new,mid,old', ids(dated));
const undated = parseModelList([{ id: 'z' }, { id: 'a' }, { id: 'm' }]);
check('没给创建时间时保持厂商原来的顺序（稳定，不许每次渲染换位置）', ids(undated) === 'z,a,m', ids(undated));
check('sortModels 不修改传入的数组', (() => {
  const src = parseModelList([{ id: 'a' }, { id: 'b' }]);
  const copy = ids(src);
  sortModels(src);
  return ids(src) === copy;
})());

const pool = parseModelList([
  { id: 'qwen-max', owned_by: 'alibaba' },
  { id: 'qwen-plus', owned_by: 'alibaba' },
  { id: 'gpt-4o', owned_by: 'openai' },
]);
check('空查询全中', pool.filter((m) => matchModel(m, '')).length === 3);
check('子串命中', pool.filter((m) => matchModel(m, 'qwen')).length === 2);
check('大小写不敏感', pool.filter((m) => matchModel(m, 'QWEN')).length === 2);
check('多个词要全部命中（「qwen max」这种搜法很常见）', pool.filter((m) => matchModel(m, 'qwen max')).length === 1);
check('有词没命中就排除', pool.filter((m) => matchModel(m, 'qwen gpt')).length === 0);
check('归属方也参与匹配', pool.filter((m) => matchModel(m, 'openai')).length === 1);

/* ------------------------------------------------------------------ */
console.log('\n[6] 型号清单：面板上的三组');

const groups = (input) =>
  buildChoices({ recent: [], builtin: [], fetched: [], query: '', ...input });
const g1 = groups({
  recent: ['gpt-4o'],
  fetched: parseModelList([{ id: 'gpt-4o' }, { id: 'qwen-max' }]),
});
check('最近用过的那组在，且里面就是它', ids(g1.recent) === 'gpt-4o');
check('同一个型号不会在两组里各出现一次', ids(g1.fetched) === 'qwen-max', ids(g1.fetched));
check('分组的来源标出来了（界面靠它给个提示）', g1.recent[0].source === 'recent' && g1.fetched[0].source === 'fetched');

const g2 = groups({ recent: ['gpt-4o'], fetched: [], query: 'qwen' });
check('一搜索就不摆「最近用过」那组（不匹配的名字只是噪音）', g2.recent.length === 0);

const g3 = groups({
  fetched: parseModelList([{ id: 'gpt-4o' }]),
  builtin: ['gpt-4o', 'deepseek-chat'],
});
check(
  '内置兜底那组只留厂商列表里没有的',
  ids(g3.builtin) === 'deepseek-chat',
  ids(g3.builtin),
);

const g4 = groups({ fetched: parseModelList([{ id: 'qwen-max' }, { id: 'gpt-4o' }]), query: 'qwen' });
check('搜索把厂商列表那组也筛了', ids(g4.fetched) === 'qwen-max');

/* ------------------------------------------------------------------ */
console.log('\n[7] 服务商预设与记忆');

check('记住的型号最新在前', rememberModel(['a'], 'b').join(',') === 'b,a');
check('重复的型号被提到最前而不是出现两次', rememberModel(['a', 'b'], 'b').join(',') === 'b,a');
check(
  `最多记 ${MAX_RECENT_MODELS} 个，超了丢最旧的`,
  rememberModel(Array.from({ length: MAX_RECENT_MODELS + 3 }, (_, i) => `m${i}`), 'new').length ===
    MAX_RECENT_MODELS,
);
check('空白型号不进记忆', rememberModel(['a'], '   ').join(',') === 'a');

const from = cfg({ provider: 'deepseek', model: 'deepseek-reasoner', modelByProvider: {} });
const toOpenai = switchProvider(from, 'openai');
check('切服务商时把当前这家的型号记到它名下', toOpenai.modelByProvider.deepseek === 'deepseek-reasoner');
check('新家没记住过 → 用它的内置兜底第一个', toOpenai.model === 'gpt-4o-mini', toOpenai.model);
check('新家自带地址时换地址', toOpenai.baseUrl === 'https://api.openai.com/v1');

const back = switchProvider(cfg({ ...from, ...toOpenai }), 'deepseek');
check('切回来拿到自己挑过的那个（而不是又被覆盖成默认）', back.model === 'deepseek-reasoner', back.model);

const toCustom = switchProvider(cfg({ provider: 'openai', baseUrl: 'https://api.openai.com/v1', model: 'gpt-4o' }), 'custom');
check(
  '切到「自定义」不清掉作者填的地址（这是最气人的一种「帮忙」）',
  toCustom.baseUrl === undefined,
  String(toCustom.baseUrl),
);
check(
  '新家既没记住过也没内置兜底 → 型号清空（不然会拿上一家的型号去请求）',
  toCustom.model === '',
  String(toCustom.model),
);

// 地址：只记「和官方不一样」的。把预设指向中转站是国内很常见的用法，
// 不记这一笔的话「切去别家看一眼再切回来」会静默还原成官方地址。
const pristine = cfg({ provider: 'deepseek', baseUrl: 'https://api.deepseek.com/v1', model: 'deepseek-chat' });
check(
  '把预设指向中转站后再切走 → 那个地址被记下来',
  switchProvider(from, 'openai').baseUrlByProvider.deepseek === 'http://127.0.0.1:5190/v1',
);
check(
  '切回来时改过的地址也一起回来（不然够不到官方域名的人就被弄坏了）',
  back.baseUrl === 'http://127.0.0.1:5190/v1',
  String(back.baseUrl),
);
check(
  '没动过地址的人不会多出一堆记录',
  Object.keys(switchProvider(pristine, 'openai').baseUrlByProvider).length === 0,
  JSON.stringify(switchProvider(pristine, 'openai').baseUrlByProvider),
);
check('改回官方地址后那条记录会被取消', (() => {
  const backToOfficial = switchProvider(
    cfg({ provider: 'deepseek', baseUrl: 'https://api.deepseek.com/v1', baseUrlByProvider: { deepseek: 'http://x/v1' } }),
    'openai',
  );
  return backToOfficial.baseUrlByProvider.deepseek === undefined;
})());

check('urlOverridden：地址和官方一样时是 false', urlOverridden(pristine) === false);
check('urlOverridden：地址被改过时是 true', urlOverridden(from) === true);
check('urlOverridden：「自定义」没有官方地址，不算改过', urlOverridden(cfg({ provider: 'custom' })) === false);

check('切到当前已在用的那家 → 什么都不改', Object.keys(switchProvider(from, 'deepseek')).length === 0);

check('服务商 id 不重复', new Set(PROVIDERS.map((p) => p.id)).size === PROVIDERS.length);
check(
  '分组只能是那三种',
  PROVIDERS.every((p) => PROVIDER_GROUPS.includes(p.group)),
);
check(
  '除「自定义」外都有地址',
  PROVIDERS.every((p) => p.id === 'custom' || p.baseUrl.startsWith('http')),
);
check(
  '内置兜底清单里没有空串',
  PROVIDERS.every((p) => p.fallbackModels.every((m) => m.trim() === m && !!m)),
);

/* ------------------------------------------------------------------ */
console.log('\n[8] 语言包：ai.* 没有孤儿键');
/** 把 src 下所有源码读成一份文本（语言包本身除外 —— 那里的键是「定义」，不是「引用」） */
function sourceText() {
  const out = [];
  const walk = (d) => {
    for (const n of readdirSync(d)) {
      const p = join(d, n);
      if (statSync(p).isDirectory()) walk(p);
      else if (/\.tsx?$/.test(n) && !p.replace(/\\/g, '/').includes('src/i18n/locales/')) {
        out.push(readFileSync(p, 'utf8'));
      }
    }
  };
  walk('src');
  return out.join('\n');
}
const SRC = sourceText();
const definedIn = (file) => {
  const src = readFileSync(file, 'utf8');
  const out = [];
  for (const m of src.matchAll(/^ {2}'([a-zA-Z][A-Za-z0-9_.]+)':/gm)) out.push(m[1]);
  return out;
};
const aiKeys = [...definedIn('src/i18n/locales/zh/ai.ts'), ...definedIn('src/i18n/locales/zh/settings.ts')].filter(
  (k) => k.startsWith('ai.') || k.startsWith('settings.ai.'),
);
check('键读出来了（不是把文件读空了）', aiKeys.length > 100, `${aiKeys.length} 个键`);

const orphans = aiKeys.filter((k) => !SRC.includes(`'${k}'`));
check('每个 ai.* / settings.ai.* 键都真的有地方引用', orphans.length === 0, orphans.join(', '));

check(
  '每个服务商的 nameKey / hintKey 都在语言包里（拼错就是运行时显示键名）',
  PROVIDERS.every((p) => aiKeys.includes(p.nameKey) && aiKeys.includes(p.hintKey)),
  PROVIDERS.filter((p) => !aiKeys.includes(p.nameKey) || !aiKeys.includes(p.hintKey))
    .map((p) => p.id)
    .join(', '),
);

/* ------------------------------------------------------------------ */
console.log('\n[9] 本机转发器也要把额外请求头带上');

// 这一条是 e2e 在「假上游不加 --cors」的那一趟里逼出来的：浏览器直连被拦时应用会退回
// 本机转发，而转发器原来是**重建**请求头（只留 Content-Type / Accept / User-Agent /
// Authorization），作者写的额外头全丢 —— 同一个配置直连能用、走转发就没了。
const proxy = await import('../tools/local-proxy.mjs');
const fwd = proxy.forwardHeaders({
  'content-type': 'application/json',
  authorization: 'Bearer k',
  'x-wf-upstream': 'https://api.example.com/v1/chat/completions',
  'x-wf-extra': 'yes',
  'x-api-version': '2024-01-01',
  host: '127.0.0.1:5188',
  connection: 'keep-alive',
  origin: 'http://127.0.0.1:5188',
  referer: 'http://127.0.0.1:5188/',
  'accept-encoding': 'gzip, deflate, br',
  'accept-language': 'zh-CN',
  'sec-fetch-mode': 'cors',
  'user-agent': 'Mozilla/5.0',
});

check(
  '额外请求头会被转发出去（退回本机转发时的活路）',
  fwd['x-wf-extra'] === 'yes' && fwd['x-api-version'] === '2024-01-01',
  JSON.stringify(fwd),
);
check('Authorization 带着', fwd.Authorization === 'Bearer k', String(fwd.Authorization));
check('Content-Type 按原样的来', fwd['Content-Type'] === 'application/json');
check('我们自己的管道头不会被转发给厂商', fwd['x-wf-upstream'] === undefined);
check(
  '浏览器自带的 Origin / Referer 不转发（只会让网关困惑）',
  fwd.origin === undefined && fwd.referer === undefined,
);
check('逐跳头不转发', fwd.host === undefined && fwd.connection === undefined);
check('Sec-* 一律不转发', !Object.keys(fwd).some((k) => k.toLowerCase().startsWith('sec-')));
check('Accept-Encoding 不转发（node 的 fetch 自己会设）', fwd['accept-encoding'] === undefined);
check('User-Agent 还是转发器自己的，不冒充浏览器', fwd['User-Agent'] === 'WorldForge-LocalProxy/1.0');
check(
  '前端的转发路径与头名和转发器一致（各写一份迟早对不上）',
  readFileSync('src/ai/client.ts', 'utf8').includes(`'${proxy.PROXY_PREFIX}'`) &&
    readFileSync('src/ai/client.ts', 'utf8').includes(`'${proxy.UPSTREAM_HEADER}'`),
);

/* ------------------------------------------------------------------ */
console.log('\n[10] 探测上限：是个能设的值，不是写死的 40');
check(
  '默认值与 PROBE_LIMIT 是同一个数（两处各写一个迟早对不上）',
  DEFAULT_AI_SETTINGS.probeLimit === PROBE_LIMIT,
  `${DEFAULT_AI_SETTINGS.probeLimit} vs ${PROBE_LIMIT}`,
);
check('默认不勾「不限制」', DEFAULT_AI_SETTINGS.probeUnlimited === false);
check(
  '读法唯一：这一轮上限只走 resolveProbeLimit',
  readFileSync('src/components/ModelPicker.tsx', 'utf8').includes('resolveProbeLimit(settings)'),
);
check(
  '这一项**只有一个入口**（选型号面板里那个）；设置页不再摆第二份',
  readFileSync('src/components/ModelPicker.tsx', 'utf8').includes('probeUnlimited: e.target.checked') &&
    !readFileSync('src/pages/SettingsPage.tsx', 'utf8').includes('probeLimit') &&
    !readFileSync('src/pages/SettingsPage.tsx', 'utf8').includes('probeUnlimited'),
);

/* ------------------------------------------------------------------ */
const failed = results.filter((r) => !r.ok);
console.log(`\n结果：${results.length - failed.length}/${results.length} 通过`);
if (failed.length) {
  console.log('失败项：', failed.map((f) => f.name).join('、'));
  process.exit(1);
}
