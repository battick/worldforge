/**
 * 开发期单元验证：agent 语言包的两条硬纪律（纯文本比对，不需要浏览器，也不用编译 TS）。
 *
 * 为什么单独给这两条写断言 —— 它们的失败方式都**特别安静**，人眼基本看不出来：
 *
 * ① **中英键集不对齐**。少一个键，英文界面下要么掉回键名本身（界面上赫然写着
 *    `agent.sys.suggest`），要么那条规矩只在中文提示词里存在 —— 英文用户拿到的
 *    提示词少了一条纪律，从外面看只是「它怎么又不听话了」，根本查不到源头。
 *
 * ② **孤儿键**：文案写好了、但没有任何地方引用它 —— 等于没写。
 *    这个坑真实发生过三次，每次都是翻车之后回头找才发现的：
 *      · `agent.sys.reviewGate` / `agent.sys.noAnswer` —— 治「凭空说已经在审查队列里」
 *        和「查不到就换个关键词接着查」；
 *      · `agent.sys.proactive` / `agent.sys.askHow` —— 治「等着被喂到嘴里」和
 *        「问一句『你想怎么做？』这种等于没问的问题」。
 *    它们 `grep` 得到、文件里也确实躺着这段话，光看代码像是「已经做过了」。
 *    只有拿机器对一遍「每个键到底有没有人用」才拦得住。
 *
 * 用法：node .dev/unit-agent-prompt.mjs
 */
import { readFileSync, existsSync } from 'node:fs';

const results = [];
const check = (name, ok, detail = '') => {
  results.push({ name, ok });
  console.log(`  ${ok ? '✓' : '✗'} ${name}${detail ? ' — ' + detail : ''}`);
};

const read = (p) => readFileSync(p, 'utf8');

const ZH = 'src/i18n/locales/zh/agent.ts';
const EN = 'src/i18n/locales/en/agent.ts';

/**
 * 把语言包里的键名抠出来。
 *
 * 只认「缩进两格 + `'agent.xxx':`」这种顶层写法 —— 注释里提到键名（比如
 * 「见 `agent.sys.todo`」）不算，那是说明文字，不是定义。
 */
function keysOf(file) {
  const src = read(file);
  const out = [];
  for (const m of src.matchAll(/^ {2}'(agent\.[A-Za-z0-9_.]+)':/gm)) out.push(m[1]);
  return [...new Set(out)];
}

const zhKeys = keysOf(ZH);
const enKeys = keysOf(EN);

console.log('\n[1] 中英逐键对齐');
check('中文语言包里读得出键（不是把文件读空了）', zhKeys.length > 50, `${zhKeys.length} 个键`);

const onlyZh = zhKeys.filter((k) => !enKeys.includes(k));
const onlyEn = enKeys.filter((k) => !zhKeys.includes(k));
check(
  '没有「只在一个语言里存在」的键',
  onlyZh.length === 0 && onlyEn.length === 0,
  `中文独有 [${onlyZh.join(', ')}] ｜ 英文独有 [${onlyEn.join(', ')}]`,
);

console.log('\n[2] 没有孤儿键（写好了却没人引用 = 等于没写）');

/**
 * 会引用提示词的地方。
 *
 * `useAgent` 也算一个 —— 催话（「清单上还剩几条」「说了要做却没做」）是在循环里插的，
 * 不在 prompts.ts。漏掉它，那几句就会被误判成孤儿。
 */
const USERS = [
  'src/ai/agent/prompts.ts',
  'src/ai/agent/tools.ts',
  'src/ai/agent/protocol.ts',
  'src/state/useAgent.ts',
];
const used = USERS.filter((p) => existsSync(p))
  .map((p) => read(p))
  .join('\n');

/** 只查 `agent.sys.*`：它们是**提示词正文**，每一句都该有落点。 */
const sysKeys = zhKeys.filter((k) => k.startsWith('agent.sys.'));
const orphan = sysKeys.filter(
  (k) => !used.includes(`'${k}'`) && !used.includes(`"${k}"`) && !used.includes(`\`${k}\``),
);

check(
  `提示词键（${sysKeys.length} 个）每一个都被引用`,
  orphan.length === 0,
  orphan.length ? `没被引用：${orphan.join(', ')}` : '',
);

/** 反向：引用了、但语言包里没有 —— 会掉回键名本身显示给模型看 */
const missing = [];
for (const p of USERS) {
  if (!existsSync(p)) continue;
  for (const m of read(p).matchAll(/'(agent\.(?:sys|fail|done|data|tool)\.[A-Za-z0-9_.]+)'/g)) {
    // `agent.tool.*` 是按工具名拼的，键名在语言包里逐个写着，这里只查有没有
    if (!zhKeys.includes(m[1]) && !missing.includes(m[1])) missing.push(m[1]);
  }
}
check(
  '反过来也成立：代码里引用的键，语言包里都有',
  missing.length === 0,
  missing.length ? `语言包里没有：${missing.join(', ')}` : '',
);

/* ---------------- 汇总 ---------------- */

const failed = results.filter((r) => !r.ok);
console.log(`\n结果：${results.length - failed.length}/${results.length} 通过`);
if (failed.length) {
  console.log('失败：' + failed.map((f) => f.name).join('、'));
  process.exit(1);
}
