/**
 * 开发期单元验证：一致性审计的**账本与判重**（纯函数，不需要浏览器）
 *
 * 为什么值得单独一条：
 * 这几个函数决定「上一轮报过的问题还会不会再来一遍」—— 作者抱怨的「每次查冲突都是那几条」，
 * 根子就在这儿。它们错的方式很安静：判重太松 = 老问题反复回来（回到原来的毛病），
 * 判重太紧 = **真问题被当成重复丢掉**（这更糟，而且没人会立刻发现）。
 * 两头都不能靠 e2e 兜 —— 模型不给这个精度。所以拿固定数据把边界钉住。
 *
 * 用法：node .dev/unit-consist.mjs
 */
import { execSync } from 'node:child_process';
import { rmSync, readdirSync, readFileSync, writeFileSync, statSync, existsSync } from 'node:fs';
import { join } from 'node:path';

const OUT = '.tmp-consist';
try {
  rmSync(OUT, { recursive: true, force: true });
} catch {
  /* 往残留目录里覆写也安全 */
}
execSync(
  `npx tsc src/ai/consist.ts --outDir ${OUT} --module esnext --target es2020 --moduleResolution bundler --skipLibCheck`,
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

const {
  normIssueTitle,
  sameIssue,
  touchedSince,
  blockedIssues,
  splitDuplicates,
  buildLedger,
} = await import(`../${OUT}/ai/consist.js`);

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

/* ------------------------------------------------------------------ */
console.log('\n== 1. 标题归一 ==');
/* ------------------------------------------------------------------ */

check('去掉空白', normIssueTitle('  匠人 同盟  ') === '匠人同盟', normIssueTitle('  匠人 同盟  '));
check('去掉中英标点', normIssueTitle('匠人同盟的成立年份，与涨潮纪对不上！') === '匠人同盟的成立年份与涨潮纪对不上');
check(
  '全角引号也去掉（剩下的实词一个不动）',
  normIssueTitle('「甲」与「乙」打架') === '甲与乙打架',
  normIssueTitle('「甲」与「乙」打架'),
);
check('大小写不敏感', normIssueTitle('Ember Stone') === normIssueTitle('ember stone'));
check('空值不炸', normIssueTitle(undefined) === '' && normIssueTitle('') === '');

/* ------------------------------------------------------------------ */
console.log('\n== 2. 两条问题是不是在说同一件事 ==');
/* ------------------------------------------------------------------ */

const oldIssue = {
  title: '烬石储量与城邦规模不匹配',
  relatedEntryIds: ['en_basin'],
};

check(
  '标题一模一样 → 重复',
  sameIssue({ title: '烬石储量与城邦规模不匹配', relatedEntryIds: ['en_basin'] }, oldIssue),
);
check(
  '只差标点 → 重复',
  sameIssue({ title: '烬石储量与城邦规模不匹配。' }, oldIssue),
);
check(
  '加了个尾巴（一个套着一个）→ 重复',
  sameIssue({ title: '烬石储量与城邦规模不匹配的问题' }, oldIssue),
);
check(
  '**换个说法认不出来** —— 这是刻意的，交给账本（提示词）兜，不靠字面判重',
  !sameIssue({ title: '烬石产量撑不起城邦规模' }, oldIssue),
);
check(
  '同一批条目上、说的是另一件事 → 不是重复',
  !sameIssue({ title: '盆地的纪年起点前后不一' }, oldIssue),
);
check('空标题不算任何东西的重复', !sameIssue({ title: '' }, oldIssue) && !sameIssue({ title: ' ' }, oldIssue));

/* ------------------------------------------------------------------ */
console.log('\n== 3. 条目后来动过没有 ==');
/* ------------------------------------------------------------------ */

const entries = [
  { id: 'en_basin', title: '烬落盆地', updatedAt: 2000 },
  { id: 'en_guild', title: '匠人同盟', updatedAt: 1000 },
];
const issueAt = (t) => ({ id: 'rv_x', worldId: 'w', kind: 'consistency', title: 't', note: '', rationale: '', status: 'pending', createdAt: t, relatedEntryIds: ['en_basin'] });

check('条目的 updatedAt 晚于这条问题 → 动过', touchedSince(issueAt(1500), entries));
check('条目的 updatedAt 早于这条问题 → 没动过', !touchedSince(issueAt(2500), entries));
check(
  '相关条目已被删掉 → 不算动过（删掉只会让这条问题失效，不会造出新矛盾）',
  !touchedSince({ ...issueAt(1000), relatedEntryIds: ['en_gone'] }, entries),
);

/* ------------------------------------------------------------------ */
console.log('\n== 4. 哪些老问题不许再报 ==');
/* ------------------------------------------------------------------ */

const hist = [
  { ...issueAt(2500), id: 'rv_open', title: '仍未处理的', status: 'pending' },
  { ...issueAt(2500), id: 'rv_settled', title: '判过且没动过的', status: 'rejected' },
  { ...issueAt(1500), id: 'rv_touched', title: '判过但条目后来改过的', status: 'accepted' },
  { ...issueAt(2500), id: 'rv_rel', title: '一条关系提议', status: 'pending', kind: 'relation' },
];
const blocked = blockedIssues(hist, entries);
const blockedTitles = blocked.map((b) => b.title);

check('待处理的被拦住', blockedTitles.includes('仍未处理的'));
check('已判定、条目没动过的被拦住', blockedTitles.includes('判过且没动过的'));
check('已判定、但条目改过的**放行**', !blockedTitles.includes('判过但条目后来改过的'));
check('不是一致性问题的不掺和进来', !blockedTitles.includes('一条关系提议'), blockedTitles.join('、'));

/* ------------------------------------------------------------------ */
console.log('\n== 5. 分成「新的」与「说过的」 ==');
/* ------------------------------------------------------------------ */

const incoming = [
  { title: '全新的一条' },
  { title: '仍未处理的' },
  { title: '判过但条目后来改过的' },
  { title: '全新的一条。' }, // 同一轮里又说了一遍（只差个句号）
];
const { fresh, skipped } = splitDuplicates(incoming, blocked);
check('新问题留下', fresh.length === 2, `fresh=${fresh.length}`);
check('旧账被拦下', skipped.length === 2, `skipped=${skipped.length}`);
check(
  '拦下的是对的那两条',
  skipped.some((s) => s.title === '仍未处理的') && skipped.some((s) => s.title === '全新的一条。'),
  skipped.map((s) => s.title).join('、'),
);
check(
  '「判过但条目改过」的放行（作者改过设定，值得重看）',
  fresh.some((f) => f.title === '判过但条目后来改过的'),
);
check('顺序不乱：先出现的先算新', fresh[0]?.title === '全新的一条');

/* ------------------------------------------------------------------ */
console.log('\n== 6. 账本 ==');
/* ------------------------------------------------------------------ */

const ledgerHist = [
  { ...issueAt(3000), id: 'L1', title: 'A 仍未处理', status: 'pending', severity: 'high' },
  { ...issueAt(3000), id: 'L2', title: 'B 判过没动', status: 'rejected', relatedEntryIds: ['en_guild'] },
  { ...issueAt(1000), id: 'L3', title: 'C 判过但动过', status: 'accepted' },
  { ...issueAt(3000), id: 'L4', title: 'D 指着已删除的条目', status: 'pending', relatedEntryIds: ['en_gone'] },
];
const ledger = buildLedger(ledgerHist, entries);
check('三个桶分对了', ledger.open === 2 && ledger.settled === 1 && ledger.revisit === 1, JSON.stringify(ledger));
check('最近的在最前', ledger.entries[0].title.startsWith('A'), ledger.entries[0].title);
check(
  '相关条目换成当下的名字',
  ledger.entries.find((e) => e.id === 'L2').related[0] === '匠人同盟',
);
check(
  '指着已删条目的那些只报个数、不报名字',
  ledger.entries.find((e) => e.id === 'L4').related.length === 0 &&
    ledger.entries.find((e) => e.id === 'L4').deletedRelated === 1,
);
check('「可重看」用的是时间戳判据，不是状态', ledger.entries.find((e) => e.id === 'L3').bucket === 'revisit');

const many = Array.from({ length: 70 }, (_, i) => ({
  ...issueAt(1000 + i),
  id: 'M' + i,
  title: '第 ' + i + ' 条',
  status: 'pending',
}));
const capped = buildLedger(many, entries);
check('账本有上限（不然它会把条目正文挤走）', capped.entries.length === 60, `实际 ${capped.entries.length}`);
check('截掉多少如实报出来', capped.truncated === 10, `实际 ${capped.truncated}`);

const empty = buildLedger([], entries);
check('没有历史 → 空账本', empty.entries.length === 0 && empty.truncated === 0);

/* ------------------------------------------------------------------ */
console.log(`\n===== 结果：${pass}/${pass + fail} 项通过 =====`);
if (fail) {
  console.log(`未通过：${fail} 项`);
  process.exitCode = 1;
}
