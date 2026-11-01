import type { Entry, ReviewItem } from '../types';

/**
 * 一致性审计的**账本**：这一页跑过什么、作者怎么判的。
 *
 * **为什么必须有它。** 审计原先是无状态的：每次把世界整个送进去，让模型从零开始找毛病。
 * 同一份设定 → 同一个判断，于是**每一次扫出来的都是那几条**。更要命的是作者的动作没有回流 ——
 * 他把一条判成「不是问题」忽略了、把另一条改完标了「已处理」，下一轮扫它们照样原样回来。
 * 作者看到的不是「新发现」，是同一份清单被反复念。
 *
 * 所以这一层干两件事：
 *   1. `buildLedger` —— 把历次审计结果整理成一份能塞进提示词的账本，并**分辨哪些还该重看**；
 *   2. `blockedIssues` / `splitDuplicates` —— 模型若还是把旧问题（甚至换个说法）又报了一遍，
 *      入库前拦住它，并如实交代「跳过几条」。
 * 两件都做成纯函数：不碰 React、不碰存储，好单测。
 *
 * **「还该重看」凭什么判。** 判据不靠模型，靠时间戳：某条问题提出之后，它盯着的条目
 * 有没有再被改动过（`entry.updatedAt > issue.createdAt`）。改过 → 当时的结论可能已经不成立，
 * 值得重新看一眼；没改过 → 作者已经拍过板了，不要再去烦他。
 * 这类「机械判断」正是代码该干的活 —— 让模型去比时间戳，它只会瞎猜。
 */

/* ------------------------------------------------------------------ */
/* 标题归一与判重                                                      */
/* ------------------------------------------------------------------ */

/**
 * 标题归一：去空白、去标点、转小写。
 *
 * 判重只能做到「字面级」为止 —— 换个说法把同一条再说一遍，除了语义模型谁也认不出来。
 * 那件事交给账本（提示词里明写「换个说法也算重复」），这里只负责把标点与空白这种噪声抹平。
 */
export function normIssueTitle(s: string): string {
  return (s || '')
    .toLowerCase()
    .replace(/[\s\u3000]+/g, '')
    .replace(/[\p{P}\p{S}]/gu, '');
}

/**
 * 判重的**最短**字数。比这更短的标题（「命名混乱」这种）包含关系不算数 —— 太容易误伤。
 */
const MIN_CONTAIN = 4;

/**
 * 两条问题是不是在说同一件事。
 *
 * **只认字面**：归一后相同，或一个套着另一个（「…不匹配」vs「…不匹配的问题」）。
 *
 * 为什么不去追「换个说法」：那要语义，而字面相似度**追不动**这件事。
 * 拿语料试过 —— 同一条问题的两种说法（「烬石储量与城邦规模不匹配」/「烬石产量撑不起城邦规模」）
 * 余弦相似度只有 0.38，而**同一批条目上两条不相干的问题**（都跟「匠人同盟」有关）能到 0.26。
 * 中间那条线窄得没法用：放宽一点就开始吃真问题。
 *
 * 而「把真问题当成重复悄悄丢掉」比「多显示一条重复」严重得多 —— 后者作者扫一眼就过去了，
 * 前者是设定里埋着的坑，谁也不会发现。
 *
 * 所以**换个说法的重复交给账本**：提示词里明写「换个说法也算重复」，由模型自己比对。
 * 这里只做那道不讲情面的兜底：字面级重复一律拦下，宁可漏、不可错杀。
 */
export function sameIssue(a: { title: string }, b: { title: string }): boolean {
  const na = normIssueTitle(a.title);
  const nb = normIssueTitle(b.title);
  if (!na || !nb) return false;
  if (na === nb) return true;
  const [short, long] = na.length <= nb.length ? [na, nb] : [nb, na];
  return short.length >= MIN_CONTAIN && long.includes(short);
}

/**
 * 一条「不许再报」的记录。
 *
 * 只是一条标题，不是整条 `ReviewItem` —— 这样「历史里的旧问题」与「这一轮刚收下的新问题」
 * 可以用同一个形状排队判重，不需要把后者伪装成前者。
 */
export interface BlockedIssue {
  title: string;
}

/** 这条问题提出之后，它盯着的条目有没有被改过 */
export function touchedSince(issue: ReviewItem, entries: Entry[]): boolean {
  const rel = issue.relatedEntryIds ?? [];
  return rel.some((id) => {
    const e = entries.find((x) => x.id === id);
    // 条目被删了不算「改过」—— 删掉只会让这条问题失效，不会造出新矛盾
    return e ? e.updatedAt > issue.createdAt : false;
  });
}

/**
 * 库里那些**不许再被报一遍**的问题。
 *
 * - 待处理的：永远算重复。它本来就在页面上挂着没处理，再报一条只会变成两张卡片说同一件事。
 * - 已处理 / 已忽略、且相关条目此后没动过：作者已经拍过板，算重复。
 * - 已处理 / 已忽略、但相关条目此后被改过：当时的结论可能已经不成立，**放行**（不进这份名单）。
 */
export function blockedIssues(history: ReviewItem[], entries: Entry[]): BlockedIssue[] {
  return history
    .filter((r) => r.kind === 'consistency')
    .filter((r) => r.status === 'pending' || !touchedSince(r, entries))
    .map((r) => ({ title: r.title }));
}

/**
 * 把模型这一轮报回来的问题分成「新的」与「已经说过的」两堆。
 *
 * 判重时把**这一轮已经收下的**也算进去：模型有时候会把同一件事在一份列表里说两遍。
 */
export function splitDuplicates<T extends { title: string }>(
  incoming: T[],
  blocked: BlockedIssue[],
): { fresh: T[]; skipped: T[] } {
  const fresh: T[] = [];
  const skipped: T[] = [];
  for (const item of incoming) {
    const dup = blocked.some((b) => sameIssue(item, b)) || fresh.some((f) => sameIssue(item, f));
    (dup ? skipped : fresh).push(item);
  }
  return { fresh, skipped };
}

/* ------------------------------------------------------------------ */
/* 账本                                                                */
/* ------------------------------------------------------------------ */

/** 账本里的一条：这条问题说过什么、作者判过没有、现在还该不该重看 */
export interface LedgerEntry {
  id: string;
  title: string;
  /** 还在库里的相关条目的名字（已被删掉的不列，只报个数） */
  related: string[];
  deletedRelated: number;
  status: ReviewItem['status'];
  severity: ReviewItem['severity'];
  /**
   * 该不该请模型重看一眼：
   * - `open`    仍未处理 —— 不要重复报
   * - `settled` 作者已判定、且条目此后没动过 —— 不要重复报
   * - `revisit` 作者已判定、但条目此后改过 —— 可以重看，条件是必须说清新的变化
   */
  bucket: 'open' | 'settled' | 'revisit';
}

export interface Ledger {
  entries: LedgerEntry[];
  /** 账本里没列完、被截掉多少条 */
  truncated: number;
  open: number;
  settled: number;
  revisit: number;
}

/**
 * 一条问题最多给模型几行。
 *
 * 账本是拿去「避免重复」的，不是拿来重读的 —— 它挤掉的每一行都是条目正文，
 * 而条目正文才是模型真正要审的东西。
 */
const LEDGER_CAP = 60;

/** 世界里的历史记录 + 当下的库 → 一份能塞进提示词的账本 */
export function buildLedger(history: ReviewItem[], entries: Entry[]): Ledger {
  const all = history
    .filter((r) => r.kind === 'consistency')
    .sort((a, b) => b.createdAt - a.createdAt);

  const lines: LedgerEntry[] = all.slice(0, LEDGER_CAP).map((r) => {
    const rel = r.relatedEntryIds ?? [];
    const alive = rel
      .map((id) => entries.find((e) => e.id === id))
      .filter((e): e is Entry => !!e);
    const touched = touchedSince(r, entries);
    return {
      id: r.id,
      title: r.title,
      related: alive.map((e) => e.title),
      deletedRelated: rel.length - alive.length,
      status: r.status,
      severity: r.severity,
      bucket: r.status === 'pending' ? 'open' : touched ? 'revisit' : 'settled',
    };
  });

  const count = (b: LedgerEntry['bucket']) => lines.filter((l) => l.bucket === b).length;
  return {
    entries: lines,
    truncated: Math.max(0, all.length - lines.length),
    open: count('open'),
    settled: count('settled'),
    revisit: count('revisit'),
  };
}
