/**
 * 开发期单元验证：正文**编辑层**的纯函数（不需要浏览器）
 *
 * 为什么值得单独一条：
 * 工具栏最要命的两种错，在界面上都长得像「没反应」——
 *   ① 包裹的边界算错，点一下把选中的字吃掉一半（作者只会以为自己手抖了）；
 *   ② 高亮层跟输入框错开一行（`join('')` 跟原文差一个字符就一路偏到底，
 *      而差的那一个字符往往正是最不起眼的换行）。
 * 这两种拿固定样例钉住最省事：一条断言就能描述「原样进去、原样出来」，
 * 摆在页面里验就只能靠肉眼比两层文字，差半个字根本看不出来。
 *
 * 用法：node .dev/unit-wikitext.mjs
 */
import { execSync } from 'node:child_process';
import { rmSync, readdirSync, readFileSync, writeFileSync, statSync, existsSync } from 'node:fs';
import { join } from 'node:path';

const OUT = '.tmp-wikitext';
try {
  rmSync(OUT, { recursive: true, force: true });
} catch {
  /* safe-delete shim 会拦批量删除（见 MEMORY.md）；往残留目录里覆写也安全 */
}
execSync(
  `npx tsc src/lib/wikitext.ts --outDir ${OUT} --module esnext --target es2020 --moduleResolution bundler --skipLibCheck`,
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

const modPath = [`.tmp-wikitext/lib/wikitext.js`, `.tmp-wikitext/wikitext.js`].find((p) => existsSync(p));
if (!modPath) throw new Error('找不到编译产物 wikitext.js');

const {
  applyEdit,
  indentSelection,
  tableSnippet,
  highlightMarkdown,
  linkQueryAt,
  matchLinkTargets,
  completeLink,
  splitSections,
  statsOf,
  PREFIX_MARK,
  INDENT,
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
const head = (s) => console.log(`\n${s}`);

/* ------------------------------------------------------------------ */
head('一、包裹类（粗体 / 斜体 / 代码 / 删除线）');

{
  const r = applyEdit('正文', 0, 2, { kind: 'wrap', before: '**', after: '**', placeholder: '粗体' });
  check('有选中 → 包起来', r.value === '**正文**', r.value);
  check('有选中 → 内层继续选中（接着打字就是替换内容）', r.selStart === 2 && r.selEnd === 4, `${r.selStart},${r.selEnd}`);
}

{
  const r = applyEdit('这是正文', 2, 2, { kind: 'wrap', before: '**', after: '**', placeholder: '粗体' });
  check('没选中 → 插占位符', r.value === '这是**粗体**正文', r.value);
  check('没选中 → 占位符被选中，接着打字直接覆盖', r.value.slice(r.selStart, r.selEnd) === '粗体');
}

{
  // 先套上、再点一次（此时选区停在标记里面）→ 该脱掉
  const once = applyEdit('正文', 0, 2, { kind: 'wrap', before: '**', after: '**', placeholder: '粗体' });
  const twice = applyEdit(once.value, once.selStart, once.selEnd, {
    kind: 'wrap',
    before: '**',
    after: '**',
    placeholder: '粗体',
  });
  check('再点一次 → 脱掉（不是又套一层）', twice.value === '正文', twice.value);
  check('脱掉后仍是「正文」被选中', twice.value.slice(twice.selStart, twice.selEnd) === '正文');
}

{
  // 选区自己带着标记（手工选中了 `**正文**`）→ 也该脱掉
  const src = '前**正文**后';
  const r = applyEdit(src, 1, 7, { kind: 'wrap', before: '**', after: '**', placeholder: '粗体' });
  check('选区自带标记 → 脱掉里面的那层', r.value === '前正文后', r.value);
}

{
  // 标记在选区外侧（点按钮后没动光标，又点了一次）
  const src = '前**正文**后';
  const r = applyEdit(src, 3, 5, { kind: 'wrap', before: '**', after: '**', placeholder: '粗体' });
  check('标记在选区外面 → 一并脱掉', r.value === '前正文后', r.value);
}

{
  const src = 'abc';
  const r = applyEdit(src, 3, 0, { kind: 'wrap', before: '_', after: '_', placeholder: '斜体' });
  check('反着给的选区也按正向处理', r.value === '_abc_', r.value);
}

{
  // 边界：选区顶到字符串头
  const r = applyEdit('abc', 0, 1, { kind: 'wrap', before: '**', after: '**', placeholder: '粗体' });
  check('选区在开头也不越界', r.value === '**a**bc', r.value);
}

/* ------------------------------------------------------------------ */
head('二、行前缀类（标题 / 列表 / 引用）');

{
  const r = applyEdit('一行', 0, 2, { kind: 'prefix', prefix: '- ', mark: PREFIX_MARK.list });
  check('列表：整行加上前缀', r.value === '- 一行', r.value);
  const back = applyEdit(r.value, r.selStart, r.selEnd, { kind: 'prefix', prefix: '- ', mark: PREFIX_MARK.list });
  check('列表：再点一次脱掉', back.value === '一行', back.value);
}

{
  // 从 `## ` 点三级标题 —— 必须是**替换**，不是叠成 `##### `
  const r = applyEdit('## 概览', 0, 6, { kind: 'prefix', prefix: '### ', mark: PREFIX_MARK.heading });
  check('改标题级别是替换而不是叠加', r.value === '### 概览', r.value);
}

{
  // 无序 → 有序：两族共用一个 mark 才能把原来的圆点换掉，
  // 各写各的就会叠成 `1. - 一行`
  const r = applyEdit('- 一行', 0, 6, { kind: 'prefix', prefix: '1. ', mark: PREFIX_MARK.list });
  check('无序列表切成有序列表：圆点被换掉而不是叠加', r.value === '1. 一行', r.value);
  const back = applyEdit(r.value, r.selStart, r.selEnd, { kind: 'prefix', prefix: '- ', mark: PREFIX_MARK.list });
  check('有序再切回无序也顺', back.value === '- 一行', back.value);
}

{
  // 空行不能加前缀，否则列表里冒出孤零零一个 `- `
  const src = '一\n\n二';
  const r = applyEdit(src, 0, 3, { kind: 'prefix', prefix: '- ', mark: PREFIX_MARK.list });
  check('空行不加前缀', r.value === '- 一\n\n- 二', JSON.stringify(r.value));
}

{
  const src = '一\n二\n三';
  const r = applyEdit(src, 0, 0, { kind: 'prefix', prefix: '> ', mark: PREFIX_MARK.quote });
  check('只影响光标所在的那一行', r.value === '> 一\n二\n三', JSON.stringify(r.value));
}

{
  // 缩进是独立的：前缀加在缩进之后，脱掉时缩进原样还回去
  const src = '  - 子项';
  const r = applyEdit(src, 2, 8, { kind: 'prefix', prefix: '- ', mark: PREFIX_MARK.list });
  check('带缩进的列表项：脱掉时保留嵌套层级', r.value === '  子项', JSON.stringify(r.value));

  const add = applyEdit('  子项', 2, 4, { kind: 'prefix', prefix: '- ', mark: PREFIX_MARK.list });
  check('带缩进的普通行：前缀加在缩进之后', add.value === '  - 子项', JSON.stringify(add.value));
}

/* ------------------------------------------------------------------ */
head('三、块插入（表格 / 代码块）');

{
  const r = applyEdit('上文下文', 2, 2, { kind: 'insert', text: '```\n\n```' });
  check('插到段落中间 → 前后各补一个换行', r.value === '上文\n```\n\n```\n下文', JSON.stringify(r.value));
}

{
  const r = applyEdit('上文\n', 3, 3, { kind: 'insert', text: '---' });
  check('已经站在行首 → 不再多补前导换行', r.value === '上文\n---', JSON.stringify(r.value));
}

{
  const t = tableSnippet(2, 3, ['列1', '列2', '列3']);
  const rows = t.split('\n');
  check('表格：表头 + 分隔行 + 数据行', rows.length === 4, JSON.stringify(rows));
  check('表格：分隔行是 ---', rows[1] === '| --- | --- | --- |', rows[1]);
  check('表格：表头用给的名字', rows[0] === '| 列1 | 列2 | 列3 |', rows[0]);
  check('表格：列数被夹在 1..12', tableSnippet(1, 99, []).split('\n')[0].split('|').length - 2 === 12);
}

{
  const r = applyEdit('', 0, 0, { kind: 'insert', text: '| a |\n| --- |', caretOffset: 2 });
  check('插入后光标按 caretOffset 落在表头格里', r.selStart === 2 && r.selEnd === 2, String(r.selStart));
}

/* ------------------------------------------------------------------ */
head('四、缩进');

{
  const src = '甲\n乙\n丙';
  const r = indentSelection(src, 0, 1, false);
  check('缩进：光标所在行加两个空格', r.value === `${INDENT}甲\n乙\n丙`, JSON.stringify(r.value));
  check('缩进：整块继续选中（连按 Tab 才会越推越深）', r.value.slice(r.selStart, r.selEnd) === `${INDENT}甲`);
}

{
  const src = '甲\n乙\n丙';
  const r = indentSelection(src, 0, 3, false);
  check('缩进：跨行的选区里每一行都加', r.value === `${INDENT}甲\n${INDENT}乙\n丙`, JSON.stringify(r.value));
}

{
  const src = `${INDENT}甲\n${INDENT}乙`;
  const r = indentSelection(src, 0, 6, true);
  check('反缩进：去掉两个空格', r.value === '甲\n乙', JSON.stringify(r.value));
}

{
  const src = '甲';
  const r = indentSelection(src, 0, 1, true);
  check('反缩进：本来就没缩进也不报错', r.value === '甲', JSON.stringify(r.value));
}

/* ------------------------------------------------------------------ */
head('五、语法高亮（逐字符守恒是硬约束）');

const SAMPLES = [
  '',
  '普通一行',
  '## 概览\n\n黑石砌的塔。\n\n### 位置\n\n架在崖上。',
  '他说：**很久**以前，*那时候*还叫~~旧名~~，见 `CODE`。',
  '一段里有 [[灯塔]] 和 [[灰袍教团|教团]] 两种内链。',
  '外链 [官网](https://example.com) 与图片 ![图](https://example.com/a.png)。',
  '- 一项\n- 二项\n1. 三项\n\n> 引用一行\n\n---\n',
  '| 列 | 值 |\n| --- | --- |\n| 甲 | 乙 |',
  '```\n这里 **不该** 高亮\n[[]] 也不该\n```\n后面正常 **要** 高亮',
  '算式 3*4 不该被当成斜体，2*3*4 也不该。',
  '结尾没有换行的最后一行',
  '连续\n\n\n空行\n',
  '未闭合的 **粗体 与 [[内链',
  '# 一级\n###### 六级'
];

for (const s of SAMPLES) {
  const segs = highlightMarkdown(s);
  const joined = segs.map((x) => x.text).join('');
  const label = s.length > 22 ? s.slice(0, 22).replace(/\n/g, '⏎') + '…' : s.replace(/\n/g, '⏎') || '(空串)';
  check(`守恒：${label}`, joined === s, JSON.stringify(joined));
}

{
  const segs = highlightMarkdown('## 概览');
  check('标题的井号是标记类', segs[0].cls === 'wxe-mark' && segs[0].text === '##', JSON.stringify(segs));
  check('标题文字单独一类', segs.some((x) => x.cls === 'wxe-h' && x.text === '概览'), JSON.stringify(segs));
}

{
  const segs = highlightMarkdown('a\nb\n## 三');
  const h = segs.find((x) => x.cls === 'wxe-h');
  check('段上带着行号（大纲跳转靠它）', h && h.line === 2, JSON.stringify(h));
}

{
  const segs = highlightMarkdown('```\n这里 **不该** 高亮\n```');
  const strong = segs.filter((x) => x.cls === 'wxe-b');
  check('围栏代码块里的粗体标记不高亮', strong.length === 0, JSON.stringify(segs));
  check('围栏行自己单独一类', segs[0].cls === 'wxe-fence');
}

{
  const segs = highlightMarkdown('3*4 不该是斜体');
  check('单独的星号不被当成斜体', !segs.some((x) => x.cls === 'wxe-i'), JSON.stringify(segs));
}

{
  const segs = highlightMarkdown('前 **粗** 后');
  const b = segs.find((x) => x.cls === 'wxe-b');
  const marks = segs.filter((x) => x.cls === 'wxe-mark' && x.text === '**');
  check('粗体内容与标记分开上色', b && b.text === '粗', JSON.stringify(b));
  check('两个星号都是标记', marks.length === 2, String(marks.length));
}

{
  const segs = highlightMarkdown('见 [[灯塔|塔]]。');
  check('内链的名字是链接类', segs.some((x) => x.cls === 'wxe-link' && x.text === '灯塔'), JSON.stringify(segs));
  check('内链的显示文字也是链接类', segs.some((x) => x.cls === 'wxe-link' && x.text === '塔'));
}

{
  const segs = highlightMarkdown('| 甲 | 乙 |');
  check('表格的竖线是标记类', segs.filter((x) => x.cls === 'wxe-mark' && x.text === '|').length === 3, JSON.stringify(segs));
}

/* ------------------------------------------------------------------ */
head('六、内链自动补全');

check('打了一半 → 认出前缀', linkQueryAt('见 [[灯', 5)?.prefix === '灯', JSON.stringify(linkQueryAt('见 [[灯', 5)));
check('刚打完两个左括号 → 空前缀（该把全部候选摆出来）', linkQueryAt('见 [[', 4)?.prefix === '', JSON.stringify(linkQueryAt('见 [[', 4)));
check('起点是第一个方括号的位置', linkQueryAt('见 [[灯', 5)?.start === 2, String(linkQueryAt('见 [[灯', 5)?.start));
check('已经闭合 → 不再补全', linkQueryAt('见 [[灯塔]] 了', 9) === null);
check('进到显示文本里了 → 不补全', linkQueryAt('见 [[灯塔|塔', 7) === null);
check('跨了行 → 不补全', linkQueryAt('[[灯\n塔', 5) === null);
check('根本没有 [[ → 返回 null', linkQueryAt('随便一行字', 3) === null);
check('离得太远（>200 字）就不认了', linkQueryAt('[[' + 'x'.repeat(300) + '灯', 304) === null);

{
  const targets = [
    { id: '1', title: '灯塔', aliases: ['塔'] },
    { id: '2', title: '静默湾' },
    { id: '3', title: '潮汐槽' },
  ];
  check('按标题过滤', matchLinkTargets('灯', targets).map((x) => x.title).join() === '灯塔');
  check('别名也参与匹配', matchLinkTargets('塔', targets).map((x) => x.title).join() === '灯塔');
  check('空查询 → 全部（截到 limit）', matchLinkTargets('', targets).length === 3);
  check('limit 生效', matchLinkTargets('', targets, 2).length === 2);
  check('一个都不匹配 → 空数组（界面据此说「没有匹配」）', matchLinkTargets('zzz', targets).length === 0);
}

{
  const q = linkQueryAt('见 [[灯', 5);
  const r = completeLink('见 [[灯', q, '灯塔');
  check('补全成完整的 [[标题]]', r.value === '见 [[灯塔]]', r.value);
  check('光标落在链接之后（挑完目标接着往下写句子）', r.selStart === 8, String(r.selStart));
}

{
  // 补全时把已经打出来的那截换掉，不是往后追加
  const src = '前 [[灯 后';
  const q = linkQueryAt(src, 5);
  const r = completeLink(src, q, '灯塔');
  check('已经打出的那截被替换掉，不留残余', r.value === '前 [[灯塔]] 后', r.value);
}

/* ------------------------------------------------------------------ */
head('七、章节切分与统计');

{
  const src = '## 一\n正文一\n## 二\n正文二\n### 二一\n正文二一';
  const secs = splitSections(src);
  check('切出全部标题', secs.map((s) => s.text).join() === '一,二,二一', JSON.stringify(secs.map((s) => s.text)));
  check('行号对得上', secs[1].line === 2, String(secs[1].line));
  check('start 是标题行首偏移', src.slice(secs[1].start, secs[1].start + 4) === '## 二', src.slice(secs[1].start, secs[1].start + 4));
  check('一节到下一个标题为止', secs[0].end === secs[1].start, `${secs[0].end} vs ${secs[1].start}`);
  check('最后一节到全文末尾', secs[2].end === src.length);
}

{
  const src = '```\n# 不是标题\n```\n## 才是';
  check('代码块里的井号不算标题', splitSections(src).map((s) => s.text).join() === '才是');
}

{
  const src = '前面没有标题的引子\n\n## 一';
  const secs = splitSections(src);
  check('引子不算一节（大纲只摆标题）', secs.length === 1 && secs[0].start > 0);
}

{
  const s = statsOf('## 一\n见 [[灯塔]] 与 [外](https://a.com)。');
  check('统计：字符数就是正文字符数（跟 common.charCount 一个口径）', s.chars === '## 一\n见 [[灯塔]] 与 [外](https://a.com)。'.length);
  check('统计：认出 1 条内链', s.links === 1, String(s.links));
  check('统计：认出 1 条外链', s.urls === 1, String(s.urls));
  check('统计：小节数', s.sections === 1, String(s.sections));
  check('空正文的统计不炸', statsOf('').chars === 0 && statsOf('').sections === 0);
}

/* ------------------------------------------------------------------ */
console.log(`\n结果：${pass}/${pass + fail} 通过`);
if (fail) {
  console.log(`失败项： ${fail} 条`);
  process.exit(1);
}
