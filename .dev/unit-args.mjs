/**
 * 开发期单元验证：agent 工具的参数归一与必填自检（纯函数，不需要浏览器）
 *
 * 起因是一次真实的翻车：让 agent「把条目里提到、但还没建的人物和物品补全」，
 * 它连着调了 8 次 read_entry，每次都被判成「缺少标题」—— 它明明写了标题，
 * 只是写在了 `title` 这个键上。工具内部只读 `args.entry`，读不到就等于没传；
 * 而那句报错里又读不出「你的键名它不认识」，于是它原样重试、再失败，
 * 攒够几次撞上打转护栏，**整件事中止、一条也没补**。
 *
 * 所以这个脚本盯两件事：
 *   1. 归一：别名/大小写/中文键都能折回规范名，且不抢本工具自己的另一个参数；
 *   2. 契约：`args` 声明 == 工具真正读的参数名（漏声明就会静默变成「没传」），
 *      `required` ⊆ `args`，别名表里没有拼错的规范名。
 *
 * 用法：node .dev/unit-args.mjs
 */
import { execSync } from 'node:child_process';
import { rmSync, readdirSync, readFileSync, writeFileSync, statSync, existsSync } from 'node:fs';
import { join } from 'node:path';

const OUT = '.tmp-args';
// 清临时目录失败不该影响结论：环境里有一层 `node-safe-delete-shim` 会拦 rmSync，
// 残留目录里的文件数超过阈值时抛 SAFE_DELETE_BULK_CONFIRM_REQUIRED。
// 被它带走的话末行只剩一个 `Node.js v22.22.2`，看着像「单测全崩」，其实断言一条都没跑。
try {
  rmSync(OUT, { recursive: true, force: true });
} catch {
  /* 直接往残留目录里重写也安全 */
}
// Windows 上 npx 是 .cmd，必须走 shell。
// tools.ts 里 `import type { StoreValue } from '../../state/store'` 会一路解析到 store.tsx →
// files.ts，而那里有 `?url` 形式的 vite 导入。所以这三样缺一不可：
// --jsx（store 是 .tsx）、--types vite/client（认 `?url`）、--lib dom（React 类型）。
execSync(
  `npx tsc src/ai/agent/tools.ts --outDir ${OUT} --module esnext --target es2020 ` +
    `--moduleResolution bundler --jsx react-jsx --lib es2021,dom,dom.iterable ` +
    `--types vite/client --skipLibCheck`,
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
  AGENT_TOOLS,
  AGENT_PAGES,
  findTool,
  normalizeArgs,
  checkRequired,
  renderToolList,
  readTimeArgs,
  resolveAgentPage,
  pageLabel,
  whenLabel,
} = await import(`../${OUT}/ai/agent/tools.js`);
// 回执文案要用真实的语言包来对照（tools.ts 自己经 translate 取）
const { tGlobal } = await import(`../${OUT}/i18n/translate.js`);

let pass = 0;
const fails = [];
const check = (name, cond, detail) => {
  if (cond) {
    pass++;
    console.log(`  ✓ ${name}`);
  } else {
    fails.push(`${name}${detail ? ` — ${detail}` : ''}`);
    console.log(`  ✗ ${name}${detail ? ` — ${detail}` : ''}`);
  }
};

const T = (n) => findTool(n);
const norm = (n, raw) => normalizeArgs(T(n), raw);

/* ------------------------------------------------------------------ */
console.log('\n一、别名折回规范名');
/* ------------------------------------------------------------------ */

// 这就是翻车的原型：模型把 entry 写成 title
check(
  'read_entry：{"title":…} 能当成 entry',
  norm('read_entry', { title: '灯塔' }).entry === '灯塔',
  JSON.stringify(norm('read_entry', { title: '灯塔' })),
);
check(
  'read_entry：{"name":…} 也认',
  norm('read_entry', { name: '灯塔' }).entry === '灯塔',
);
check(
  'read_entry：中文键「标题」也认',
  norm('read_entry', { 标题: '灯塔' }).entry === '灯塔',
);
check(
  'read_entry：{"entry":…} 原样通过',
  norm('read_entry', { entry: '灯塔' }).entry === '灯塔',
);

console.log('\n二、写法归位（大小写 / 分隔符）');

check('read_entry：{"Entry":…} 归位到 entry', norm('read_entry', { Entry: '灯塔' }).entry === '灯塔');
check('read_entry：{"ENTRY":…} 归位', norm('read_entry', { ENTRY: '灯塔' }).entry === '灯塔');
check(
  'create_relation：{"fromEntry":…} 不被当成 from（from 不是它的别名表项，但键名要归位）',
  norm('create_relation', { fromEntry: '甲' }).from === '甲',
);

console.log('\n三、不抢本工具自己的另一个参数');

// update_entry 里 title 是「改成什么标题」，不是「改哪一个」——
// 这种歧义该老实报缺 entry，而不是猜。
const upd = norm('update_entry', { title: '新名字' });
check('update_entry：{"title":…} 不被抢成 entry', upd.entry === undefined && upd.title === '新名字');
// 两个都给时各就各位
const upd2 = norm('update_entry', { entry: '灯塔', title: '灯塔·新' });
check('update_entry：entry + title 各就各位', upd2.entry === '灯塔' && upd2.title === '灯塔·新');

console.log('\n四、别的常见写法');

check(
  'search_entries：{"keyword":…} 折成 query',
  norm('search_entries', { keyword: '潮汐' }).query === '潮汐',
);
check(
  'search_entries：{"分类":…} 折成 category 且不改写原键',
  norm('search_entries', { 分类: '地理' }).category === '地理',
);
check(
  'polish_entries：{"条目":[…]}/{"titles":[…]} 折成 entries 且保持数组',
  Array.isArray(norm('polish_entries', { titles: ['甲', '乙'] }).entries) &&
    norm('polish_entries', { 条目: ['甲'] }).entries[0] === '甲',
);
check(
  'add_doc：{"content":…} 折成 text（text 的别名里有 content）',
  norm('add_doc', { name: '旧稿', content: '正文' }).text === '正文',
);

console.log('\n五、不认识、不该动的键原样留着');

check(
  '不认识的键原样留着',
  norm('read_entry', { entry: '灯塔', whatever: 1 }).whatever === 1,
);
// 别名是**移过去**，不是复制一份：一个原键名只对应一个规范参数，
// 复制会让「同一件事被喂两遍」，而且工具里哪个生效全看读取顺序 —— 那是隐藏的坑。
const moved = norm('read_entry', { title: 'x' });
check('别名是移动而不是复制（不留重复的 title）', moved.entry === 'x' && moved.title === undefined);

/* ------------------------------------------------------------------ */
console.log('\n六、必填自检：报错要「能照着重写」');
/* ------------------------------------------------------------------ */

const miss = checkRequired(T('read_entry'), {});
check('缺 entry 时报错', !!miss && miss.ok === false);
check('报错里说了缺哪个', !!miss && miss.summary.includes('entry'));
check('报错里说了这个工具认哪些参数名', !!miss && miss.summary.includes('参数名'));
check('报错里说了「你这次给的是」', !!miss && miss.summary.includes('你这次给的是'));
check('标成 badCall（不是「查不到」）', !!miss && miss.badCall === true);
check('空字符串也算缺', !!checkRequired(T('read_entry'), { entry: '   ' }));
check('给齐了就返回 null', checkRequired(T('read_entry'), { entry: '灯塔' }) === null);
check(
  '归一之后再自检：{"title":…} 不该再被判定缺 entry',
  checkRequired(T('read_entry'), norm('read_entry', { title: '灯塔' })) === null,
);
check(
  'create_entry 缺两样时都会点名',
  (() => {
    const m = checkRequired(T('create_entry'), {});
    return !!m && m.summary.includes('title') && m.summary.includes('category');
  })(),
);

/* ------------------------------------------------------------------ */
console.log('\n七、契约自检（静态扫源码）');
/* ------------------------------------------------------------------ */

const src = readFileSync('src/ai/agent/tools.ts', 'utf8');
const lines = src.split('\n');

/** 按工具切块：`    name: 'x',` 起，到该工具对象的收尾 `  },` 止 */
const blocks = new Map();
{
  let cur = null;
  let stopped = false;
  for (const ln of lines) {
    const m = ln.match(/^    name: '([a-z_]+)',$/);
    if (m) {
      cur = m[1];
      blocks.set(cur, []);
      stopped = false;
      continue;
    }
    if (!cur || stopped) continue;
    // 工具对象在 2 空格缩进处收尾。不截断的话，最后一个工具的块会把
    // 它下面的 renderToolList 也吃进来（那里有 `tool.args.length`，会误报）。
    if (/^  \},$/.test(ln)) {
      stopped = true;
      continue;
    }
    blocks.get(cur).push(ln);
  }
}

// 1. 工具真正读的 `args.xxx` 必须都在 args 声明里 —— 漏声明 = 静默变成「没传」
const undeclared = [];
for (const t of AGENT_TOOLS) {
  const body = (blocks.get(t.name) || []).join('\n');
  const used = new Set([
    ...[...body.matchAll(/args\.([a-zA-Z_]+)/g)].map((m) => m[1]),
    // update_world 那种 `(['a','b'] as const).forEach(k => args[k])` 的写法
    ...[...body.matchAll(/\['([a-z][a-zA-Z]*)'(?:, *'[a-z][a-zA-Z]*')*\] as const\)\.forEach/g)].flatMap(
      (m) => [...m[0].matchAll(/'([a-z][a-zA-Z]*)'/g)].map((x) => x[1]),
    ),
  ]);
  for (const k of used) if (!t.args.includes(k)) undeclared.push(`${t.name}.${k}`);
}
check(
  '每个工具读的参数名都写在 args 里',
  undeclared.length === 0,
  undeclared.join(', '),
);

// 2. required ⊆ args
const reqGap = AGENT_TOOLS.flatMap((t) => t.required.filter((k) => !t.args.includes(k)).map((k) => `${t.name}.${k}`));
check('required 里的名字都在 args 里', reqGap.length === 0, reqGap.join(', '));

// 3. 别名表里的规范名必须真实存在于某个工具 —— 拼错（addTag / contextLength）会被这里抓出来
const canonInTable = [...src.matchAll(/^  ([a-zA-Z]+): \[/gm)].map((m) => m[1]);
const allArgs = new Set(AGENT_TOOLS.flatMap((t) => t.args));
const bogus = canonInTable.filter((c) => !allArgs.has(c));
check('别名表里没有拼错的规范名', bogus.length === 0, bogus.join(', '));

// 4. 同一工具内两个参数不许折成同一个键名 —— 那会让第二遍的别名匹配失去判据
const selfClash = [];
{
  const fold = (s) => s.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, '');
  for (const t of AGENT_TOOLS) {
    const seen = new Map();
    for (const a of t.args) {
      const k = fold(a);
      if (seen.has(k) && seen.get(k) !== a) selfClash.push(`${t.name}: ${k}`);
      seen.set(k, a);
    }
  }
}
check('同一工具内没有两个参数折成同一个键名', selfClash.length === 0, selfClash.join(', '));

/* ------------------------------------------------------------------ */
console.log('\n八、工具清单把参数名印给模型');
/* ------------------------------------------------------------------ */

const list = renderToolList();
check('清单里印出了 read_entry 的参数 entry', /read_entry[\s\S]{0,200}?entry/.test(list));
check('必填参数带「必填」标记', list.includes('（必填）'));
check('无参数的工具明确写「无参数」', list.includes('（无参数）'));
check(
  '每个工具都在清单里（不漏印）',
  AGENT_TOOLS.every((t) => list.includes(`- ${t.name}（`)),
  AGENT_TOOLS.filter((t) => !list.includes(`- ${t.name}（`)).map((t) => t.name).join(', '),
);
check(
  '有参数的工具都在清单里印了「参数：」',
  AGENT_TOOLS.filter((t) => t.args.length).every((t) => {
    const i = list.indexOf(`- ${t.name}（`);
    const j = list.indexOf('\n', i);
    return list.slice(i, j).includes('参数：');
  }),
);

/* ------------------------------------------------------------------ */
console.log('\n九、时间：三种形态与「没给 ≠ 清掉」');
/* ------------------------------------------------------------------ */

// 时间是条目上的一个可选字段（`Entry.time`），进出的唯一一道闸就是 readTimeArgs。
// 它最要紧的一条判据是**三态必须显式**：拿「没给 to」去猜「至今」，轴上会凭空多出
// 一段跨度 —— 那是看得出来的错，属于「宁可让模型说清楚」的那一类。
//
// 另一个必须钉住的是「返回 undefined 的意思」：undefined 是「这次根本没提时间」，
// 绝不能顺手当成「把时间清掉」—— 否则 agent 每改一次正文就抹一次时间。

const tm = (raw) => readTimeArgs(raw);

check(
  '没给 when → undefined（不是「清掉」，是「没提」）',
  tm({}) === undefined && tm({ era: '涨潮纪' }) === undefined && tm({ weight: 'major' }) === undefined,
  JSON.stringify([tm({}), tm({ era: '涨潮纪' })]),
);
check(
  '只给 when → 时间点，且 to 是空（不是「至今」）',
  tm({ when: '涨潮纪十二年' })?.kind === 'point' && tm({ when: '涨潮纪十二年' })?.to === '',
  JSON.stringify(tm({ when: '涨潮纪十二年' })),
);
check(
  'when + until → 一段，两端都留着',
  tm({ when: '甲', until: '乙' })?.kind === 'range' && tm({ when: '甲', until: '乙' })?.to === '乙',
  JSON.stringify(tm({ when: '甲', until: '乙' })),
);
check(
  'when + ongoing → 至今（显式），to 清空',
  tm({ when: '甲', ongoing: true })?.kind === 'ongoing' && tm({ when: '甲', ongoing: true })?.to === '',
  JSON.stringify(tm({ when: '甲', ongoing: true })),
);
check(
  'ongoing 的字符串写法也认（"true" / "yes" / "1" / "是"）',
  ['true', 'yes', '1', '是'].every((v) => tm({ when: '甲', ongoing: v })?.kind === 'ongoing'),
);
check(
  'ongoing 与 until 同时给 → 按 ongoing（作者说了「至今」，「至今」优先）',
  tm({ when: '甲', until: '乙', ongoing: true })?.kind === 'ongoing',
  JSON.stringify(tm({ when: '甲', until: '乙', ongoing: true })),
);
check(
  'ongoing 写成 "false" → 不是至今',
  tm({ when: '甲', ongoing: 'false' })?.kind === 'point',
);
check(
  'era / weight 照带；weight 认大小写、胡写的退回 normal',
  tm({ when: '甲', era: '涨潮纪', weight: 'MAJOR' })?.era === '涨潮纪' &&
    tm({ when: '甲', weight: 'MAJOR' })?.weight === 'major' &&
    tm({ when: '甲', weight: '惊天动地' })?.weight === 'normal',
);
check(
  '解析结果里**没有** at / toAt —— 轴上的位置不给模型猜',
  (() => {
    const t0 = tm({ when: '甲', until: '乙' });
    return t0.at === undefined && t0.toAt === undefined;
  })(),
  JSON.stringify(tm({ when: '甲', until: '乙' })),
);
check(
  'when 只有空白 → 当作没给（空白不是时间）',
  tm({ when: '   ' }) === undefined,
);
check(
  'whenLabel 把三种形态各说成一句话（不是甩两个裸字段）',
  whenLabel(tm({ when: '甲' })) === '甲' &&
    whenLabel(tm({ when: '甲', until: '乙' })).includes('甲') &&
    whenLabel(tm({ when: '甲', until: '乙' })).includes('乙') &&
    whenLabel(tm({ when: '甲', ongoing: true })) !== whenLabel(tm({ when: '甲' })),
  [whenLabel(tm({ when: '甲' })), whenLabel(tm({ when: '甲', until: '乙' })), whenLabel(tm({ when: '甲', ongoing: true }))].join(' | '),
);
check('没时间就没有那句话（空字符串，而不是 "undefined"）', whenLabel(undefined) === '');

console.log('\n十、旧说法要能落地');
/* ------------------------------------------------------------------ */

// `propose_timeline_event` 没了：一件「什么时候发生了什么」现在就是一条带时间的条目。
// 但模型（和它记住的旧说法）还会写 `date:`；而「时间线」已经不单独占一页了 —— 这两样
// 都得能归到新的位置上，否则它会收到一句「参数不对」却不知道该怎么改。
check(
  'create_entry：{"date":…} 折成 when',
  norm('create_entry', { date: '涨潮纪十二年' }).when === '涨潮纪十二年',
  JSON.stringify(norm('create_entry', { date: '涨潮纪十二年' })),
);
check(
  'create_entry：{"from"/"to":…} 折成 when / until',
  norm('create_entry', { from: '甲', to: '乙' }).when === '甲' &&
    norm('create_entry', { from: '甲', to: '乙' }).until === '乙',
  JSON.stringify(norm('create_entry', { from: '甲', to: '乙' })),
);
check(
  'create_relation：from / to 仍然是「起点 / 终点」，没被时间抢走',
  (() => {
    const a = norm('create_relation', { from: '甲', to: '乙' });
    return a.from === '甲' && a.to === '乙' && a.when === undefined && a.until === undefined;
  })(),
);
check(
  'update_entry：{"clearTime":…} 原样到 clearTime',
  norm('update_entry', { entry: '灯塔', clearTime: true }).clearTime === true,
);
check(
  'create_entry 的 required 仍然是 title + category（时间不是必填）',
  T('create_entry').required.join(',') === 'title,category',
  T('create_entry').required.join(','),
);
check(
  'navigate：timeline 认下来并落到 graph 的编年分支（编年转正后它是第一入口）',
  (() => {
    const r = resolveAgentPage('timeline');
    return r && r.page === 'graph' && r.view === 'chronicle';
  })(),
  JSON.stringify(resolveAgentPage('timeline')),
);
check(
  'navigate：graph 本身不带 view（默认落编年那一支由界面定）',
  (() => {
    const r = resolveAgentPage('graph');
    return r && r.page === 'graph' && r.view === undefined;
  })(),
);
check('navigate：认不出来返回 null（由调用方报「照着重写」）', resolveAgentPage('时间轴不存在的页') === null);
check(
  'navigate：清单里没有 timeline 这个页面了（它已经不是一页）',
  !AGENT_PAGES.includes('timeline'),
  AGENT_PAGES.join(','),
);
check(
  'navigate：清单里只剩 wiki，entries / pieces 不再是一页（它们成了 Wiki 的子页）',
  AGENT_PAGES.includes('wiki') && !AGENT_PAGES.includes('entries') && !AGENT_PAGES.includes('pieces'),
  AGENT_PAGES.join(','),
);
check(
  'navigate：旧页面名 entries 落到 wiki 的编辑子页',
  (() => {
    const r = resolveAgentPage('entries');
    return r && r.page === 'wiki' && r.view === 'entries';
  })(),
  JSON.stringify(resolveAgentPage('entries')),
);
check(
  'navigate：旧页面名「杂物间」落到 wiki 的杂物子页（中文也认）',
  (() => {
    const r = resolveAgentPage('杂物间');
    return r && r.page === 'wiki' && r.view === 'pieces';
  })(),
  JSON.stringify(resolveAgentPage('杂物间')),
);
check(
  'navigate：wiki 本身不带 view（默认落在阅读子页）',
  (() => {
    const r = resolveAgentPage('wiki');
    return r && r.page === 'wiki' && r.view === undefined;
  })(),
);
check(
  'navigate：回执里说清落在哪一支（只说「Wiki」作者不知道是阅读还是杂物间）',
  pageLabel('wiki', 'pieces').includes(tGlobal('wiki.tab.pieces')) &&
    pageLabel('wiki', 'pieces').includes(tGlobal('agent.page.wiki')) &&
    pageLabel('wiki') === tGlobal('agent.page.wiki'),
  pageLabel('wiki', 'pieces'),
);
check(
  'propose_timeline_event 已经彻底不存在（工具表里没有它）',
  !findTool('propose_timeline_event') && !AGENT_TOOLS.some((t) => t.name === 'propose_timeline_event'),
);

/* ------------------------------------------------------------------ */
// 清临时目录失败不该影响结论（`node-safe-delete-shim` 的阈值拦截 / Windows 占用都会抛），
// 断言都跑完了才轮到它，不该为它改变退出码
try {
  rmSync(OUT, { recursive: true, force: true });
} catch {
  /* 下次运行开头还会再删一遍 */
}

console.log('');
if (fails.length) {
  console.log(`单元验证（args）：${pass}/${pass + fails.length} 通过，失败 ${fails.length} 项：`);
  for (const f of fails) console.log(`  - ${f}`);
  process.exit(1);
}
console.log(`单元验证（args）：${pass}/${pass} 通过。`);
