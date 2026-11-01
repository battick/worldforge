import type { Category, DraftMaterial, Entry, Piece, PolishFocus, World, WorldProposal } from '../types';
import {
  existingIndex,
  existingIndexWithReport,
  expandEntries,
  expandEntriesWithReport,
  retrieveRelevant,
  worldBrief,
  entryLine,
  catNameMap,
} from './context';
import { pt, type PromptKey } from './promptText';
import type { Ledger, LedgerEntry } from './consist';

/**
 * 提示词的「组装层」。
 *
 * 所有给人看、也给模型看的文字都在 `src/ai/promptText/{zh,en}.ts` 里，
 * 这里只负责把数据填进模板。语言跟随界面语言，切换后下一次调用即生效。
 */
export interface PromptPair {
  system: string;
  user: string;
}

/* ------------------------------------------------------------------ */
/* 1. 生成新条目                                                       */
/* ------------------------------------------------------------------ */

export interface GenerateParams {
  categoryName: string;
  instruction: string;
  count: number;
  keywords: string;
  allowRelations: boolean;
}

export function buildGeneratePrompt(
  world: World,
  entries: Entry[],
  categories: Category[],
  params: GenerateParams,
): PromptPair {
  const index = existingIndex(entries, categories, 80, undefined);
  const titles = entries.map((e) => e.title).join(pt('listSep'));

  const system = pt('generateSystem', {
    editorRole: pt('editorRole'),
    jsonRule: pt('jsonRule'),
    categoryName: params.categoryName,
    relationsRule: pt(params.allowRelations ? 'generateRelationsOn' : 'generateRelationsOff'),
  });

  const user = pt('generateUser', {
    worldBrief: worldBrief(world),
    index,
    titles: titles || pt('none'),
    categoryName: params.categoryName,
    instruction: params.instruction || pt('generateNoInstruction'),
    keywords: params.keywords ? pt('generateKeywords', { keywords: params.keywords }) : '',
    count: params.count,
  });

  return { system, user };
}

/* ------------------------------------------------------------------ */
/* 2. 扩写 / 打磨已有条目                                              */
/* ------------------------------------------------------------------ */

export function buildExpandPrompt(
  world: World,
  entry: Entry,
  entries: Entry[],
  categories: Category[],
  instruction: string,
): PromptPair {
  const names = catNameMap(categories);
  const index = existingIndex(entries, categories, 80);

  const system = pt('expandSystem', {
    editorRole: pt('editorRole'),
    jsonRule: pt('jsonRule'),
  });

  const user = pt('expandUser', {
    worldBrief: worldBrief(world),
    index,
    category: names[entry.categoryId] ?? pt('uncategorized'),
    title: entry.title,
    aliases: entry.aliases.join(pt('listSep')) || pt('none'),
    summary: entry.summary,
    content: entry.content || pt('empty'),
    instruction: instruction || pt('expandNoInstruction'),
  });

  return { system, user };
}

/* ------------------------------------------------------------------ */
/* 2b. 批量打磨                                                        */
/* ------------------------------------------------------------------ */

/** 打磨着力点。作者不选任何一项也允许 —— 那时提示模型「尽量少动」。类型定义在数据层（types.ts），这里 re-export 保持旧引用不破。 */
export type { PolishFocus };

export const POLISH_FOCUS: PolishFocus[] = ['detail', 'style', 'trim', 'links', 'conflict'];

/** 着力点 → 提示词模板键。显式映射（而不是拼字符串），这样漏一个键类型检查就会报。 */
const FOCUS_TEMPLATE: Record<PolishFocus, PromptKey> = {
  detail: 'polishFocusDetail',
  style: 'polishFocusStyle',
  trim: 'polishFocusTrim',
  links: 'polishFocusLinks',
  conflict: 'polishFocusConflict',
};

export interface PolishParams {
  focus: PolishFocus[];
  instruction: string;
  /** 这是本批的第几条（从 1 数）。只影响提示词措辞，让模型知道自己在批量里干活 */
  i: number;
  total: number;
}

export function buildPolishPrompt(
  world: World,
  entry: Entry,
  entries: Entry[],
  categories: Category[],
  params: PolishParams,
): PromptPair {
  const names = catNameMap(categories);
  const index = existingIndex(entries, categories, 80);

  const bullets = params.focus.map((f) => pt(FOCUS_TEMPLATE[f]));
  const focus = bullets.length
    ? [pt('polishFocusIntro'), ...bullets].join('\n')
    : pt('polishNoFocus');

  const system = pt('polishSystem', {
    editorRole: pt('editorRole'),
    jsonRule: pt('jsonRule'),
  });

  const user = pt('polishUser', {
    worldBrief: worldBrief(world),
    index,
    total: params.total,
    i: params.i,
    category: names[entry.categoryId] ?? pt('uncategorized'),
    title: entry.title,
    aliases: entry.aliases.join(pt('listSep')) || pt('none'),
    summary: entry.summary || pt('none'),
    content: entry.content || pt('empty'),
    focus,
    instruction: params.instruction || pt('polishNoInstruction'),
  });

  return { system, user };
}

/* ------------------------------------------------------------------ */
/* 3. 关系推荐                                                         */
/* ------------------------------------------------------------------ */

export function buildRelationPrompt(
  world: World,
  entries: Entry[],
  categories: Category[],
): PromptPair {
  const names = catNameMap(categories);
  const index = entries
    .map((e) => entryLine(e, names[e.categoryId] ?? pt('uncategorized')))
    .join('\n');

  const system = pt('relationSystem', {
    editorRole: pt('editorRole'),
    jsonRule: pt('jsonRule'),
  });

  const user = pt('relationUser', {
    worldBrief: worldBrief(world),
    index,
  });

  return { system, user };
}

/* ------------------------------------------------------------------ */
/* 3b. 时间轴自动排版                                                  */
/*                                                                     */
/* 与一致性检查的区别很要紧：那一个要的是**正文**（判有没有打架），     */
/* 这一个要的是**顺序** —— 所以送的是「它什么时候、现在排在哪儿、大概  */
/* 是什么事」，而不是大段正文。正文会把预算吃光，却帮不上先后。         */
/* ------------------------------------------------------------------ */

export interface TimelineLayoutScope {
  /** 一条给多少字概览。顺序靠的是时间与事情本身，不需要整篇正文 */
  briefCap?: number;
}

const WEIGHT_BRIEF: Record<'major' | 'normal' | 'minor', PromptKey> = {
  major: 'timelineLayoutWeightMajor',
  normal: 'timelineLayoutWeightNormal',
  minor: 'timelineLayoutWeightMinor',
};

/** 时间念成一行（形态不同写法不同 —— 别让模型自己从两个字段里猜） */
function briefWhen(tm: NonNullable<Entry['time']>): string {
  const from = tm.from.trim() || pt('timelineLayoutWhenNone');
  if (tm.kind === 'range') {
    return pt('timelineLayoutWhenRange', { from, to: tm.to.trim() || pt('timelineLayoutWhenNone') });
  }
  if (tm.kind === 'ongoing') return pt('timelineLayoutWhenOngoing', { from });
  return from;
}

function briefOf(e: Entry, cap: number): string {
  return (e.summary || e.content).replace(/\s+/g, ' ').slice(0, cap) || pt('timelineLayoutBriefNone');
}

export function buildTimelineLayoutPrompt(
  world: World,
  axis: Entry[],
  pool: Entry[],
  categories: Category[],
  scope: TimelineLayoutScope = {},
): PromptPair {
  const names = catNameMap(categories);
  const cap = scope.briefCap ?? 140;
  const cat = (e: Entry) => names[e.categoryId] ?? pt('uncategorized');

  const axisText = axis.length
    ? axis
        .map((e) => {
          const tm = e.time!;
          return pt('timelineLayoutLine', {
            title: e.title,
            category: cat(e),
            when: briefWhen(tm),
            era: tm.era.trim() || pt('timelineLayoutEraNone'),
            at: String(tm.at ?? ''),
            weight: pt(WEIGHT_BRIEF[tm.weight]),
            brief: briefOf(e, cap),
            // 锁定的条目单独标出来 —— 挪了它的位置，时间文字得跟着重写
            locked: tm.locked ? pt('timelineLayoutLocked') : '',
          });
        })
        .join('\n')
    : pt('timelineLayoutAxisEmpty');

  const poolText = pool.length
    ? pool
        .map((e) =>
          pt('timelineLayoutPoolLine', { title: e.title, category: cat(e), brief: briefOf(e, cap) }),
        )
        .join('\n')
    : pt('timelineLayoutPoolEmpty');

  return {
    system: pt('timelineLayoutSystem', {
      editorRole: pt('editorRole'),
      jsonRule: pt('jsonRule'),
    }),
    user: pt('timelineLayoutUser', { worldBrief: worldBrief(world), axis: axisText, pool: poolText }),
  };
}

/**
 * 「AI 猜测条目时间」的提示词。
 *
 * 与排版同族但目标相反：排版给**已有时间**的条目定先后（只动 `at`），猜测给
 * **没有时间**的条目凭空定出「什么时候」（`from` + `at` 一起）。它更重，因为它在
 * 替作者编日期，所以提示词里把「只猜有依据的」这条纪律写得更死。
 *
 * 刻意复用排版那套 `layout` 返回形状与 `findEntryByTitle` 解析，不另起炉灶：
 * 审查页、采纳逻辑、agent 工具都共用同一份「摆到轴上」的表示。
 */
export function buildTimelineGuessPrompt(
  world: World,
  axis: Entry[],
  pool: Entry[],
  categories: Category[],
  scope: TimelineLayoutScope = {},
): PromptPair {
  const names = catNameMap(categories);
  const cap = scope.briefCap ?? 140;
  const cat = (e: Entry) => names[e.categoryId] ?? pt('uncategorized');

  const axisText = axis.length
    ? axis
        .map((e) => {
          const tm = e.time!;
          return pt('timelineLayoutLine', {
            title: e.title,
            category: cat(e),
            when: briefWhen(tm),
            era: tm.era.trim() || pt('timelineLayoutEraNone'),
            at: String(tm.at ?? ''),
            weight: pt(WEIGHT_BRIEF[tm.weight]),
            brief: briefOf(e, cap),
            locked: tm.locked ? pt('timelineLayoutLocked') : '',
          });
        })
        .join('\n')
    : pt('timelineLayoutAxisEmpty');

  const poolText = pool.length
    ? pool.map((e) => pt('guessTimelinePoolLine', { title: e.title, category: cat(e), brief: briefOf(e, cap) })).join('\n')
    : pt('timelineLayoutPoolEmpty');

  return {
    system: pt('guessTimelineSystem', {
      editorRole: pt('editorRole'),
      jsonRule: pt('jsonRule'),
    }),
    user: pt('guessTimelineUser', { worldBrief: worldBrief(world), axis: axisText, pool: poolText }),
  };
}

/* ------------------------------------------------------------------ */
/* 4. 一致性检查                                                       */
/* ------------------------------------------------------------------ */

/** 本次审计送进去多少 —— 由设置与条目数决定，拼装层按实情写给模型看 */
export interface ConsistencyScope {
  /** 「送入条目的数量上限」：索引最多列几条 */
  indexLimit: number;
  /** 正文单条上限（字） */
  perEntryCap: number;
  /** 正文总预算（字）；0 = 不限 */
  bodyBudget: number;
}

/**
 * 把账本渲染成提示词里的一段。
 *
 * 按「还该不该重看」**分组**，而不是每行挂一句处置说明：同一组的问题处置完全一样，
 * 一句话讲一次就够；逐行重复那段长句只会把真正要审的条目正文挤走。
 * 顺带把「凭什么放行可重看的那几条」写在组头上 —— 那是代码比出来的时间戳，不写它，模型只会瞎猜。
 */
function renderLedger(ledger: Ledger): string {
  if (!ledger.entries.length) return '';
  const group = (bucket: LedgerEntry['bucket']) =>
    ledger.entries.filter((l) => l.bucket === bucket);
  const rows = (list: LedgerEntry[]) =>
    list.map((l) => {
      const related = l.related.length
        ? pt('consistencyLedgerRelated', { titles: l.related.join(pt('listSep')) })
        : l.deletedRelated
          ? pt('consistencyLedgerDeleted', { n: l.deletedRelated })
          : '';
      return pt('consistencyLedgerLine', { title: l.title, related });
    });

  const blocks: string[] = [];
  const open = group('open');
  if (open.length) blocks.push([pt('consistencyLedgerGroupOpen'), ...rows(open)].join('\n'));
  const settled = group('settled');
  if (settled.length)
    blocks.push([pt('consistencyLedgerGroupSettled'), ...rows(settled)].join('\n'));
  const revisit = group('revisit');
  if (revisit.length) {
    blocks.push(
      [
        pt('consistencyLedgerGroupRevisit', { why: pt('consistencyLedgerRevisitWhy') }),
        ...rows(revisit),
      ].join('\n'),
    );
  }

  const tail = ledger.truncated
    ? `\n${pt('consistencyLedgerTruncated', { n: ledger.truncated })}`
    : '';
  return `${pt('consistencyLedgerTitle')}\n${pt('consistencyLedgerIntro')}\n\n${blocks.join('\n\n')}${tail}\n\n`;
}

export function buildConsistencyPrompt(
  world: World,
  entries: Entry[],
  categories: Category[],
  ledger: Ledger,
  scope: ConsistencyScope,
): PromptPair {
  const indexRep = existingIndexWithReport(entries, categories, scope.indexLimit);
  const bodyRep = expandEntriesWithReport(entries, categories, scope.perEntryCap, scope.bodyBudget);
  const compressed = bodyRep.perEntry < scope.perEntryCap;

  const scopeText = pt('consistencyScope', {
    n: entries.length,
    index:
      indexRep.picked < indexRep.total
        ? pt('consistencyScopeIndexCut', {
            listed: indexRep.picked,
            miss: indexRep.total - indexRep.picked,
          })
        : pt('consistencyScopeIndexAll'),
    body: pt('consistencyScopeBody', {
      per: bodyRep.perEntry,
      note: compressed ? pt('consistencyScopeNote') : '',
    }),
  });

  const system = pt('consistencySystem', {
    editorRole: pt('editorRole'),
    jsonRule: pt('jsonRule'),
  });

  const user = pt('consistencyUser', {
    worldBrief: worldBrief(world),
    scope: scopeText,
    ledger: renderLedger(ledger),
    index: indexRep.text,
    detail: bodyRep.text,
  })
    // 账本缺席时会留下一个空行占位，收掉它
    .replace(/\n{3,}/g, '\n\n')
    .trim();

  return { system, user };
}

/* ------------------------------------------------------------------ */
/* 5. 文章审校（用户投稿 → AI 给修改建议）                             */
/* ------------------------------------------------------------------ */

export function buildArticleReviewPrompt(
  world: World,
  article: string,
  entries: Entry[],
  categories: Category[],
): PromptPair {
  const relevant = retrieveRelevant(article.slice(0, 3000), entries, categories, 10);
  const ctx = relevant.length
    ? expandEntries(relevant, categories, 1200)
    : existingIndex(entries, categories, 60);

  const system = pt('articleSystem', {
    editorRole: pt('editorRole'),
    jsonRule: pt('jsonRule'),
  });

  const user = pt('articleUser', {
    worldBrief: worldBrief(world),
    ctx,
    article: article.slice(0, 12000),
  });

  return { system, user };
}

/* ------------------------------------------------------------------ */
/* 6. 世界问答                                                         */
/* ------------------------------------------------------------------ */

/**
 * 从提问里提取检索词。
 * 中文没有空格分词，只按空白切会把整句当成一个词 —— 所以额外把连续中文
 * 切成二元组（bigram），「灯塔的光为什么不能熄灭」→ 灯塔/塔的/的光/…
 * 这样哪怕作者没说和素材里一模一样的词，也能命中。
 */
function queryTerms(text: string): string[] {
  const norm = text.toLowerCase();
  const terms = new Set<string>();
  for (const t of norm.split(/[\s，。！？、；：""''（）()\[\]{}<>/\\|~`!@#$%^&*+=,.?:;"'-]+/)) {
    if (t.length >= 2) terms.add(t);
  }
  for (const m of norm.matchAll(/[\u4e00-\u9fa5]{2,}/g)) {
    const s = m[0];
    for (let i = 0; i + 2 <= s.length; i++) terms.add(s.slice(i, i + 2));
  }
  return [...terms];
}

export function buildAskPrompt(
  world: World,
  question: string,
  entries: Entry[],
  categories: Category[],
  history: { role: 'user' | 'assistant'; content: string }[] = [],
  pieces: Piece[] = [],
): PromptPair {
  const relevant = retrieveRelevant(question, entries, categories, 8);
  const ctx = relevant.length
    ? expandEntries(relevant, categories, 1400)
    : pt('askNoEntries');

  // 杂物间的文字类藏品：与问题相关的，作为「作者的其他素材」一并参考
  const terms = queryTerms(question);
  const pieceCtx = pieces
    .filter((p) => p.content?.trim())
    .map((p) => {
      const titleHay = (p.title + ' ' + p.tags.join(' ')).toLowerCase();
      const bodyHay = p.content.toLowerCase();
      const score =
        terms.reduce((s, t) => s + (titleHay.includes(t) ? 2 : 0) + (bodyHay.includes(t) ? 1 : 0), 0) +
        (p.pinned ? 2 : 0);
      return { p, score };
    })
    .sort((a, b) => b.score - a.score)
    .filter((x) => x.score > 2)
    .slice(0, 5)
    .map(({ p }) =>
      pt('askPieceLine', {
        title: p.title,
        body:
          p.content.length > 500 ? p.content.slice(0, 500) + pt('askTruncated') : p.content,
      }),
    )
    .join('\n');

  const system = pt('askSystem', { editorRole: pt('editorRole') });

  const historyText = history
    .slice(-6)
    .map((m) =>
      pt('askHistoryLine', {
        role: m.role === 'user' ? pt('askRoleAuthor') : pt('askRoleKeeper'),
        content: m.content,
      }),
    )
    .join('\n');

  const user = pt('askUser', {
    worldBrief: worldBrief(world),
    ctx,
    pieceSection: pieceCtx ? pt('askPieceSection', { pieces: pieceCtx }) : '',
    historySection: historyText ? pt('askHistorySection', { history: historyText }) : '',
    question,
  });

  return { system, user };
}

/* ------------------------------------------------------------------ */
/* 6b. 建议提问 —— 问答页那排「点一下就能直接问」的提示泡                */
/*                                                                     */
/* 立场：作者常常写不出第一个问题。与其给他一堆写死的示例，              */
/* 不如让读过设定的人替他起个头 —— 每次进页面、每轮问答后重新想一遍。     */
/* ------------------------------------------------------------------ */

/** 把历史压成给「提问助手」看的一段对话（过长会挤掉真正有用的设定） */
function renderAskedHistory(history: { role: 'user' | 'assistant'; content: string }[]): string {
  return history
    .slice(-8)
    .map((m) =>
      pt('askHistoryLine', {
        role: m.role === 'user' ? pt('askRoleAuthor') : pt('askRoleKeeper'),
        content: m.content.slice(0, 160),
      }),
    )
    .join('\n');
}

export function buildSuggestPrompt(
  world: World,
  entries: Entry[],
  categories: Category[],
  history: { role: 'user' | 'assistant'; content: string }[] = [],
  count = 4,
): PromptPair {
  const index = existingIndex(entries, categories, 60);

  return {
    system: pt('suggestSystem', { editorRole: pt('editorRole') }),
    user: pt('suggestUser', {
      worldBrief: worldBrief(world),
      index,
      historySection: history.length
        ? pt('suggestFollowUp', { history: renderAskedHistory(history) })
        : pt('suggestFresh'),
      count,
    }),
  };
}

/* ------------------------------------------------------------------ */
/* 6c. 追问的候选答案 —— 新建世界里那排「点一下就能直接填」的建议         */
/* ------------------------------------------------------------------ */

export function buildSuggestAnswersPrompt(
  materials: DraftMaterial[],
  question: string,
  why: string,
  told: string[],
  count = 3,
): PromptPair {
  return {
    system: pt('suggestAnswerSystem', { editorRole: pt('editorRole') }),
    user: pt('suggestAnswerUser', {
      materials: renderMaterials(materials, 14000),
      toldBlock: renderTold(told),
      question,
      whyLine: why ? pt('suggestAnswerWhyLine', { why }) : '',
      count,
    }),
  };
}

/* ================================================================== */
/* 新建世界：把一堆零散材料统筹成一个世界                                */
/*                                                                     */
/* 这一组提示词的立场：用户不用先想清楚再来找我们。                      */
/* 他丢什么进来都可以，读懂的活儿是我们干。                              */
/* ================================================================== */

/** 把用户投喂的素材渲染成提示词里的材料清单 */
export function renderMaterials(materials: DraftMaterial[], budget = 34000): string {
  const usable = materials.filter((m) => m.kind !== 'image');
  if (!usable.length) return pt('materialsEmpty');

  const perDoc = Math.max(2000, Math.floor(budget / Math.max(1, usable.length)));
  const kindLabel: Record<string, string> = {
    file: pt('materialKindFile'),
    text: pt('materialKindText'),
    rule: pt('materialKindRule'),
  };

  return usable
    .map((m, i) => {
      const body = (m.text ?? '').slice(0, perDoc);
      const cut = (m.text ?? '').length > body.length ? pt('materialCut') : '';
      return pt('materialLine', {
        n: i + 1,
        name: m.name,
        kind: kindLabel[m.kind] ?? m.kind,
        chars: m.chars ? pt('materialChars', { chars: m.chars }) : '',
        note: m.note ? pt('materialNote', { note: m.note }) : '',
        body,
        cut,
      });
    })
    .join('\n\n');
}

function renderQa(answers: { question: string; answer: string; delegated: boolean }[]): string {
  if (!answers.length) return pt('qaEmpty');
  return answers
    .map((a, i) =>
      pt('qaLine', {
        n: i + 1,
        question: a.question,
        answer: a.delegated ? pt('qaDelegated') : a.answer || pt('qaUnanswered'),
      }),
    )
    .join('\n');
}

/** 作者单方面交代的话：不针对任何问题，优先级高于一切材料与你的判断 */
function renderTold(told: string[]): string {
  if (!told.length) return pt('toldEmpty');
  return pt('toldBlock', {
    list: told.map((t, i) => `${i + 1}. ${t}`).join('\n'),
  });
}

export interface IntakeParams {
  round: number;
  /** 这是回答完问题后的追问轮 */
  followUp: boolean;
  /** 用户额外补充的话 */
  extra?: string;
  /** 作者单方面交代的话（最高优先级） */
  told: string[];
  answers: { question: string; answer: string; delegated: boolean }[];
}

export function buildIntakePrompt(
  materials: DraftMaterial[],
  params: IntakeParams,
): PromptPair {
  const imageCount = materials.filter((m) => m.kind === 'image').length;

  const system = pt('intakeSystem', {
    toldRule: pt('toldRule'),
    round: params.round,
  });

  const user = pt('intakeUser', {
    materialCount: materials.length,
    imageNote: imageCount ? pt('intakeImageNote', { n: imageCount }) : '',
    materials: renderMaterials(materials),
    toldBlock: renderTold(params.told),
    qa: renderQa(params.answers),
    extraBlock: params.extra ? pt('intakeExtraBlock', { extra: params.extra }) : '',
    task: params.followUp ? pt('intakeTaskFollowUp') : pt('intakeTaskFirst'),
  });

  return { system, user };
}

export function buildProposalPrompt(
  materials: DraftMaterial[],
  answers: { question: string; answer: string; delegated: boolean }[],
  told: string[],
  extra?: string,
): PromptPair {
  const system = pt('proposalSystem', {
    proposalShape: pt('proposalShape'),
    colorRule: pt('colorRule'),
    toldRule: pt('toldRule'),
  });

  const user = pt('proposalUser', {
    materialCount: materials.length,
    imageNote: materials.some((m) => m.kind === 'image') ? pt('proposalImageNote') : '',
    materials: renderMaterials(materials),
    toldBlock: renderTold(told),
    qa: renderQa(answers),
    extraBlock: extra ? pt('proposalExtraBlock', { extra }) : '',
  });

  return { system, user };
}

export function buildProposalRevisePrompt(
  materials: DraftMaterial[],
  answers: { question: string; answer: string; delegated: boolean }[],
  told: string[],
  proposal: WorldProposal,
  instruction: string,
  revisionCount: number,
): PromptPair {
  const system = pt('reviseSystem', {
    proposalShape: pt('proposalShape'),
    colorRule: pt('colorRule'),
    revisionNo: revisionCount + 1,
  });

  const user = pt('reviseUser', {
    materials: renderMaterials(materials, 12000),
    toldBlock: renderTold(told),
    qa: renderQa(answers),
    proposal: JSON.stringify(proposal, null, 2).slice(0, 24000),
    instruction,
  });

  return { system, user };
}

/* ------------------------------------------------------------------ */
/* 从资料中抽取条目（世界建好之后，继续往里补资料用）                     */
/* ------------------------------------------------------------------ */

export function buildDocExtractPrompt(
  world: World,
  docName: string,
  docText: string,
  entries: Entry[],
  categories: Category[],
  categoryNames: string[],
): PromptPair {
  const index = existingIndex(entries, categories, 70);

  const system = pt('docExtractSystem', {
    editorRole: pt('editorRole'),
    jsonRule: pt('jsonRule'),
    categoryNames: categoryNames.join(pt('listSep')),
  });

  const user = pt('docExtractUser', {
    worldBrief: worldBrief(world),
    index,
    docName,
    docText: docText.slice(0, 14000),
  });

  return { system, user };
}
