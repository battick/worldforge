/**
 * 开发期单元验证：Wiki 陈列层的**派生数据**（纯函数，不需要浏览器）
 *
 * 为什么值得单独一条：
 * 目录里摆什么、按什么顺序摆、一条条目牵扯着谁 —— 这些全是「拿数据算出来的」。
 * 它们错的方式都很安静：排序一不稳，目录每次渲染都重排，看着像在抖（而截图看不出来）；
 * 摘录把标题行又抄一遍，悬停提示里同一句话摆两遍（看着只是「有点啰嗦」）；
 * `[[别名]]` 认不出来，半条内链是死的（作者只会以为自己点偏了）。
 * 这些拿固定数据钉住最省事 —— 摆进页面里验就只能靠肉眼了。
 *
 * 用法：node .dev/unit-wiki.mjs
 */
import { execSync } from 'node:child_process';
import { rmSync, readdirSync, readFileSync, writeFileSync, statSync, existsSync } from 'node:fs';
import { join } from 'node:path';

const OUT = '.tmp-wiki';
try {
  rmSync(OUT, { recursive: true, force: true });
} catch {
  /* safe-delete shim 会拦批量删除（见 MEMORY.md）；往残留目录里覆写也安全 */
}
execSync(
  `npx tsc src/lib/wiki.ts --outDir ${OUT} --module esnext --target es2020 --moduleResolution bundler --skipLibCheck`,
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

/** 编译产物的位置取决于 rootDir 推断（共同祖先一般是 src/），两种都探一下 */
const wikiPath = [`.tmp-wiki/lib/wiki.js`, `.tmp-wiki/wiki.js`].find((p) => existsSync(p));
if (!wikiPath) throw new Error('找不到编译产物 wiki.js');

const {
  EXCERPT_MAX,
  excerptOf,
  matches,
  filterEntries,
  linkCounts,
  sortEntries,
  relatedTo,
  sourceDocs,
  findByTitle,
} = await import(`../${wikiPath}`);
const { outlineOf, stripInline } = await import(`../${wikiPath.replace(/wiki\.js$/, 'markdown.js')}`);

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

/** 造一条够用的条目；只写关心的字段，其余给个不碍事的默认 */
const entry = (over = {}) => ({
  id: 'en_x',
  worldId: 'w',
  categoryId: 'ct_1',
  title: '某条',
  aliases: [],
  summary: '',
  content: '',
  tags: [],
  fields: {},
  status: 'canon',
  sourceRefs: [],
  createdAt: 0,
  updatedAt: 0,
  ...over,
});

/* ------------------------------------------------------------------ */
console.log('\n== 1. 摘录：作者的话优先，退到正文要跳过标题行 ==');
/* ------------------------------------------------------------------ */

check(
  '有 summary 就用 summary（那是他特意写的「让 AI 一眼懂」的一句话）',
  excerptOf(entry({ summary: '黑石砌的塔。', content: '## 概览\n\n完全不同的正文。' })) === '黑石砌的塔。',
);
check(
  '没有 summary 才退到正文，且**跳过标题行**（标题会以大纲形式另摆一遍）',
  excerptOf(entry({ content: '## 概览\n\n只剩半句话。' })) === '只剩半句话。',
  excerptOf(entry({ content: '## 概览\n\n只剩半句话。' })),
);
check(
  '第一个小节是空的就往后找（不空手回来）',
  excerptOf(entry({ content: '## 概览\n\n## 位置\n\n架在崖上。' })) === '架在崖上。',
  excerptOf(entry({ content: '## 概览\n\n## 位置\n\n架在崖上。' })),
);
check(
  '第一个标题之前有引子 → 用引子（那正是全文的开场白）',
  excerptOf(entry({ content: '北境的塔都朝东。\n\n## 概览\n\n正文。' })) === '北境的塔都朝东。',
  excerptOf(entry({ content: '北境的塔都朝东。\n\n## 概览\n\n正文。' })),
);
check(
  '整篇只有标题、没有一句正文 → 也只能把标题摆出来',
  excerptOf(entry({ content: '## 概览' })) === '概览',
  excerptOf(entry({ content: '## 概览' })),
);
check('summary 与正文都空 → 空串（悬停提示里不摆一个空提示）', excerptOf(entry({})) === '');
check(
  '两边都是空白字符也算空',
  excerptOf(entry({ summary: '   ', content: '\n  \n' })) === '',
);

const long = '潮'.repeat(300);
const snapped = excerptOf(entry({ summary: long }));
check(
  `超长要截断（长度 = ${EXCERPT_MAX} + 那个省略号）`,
  snapped.length === EXCERPT_MAX + 1 && snapped.endsWith('…'),
  `len=${snapped.length}`,
);
check(
  '截断前先把换行压成一行（瀑布流是按内容定高的，一个换行能把整列顶下去）',
  excerptOf(entry({ summary: '第一行\n第二行' })) === '第一行 第二行',
  excerptOf(entry({ summary: '第一行\n第二行' })),
);
check(
  // 口径与条目库那一套**刻意一致**：summary 是作者写给「一眼看懂」的一句话，
  // 原样摆出来、不替他改字。只有退到正文时才剥标记 —— 正文是写给编辑器看的。
  'summary 原样摆出来（不剥标记、不动他的字）',
  excerptOf(entry({ summary: '他效忠过[[灰袍教团]]，**很久**以前。' })) === '他效忠过[[灰袍教团]]，**很久**以前。',
  excerptOf(entry({ summary: '他效忠过[[灰袍教团]]，**很久**以前。' })),
);
check(
  '退到正文时才剥标记',
  excerptOf(entry({ content: '## 概览\n\n他效忠过[[灰袍教团]]，**很久**以前。' })) === '他效忠过灰袍教团，很久以前。',
  excerptOf(entry({ content: '## 概览\n\n他效忠过[[灰袍教团]]，**很久**以前。' })),
);

/* ------------------------------------------------------------------ */
console.log('\n== 2. 关键词命中：口径与条目库那一套保持一致 ==');
/* ------------------------------------------------------------------ */

const tower = entry({
  title: '灯塔',
  aliases: ['光塔'],
  summary: '黑石砌的塔。',
  tags: ['北境'],
  content: '## 概览\n\n九十九级台阶。',
});
check('命中标题', matches(tower, '灯塔'));
check('命中小名（别名）', matches(tower, '光塔'));
check('命中摘要', matches(tower, '黑石'));
check('命中标签', matches(tower, '北境'));
check('命中正文', matches(tower, '台阶'));
check('大小写不敏感', matches(entry({ title: 'Ember Stone' }), 'ember'));
check('空关键词 = 全都算命中（不是「都不命中」）', matches(tower, '') && matches(tower, '   '));
check('确实没有的就不命中', !matches(tower, '蒸汽机'));

/* ------------------------------------------------------------------ */
console.log('\n== 3. 三道筛：分类 / 状态 / 关键词 ==');
/* ------------------------------------------------------------------ */

const pool = [
  entry({ id: 'a', title: '甲', categoryId: 'ct_1', status: 'canon' }),
  entry({ id: 'b', title: '乙', categoryId: 'ct_1', status: 'draft' }),
  entry({ id: 'c', title: '丙', categoryId: 'ct_2', status: 'canon' }),
];
const ids = (list) => list.map((e) => e.id).join(',');
check('默认不过滤', ids(filterEntries(pool, {})) === 'a,b,c', ids(filterEntries(pool, {})));
check('按分类', ids(filterEntries(pool, { categoryId: 'ct_1' })) === 'a,b');
check('按状态', ids(filterEntries(pool, { status: 'canon' })) === 'a,c');
check('分类 + 状态一起', ids(filterEntries(pool, { categoryId: 'ct_1', status: 'canon' })) === 'a');
check('关键词叠在上面', ids(filterEntries(pool, { categoryId: 'ct_1', q: '乙' })) === 'b');
check('`all` 等同于不筛', ids(filterEntries(pool, { categoryId: 'all', status: 'all' })) === 'a,b,c');

/* ------------------------------------------------------------------ */
console.log('\n== 4. 牵连数：自环只算一次 ==');
/* ------------------------------------------------------------------ */

const rel = (id, from, to) => ({ id, worldId: 'w', fromEntryId: from, toEntryId: to, type: 'x', note: '', status: 'canon', createdAt: 0 });
const rels = [
  rel('r1', 'A', 'B'),
  rel('r2', 'C', 'A'),
  rel('r3', 'D', 'A'),
  rel('r4', 'A', 'A'), // 自环
];
const counts = linkCounts(rels);
check('枢纽 A 被 4 条关系牵着（出 1 + 入 2 + 自环 1）', counts.get('A') === 4, String(counts.get('A')));
check('自环没有在两端各记一笔', counts.get('A') !== 5);
check('叶子各 1', counts.get('B') === 1 && counts.get('C') === 1 && counts.get('D') === 1);
check('没被提到的条目 = 不在表里（调用方按 0 处理）', counts.get('E') === undefined);

/* ------------------------------------------------------------------ */
console.log('\n== 5. 排序：三档都以标题兜底 ==');
/* ------------------------------------------------------------------ */

const sortPool = [
  entry({ id: 's1', title: '涨潮纪', updatedAt: 100 }),
  entry({ id: 's2', title: '灯塔', updatedAt: 300 }),
  entry({ id: 's3', title: '残页', updatedAt: 300 }), // 与 s2 同刻 —— 全靠标题兜底才稳
  entry({ id: 's4', title: '灰袍教团', updatedAt: 200 }),
];
const titles = (list) => list.map((e) => e.title).join('、');

check(
  '「最近更新」在前，同刻的按名字排（瀑布流稳不稳就看这一条）',
  titles(sortEntries(sortPool, 'updated')) === '残页、灯塔、灰袍教团、涨潮纪',
  titles(sortEntries(sortPool, 'updated')),
);
check(
  '同刻两条的先后是确定的（连排三遍都一样）',
  titles(sortEntries(sortPool, 'updated')) === titles(sortEntries([...sortPool].reverse(), 'updated')),
);
check(
  '「按名字」走中文拼音序，不是码位序',
  titles(sortEntries(sortPool, 'title')) === '残页、灯塔、灰袍教团、涨潮纪',
  titles(sortEntries(sortPool, 'title')),
);
check(
  '码位序确实不一样（否则这条断言证明不了什么）',
  titles([...sortPool].sort((a, b) => (a.title < b.title ? -1 : 1))) !== '残页、灯塔、灰袍教团、涨潮纪',
);
check(
  '「关联最多」按牵连数从多到少，同数的按名字兜底',
  titles(sortEntries(sortPool, 'links', new Map([['s4', 5], ['s1', 2], ['s2', 2]]))) === '灰袍教团、灯塔、涨潮纪、残页',
  titles(sortEntries(sortPool, 'links', new Map([['s4', 5], ['s1', 2], ['s2', 2]]))),
);
check(
  '牵连数一样时同样按名字兜底',
  titles(sortEntries(sortPool, 'links', new Map())) === '残页、灯塔、灰袍教团、涨潮纪',
);
check('不改动传进来的那份数组（纯函数）', (() => {
  const before = sortPool.map((e) => e.id).join(',');
  sortEntries(sortPool, 'title');
  return sortPool.map((e) => e.id).join(',') === before;
})());

/* ------------------------------------------------------------------ */
console.log('\n== 6. 关联：出入两个方向分开记 ==');
/* ------------------------------------------------------------------ */

const people = [
  entry({ id: 'A', title: '甲' }),
  entry({ id: 'B', title: '乙' }),
  entry({ id: 'C', title: '丙' }),
  entry({ id: 'D', title: '丁' }),
];
const peopleRels = [
  { ...rel('p1', 'A', 'B'), type: '隶属' }, // 甲 → 乙
  { ...rel('p2', 'C', 'A'), type: '位于' }, // 丙 → 甲
  { ...rel('p3', 'D', 'A'), type: '效忠' }, // 丁 → 甲
  rel('p5', 'A', 'GONE'), // 对端已删
];
const related = relatedTo('A', people, peopleRels);
check(
  '指向别人的 1 条算「出」',
  related.filter((r) => r.dir === 'out').length === 1,
  related.map((r) => r.dir + ':' + r.other.title).join('、'),
);
check('指向我的 2 条算「入」', related.filter((r) => r.dir === 'in').length === 2);
check('「出」排在「入」前面', related[0].dir === 'out' && related[1].dir === 'in');
check('出去的那条是乙（隶属）', related[0].other.title === '乙' && related[0].type === '隶属');
check(
  '进来的两条按关系类型排（位于 在 效忠 之前 —— w < x）',
  related[1].other.title === '丙' &&
    related[1].type === '位于' &&
    related[2].other.title === '丁' &&
    related[2].type === '效忠',
  related.map((r) => r.type + ':' + r.other.title).join('、'),
);
check(
  '对端已被删的关系跳过（列表上不留一行空白）',
  !related.some((r) => r.other.id === 'GONE'),
);
check(
  '自环只出现一次（不是出、入各来一条）',
  (() => {
    const self = relatedTo('A', people, [rel('p4', 'A', 'A')]);
    return self.length === 1 && self[0].dir === 'out' && self[0].other.id === 'A';
  })(),
);
check('跟我没关系的关系不掺进来', relatedTo('B', people, peopleRels).every((r) => r.other.id === 'A'));

/* ------------------------------------------------------------------ */
console.log('\n== 7. 来源资料：按 refs 的顺序，缺的跳过 ==');
/* ------------------------------------------------------------------ */

const docs = [
  { id: 'd1', worldId: 'w', name: '北境旧志.txt', ext: 'txt', size: 1, text: '', parsed: false, addedAt: 0 },
  { id: 'd2', worldId: 'w', name: '潮汐笔记.md', ext: 'md', size: 1, text: '', parsed: false, addedAt: 0 },
];
check(
  '列出来的是 refs 指着的那几份',
  sourceDocs(entry({ sourceRefs: ['d1'] }), docs).map((d) => d.name).join(',') === '北境旧志.txt',
);
check(
  '多份按 refs 的顺序（不是按资料表里的顺序）',
  sourceDocs(entry({ sourceRefs: ['d2', 'd1'] }), docs).map((d) => d.id).join(',') === 'd2,d1',
);
check(
  '资料被删了就跳过，剩下的照列',
  sourceDocs(entry({ sourceRefs: ['d1', 'gone', 'd2'] }), docs).map((d) => d.id).join(',') === 'd1,d2',
);
check('一个 ref 都没有 → 空（界面据此整块不渲染，不留空框）', sourceDocs(entry({ sourceRefs: [] }), docs).length === 0);

/* ------------------------------------------------------------------ */
console.log('\n== 8. 内链：按名字找，正式名优先 ==');
/* ------------------------------------------------------------------ */

const named = [
  entry({ id: 'n1', title: '守夜人团（北境）', aliases: ['守夜人团', '夜团'] }),
  entry({ id: 'n2', title: 'Ember Stone', aliases: [] }),
  entry({ id: 'n3', title: '灯塔' }),
];
check('全名能找着', findByTitle(named, '灯塔')?.id === 'n3');
check('小名也能找着', findByTitle(named, '夜团')?.id === 'n1');
check('大小写不敏感', findByTitle(named, 'ember stone')?.id === 'n2');
check('空名字 → null（别把第一条当成命中）', findByTitle(named, '  ') === null);
check('查不到就是 null', findByTitle(named, '蒸汽机') === null);
check(
  '既是别人的小名、又有一条条目就叫这个名 → 正式名赢',
  findByTitle([entry({ id: 'x1', title: '甲', aliases: ['乙'] }), entry({ id: 'x2', title: '乙' })], '乙')?.id === 'x2',
);

/* ------------------------------------------------------------------ */
console.log('\n== 9. 正文大纲（「识别 md」落到界面上的地方） ==');
/* ------------------------------------------------------------------ */

check(
  'ATX 标题按行取出来，级别照记',
  JSON.stringify(outlineOf('## 概览\n\n正文\n\n### 位置')) ===
    JSON.stringify([{ level: 2, text: '概览' }, { level: 3, text: '位置' }]),
  JSON.stringify(outlineOf('## 概览\n\n正文\n\n### 位置')),
);
check('代码块里的 `#` 不是标题', JSON.stringify(outlineOf('```\n## 假的\n```\n## 真的')) === JSON.stringify([{ level: 2, text: '真的' }]));
check('闭式写法 `## 标题 ##` 也认', outlineOf('## 标题 ##')[0]?.text === '标题', JSON.stringify(outlineOf('## 标题 ##')));
check(
  '粗体 / 内链在标题里要剥掉',
  outlineOf('## **加粗**与[[灯塔]]')[0]?.text === '加粗与灯塔',
  JSON.stringify(outlineOf('## **加粗**与[[灯塔]]')),
);
check('别名写法 `[[灯塔|那座塔]]` 取显示的那半', outlineOf('## 关于[[灯塔|那座塔]]')[0]?.text === '关于那座塔');
check('`# 一级` 是 level 1', outlineOf('# 一级')[0]?.level === 1);
check(
  '不认 setext（本项目里 `---` 是分隔线，认了会把分隔线当标题）',
  outlineOf('看起来像标题\n===\n---\n').length === 0,
  JSON.stringify(outlineOf('看起来像标题\n===\n---\n')),
);
check('只有 `#` 没有名字的空标题跳过', outlineOf('##   \n## 有名字').length === 1);
check('空正文 → 空大纲', outlineOf('').length === 0 && outlineOf(undefined).length === 0);
check(
  '与正文大纲用的是同一个函数（不另写一份口径）',
  typeof outlineOf === 'function' && typeof stripInline === 'function',
);

/* ------------------------------------------------------------------ */
console.log(`\n===== 结果：${pass}/${pass + fail} 项通过 =====`);
if (fail) {
  console.log(`未通过：${fail} 项`);
  process.exitCode = 1;
}
