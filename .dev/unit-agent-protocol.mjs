/**
 * 开发期单元验证：agent 回复协议解析（纯函数，不需要浏览器）
 *
 * 为什么要专门给这一层写断言：
 * 假上游（`.dev/mock-upstream.mjs`）永远吐标准格式，所以端到端测不出「模型没按格式回」。
 * 而真实模型最常见的偏差就是这几类 —— plan 写成单个对象、键名换成 steps/actions、
 * 根级直接给动作、把 plan 序列化成字符串、或者干脆说了一段话没给 JSON。
 * 这一层的失败模式是**静默丢动作**：界面上看起来「它说完了，然后什么都没发生」，
 * 作者根本无从判断是模型不想做还是解析丢了。所以每条偏差都要有明确的期望行为。
 *
 * 第 [3.5] 段用的是作者贴过来的**真实原话**（`fixture-sloppy-reply.txt`）：它一口气提 8 个
 * create_entry，每个动作对象都少写了一个收尾的 `}`。假上游永远不会吐这种东西 ——
 * 那段夹具是这类畸形唯一的回归保险。
 *
 * 用法：node .dev/unit-agent-protocol.mjs
 */
import { execSync } from 'node:child_process';
import { rmSync, readdirSync, readFileSync, writeFileSync, statSync, existsSync } from 'node:fs';
import { join } from 'node:path';

const OUT = '.tmp-unit-protocol';
// 环境里有一层 `node-safe-delete-shim` 会拦 rmSync：残留目录里文件数超过阈值时抛
// SAFE_DELETE_BULK_CONFIRM_REQUIRED，被占用的文件还会 EPERM/EBUSY。
// 被它带走的话末行只剩一个 `Node.js v22.22.2`，看着像「单测全崩」，其实断言一条都没跑。
function clean() {
  try {
    rmSync(OUT, { recursive: true, force: true });
  } catch {
    /* 删不掉也安全：tsc 会往残留目录里覆写 */
  }
}
// 开头这遍要删干净（`force` 保证目录不存在也不报错）；删不掉说明有残留占用，直接重建也安全
clean();
execSync(
  `npx tsc src/ai/agent/protocol.ts --outDir ${OUT} --module esnext --target es2020 --moduleResolution bundler --skipLibCheck`,
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

const { parseAgentReply } = await import(`../${OUT}/ai/agent/protocol.js`);

const results = [];
const check = (name, ok, detail = '') => {
  results.push({ name, ok });
  console.log(`  ${ok ? '✓' : '✗'} ${name}${detail ? ' — ' + detail : ''}`);
};

const ACTION = { tool: 'create_entry', args: { title: '水位线换算' }, why: '补一条换算规则' };
const say = (r) => r.say;
const tools = (r) => r.plan.map((a) => a.tool);

/* ---------------- 1. 标准与常见包装 ---------------- */

console.log('\n[1] 正常格式');

const std = parseAgentReply(JSON.stringify({ say: '我加一条。', plan: [ACTION] }));
check('标准 JSON → 一个动作', tools(std).join() === 'create_entry', JSON.stringify(tools(std)));
check('say 原样带出', say(std) === '我加一条。');

const fenced = parseAgentReply('```json\n' + JSON.stringify({ say: '我加一条。', plan: [ACTION] }) + '\n```');
check('前后带 ```json 围栏 → 仍解析出动作', tools(fenced).join() === 'create_entry');

const chatty = parseAgentReply(
  '好的，我看看：\n' + JSON.stringify({ say: '我加一条。', plan: [ACTION] }) + '\n还需要别的吗？',
);
check('前后夹着闲聊 → 仍解析出动作', tools(chatty).join() === 'create_entry');

const trailing = parseAgentReply('{"say":"加好了","plan":[{"tool":"create_entry","args":{},"why":"w",}]}');
check('末尾多余逗号 → 修得回来', tools(trailing).join() === 'create_entry');

/* ---------------- 2. 真实模型最常走的样（这些以前会静默丢动作） ---------------- */

console.log('\n[2] 偏差形状：必须把动作救回来，不能静默丢');

const single = parseAgentReply(JSON.stringify({ say: '内容很短，我直接加。', plan: ACTION }));
check('plan 写成单个对象（不是数组）→ 也当成一个动作', tools(single).join() === 'create_entry', JSON.stringify(tools(single)));

const rootLevel = parseAgentReply(JSON.stringify(ACTION));
check('根级直接给一个动作（没有 say/plan 外壳）→ 救回来', tools(rootLevel).join() === 'create_entry', JSON.stringify(tools(rootLevel)));
check('根级动作没带 say → 合成一句占位的话（别留空气泡）', say(rootLevel).length > 0, `say="${say(rootLevel)}"`);

const stepsKey = parseAgentReply(JSON.stringify({ say: '分两步。', steps: [ACTION] }));
check('键名写成 steps → 也认', tools(stepsKey).join() === 'create_entry', JSON.stringify(tools(stepsKey)));

const strPlan = parseAgentReply(JSON.stringify({ say: '加一条。', plan: JSON.stringify([ACTION]) }));
check('plan 被序列化成字符串 → 解回来', tools(strPlan).join() === 'create_entry', JSON.stringify(tools(strPlan)));

const altArgs = parseAgentReply(JSON.stringify({ say: '加一条。', plan: [{ name: 'create_entry', arguments: { title: 'X' } }] }));
check('键名写成 name/arguments → tool 与 args 都要认', tools(altArgs).join() === 'create_entry' && altArgs.plan[0].args.title === 'X', JSON.stringify(altArgs.plan[0]));

const twoObjects = parseAgentReply('{"say":"我先查一下。"}\n{"plan":[{"tool":"create_entry","args":{},"why":"w"}]}');
check('吐了两个 JSON 对象 → 合并，别整段当 say', tools(twoObjects).join() === 'create_entry', JSON.stringify(tools(twoObjects)));
check('两个对象时 say 不该混进花括号', !say(twoObjects).includes('{'), `say="${say(twoObjects)}"`);

const partial = parseAgentReply(JSON.stringify({ say: '加一条。', plan: [ACTION, {}] }));
check('plan 里混了空对象 → 只留有效的', tools(partial).join() === 'create_entry' && partial.plan.length === 1, JSON.stringify(partial.plan.length));

const trunc = parseAgentReply('{"say":"我加一条。","plan":[{"tool":"create_entry","args":{"title":"水位线","content":"很长的一段正');
check('被 token 上限拦腰截断 → 保住已经写完的动作', tools(trunc).join() === 'create_entry', JSON.stringify(tools(trunc)));

/* ---------------- 3. 真的没给格式（要能被界面识别出来） ---------------- */

console.log('\n[3] 没按协议回：要留下「它没照格式说」的痕迹');

const prose = parseAgentReply('你的库里现在有三条条目，分别是……');
check('纯散文 → 整段当答复', say(prose).startsWith('你的库里'), `say="${say(prose).slice(0, 12)}…"`);
check('纯散文 → 标成「没按协议」', prose.protocolBroken === true, `protocolBroken=${prose.protocolBroken}`);
check('纯散文 → 没有动作', prose.plan.length === 0);

const emptyPlan = parseAgentReply(JSON.stringify({ say: '好的，我先查一下现有的条目。', plan: [] }));
check('合法 JSON、plan 为空 → 不是协议问题（这是正常的「到此为止」）', emptyPlan.protocolBroken === false);
check('合法 JSON、plan 为空 → 答复保留', say(emptyPlan).includes('先查一下'));

const empty = parseAgentReply('');
check('空输出 → 不炸，也没有动作', empty.plan.length === 0 && typeof empty.say === 'string');

const plainArray = parseAgentReply(JSON.stringify([ACTION]));
check('根是数组（模型只给了动作列表）→ 救回来', tools(plainArray).join() === 'create_entry' && say(plainArray).length > 0, JSON.stringify(tools(plainArray)));

/* ---------------- 3.5 结构在、只是括号少写了一个 ---------------- */

console.log('\n[3.5] 它写歪了、可东西都在：要按结构救回来');

// 夹具是作者贴过来的原话。老实现的表现：整轮判废 → 界面说「它没按约定的格式回，
// 已请它重说一遍」→ 它照抄同一处错 → 再废一轮 → 「再问一次通常就好了」。
// 两条写好的提议就此没了（作者的原话是「它根本就没补全」）。
const sloppy = readFileSync(new URL('./fixture-sloppy-reply.txt', import.meta.url), 'utf8').trim();
const real = parseAgentReply(sloppy);
check('真实那次的原话 → 不再判成「没按格式」', real.protocolBroken === false, 'protocolBroken=' + real.protocolBroken);
check('8 个动作一个不丢', real.plan.length === 8, 'plan=' + real.plan.length);
check(
  '工具名与参数都对得上',
  tools(real).every((t) => t === 'create_entry') && real.plan[7].args.title === '寒冰山脉的冰雪陷阱和冰墙',
  String(real.plan[7].args.title),
);
check('say 也在（不是只剩动作、把话说丢了）', say(real).includes('尚未建立的人物和物品'));
check('这一轮要如实标成「替它补齐了括号」', real.salvaged === true, 'salvaged=' + real.salvaged);

const oneBrace = parseAgentReply('{"say":"先建一条。","plan":[{"tool":"create_entry","args":{"title":"幽魂"}}');
check(
  '只少最后一个收尾括号 → 救回来',
  tools(oneBrace).join() === 'create_entry' && say(oneBrace) === '先建一条。',
  JSON.stringify(say(oneBrace)),
);

// 两条各自少一个括号：**绝不能走「从最后一个逗号切下去」那一手** ——
// 切出来的前缀照样能解析，于是第 2 条被无声吃掉，界面上看起来一切正常。
const twoSloppy = parseAgentReply(
  '{"say":"两件都提上去。","plan":[' +
    '{"tool":"create_entry","args":{"title":"甲","content":"甲的内容"}' +
    ',{"tool":"create_entry","args":{"title":"乙","content":"乙的内容"}' +
    ']}',
);
check(
  '两个动作各少一个括号 → 两条都要在（不许切尾巴切到只剩一条）',
  twoSloppy.plan.length === 2 && twoSloppy.plan[1].args.title === '乙',
  'plan=' + twoSloppy.plan.length + ' titles=' + twoSloppy.plan.map((a) => a.args.title).join(),
);

const noComma = parseAgentReply('{"say":"好","plan":[{"tool":"note","args":{"text":"甲" "why":"乙"}}]}');
check('两个键之间少了逗号 → 救回来（别整份丢掉）', tools(noComma).join() === 'note');

const rawNl = parseAgentReply('{"say":"第一行\n第二行","plan":[{"tool":"note","args":{"text":"甲\n乙"}}]}');
check(
  '字符串里是裸换行 → 救回来，且换行原样留着',
  say(rawNl).includes('第二行') && rawNl.plan[0].args.text === '甲\n乙',
  JSON.stringify(rawNl.plan[0].args),
);

// 全角结构符号：严格路径会从 plan 的 `[` 开始截 —— 截出来的数组照样能解析，say 就没了
const fw = parseAgentReply('｛"say": "好", "plan": [{"tool": "note", "args": {"text": "甲"}}]｝');
check('全角括号 → 救回来，而且 say 不能被切掉', say(fw) === '好' && tools(fw).join() === 'note', 'say=' + JSON.stringify(say(fw)));

// 反面：随笔里孤立的 {…} 绝不能被「修」成一个空对象 —— 那正是本模块最怕的静默丢空
const looseProse = parseAgentReply('我先看看{名字}是什么意思。');
check(
  '随笔里孤立的 {…} → 仍旧老实报「没按协议」，不许硬修',
  looseProse.protocolBroken === true && looseProse.plan.length === 0,
  'broken=' + looseProse.protocolBroken + ' plan=' + looseProse.plan.length,
);

/* ---------------- 4. 交代清单与「做完了」 ----------------
   清单是「清点式」任务的账（把提到过、还没建的补全）。它跟动作是**两个字段**，
   而 `todos` 这个名字模型又爱拿去当动作列表 —— 认错了两个方向都很贵：
   把动作当清单 → 这一轮白跑；把清单当动作 → 一串「没有这个工具」。
   所以这一段盯的就是这条分界线，以及「勾选状态要读得出来」。
   还有一条被真实翻车改过的地方：清单**可以和动作同一轮给**（先立账、再动手）。 */
console.log('\n[4] 交代清单与「做完了」');

const plan = parseAgentReply(
  JSON.stringify({
    say: '先立个账。',
    todos: [
      { text: '读「幽暗沼泽的诅咒」', done: false },
      { text: '核对正文里的人名', done: true },
    ],
  }),
);
check('todos 是清单：读得出条目', plan.todos.length === 2, JSON.stringify(plan.todos));
check('勾选状态读得出来（第二条做完了）', plan.todos[0]?.done === false && plan.todos[1]?.done === true);
check('只立账、不给动作 → plan 为空（清单不是动作）', plan.plan.length === 0);
check('清单是它给的（todosGiven）—— 循环据此决定要不要替换旧的那份', plan.todosGiven === true);

// 纯字符串的清单：模型偷懒只写一串字
const strTodo = parseAgentReply(JSON.stringify({ say: '列一下。', todos: ['读甲', '读乙'] }));
check('todos 写成字符串数组 → 都算未完成', strTodo.todos.length === 2 && !strTodo.todos.some((x) => x.done));

// Markdown 复选框：模型很爱这么写，勾选状态就是它表达「做完了」的方式
const mdTodo = parseAgentReply(
  JSON.stringify({ say: '进度更新。', todos: ['- [x] 读甲', '- [ ] 读乙', '✓ 读丙'] }),
);
check('Markdown 复选框 → 勾了的那条算完成', mdTodo.todos[0].done && !mdTodo.todos[1].done && mdTodo.todos[2].done);
check('复选框标记不会混进条目文字', mdTodo.todos[0].text === '读甲', JSON.stringify(mdTodo.todos[0].text));

// 反面 1：todos 其实是它的动作列表（模型把 plan 叫成 todos）
const todosAsPlan = parseAgentReply(
  JSON.stringify({ say: '这就做。', todos: [{ tool: 'search_entries', args: { query: '甲' } }] }),
);
check(
  'todos 里装的是动作时 → 按**动作**读，不当清单吞掉',
  tools(todosAsPlan).join() === 'search_entries' && todosAsPlan.todos.length === 0,
  'tools=' + JSON.stringify(tools(todosAsPlan)) + ' todos=' + todosAsPlan.todos.length,
);

// 反面 2（这条规矩被真实翻车改过）：早期实现写的是「同一轮既有动作又有清单 → 清单忽略」。
// 那条是错的 —— Cursor / Codex 那类 agent 恰恰是**同一轮里先立账、再动手**：
// 「一共 5 条，我先把账立起来」+ 同轮的 read_entry ×2。忽略清单的话，
// 界面上那份账永远立不起来，模型下一轮回来也看不见自己刚才说过什么。
const both = parseAgentReply(
  JSON.stringify({ say: '边做边记。', plan: [ACTION], todos: [{ text: '读甲', done: false }] }),
);
check(
  '同一轮既有动作又有清单 → 两样都要（先立账、再动手，这是常态）',
  both.plan.length === 1 && both.todos.length === 1 && both.todosGiven === true,
  `plan=${both.plan.length} todos=${both.todos.length} given=${both.todosGiven}`,
);
check('同一轮里还给了动作 → 依旧不算「做完了」', both.done === false);
// 反过来：只动清单（没有动作）时也得照收
const onlyTodos = parseAgentReply(
  JSON.stringify({ say: '先立个账。', todos: [{ text: '读甲', done: false }] }),
);
check(
  '只给清单、不给动作 → 也收下',
  onlyTodos.todosGiven === true && onlyTodos.todos.length === 1 && onlyTodos.plan.length === 0,
);

// 「做完了」必须显式说：plan 为空**不等于**做完 —— 这是「说了要做却没做」的判据
check('plan 为空、没说 done → 不算收工', parseAgentReply('{"say":"接下来我再看看别的。","plan":[]}').done === false);
check(
  '明说 done: true → 收工',
  parseAgentReply('{"say":"都补完了。","plan":[],"done":true}').done === true,
);
check(
  '给了动作的同时说 done → 不认（它还在干）',
  parseAgentReply(JSON.stringify({ say: '继续。', plan: [ACTION], done: true })).done === false,
);
// 别名与字符串写法
check(
  'done 的别名（finished / "true"）也认',
  parseAgentReply('{"say":"完了","plan":[],"finished":"true"}').done === true,
);

/* ---------------- 5. 下一步建议（界面上一排一点就跑的按钮） ----------------
   作者的原话：「我希望它能够给出建议，亦或者给一些可选的按钮给用户，
   比如说『构思 xxx 条目』，点击后自动开始思考和构思」。

   模型给这一栏的形状五花八门（一句人话、字符串数组、{label, goal} 对象、
   甚至整段用换行分开的文本）—— 认不出来的后果很**安静**：那排按钮凭空消失，
   作者只会觉得「它又变笨了」，没有任何报错可查。所以每一种形状都钉一条。 */

console.log('\n[5] 下一步建议');

const sugStr = parseAgentReply(
  JSON.stringify({ say: '动机是增强帝国的力量。', plan: [], suggest: ['构思「神祇的监管」条目'] }),
);
check(
  '一串字符串 → 一条建议（按钮文字和点下去说的话是同一句）',
  sugStr.suggest.length === 1 &&
    sugStr.suggest[0].label === '构思「神祇的监管」条目' &&
    sugStr.suggest[0].goal === '构思「神祇的监管」条目',
  JSON.stringify(sugStr.suggest),
);

const sugObj = parseAgentReply(
  JSON.stringify({
    say: '…',
    plan: [],
    suggest: [
      { label: '构思「神祇的监管」条目', goal: '读一遍「导师」，然后按它的内容提一条新条目' },
    ],
  }),
);
check(
  '对象形状 → label 上按钮、goal 是点下去发给它的那句话',
  sugObj.suggest.length === 1 &&
    sugObj.suggest[0].label === '构思「神祇的监管」条目' &&
    sugObj.suggest[0].goal.includes('读一遍「导师」'),
  JSON.stringify(sugObj.suggest),
);

const sugKey = parseAgentReply(
  JSON.stringify({ say: '…', plan: [], nextSteps: ['把这段补进正文', '给导师连一条关系'] }),
);
check('换个键名（nextSteps）也认', sugKey.suggest.length === 2, JSON.stringify(sugKey.suggest));

const sugText = parseAgentReply(
  JSON.stringify({ say: '…', plan: [], suggest: '- 构思「神祇的监管」条目\n- 把这段补进正文' }),
);
check(
  '整段文本、每行一条 → 也读得出来（顺手剥掉行首的 `-`）',
  sugText.suggest.length === 2 && sugText.suggest[0].label === '构思「神祇的监管」条目',
  JSON.stringify(sugText.suggest),
);

const sugJsonStr = parseAgentReply(
  JSON.stringify({ say: '…', plan: [], suggestions: '["构思「神祇的监管」条目"]' }),
);
check(
  '被序列化成字符串 → 解它一层（模型爱这么写）',
  sugJsonStr.suggest.length === 1,
  JSON.stringify(sugJsonStr.suggest),
);

const sugDup = parseAgentReply(
  JSON.stringify({
    say: '…',
    plan: [],
    suggest: ['构思 A', '构思 A', '构思 B', '构思 C', '构思 D'],
  }),
);
check(
  '去重后最多 4 条（再多就不是建议、是一堵墙了）',
  sugDup.suggest.length === 4 && sugDup.suggest[0].label === '构思 A',
  JSON.stringify(sugDup.suggest.map((s) => s.label)),
);

/*
 * 同一轮既给动作又给建议：解析层**照收**，收不收由循环那条判据决定
 * （`useAgent` 只在「把话交回给作者」的轮次才写进画面）。
 *
 * 这一条刻意反着写：如果解析层自己先丢掉，那条判据就永远测不到 ——
 * 而它正是「手上还有动作时别摆一排按钮」的全部依据。
 */
const sugWithPlan = parseAgentReply(
  JSON.stringify({ say: '先查一下。', plan: [ACTION], suggest: ['这条不该出现'] }),
);
check(
  '同一轮既给动作又给建议 → 解析层照收（收不收由循环判）',
  sugWithPlan.suggest.length === 1 && sugWithPlan.plan.length === 1,
);

check(
  '压根没给 suggest → 空数组（不许自己编一条出来）',
  parseAgentReply(JSON.stringify({ say: '答完了。', plan: [] })).suggest.length === 0,
);

/* ---------------- 汇总 ---------------- */

const failed = results.filter((r) => !r.ok);
console.log(`\n结果：${results.length - failed.length}/${results.length} 通过`);
if (failed.length) {
  console.log('失败：' + failed.map((f) => f.name).join('、'));
  process.exit(1);
}
