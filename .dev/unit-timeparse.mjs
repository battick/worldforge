/**
 * 开发期单元验证：时间文本 ↔ 轴位置换算（`src/lib/timeParse.ts`）。
 *
 * 这是编年「锁定」的根基：锁定的条目位置必须等于文本解析值，「120 年」= 120、
 * 「120 年 6 月」= 120.5。换算错了，锁定就是摆设 —— 改文本位置不跟着走。
 *
 * 用法：node .dev/unit-timeparse.mjs
 */
import { execSync } from 'node:child_process';
import { rmSync, readdirSync, readFileSync, writeFileSync, statSync, existsSync } from 'node:fs';
import { join } from 'node:path';

const OUT = '.tmp-timeparse';
try {
  rmSync(OUT, { recursive: true, force: true });
} catch {
  /* 往残留目录覆写也安全 */
}

execSync(
  `npx tsc src/lib/timeParse.ts --outDir ${OUT} --module esnext --target es2020 --moduleResolution bundler --skipLibCheck`,
  { stdio: 'inherit' },
);

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

const { parseTimeText, formatTimeText, monthOfValue } = await import(`../${OUT}/timeParse.js`);

const cases = [];
const eq = (got, want, name) =>
  cases.push([name, Math.abs(got - want) < 1e-9]);

const p120 = parseTimeText('120 年');
eq(p120?.value ?? NaN, 120, '「120 年」→ 120');
cases.push(['「120 年」解析出年=120', p120?.year === 120]);
cases.push(['「120 年」无月', p120?.hasMonth === false]);

const p1205 = parseTimeText('120 年 6 月');
eq(p1205?.value ?? NaN, 120.5, '「120 年 6 月」→ 120.5');
cases.push(['「120 年 6 月」有月=6', p1205?.month === 6 && p1205?.hasMonth === true]);

const pNeg = parseTimeText('前 3 年');
eq(pNeg?.value ?? NaN, -3, '「前 3 年」→ -3');

const pEra = parseTimeText('第 3 纪元 45 年');
cases.push(['「第 3 纪元 45 年」取最后一组年=45', pEra?.value === 45]);

cases.push(['纯文字纪元「涨潮纪」解析不出（不硬编数字）', parseTimeText('涨潮纪') === null]);
cases.push(['「灰烬之年」解析不出', parseTimeText('灰烬之年') === null]);

const pPure = parseTimeText('120.5');
cases.push(['纯数字「120.5」→ 120.5', pPure?.value === 120.5]);

// 反序列化：formatTimeText 与 parseTimeText 是一对
cases.push(['format(120) =「120 年」', formatTimeText(120) === '120 年']);
cases.push(['format(120.5) =「120 年 6 月」', formatTimeText(120.5) === '120 年 6 月']);
cases.push(['format(-3) =「前 3 年」', formatTimeText(-3) === '前 3 年']);
cases.push(['format(120.9167≈11月) =「120 年 11 月」', formatTimeText(120 + 11 / 12) === '120 年 11 月']);

// 来回：parse(format(v)) ≈ v
const rt = (v) => parseTimeText(formatTimeText(v))?.value ?? NaN;
eq(rt(130), 130, '锁定联动：parse(format(130)) = 130');
eq(rt(120.5), 120.5, '锁定联动：parse(format(120.5)) = 120.5');

cases.push(['monthOfValue(120.5)=6', monthOfValue(120.5) === 6]);
cases.push(['monthOfValue(120)=0', monthOfValue(120) === 0]);

let failed = 0;
for (const [name, ok] of cases) {
  console.log(`  ${ok ? '✓' : '✗'} ${name}`);
  if (!ok) failed++;
}
console.log(`\n结果：${cases.length - failed}/${cases.length} 通过`);
try {
  rmSync(OUT, { recursive: true, force: true });
} catch {
  /* 下次运行开头还会再删 */
}
process.exit(failed ? 1 : 0);
