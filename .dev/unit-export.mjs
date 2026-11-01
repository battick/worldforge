/**
 * 开发期单元验证：导出设定集的内链锚点（纯函数，不需要浏览器）
 *
 * 为什么值得单独一条：
 * 导出的 Markdown/HTML 里，`[[条目]]` 要折成真链接 `[条目](#锚点)`，锚点必须
 * 与标题一一对应、且经得起中文/空格/标点的折腾 —— 一旦锚点算错，点目录就
 * 跳到别的条目（或干脆点空）。这里把锚点与折链两条规则钉死。
 *
 * 用法：node .dev/unit-export.mjs
 */
import { execSync } from 'node:child_process';
import { rmSync, readdirSync, readFileSync, writeFileSync, statSync, existsSync } from 'node:fs';
import { join } from 'node:path';

const OUT = '.tmp-unit-export';
try {
  rmSync(OUT, { recursive: true, force: true });
} catch {
  /* safe-delete shim 会拦批量删除；往残留目录里覆写也安全 */
}
execSync(
  `npx tsc src/lib/export.ts --outDir ${OUT} --module esnext --target es2020 --moduleResolution bundler --skipLibCheck`,
  { stdio: 'inherit' },
);

/** 给编译产物里的相对导入补 .js 后缀 */
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

const { anchorOf, buildHtml, buildMarkdown } = await import(`../${OUT}/lib/export.js`);

const cases = [];
const eq = (title, expected) =>
  cases.push([`anchorOf(${JSON.stringify(title)}) => ${JSON.stringify(expected)}`, anchorOf(title) === expected]);

/* ---- 基础：中文照原样保留 ---- */
eq('长安', '长安');
eq('守灯人', '守灯人');
eq('张三', '张三');

/* ---- 英文小写 + 空格折横杠 ---- */
eq('Alice Bob', 'alice-bob');
eq('  Alice  Bob  ', 'alice-bob');

/* ---- 标点剥离 ---- */
eq('第三纪·灰烬之年', '第三纪灰烬之年');
eq("Alice's Book", 'alices-book');
eq('Alice & Bob', 'alice-bob');
eq('涨潮纪 9 年', '涨潮纪-9-年');

/* ---- 连续横杠合并、首尾清除 ---- */
eq('A - B', 'a-b');
eq('A--B', 'a-b');
eq('-alice-', 'alice');

/* ---- 数字保留 ---- */
eq('Alice 007', 'alice-007');
eq('42', '42');

/* ---- 空标题兜底 ---- */
eq('', '');
eq('   ', '');
eq('!!!', '');

/* ---- 锚点应能唯一区分 ---- */
const distinct = [
  ['长安', '洛阳'],
  ['张三', '李四'],
  ['涨潮纪', '烬落纪'],
];
for (const [a, b] of distinct) {
  cases.push([`不同标题不同锚点: ${JSON.stringify(a)} != ${JSON.stringify(b)}`, anchorOf(a) !== anchorOf(b)]);
}

/* ---- buildMarkdown：内链折成真链接、目录可跳、不留 [[ ]] ---- */
{
  const world = { id: 'w', name: '测试世界', tagline: '', summary: '', genre: '', tone: '', themeColor: '', createdAt: 0, updatedAt: 0 };
  const categories = [{ id: 'c', worldId: 'w', name: '人物', icon: '', fieldDefs: [], order: 0, createdAt: 0, updatedAt: 0 }];
  const entries = [
    { id: 'e1', worldId: 'w', categoryId: 'c', title: '长安', key: '长安', aliases: [], summary: '', content: '[[洛阳]]', tags: [], fields: {}, status: 'canon', sourceRefs: [], createdAt: 0, updatedAt: 0 },
    { id: 'e2', worldId: 'w', categoryId: 'c', title: '洛阳', key: '洛阳', aliases: [], summary: '', content: '见 [[长安|都城]]', tags: [], fields: {}, status: 'canon', sourceRefs: [], createdAt: 0, updatedAt: 0 },
  ];
  const relations = [];
  const opts = { includeDraft: true, includeRelations: true, includeInternalLinks: true, includeTimeline: false };
  const md = buildMarkdown(world, categories, entries, relations, [], opts);
  cases.push(['Markdown 目录是能跳的链接', md.includes('- [长安](#长安)') && md.includes('- [洛阳](#洛阳)')]);
  cases.push(['Markdown 正文内链折成 [x](#锚点)', md.includes('[洛阳](#洛阳)')]);
  cases.push(['Markdown 内链带显示文本也折对', md.includes('[都城](#长安)')]);
  cases.push(['Markdown 里没有残留 [[ ]]', !/\[\[[^\]\n]+\]\]/.test(md)]);
}

/* ---- buildHtml：标题挂 id、目录/内链是 <a href="#锚点">、媒体占位如实 ---- */
{
  const world = { id: 'w', name: '测试世界', tagline: '', summary: '', genre: '奇幻', tone: '', themeColor: '', createdAt: 0, updatedAt: 0 };
  const categories = [{ id: 'c', worldId: 'w', name: '人物', icon: '', fieldDefs: [], order: 0, createdAt: 0, updatedAt: 0 }];
  const entries = [
    { id: 'e1', worldId: 'w', categoryId: 'c', title: '长安', key: '长安', aliases: [], summary: '概述文字', content: '[[洛阳]]', tags: [], fields: {}, status: 'canon', sourceRefs: [], createdAt: 0, updatedAt: 0 },
    { id: 'e2', worldId: 'w', categoryId: 'c', title: '洛阳', key: '洛阳', aliases: [], summary: '', content: '', tags: [], fields: {}, status: 'canon', sourceRefs: [], createdAt: 0, updatedAt: 0 },
  ];
  const opts = { includeDraft: true, includeRelations: true, includeInternalLinks: true, includeTimeline: false };
  const html = await buildHtml(world, categories, entries, [], [], opts, []);
  cases.push(['HTML 标题挂了 id 锚点', html.includes('<h3 id="长安">') && html.includes('<h3 id="洛阳">')]);
  cases.push(['HTML 目录是 <a href="#锚点">', html.includes('<a href="#长安">')]);
  cases.push(['HTML 正文内链折成 <a href="#锚点">', html.includes('<a href="#洛阳" class="wl">洛阳</a>')]);
  cases.push(['HTML 里没有残留 [[ ]]', !/\[\[[^\]\n]+\]\]/.test(html)]);

  /* 媒体引用失效（没传 pieces）时，要如实标「已失效」，而不是凭空消失 */
  const htmlWithMissing = await buildHtml(
    world,
    categories,
    [
      { id: 'e1', worldId: 'w', categoryId: 'c', title: '长安', key: '长安', aliases: [], summary: '', content: '![城门](asset:不存在)', tags: [], fields: {}, status: 'canon', sourceRefs: [], createdAt: 0, updatedAt: 0 },
      { id: 'e2', worldId: 'w', categoryId: 'c', title: '洛阳', key: '洛阳', aliases: [], summary: '', content: '', tags: [], fields: {}, status: 'canon', sourceRefs: [], createdAt: 0, updatedAt: 0 },
    ],
    [],
    [],
    opts,
    [],
  );
  cases.push(['HTML 里失效的媒体引用如实标出（不凭空消失）', htmlWithMissing.includes('md-asset-missing')]);
}

let failed = 0;
for (const [name, ok] of cases) {
  if (!ok) {
    failed++;
    console.error(`✗ ${name}`);
  }
}
if (failed) {
  console.error(`\n${failed}/${cases.length} failed`);
  process.exit(1);
}
console.log(`✓ ${cases.length} passed`);
