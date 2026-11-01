/**
 * 开发期单元验证：双向关系归并（`src/lib/relations.ts`）。
 *
 * 关系是有方向的。A→B 与 B→A 同时存在时，`mergeMutual` 要把它们合成**一个**双向单元，
 * 图上才能画双箭头、列表里才能合成一行；否则作者看到两行各说各的，读不出一对互相关系。
 *
 * 用法：node .dev/unit-relations.mjs
 */
import { execSync } from 'node:child_process';
import { rmSync, readdirSync, readFileSync, writeFileSync, statSync, existsSync } from 'node:fs';
import { join } from 'node:path';

const OUT = '.tmp-relations';
try {
  rmSync(OUT, { recursive: true, force: true });
} catch {
  /* 往残留目录覆写也安全 */
}

execSync(
  `npx tsc src/lib/relations.ts --outDir ${OUT} --module esnext --target es2020 --moduleResolution bundler --skipLibCheck`,
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

const { mergeMutual, mergeMutualOf } = await import(`../${OUT}/lib/relations.js`);

const rel = (id, from, to, type = '关联', status = 'canon') => ({
  id,
  worldId: 'w',
  fromEntryId: from,
  toEntryId: to,
  type,
  note: '',
  status,
  createdAt: 0,
});

const cases = [];
const check = (name, ok) => cases.push([name, !!ok]);

// 单向：一条关系就是一条单元
{
  const out = mergeMutual([rel('r1', 'A', 'B')]);
  check('单向：一条关系 → 一个单元', out.length === 1 && !out[0].mutual && out[0].rels.length === 1);
}

// 双向：A→B 与 B→A 合成一个单元
{
  const out = mergeMutual([rel('r1', 'A', 'B', '敌对'), rel('r2', 'B', 'A', '效忠')]);
  check('双向：两条反向 → 一个双向单元', out.length === 1 && out[0].mutual && out[0].rels.length === 2);
  check('双向：from 字典序小的排前（A 那条在前）', out[0].rels[0].fromEntryId === 'A' && out[0].rels[1].fromEntryId === 'B');
}

// 顺序无关：B→A 先给，结果一样
{
  const out = mergeMutual([rel('r2', 'B', 'A'), rel('r1', 'A', 'B')]);
  check('顺序无关：反向先给仍合成一个双向单元', out.length === 1 && out[0].mutual);
}

// 同向两条：不误合并（少见，但各算各的）
{
  const out = mergeMutual([rel('r1', 'A', 'B', '隶属'), rel('r2', 'A', 'B', '敌对')]);
  check('同向两条不误合并（仍两个单元）', out.length === 2 && out.every((m) => !m.mutual));
}

// 三条 A↔B（一条 A→B，两条 B→A）：不是恰好两条反向，不合并
{
  const out = mergeMutual([
    rel('r1', 'A', 'B'),
    rel('r2', 'B', 'A'),
    rel('r3', 'B', 'A'),
  ]);
  check('三条同对不合并（保持三条单向）', out.length === 3 && out.every((m) => !m.mutual));
}

// mergeMutualOf：从条目视角，双向单元里「出发」那条排前
{
  const out = mergeMutualOf('A', [rel('r1', 'A', 'B', '敌对'), rel('r2', 'B', 'A', '效忠')]);
  check('mergeMutualOf：双向里「我出发」那条排 rels[0]', out.length === 1 && out[0].mutual && out[0].rels[0].fromEntryId === 'A');
  check('mergeMutualOf：反向那条在 rels[1]', out[0].rels[1].fromEntryId === 'B');
}

// mergeMutualOf：只留牵到 entryId 的，无关的过滤掉
{
  const out = mergeMutualOf('A', [rel('r1', 'A', 'B'), rel('r2', 'C', 'D')]);
  check('mergeMutualOf：只留牵扯到 entryId 的关系', out.length === 1 && out[0].rels[0].fromEntryId === 'A');
}

// mergeMutualOf：反向单条（只有 B→A）也正常工作，且 rels[0] 仍是那条（from=B）
{
  const out = mergeMutualOf('A', [rel('r2', 'B', 'A', '效忠')]);
  check('mergeMutualOf：反向单条保留，mutual=false', out.length === 1 && !out[0].mutual && out[0].rels[0].fromEntryId === 'B');
}

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
