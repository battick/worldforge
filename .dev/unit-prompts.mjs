/**
 * 开发期单元验证：AI 提示词拼装（纯函数，不需要浏览器）
 *
 * 做法：把 src/ai/prompts.ts 单独编译到 .tmp-unit，给相对导入补上 .js 后缀
 * （tsc 不会自动加，Node ESM 又必须要），再动态 import 跑断言。
 *
 * 用法：node .dev/unit-prompts.mjs
 */
import { execSync } from 'node:child_process';
import { rmSync, readdirSync, readFileSync, writeFileSync, statSync, existsSync } from 'node:fs';
import { join } from 'node:path';

const OUT = '.tmp-unit';
// 开头这句**必须**也吞错，而且原因跟结尾那次不一样：环境里有一层 `node-safe-delete-shim`
// 会拦 rmSync，目录里文件数超过阈值时直接抛 SAFE_DELETE_BULK_CONFIRM_REQUIRED ——
// 上一次没清干净、这次又攒了几百个文件，脚本就会在第 14 行当场死掉，
// 末行只剩一个 `Node.js v22.22.2`，看着像「单测全崩」，其实断言一条都没跑。
// 删不掉不影响正确性：tsc 会往残留目录里覆写它自己那几个 .js。
try {
  rmSync(OUT, { recursive: true, force: true });
} catch {
  /* 往残留目录里覆写也安全 */
}
// Windows 上 npx 是 .cmd，必须走 shell
execSync(
  `npx tsc src/ai/prompts.ts --outDir ${OUT} --module esnext --target es2020 --moduleResolution bundler --skipLibCheck`,
  { stdio: 'inherit' },
);

/**
 * 给编译产物里所有相对导入补 .js 后缀（tsc 不会自动加，Node ESM 又必须要）。
 * 目录导入（如 `./promptText`）要补成 `./promptText/index.js`。
 */
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

const { buildAskPrompt, buildTimelineLayoutPrompt, buildIntakePrompt } = await import(`../${OUT}/ai/prompts.js`);

const world = {
  id: 'w1', name: '涨潮纪', tagline: '海面每年上涨三尺', summary: '海水不可逆上涨。',
  genre: '低魔', tone: '冷峻', themeColor: '#2f6fb0', createdAt: 0, updatedAt: 0,
};
const categories = [{ id: 'c1', worldId: 'w1', name: '地理', icon: '🗺️', fieldDefs: [], order: 0, createdAt: 0, updatedAt: 0 }];
const entries = [{
  id: 'e1', worldId: 'w1', categoryId: 'c1', title: '灯塔', aliases: [], summary: '最高的人工建筑',
  content: '## 概览\n灯塔是航标，也是权力象征。', tags: ['地标'], fields: {}, status: 'canon', sourceRefs: [], createdAt: 0, updatedAt: 0,
}];
const pieces = [
  {
    id: 'p1', worldId: 'w1', kind: 'long', title: '灯塔守则残页',
    content: '守塔人每夜必须记录潮线。灯塔的光芒是不可熄灭的，一旦熄灭，船只就会迷失方向。',
    tags: ['灯塔'], linkedEntryIds: [], pinned: false, createdAt: 0, updatedAt: 0,
  },
  {
    id: 'p2', worldId: 'w1', kind: 'fragment', title: '无关的碎片',
    content: '今天吃的是鱼干。', tags: [], linkedEntryIds: [], pinned: false, createdAt: 0, updatedAt: 0,
  },
];

const cases = [];
const p = buildAskPrompt(world, '灯塔的光为什么不能熄灭？', entries, categories, [], pieces);
cases.push(['提示词包含「作者的杂物间素材」区块', p.user.includes('作者的杂物间素材')]);
cases.push(['相关素材《灯塔守则残页》被带入（中文二元组检索生效）', p.user.includes('灯塔守则残页')]);
cases.push(['素材正文被带入', p.user.includes('光芒是不可熄灭的')]);
cases.push(['无关碎片未被带入', !p.user.includes('今天吃的是鱼干')]);
cases.push(['系统提示说明了素材的引用方式', p.system.includes('来自你的素材')]);
cases.push(['声明了素材优先级低于设定条目', p.user.includes('优先级低于设定条目')]);

const p2 = buildAskPrompt(world, '随便问问', entries, categories, [], []);
cases.push(['无素材时不出现空区块', !p2.user.includes('作者的杂物间素材')]);

const p3 = buildAskPrompt(world, '灯塔的光为什么不能熄灭？', entries, categories, []);
cases.push(['不传 pieces 参数时行为不变（向后兼容）', p3.user.includes('相关设定') && !p3.user.includes('杂物间素材')]);

/* ---------------- 时间轴自动排版：要的是「先后」，不是正文 ----------------
   这一支跟别的提示词有一处根本区别：它得**知道每条此刻排在哪儿**，否则排不了版。
   无头浏览器里的 e2e 靠假上游回读轴行来证这件事（`stats.layoutParsed`），
   但那只跑一种语言 —— 这里的断言管两件事：轴行里到底写了哪些字段、中英都得写全。 */
const axisE = {
  ...entries[0],
  time: { kind: 'point', from: '涨潮纪 1 年', to: '', at: 7, era: '涨潮纪', weight: 'major' },
};
const poolE = { ...entries[0], id: 'e2', title: '潮汐槽', summary: '海面退去后露出的浅槽。' };
const longE = {
  ...entries[0], id: 'e3', title: '长条目', summary: '',
  content: '开'.repeat(200) + '尾巴不该出现',
};
const lay = buildTimelineLayoutPrompt(world, [axisE], [poolE], categories);
cases.push([
  '排版提示词把轴上那条的「时间 / 纪元 / 位置」都写清楚了',
  lay.user.includes('涨潮纪 1 年') && lay.user.includes('涨潮纪') && /位置：7/.test(lay.user),
]);
cases.push([
  '「还没排进轴的」单独一块，并点名是哪一条（不然它无从知道还能把谁排进来）',
  lay.user.includes('未排进轴') && lay.user.includes('潮汐槽'),
]);
cases.push([
  '概览有上限：正文写到 200 字也只截一段（正文吃预算，却帮不上先后）',
  !buildTimelineLayoutPrompt(world, [axisE], [longE], categories).user.includes('尾巴不该出现'),
]);
cases.push([
  '系统提示词里写死了「不要改写时间文字」这条纪律',
  lay.system.includes('不要改写时间文字'),
]);
cases.push([
  '返回形状的根键与 `toAt` 都写在提示词里（这两样凑齐才算命中排版分支 —— 假上游就按它路由）',
  lay.system.includes('"layout"') && lay.system.includes('"toAt"'),
]);
cases.push([
  '轴上一条都没有时，不摆一块空清单让模型猜',
  buildTimelineLayoutPrompt(world, [], [poolE], categories).user.includes('时间轴还是空的'),
]);
cases.push([
  '条目全排进轴之后，池子那块也明说「没有了」',
  buildTimelineLayoutPrompt(world, [axisE], [], categories).user.includes('全部排进轴了'),
]);

/* ---------------- 新建世界：接着聊必须带上上一轮问答 ----------------
   曾翻车：buildIntakePrompt 收了 answers 却没渲染进 user 提示词 ——
   模型只看到「作者已回答了上面的问题」这句空话，看不到「上面的问题」是什么、
   作者答了什么，于是把刚答过的问题又问一遍。这里钉死：followUp 轮的问答必须进提示词。 */
const intakeMats = [
  { id: 'm1', kind: 'text', name: '设定片段', text: '这个世界没有太阳。', chars: 8, addedAt: 0 },
];
const intakeAnswers = [
  { question: '这个世界的核心矛盾是什么？', answer: '资源是潮汐带来的，退潮后什么都没了。', delegated: false },
  { question: '主角身处什么位置？', answer: '', delegated: true },
];
const intakeFollowUp = buildIntakePrompt(intakeMats, {
  round: 2,
  followUp: true,
  told: [],
  answers: intakeAnswers,
});
cases.push([
  '接着聊时上一轮问答被写进提示词（问题原文在）',
  intakeFollowUp.user.includes('这个世界的核心矛盾是什么？'),
]);
cases.push([
  '接着聊时上一轮问答被写进提示词（作者的回答在）',
  intakeFollowUp.user.includes('资源是潮汐带来的'),
]);
cases.push([
  '「你来定」的问题也如实带进去（标注成作者授权）',
  intakeFollowUp.user.includes('主角身处什么位置') && intakeFollowUp.user.includes('你来定'),
]);
const intakeFirst = buildIntakePrompt(intakeMats, {
  round: 1,
  followUp: false,
  told: [],
  answers: [],
});
cases.push([
  '首轮没有问答时给出空占位，不出现上一轮问题',
  intakeFirst.user.includes('（还没有问答记录）') && !intakeFirst.user.includes('这个世界的核心矛盾'),
]);

/* ---------------- 提示词语言跟随界面语言 ---------------- */
// Node 环境下 currentLocale() 会读 navigator.language；把它换掉即可模拟英文界面
cases.push(['中文环境下提示词是中文', p.system.includes('世界观设定编辑')]);

const navDesc = Object.getOwnPropertyDescriptor(globalThis, 'navigator');
let stubbed = false;
try {
  Object.defineProperty(globalThis, 'navigator', {
    value: { language: 'en-US', languages: ['en-US'] },
    configurable: true,
  });
  stubbed = true;
} catch {
  /* 覆盖不了就跳过这组用例 */
}

if (stubbed) {
  const pEn = buildAskPrompt(
    world,
    'Why must the lighthouse light never go out?',
    entries,
    categories,
    [],
    pieces,
  );
  cases.push(['切到 en-US 后系统提示词变英文', pEn.system.includes('senior worldbuilding editor')]);
  cases.push(['切到 en-US 后不再出现中文章节标题', !pEn.system.includes('输出格式硬性要求')]);
  cases.push(['切到 en-US 后用户提示词也变英文', pEn.user.includes('World basics') && !pEn.user.includes('【世界基础】')]);

  // 排版那一支也得跟着切：假上游的轴行解析认中英两种行格式，
  // 少一种就等于「换语言之后 AI 看不见现状了」，而那种失败在界面上看不出来
  const layEn = buildTimelineLayoutPrompt(world, [axisE], [poolE], categories);
  cases.push([
    'en-US 下排版提示词也是英文（不再出现中文章节标题）',
    !layEn.user.includes('【世界基础】') && !layEn.system.includes('不要改写时间文字'),
  ]);
  cases.push([
    'en-US 下轴行同样写着时间 / 纪元 / 位置（关键词换成 when / era / position）',
    /position:\s*7/.test(layEn.user) && /era:/i.test(layEn.user),
  ]);
  if (navDesc) Object.defineProperty(globalThis, 'navigator', navDesc);
} else {
  console.log('  – 跳过英文切换用例（当前 Node 无法覆盖 navigator）');
}

let failed = 0;
for (const [name, ok] of cases) {
  console.log(`  ${ok ? '✓' : '✗'} ${name}`);
  if (!ok) failed++;
}
console.log(`\n结果：${cases.length - failed}/${cases.length} 通过`);
// 清临时目录失败不该影响结论：Windows 上刚 import 过的模块文件偶尔还被占着，
// rmSync 会抛 EPERM/EBUSY —— 断言都跑完了，为此报红是纯粹的噪音
try {
  rmSync(OUT, { recursive: true, force: true });
} catch {
  /* 下次运行开头还会再删一遍 */
}
process.exit(failed ? 1 : 0);
