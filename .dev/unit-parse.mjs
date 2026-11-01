/**
 * 开发期单元验证：模型返回的「列表」解析（纯函数，不需要浏览器）
 *
 * 为什么要专门给这一层写断言：
 * 每条任务的提示词都写明了返回形状（文档抽取 `items`、一致性检查 `issues`、
 * 关系推荐 `relations`……），而解析层曾经只认一份硬编码的白名单 —— 名单漏了一个键，
 * 结果就被**静默丢空**，界面上的表现是「没有发现问题」。
 * 假上游永远吐标准形状，端到端测不出这个偏差（它恰恰是忠实复刻契约才暴露的）。
 *
 * 这里同时锁两件事：
 *   1. 提示词里出现过的每个列表键，解析层必须都认；
 *   2. 「它说没有问题（空数组）」与「它答非所问（压根没有列表）」必须能区分 ——
 *      后者不许冒充前者。
 *
 * 用法：node .dev/unit-parse.mjs
 */
import { execSync } from 'node:child_process';
import { rmSync, readdirSync, readFileSync, writeFileSync, statSync, existsSync } from 'node:fs';
import { join } from 'node:path';

const OUT = '.tmp-unit-parse';
// 清临时目录失败不该影响结论：环境里有一层 `node-safe-delete-shim` 会拦 rmSync，
// 残留目录里的文件数超过阈值时它直接抛 SAFE_DELETE_BULK_CONFIRM_REQUIRED；
// Windows 上被占用的文件还会 EPERM/EBUSY。被它带走的话，末行只剩一个 `Node.js v22.22.2`，
// 看着像「单测全崩」，其实断言一条都没跑。删不掉也不影响正确性：tsc 会覆写。
function clean() {
  try {
    rmSync(OUT, { recursive: true, force: true });
  } catch {
    /* 下次运行开头还会再删一遍 */
  }
}
clean();
execSync(
  `npx tsc src/ai/parse.ts --outDir ${OUT} --module esnext --target es2020 --moduleResolution bundler --skipLibCheck`,
  { stdio: 'inherit' },
);

/** tsc 不会给相对导入补 .js，Node ESM 又必须要 */
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

const { asArray, hasListShape } = await import(`../${OUT}/ai/parse.js`);

const cases = [];
const one = { id: 1 };

/* ---- 1. 提示词里明写过的每个列表键都要认 ----
   左边是键名，右边是它在哪条任务里出现。漏一个就是一处静默丢结果。 */
const SHAPES = [
  ['items', '文档抽取（docExtract）'],
  ['entries', '批量生成条目（generate）'],
  ['issues', '一致性检查（consistency）'],
  ['relations', '关系推荐（relation）'],
  ['suggestions', '文章审校（article）'],
  ['questions', '追问（suggest）'],
  ['layout', '时间轴自动排版（timeline-layout）'],
  ['categories', '世界草案'],
  ['rules', '世界草案'],
  ['data', '模型自套的壳'],
  ['results', '模型自套的壳'],
];
for (const [key, where] of SHAPES) {
  cases.push([`asArray 认 {"${key}": [...]}（${where}）`, asArray({ [key]: [one] }).length === 1]);
}

/* ---- 2. 根就是数组 ---- */
cases.push(['asArray 认根级数组', asArray([one, one]).length === 2]);

/* ---- 3. 键名对不上时的兜底：整份返回只有一个数组字段 ---- */
cases.push(['唯一数组字段时认它（issues 被写成 conflicts）', asArray({ conflicts: [one] }).length === 1]);
cases.push([
  '有多个数组字段就不猜（真歧义，宁可返回空）',
  asArray({ a: [one], b: [one, one] }).length === 0,
]);
cases.push([
  '既定的键优先于「唯一数组」兜底',
  asArray({ conflicts: [one, one, one], issues: [one] }).length === 1,
]);

/* ---- 4. 再包一层 ---- */
cases.push(['认 {"data": {"items": [...]}}', asArray({ data: { items: [one] } }).length === 1]);
cases.push(['认 {"result": {"issues": [...]}}', asArray({ result: { issues: [one] } }).length === 1]);

/* ---- 5. 「它说没问题」与「我们没读懂」必须分得开 ---- */
cases.push(['{"issues": []} 是结论：有列表形态', hasListShape({ issues: [] }) === true]);
cases.push(['{"issues": []} 解析出空数组', asArray({ issues: [] }).length === 0]);
cases.push(['[] 也是结论：有列表形态', hasListShape([]) === true]);
cases.push([
  '{"note": "..."} 没有列表形态 —— 不许冒充「没问题」',
  hasListShape({ note: '设定自洽' }) === false,
]);
cases.push(['答非所问时 asArray 给空数组', asArray({ note: '设定自洽' }).length === 0]);
cases.push(['字符串不是列表', hasListShape('ok') === false]);
cases.push(['null 不是列表', hasListShape(null) === false]);
cases.push(['数字不是列表', hasListShape(42) === false]);

/* ---- 6. 真实形状：假上游/真模型的那一份 ---- */
const CONSISTENCY = {
  issues: [
    {
      title: '烬石储量与城邦规模不匹配',
      severity: 'medium',
      detail: '人口规模需要远超当前描述的产量。',
      suggestion: '补充一条地下深层矿脉，或调低盆地人口。',
      entryTitles: ['烬落盆地'],
    },
  ],
};
cases.push(['一致性检查的真实返回能解析出 1 条问题', asArray(CONSISTENCY).length === 1]);
cases.push([
  '问题标题没丢',
  asArray(CONSISTENCY)[0].title === '烬石储量与城邦规模不匹配',
]);

const RELATIONS = { relations: [{ from: '匠人同盟', to: '烬石', type: '依赖' }] };
cases.push(['关系推荐的真实返回能解析出 1 条关系', asArray(RELATIONS).length === 1]);

/* 排版：根键是 layout，条目字段是 title/at/…（假上游 LAYOUT_PLAN 就是这份） */
const LAYOUT = {
  layout: [
    { title: '涨潮纪', at: 111, era: '涨潮纪', reason: '它是这套历法的起点。' },
    { title: '潮汐槽', at: 222, weight: 'normal', reason: '海面下降才露出浅槽。' },
  ],
  note: '重排了一遍。',
};
cases.push(['排版的真实返回能解析出 2 条方案', asArray(LAYOUT).length === 2]);
cases.push(['方案里的位置没丢（at 是数字，不是字符串）', asArray(LAYOUT)[0].at === 111]);

/* ---------------- 汇总 ---------------- */
let bad = 0;
for (const [name, ok] of cases) {
  if (!ok) bad++;
  console.log(`${ok ? 'OK  ' : 'FAIL'}  ${name}`);
}
console.log(`\n单元验证（parse）：${cases.length - bad}/${cases.length} 通过。`);
if (bad) process.exitCode = 1;
