/**
 * 开发期单元验证：型号可用性探测（`src/ai/probe.ts`，不需要浏览器）
 *
 * 为什么值得单独一条：
 * 探测的结论会**变成列表里一个颜色**。而颜色是没法自辩的 —— 判错档之后，
 * 作者看到的就是「这个型号是红的」，他会去换型号；可如果它其实是**渠道没余额**，
 * 换一百个型号也一样红。所以判据这几行必须拿真实文案钉死：
 *
 *   - 作者的原话「模型返回 402：Sorry, your account balance is insufficient.」
 *     **必须**判成「余额不足」，不能是泛泛的「有问题」；
 *   - 「余额不足」与「这个型号不存在」**必须**分开（要做的事完全不同）；
 *   - 「insufficient permissions」（权限）不能被「insufficient」抢成余额问题；
 *   - 「2xx 但没内容」不算可用 —— 这是「只有正确返回才测试成功」那条纪律的落点；
 *   - 超龄的结论要重探，不能拿昨天的余额当今天的余额。
 *
 * 用法：node .dev/unit-probe.mjs
 */
import { execSync } from 'node:child_process';
import { rmSync, readdirSync, readFileSync, writeFileSync, statSync, existsSync } from 'node:fs';
import { join } from 'node:path';

const OUT = '.tmp-probe';
try {
  rmSync(OUT, { recursive: true, force: true });
} catch {
  /* safe-delete shim 会拦批量删除（见 MEMORY.md）；往残留目录里覆写也安全 */
}
// `--lib dom` 是给 client.ts 里的 fetch / Response / DOMException 用的；
// `--types vite/client` 是给 translate.ts 里的 `import.meta.env` 用的
execSync(
  `npx tsc src/ai/probe.ts --outDir ${OUT} --module esnext ` +
    `--target es2020 --moduleResolution bundler --lib es2021,dom,dom.iterable ` +
    `--strict --types vite/client --skipLibCheck`,
  { stdio: 'inherit' },
);

/** 给编译产物里的相对导入补 .js 后缀（tsc 不会自动加，Node ESM 又必须要） */
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

const modPath = [`.tmp-probe/ai/probe.js`, `.tmp-probe/probe.js`].find((p) => existsSync(p));
if (!modPath) throw new Error('找不到编译产物 probe.js');

const {
  classifyProbe,
  toneOf,
  planProbe,
  probeCandidates,
  freshResults,
  isAbort,
  probeTitle,
  probeStateText,
  resolveProbeLimit,
  PROBE_TTL,
  PROBE_LIMIT,
  PROBE_LIMIT_MIN,
} = await import(`../${modPath}`);

let pass = 0;
let fail = 0;
const check = (name, ok, detail = '') => {
  if (ok) {
    pass++;
    console.log(`  ✓ ${name}`);
  } else {
    fail++;
    console.log(`  ✗ ${name}${detail ? ' — ' + detail : ''}`);
  }
};

const state = (ev) => classifyProbe(ev).state;

/* ------------------------------------------------------------------ */
console.log('\n[1] 什么叫「可用」');
{
  check('真的拿到回复才算可用', state({ content: 'ok' }) === 'ok');
  check('回复是空白不算可用（2xx 不等于说得上话）', state({ content: '   \n ' }) !== 'ok', state({ content: ' ' }));
  check(
    '通了但内容为空（chat() 抛 badShape）不算可用，也不是「没问题」',
    state({ status: undefined, message: '模型返回格式异常：{}' }) !== 'ok',
  );
  check(
    '而且它归到「通的，但读不懂」而不是「未知」—— 后者会让作者以为可能能用',
    state({ message: '模型返回格式异常：{"choices":[{"message":{"content":""}}]}' }) === 'noContent',
    state({ message: '模型返回格式异常：{"choices":[]}' }),
  );
}

/* ------------------------------------------------------------------ */
console.log('\n[2] 作者的原话：402 余额不足');
{
  const real = {
    status: 402,
    message: '模型返回 402：Sorry, your account balance is insufficient.',
  };
  check('渠道那句原话判成「余额不足」', state(real) === 'noBalance', state(real));
  check(
    '悬停说明里带上厂商原话（不然作者只知道是红的，不知道为什么）',
    probeTitle({ ...classifyProbe(real), at: 0 }).includes('insufficient'),
  );
  check(
    '「余额不足」这四个字真的出现在界面上（不是被别的措辞吃掉）',
    probeStateText('noBalance').includes('余额'),
    probeStateText('noBalance'),
  );
  check(
    '状态码被网关写成 400，但文案说了 balance —— 照样认出来',
    state({ status: 400, message: '模型返回 400：insufficient balance' }) === 'noBalance',
  );
  check(
    '429 + insufficient_quota 也是余额问题（不是「被限流」，它不会自己好）',
    state({ status: 429, message: '模型返回 429：You exceeded your current quota, type=insufficient_quota' }) ===
      'noBalance',
  );
  check('中文渠道的「余额不足」也认', state({ status: 400, message: '模型返回 400：账户余额不足' }) === 'noBalance');
  check('只给状态码 402、没有文案时也能判', state({ status: 402, message: '' }) === 'noBalance');
}

/* ------------------------------------------------------------------ */
console.log('\n[3] 别的失败各有各的结论');
{
  check('404 → 这个型号不存在', state({ status: 404, message: '模型返回 404：not found' }) === 'noModel');
  check(
    '400 + does not exist 也是型号不存在',
    state({ status: 400, message: '模型返回 400：The model `gpt-x` does not exist' }) === 'noModel',
  );
  check('401 → 钥匙不对', state({ status: 401, message: '模型返回 401：Unauthorized' }) === 'noAuth');
  check('403 → 钥匙不对', state({ status: 403, message: '模型返回 403：Forbidden' }) === 'noAuth');
  check(
    '「insufficient permissions」是权限、不是余额（这一条顺序错了就会让人去充钱）',
    state({ status: 403, message: '模型返回 403：insufficient permissions' }) === 'noAuth',
    state({ status: 403, message: '模型返回 403：insufficient permissions' }),
  );
  check(
    '429 纯限流 → 被限流（它自己会好，别写成「用不了」）',
    state({ status: 429, message: '模型返回 429：Rate limit reached for requests' }) === 'rateLimited',
  );
  check('500 → 厂商服务端出错', state({ status: 500, message: '模型返回 500：internal error' }) === 'serverError');
  check(
    '503 → 也是服务端',
    state({ status: 503, message: '模型返回 503：model is loading' }) === 'serverError',
  );
  check(
    '连不上（浏览器那句 Failed to fetch）→ unreachable',
    state({ message: '请求失败：Failed to fetch' }) === 'unreachable',
    state({ message: '请求失败：Failed to fetch' }),
  );
  check('两种路都走不通 → unreachable', state({ message: '直连与本地转发都失败了：connect ECONNREFUSED' }) === 'unreachable');
  check('超时 → unreachable', state({ message: '请求超时 timeout of 30000ms exceeded' }) === 'unreachable');
  check(
    '网关那句 502（连不上上游）→ unreachable，而不是「厂商服务端出错」',
    state({ status: 502, message: '模型返回 502：upstream connect error or disconnect/reset before headers' }) ===
      'unreachable',
    state({ status: 502, message: '模型返回 502：upstream connect error' }),
  );
  check(
    '有状态码但没有任何线索 → noContent（不是「没问题」）',
    state({ status: 418, message: '' }) === 'noContent',
  );
  check('什么都没有 → unknown', state({}) === 'unknown');
}

/* ------------------------------------------------------------------ */
console.log('\n[4] 竖条的三档配色');
{
  check('可用 → 绿', toneOf('ok') === 'ok');
  check('余额不足 → 橙（单独一档，因为要做的事不一样）', toneOf('noBalance') === 'warn');
  check('型号不存在 → 红', toneOf('noModel') === 'bad');
  check('连不上 → 红', toneOf('unreachable') === 'bad');
  check('还没探 → 灰（不写结论，也不冒充成红的）', toneOf(undefined) === 'idle');
}

/* ------------------------------------------------------------------ */
console.log('\n[5] 该探哪些（缓存 / 跳过 / 上限）');
{
  const models = [
    { id: 'a-chat', maybeNotChat: false },
    { id: 'b-embed', maybeNotChat: true },
    { id: 'c-chat', maybeNotChat: false },
  ];
  check(
    '非对话模型不探（探了必然红，一片红看着像渠道坏了）',
    !planProbe(models, {}).ids.includes('b-embed'),
    planProbe(models, {}).ids.join(','),
  );
  check('没结果的全探', planProbe(models, {}).ids.length === 2);

  const now = 1_800_000_000_000;
  const cached = { 'a-chat': { state: 'ok', at: now - 1000 } };
  check(
    '已有新鲜结论的跳过（重复打开面板不该重复打）',
    !planProbe(models, cached, PROBE_LIMIT, now).ids.includes('a-chat'),
  );
  const stale = { 'a-chat': { state: 'ok', at: now - PROBE_TTL - 1 } };
  check(
    '超龄的结论要重探（昨天的「能用」不代表今天还有钱）',
    planProbe(models, stale, PROBE_LIMIT, now).ids.includes('a-chat'),
  );
  check(
    '超龄的条目在读缓存那一层就被剔掉了',
    Object.keys(freshResults(stale, now)).length === 0,
  );
  check('新鲜的留着', Object.keys(freshResults(cached, now)).length === 1);

  const many = Array.from({ length: 7 }, (_, i) => ({ id: `m${i}`, maybeNotChat: false }));
  const plan = planProbe(many, {}, 3);
  check('超出上限就截断', plan.ids.length === 3);
  check('但如实报出还剩几个没探（截断不是丢弃）', plan.pending === 4, String(plan.pending));
}

/* ------------------------------------------------------------------ */
console.log('\n[6] 中止不是失败');
{
  const abortErr = Object.assign(new Error('The operation was aborted.'), { name: 'AbortError' });
  check('AbortError 认得出', isAbort(abortErr) === true);
  check('普通错误不算中止', isAbort(new Error('Failed to fetch')) === false);
  check('拿不到东西也不炸', isAbort(undefined) === false);
}

/* ------------------------------------------------------------------ */
console.log('\n[7] 上限是作者定的：能调大，也能不封顶');
{
  const many = Array.from({ length: 120 }, (_, i) => ({ id: `m${i}`, maybeNotChat: false }));

  check('不填就按默认（老设置里没有这个键）', planProbe(many, {}).ids.length === PROBE_LIMIT);
  check('调大就真的多探（不是嘴上说调了、实际还按默认来）', planProbe(many, {}, 200).ids.length === 120);
  check('调大后没有剩余时，不能说「还有 N 个没探」', planProbe(many, {}, 200).pending === 0);
  check('调小就真的少探', planProbe(many, {}, 5).ids.length === 5);
  check('少探的那些如实报出来（截断不是丢弃）', planProbe(many, {}, 5).pending === 115);

  const all = planProbe(many, {}, Infinity);
  check('不封顶 = 整份清单都探', all.ids.length === 120);
  check('不封顶时 pending 是 0（不是 NaN / -Infinity 挂到界面上）', all.pending === 0, String(all.pending));

  // —— resolveProbeLimit 是「设置 → 这一轮上限」的唯一接线，单独钉住
  check('没设过 → 默认值', resolveProbeLimit({}) === PROBE_LIMIT);
  check('设了就用设的', resolveProbeLimit({ probeLimit: 200 }) === 200);
  check('勾了「不限制」→ 不封顶', resolveProbeLimit({ probeUnlimited: true }) === Infinity);
  check(
    '勾了「不限制」时，哪怕是坏条数也照样不封顶',
    resolveProbeLimit({ probeUnlimited: true, probeLimit: 0 }) === Infinity,
  );
  check(
    '坏输入（0）回落成默认，**不许**悄悄放大成「全探」',
    resolveProbeLimit({ probeLimit: 0 }) === PROBE_LIMIT,
    String(resolveProbeLimit({ probeLimit: 0 })),
  );
  check('坏输入（NaN）也回落', resolveProbeLimit({ probeLimit: Number.NaN }) === PROBE_LIMIT);
  check('坏输入（负数）也回落', resolveProbeLimit({ probeLimit: -5 }) === PROBE_LIMIT);
  check('小数向下取整（发不了半个请求）', resolveProbeLimit({ probeLimit: 12.7 }) === 12);

  check('设置里填的数真的走到计划里', planProbe(many, {}, resolveProbeLimit({ probeLimit: 7 })).ids.length === 7);
  check(
    '勾了不限制 → 全探（而不是被读成「一个都不探」）',
    planProbe(many, {}, resolveProbeLimit({ probeUnlimited: true })).ids.length === 120,
  );

  /* —— 「现在还剩几条」与「这一轮打完之后还剩几条」是两件事，界面两个都要，别混用 —— */
  const plan5 = planProbe(many, {}, 5);
  check('planProbe.pending = 这一轮打**完**之后还剩几条', plan5.pending === 115, String(plan5.pending));
  check(
    'probeCandidates = **现在**还剩几条（两者差着一轮）',
    probeCandidates(many, {}).length === 120,
    String(probeCandidates(many, {}).length),
  );
  const part = Object.fromEntries(
    Array.from({ length: 30 }, (_, i) => [`m${i}`, { state: 'ok', at: Date.now() }]),
  );
  check('已有结论的从 candidates 里掉出去', probeCandidates(many, part).length === 90, String(probeCandidates(many, part).length));
  check(
    '非对话模型从来不算 candidates',
    probeCandidates([{ id: 'a-chat' }, { id: 'b-embed', maybeNotChat: true }], {}).length === 1,
  );
}

/* ------------------------------------------------------------------ */
console.log(`\n结果：${pass}/${pass + fail} 通过\n`);
if (fail) process.exitCode = 1;
