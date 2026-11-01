/**
 * 开发期单元验证：条目标题归一化 entryKey（纯函数，不需要浏览器）
 *
 * 为什么值得单独一条：
 * 条目唯一性靠 `key` 字段，而 `key` 是标题归一化出来的。
 * 归一化规则有一丝偏差（比如没处理全角空格、没合并连续下划线），
 * 两条本该被识别为重复的条目就会各拿一个不同的 key，查重彻底失效。
 * 这里把所有边界情况钉死：空标题、大小写、空白、标点、中文、emoji、连续分隔符。
 *
 * 用法：node .dev/unit-id.mjs
 */
import { execSync } from 'node:child_process';
import { rmSync, readdirSync, readFileSync, writeFileSync, statSync, existsSync } from 'node:fs';
import { join } from 'node:path';

const OUT = '.tmp-unit-id';
try {
  rmSync(OUT, { recursive: true, force: true });
} catch {
  /* safe-delete shim 会拦批量删除；往残留目录里覆写也安全 */
}
execSync(
  `npx tsc src/lib/id.ts --outDir ${OUT} --module esnext --target es2020 --moduleResolution bundler --skipLibCheck`,
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

const { entryKey } = await import(`../${OUT}/lib/id.js`);

const cases = [];
const eq = (title, expected) => cases.push([`entryKey(${JSON.stringify(title)}) => ${JSON.stringify(expected)}`, entryKey(title) === expected]);

/* ---- 基础归一化 ---- */
eq('Alice', 'alice');
eq('  Alice  ', 'alice');
eq('ALICE', 'alice');

/* ---- 空白折叠 ---- */
eq('Alice  Bob', 'alice_bob');
eq('Alice\tBob', 'alice_bob');
eq('Alice\nBob', 'alice_bob');
eq('  a   b  ', 'a_b');

/* ---- 标点剥离 ---- */
eq("Alice's Book", 'alices_book');
eq('Alice & Bob', 'alice_bob');
eq('Alice-Bob', 'alice_bob');          // 短横被合并成下划线
eq('Alice_Bob', 'alice_bob');
eq('Alice!!!', 'alice');

/* ---- 连续分隔符合并 ---- */
eq('A - B', 'a_b');
eq('A__B', 'a_b');
eq('A--B', 'a_b');

/* ---- 首尾分隔符清除 ---- */
eq('_alice_', 'alice');
eq('-alice-', 'alice');
eq(' _ alice _ ', 'alice');

/* ---- 中文 / Unicode 字母保留 ---- */
eq('张三', '张三');
eq('张 三', '张_三');
eq('ボブ', 'ボブ');

/* ---- 数字保留 ---- */
eq('Alice 007', 'alice_007');
eq('42', '42');

/* ---- emoji 剥离 ---- */
eq('Alice 🎉', 'alice');
eq('🎉🎉', 'untitled');

/* ---- 空标题兜底 ---- */
eq('', 'untitled');
eq('   ', 'untitled');
eq('!!!', 'untitled');
eq(null, 'untitled');
eq(undefined, 'untitled');

/* ---- 重复识别：这些对应该产生相同 key ---- */
const dupPairs = [
  ['Alice', 'alice'],
  ['Alice  Bob', 'alice bob'],
  ["Alice's", 'alices'],
  ['张三', ' 张三 '],
];
for (const [a, b] of dupPairs) {
  cases.push([`重复识别: ${JSON.stringify(a)} ~ ${JSON.stringify(b)}`, entryKey(a) === entryKey(b)]);
}

/* ---- 不应重复：这些对必须产生不同 key ---- */
const diffPairs = [
  ['Alice', 'Bob'],
  ['Alice A', 'Alice B'],
  ['张三', '李四'],
];
for (const [a, b] of diffPairs) {
  cases.push([`不重复: ${JSON.stringify(a)} != ${JSON.stringify(b)}`, entryKey(a) !== entryKey(b)]);
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
