import type {
  AISettings,
  Category,
  DraftMaterial,
  Entry,
  Piece,
  ReviewItem,
  ReviewSource,
  TimeLayoutItem,
  TimeWeight,
  World,
  WorldProposal,
} from '../types';
import { TIME_WEIGHTS } from '../types';
import { entryKey, uid, now } from '../lib/id';
import { formatTimeText } from '../lib/timeParse';
import { chat, AIError, type ChatMessageInput, type ContentPart } from './client';
import { asArray, extractJson, hasListShape, str, strArray } from './parse';
import {
  buildArticleReviewPrompt,
  buildAskPrompt,
  buildConsistencyPrompt,
  buildDocExtractPrompt,
  buildExpandPrompt,
  buildGeneratePrompt,
  buildIntakePrompt,
  buildPolishPrompt,
  buildProposalPrompt,
  buildProposalRevisePrompt,
  buildRelationPrompt,
  buildSuggestAnswersPrompt,
  buildSuggestPrompt,
  buildTimelineLayoutPrompt,
  buildTimelineGuessPrompt,
  type GenerateParams,
  type IntakeParams,
  type PolishParams,
} from './prompts';
import { retrieveRelevant } from './context';
import { blockedIssues, buildLedger, splitDuplicates, type Ledger } from './consist';
import { tGlobal } from '../i18n/translate';

export interface RunOptions {
  onDelta?: (chunk: string) => void;
  signal?: AbortSignal;
  /**
   * 「再一次生成」时作者追加的提示词：只影响这一次调用，不改原任务定义。
   * 作为一条额外的 user 消息接在原始 user 之后，让模型在原任务的基础上照此调整。
   */
  extraInstruction?: string;
}

/**
 * 把 `RunOptions.extraInstruction` 折成一条追加的 user 消息（没有则返回空数组）。
 *
 * 放在独立的 helper 里，是因为每个 run 函数拼 messages 的方式都一样 ——
 * 与其每个都手写一遍 `if (opts.extraInstruction)`，不如这里统一收口。
 */
function extraInstructionMsg(opts: RunOptions): ChatMessageInput[] {
  const extra = opts.extraInstruction?.trim();
  return extra ? [{ role: 'user' as const, content: extra }] : [];
}

/**
 * 从模型返回里取「列表」—— 取不到就报错，**不许**退化成空数组。
 *
 * 因为空数组在界面上等于「它说没有问题」，那是结论。而「模型答非所问」是我们没读懂，
 * 两件事必须分开，否则作者会以为设定真的自洽（一致性检查曾这样静默吞掉全部结果）。
 */
function requireList<T>(raw: string, data: unknown): T[] {
  if (!hasListShape(data)) {
    throw new AIError(tGlobal('ai.err.shapeMismatch', { raw: raw.trim().slice(0, 200) }));
  }
  return asArray<T>(data);
}

/** 按标题（含别名）在已有条目里找目标，找不到返回 null */
export function findEntryByTitle(entries: Entry[], title: string): Entry | null {
  const t = title.trim().toLowerCase();
  if (!t) return null;
  const exact = entries.find(
    (e) =>
      e.title.toLowerCase() === t ||
      e.aliases.some((a) => a.toLowerCase() === t),
  );
  if (exact) return exact;
  // 宽松匹配：包含关系
  return (
    entries.find(
      (e) =>
        e.title.toLowerCase().includes(t) ||
        t.includes(e.title.toLowerCase()),
    ) ?? null
  );
}

function baseItem(worldId: string, kind: ReviewItem['kind'], title: string): ReviewItem {
  return {
    id: uid('rv'),
    worldId,
    kind,
    title,
    note: '',
    rationale: '',
    status: 'pending',
    createdAt: now(),
  };
}

/** 一次「批量生成」的可复现来源 */
function generateSource(categoryId: string, params: Omit<GenerateParams, 'categoryName'>): ReviewSource {
  return {
    task: 'generate',
    categoryId,
    instruction: params.instruction,
    count: params.count,
    keywords: params.keywords,
    allowRelations: params.allowRelations,
  };
}

function normalizeEntryDraft(
  raw: any,
  worldId: string,
  fallbackCategoryId: string,
): Partial<Entry> {
  return {
    id: uid('en'),
    worldId,
    categoryId: str(raw.categoryId, fallbackCategoryId),
    title: str(raw.title, tGlobal('ai.task.unnamedEntry')).trim(),
    aliases: strArray(raw.aliases),
    summary: str(raw.summary),
    content: str(raw.content),
    tags: strArray(raw.tags),
    fields: typeof raw.fields === 'object' && raw.fields ? (raw.fields as Record<string, string>) : {},
    status: 'pending' as const,
  };
}

/* ------------------------------------------------------------------ */

export async function runGenerate(
  settings: AISettings,
  world: World,
  entries: Entry[],
  categories: Category[],
  category: Category,
  params: Omit<GenerateParams, 'categoryName'>,
  opts: RunOptions = {},
): Promise<ReviewItem[]> {
  const prompt = buildGeneratePrompt(world, entries, categories, {
    ...params,
    categoryName: category.name,
  });
  const raw = await chat(
    settings,
    [
      { role: 'system', content: prompt.system },
      { role: 'user', content: prompt.user },
      ...extraInstructionMsg(opts),
    ],
    { onDelta: opts.onDelta, signal: opts.signal, json: false },
  );
  const data = extractJson<any>(raw);
  const list = asArray<any>(data);

  // 去重：同批内或与库内 key 冲突的条目跳过（及其附带关系）
  const seenKeys = new Set(entries.map((e) => e.key));
  const batchKeys = new Set<string>();
  const items: ReviewItem[] = [];
  for (const rawEntry of list) {
    const draft = normalizeEntryDraft(rawEntry, world.id, category.id);
    if (!draft.title) continue;
    const key = entryKey(draft.title);
    if (seenKeys.has(key) || batchKeys.has(key)) continue;
    seenKeys.add(key);
    batchKeys.add(key);
    const relations = Array.isArray(rawEntry.relations) ? rawEntry.relations : [];
    const unresolved: string[] = [];
    const resolved: ReviewItem[] = [];

    for (const rel of relations) {
      const target = findEntryByTitle(entries, str(rel.toTitle ?? rel.to ?? ''));
      if (!target) {
        unresolved.push(str(rel.toTitle ?? rel.to));
        continue;
      }
      const item = baseItem(world.id, 'relation', `${draft.title} → ${target.title}`);
      item.relationDraft = {
        fromEntryId: draft.id!,
        toEntryId: target.id,
        type: str(rel.type, tGlobal('ai.task.defaultRelation')),
        note: str(rel.note ?? rel.description),
      };
      item.rationale = tGlobal('ai.task.newEntryRelationRationale');
      item.note = tGlobal('ai.task.newEntryRelationNote');
      resolved.push(item);
    }

    const item = baseItem(world.id, 'create-entry', draft.title!);
    item.entryDraft = draft;
    item.rationale = str(rawEntry.reason ?? rawEntry.rationale, '');
    item.note = unresolved.length
      ? tGlobal('ai.task.unresolved', {
          n: unresolved.length,
          list: unresolved.join(tGlobal('ai.task.listSep')),
        })
      : '';
    // 同一次「批量生成」产出的条目与它附带的关系，共享同一份来源 ——
    // 这样任一张卡点「再生成」都能重跑当初那次生成。
    const source = generateSource(category.id, params);
    item.source = source;
    for (const rel of resolved) rel.source = source;
    items.push(item, ...resolved);
  }
  return items;
}

/* ------------------------------------------------------------------ */

/**
 * 把模型返回的「改后字段」拼成一条 update-entry 提议。
 *
 * 单条扩写（作者就盯着这一条）与批量打磨（作者要连着审一批）共用这一段 ——
 * 否则两条路径的 diff 生成逻辑会各自漂移，审查页上看到的对比就不一样了。
 *
 * 注意「没改动」是**正常结果**（批量打磨里尤其常见），这里照常返回提议、
 * `changes` 为空；要不要入队由调用方决定。
 */
function buildUpdateProposal(
  worldId: string,
  entry: Entry,
  data: any,
  fallbackRationale: string,
): ReviewItem {
  const sep = tGlobal('ai.task.listSep');
  const after = {
    summary: str(data.summary, entry.summary),
    content: str(data.content, entry.content),
    tags: strArray(data.tags).length ? strArray(data.tags) : entry.tags,
    aliases: strArray(data.aliases).length ? strArray(data.aliases) : entry.aliases,
  };

  const changes = [
    { field: 'summary', before: entry.summary, after: after.summary },
    { field: 'content', before: entry.content, after: after.content },
    {
      field: 'tags',
      before: entry.tags.join(sep),
      after: after.tags.join(sep),
    },
    {
      field: 'aliases',
      before: entry.aliases.join(sep),
      after: after.aliases.join(sep),
    },
  ].filter((c) => c.before !== c.after);

  const item = baseItem(
    worldId,
    'update-entry',
    tGlobal('ai.task.updateTitle', { title: entry.title }),
  );
  item.targetEntryId = entry.id;
  item.entryDraft = after as Partial<Entry>;
  item.changes = changes;
  item.rationale = str(data.changeNote, fallbackRationale);
  return item;
}

/**
 * 把模型给的关系（按标题写在 relations 里）转成关系提议。
 *
 * 目标条目找不到时不静默丢弃：名字记进 `unresolved` 交给调用方提示作者 ——
 * 「模型写了三条关系、其实一条都没连上」和「本来就没有可连的」是两回事。
 */
function relationProposals(
  worldId: string,
  entries: Entry[],
  fromTitle: string,
  fromEntryId: string,
  rawRelations: unknown,
): { items: ReviewItem[]; unresolved: string[] } {
  const items: ReviewItem[] = [];
  const unresolved: string[] = [];
  if (!Array.isArray(rawRelations)) return { items, unresolved };

  for (const rel of rawRelations) {
    const toTitle = str(rel?.toTitle ?? rel?.to);
    if (!toTitle) continue;
    const target = findEntryByTitle(entries, toTitle);
    if (!target || target.id === fromEntryId) {
      unresolved.push(toTitle);
      continue;
    }
    const item = baseItem(worldId, 'relation', `${fromTitle} → ${target.title}`);
    item.relationDraft = {
      fromEntryId,
      toEntryId: target.id,
      type: str(rel.type, tGlobal('ai.task.defaultRelation')),
      note: str(rel.note ?? rel.description),
    };
    item.rationale = tGlobal('ai.task.relationRationale');
    items.push(item);
  }
  return { items, unresolved };
}

export async function runExpand(
  settings: AISettings,
  world: World,
  entry: Entry,
  entries: Entry[],
  categories: Category[],
  instruction: string,
  opts: RunOptions = {},
): Promise<ReviewItem> {
  const prompt = buildExpandPrompt(world, entry, entries, categories, instruction);
  const raw = await chat(
    settings,
    [
      { role: 'system', content: prompt.system },
      { role: 'user', content: prompt.user },
    ],
    { onDelta: opts.onDelta, signal: opts.signal },
  );
  const data = extractJson<any>(raw);

  // 模型判断这条条目本身就该删掉（重复、冗余、与世界基调相悖等）——
  // 那就不是「改写正文」的活，而是提议删除。删条目是不可逆操作，
  // 必须进审查队列由作者拍板，不能让 AI 自己动手。
  if (data && (data.action === 'delete' || data.delete === true)) {
    const item = baseItem(
      world.id,
      'delete-entry',
      tGlobal('ai.task.deleteTitle', { title: entry.title }),
    );
    item.targetEntryId = entry.id;
    item.rationale = str(data.changeNote, tGlobal('ai.task.deleteRationale'));
    return item;
  }

  const item = buildUpdateProposal(
    world.id,
    entry,
    data,
    tGlobal('ai.task.updateRationale'),
  );
  // 单条扩写是作者在现场下的明确指令，即便一字未改也照常入队 ——
  // 「AI 看完觉得不用改」本身就是他要的答复。
  const { unresolved } = relationProposals(world.id, entries, entry.title, entry.id, data?.relations);
  if (unresolved.length) {
    item.note = tGlobal('ai.task.unresolved', {
      n: unresolved.length,
      list: unresolved.join(tGlobal('ai.task.listSep')),
    });
  }
  return item;
}

/**
 * 批量打磨：对一条已有条目做**克制型**修订。
 *
 * 与 `runExpand` 的差别在纪律与产出：批量打磨会连着产出十几条提议，作者要一条条审，
 * 所以模型原样返回（一个字都没改）时**不入队** —— 一条空 diff 的卡片只会让作者多读一遍。
 * 于是这里返回数组：`[]` = 这条无需改动；否则 `[update, ...relations]`。
 *
 * 返回数组而不是单条，是因为「补关联」这个着力点会连带产出关系提议 ——
 * 关系必须自己成为一条提议才会进审查队列，挂在条目提议上没人消费就等于白做。
 */
export async function runPolish(
  settings: AISettings,
  world: World,
  entry: Entry,
  entries: Entry[],
  categories: Category[],
  params: PolishParams,
  opts: RunOptions = {},
): Promise<ReviewItem[]> {
  const prompt = buildPolishPrompt(world, entry, entries, categories, params);
  const raw = await chat(
    settings,
    [
      { role: 'system', content: prompt.system },
      { role: 'user', content: prompt.user },
      ...extraInstructionMsg(opts),
    ],
    { onDelta: opts.onDelta, signal: opts.signal },
  );
  const data = extractJson<any>(raw);

  // 「它没改」和「它答非所问」都会表现为「改后字段和原文一样」，但对作者的意义正好相反：
  // 前者是结论（这条够好了），后者是我们没读懂。要是混为一谈，界面就会用「这批都不用改」
  // 这种口吻宣布一件假事 —— 跟一致性检查当初静默吞掉结果是一个坑。
  // 所以这里要求返回里至少有 content 或 summary 之一，否则按「形状对不上」报错。
  if (!data || typeof data !== 'object' || !('content' in data || 'summary' in data)) {
    throw new AIError(tGlobal('ai.err.shapeMismatch', { raw: raw.trim().slice(0, 200) }));
  }

  const item = buildUpdateProposal(world.id, entry, data, tGlobal('ai.task.polishRationale'));
  const { items: relItems, unresolved } = relationProposals(
    world.id,
    entries,
    entry.title,
    entry.id,
    data?.relations,
  );

  if (!item.changes?.length) return relItems;

  if (unresolved.length) {
    item.note = tGlobal('ai.task.unresolved', {
      n: unresolved.length,
      list: unresolved.join(tGlobal('ai.task.listSep')),
    });
  }
  // 打磨单条条目：来源记目标条目 + 打磨方式，供「再生成」重新打磨这一条
  const source: ReviewSource = {
    task: 'polish',
    targetEntryId: entry.id,
    focus: params.focus,
    instruction: params.instruction,
  };
  item.source = source;
  for (const rel of relItems) rel.source = source;
  return [item, ...relItems];
}

/* ------------------------------------------------------------------ */

export async function runRelations(
  settings: AISettings,
  world: World,
  entries: Entry[],
  categories: Category[],
  opts: RunOptions = {},
): Promise<{ items: ReviewItem[]; unmatched: string[] }> {
  const prompt = buildRelationPrompt(world, entries, categories);
  const raw = await chat(
    settings,
    [
      { role: 'system', content: prompt.system },
      { role: 'user', content: prompt.user },
      ...extraInstructionMsg(opts),
    ],
    { onDelta: opts.onDelta, signal: opts.signal },
  );
  const data = extractJson<any>(raw);
  const list = requireList<any>(raw, data);

  const items: ReviewItem[] = [];
  const unmatched: string[] = [];
  const seen = new Set<string>();

  for (const r of list) {
    const from = findEntryByTitle(entries, str(r.from));
    const to = findEntryByTitle(entries, str(r.to));
    if (!from || !to || from.id === to.id) {
      unmatched.push(`${str(r.from)} → ${str(r.to)}`);
      continue;
    }
    const key = `${from.id}|${to.id}|${str(r.type)}`;
    const rkey = `${to.id}|${from.id}|${str(r.type)}`;
    if (seen.has(key) || seen.has(rkey)) continue;
    seen.add(key);

    const item = baseItem(world.id, 'relation', `${from.title} → ${to.title}`);
    item.relationDraft = {
      fromEntryId: from.id,
      toEntryId: to.id,
      type: str(r.type, tGlobal('ai.task.defaultRelation')),
      note: str(r.note),
    };
    item.rationale = str(r.note);
    item.source = { task: 'relations' };
    items.push(item);
  }
  return { items, unmatched };
}

/* ------------------------------------------------------------------ */
/* 时间轴自动排版                                                       */
/* ------------------------------------------------------------------ */

/**
 * AI 自动排版的一次产出。
 *
 * 它**不给出一份「它想要的完整排布」**，只给出**相对此刻的真实改动**：
 * 位置已经对的不列、它没说依据的不排。这样作者在审查页看到的每一行
 * 都是「按了会真的发生什么」，而不是一份要他自己去比对的清单。
 */
export interface TimelineLayoutOutcome {
  /** 真正的改动（已经和送进去那份快照对过账） */
  items: TimeLayoutItem[];
  /** 模型报了标题、但清单里没有这一条 —— 如实交代，别当成「它没找到问题」 */
  unmatched: string[];
  /** 它自己对这次排法的整体说明（进审查卡当「AI 依据」） */
  note: string;
  /** 送进提示词的条数 / 这个世界一共有多少条 */
  sent: number;
  total: number;
}

/** 位置数值只留一位小数 —— 再细的差别在轴上根本看不出来，却会让日志读起来像随机数 */
const round1 = (n: number) => Math.round(n * 10) / 10;

/**
 * 让 AI 把时间轴排一遍。
 *
 * 三件必须做对的事：
 *   1. **只排有依据的**（提示词里写死了这条纪律，这里再按「有没有给位置」兜一道）；
 *   2. **只输出真实的改动** —— 和送进去那份快照比，什么都没变的直接不列，
 *      否则作者会在审查页看到一屏「12 → 12」；
 *   3. **不碰时间文本**：`from`/`to` 是作者写的，AI 只决定 `at`。
 */
export async function runTimelineLayout(
  settings: AISettings,
  world: World,
  entries: Entry[],
  categories: Category[],
  opts: RunOptions = {},
): Promise<TimelineLayoutOutcome> {
  // 轴上的排前面、按当下位置排：它们才是「排版」的主要对象；池子里的跟在后面，
  // 能排一条是一条 —— 顺序本身也在告诉模型「先看这些」。
  const axis = entries
    .filter((e) => e.time)
    .sort((a, b) => (a.time!.at ?? 0) - (b.time!.at ?? 0));
  const pool = entries.filter((e) => !e.time);

  const limit = Math.max(2, settings.contextLimit || 60);
  const axisSent = axis.slice(0, limit);
  const poolSent = pool.slice(0, Math.max(0, limit - axisSent.length));
  const sent = axisSent.length + poolSent.length;

  const prompt = buildTimelineLayoutPrompt(world, axisSent, poolSent, categories);
  const raw = await chat(
    settings,
    [
      { role: 'system', content: prompt.system },
      { role: 'user', content: prompt.user },
      ...extraInstructionMsg(opts),
    ],
    { onDelta: opts.onDelta, signal: opts.signal },
  );
  const data = extractJson<any>(raw);
  // 取不到列表就报错，**不许**退化成空数组：空数组在这里等于「它觉得现在这样就行」，
  // 那是结论；而「它答非所问」是我们没读懂。两件事混了，作者会信一句假话。
  const list = requireList<any>(raw, data);

  const items: TimeLayoutItem[] = [];
  const unmatched: string[] = [];
  const seen = new Set<string>();

  for (const r of list) {
    const title = str(r.title).trim();
    if (!title) continue;
    const entry = findEntryByTitle(entries, title);
    if (!entry) {
      unmatched.push(title);
      continue;
    }
    if (seen.has(entry.id)) continue;
    seen.add(entry.id);

    const at = Number(r.at);
    if (!Number.isFinite(at)) {
      // 没有位置就没什么可排的 —— 报进 unmatched，好让界面说清「它这条没说清楚」
      unmatched.push(title);
      continue;
    }

    const cur = entry.time;
    const fromAt = cur && typeof cur.at === 'number' ? cur.at : null;
    const kind = cur?.kind ?? 'point';
    const toAtRaw = Number(r.toAt);
    const toAt =
      kind === 'range' && Number.isFinite(toAtRaw) && round1(toAtRaw) > round1(at)
        ? round1(toAtRaw)
        : undefined;

    const eraRaw = str(r.era).trim();
    const era = eraRaw && eraRaw !== (cur?.era ?? '') ? eraRaw : undefined;
    const weightRaw = str(r.weight).trim();
    const weight = TIME_WEIGHTS.includes(weightRaw as TimeWeight)
      ? (weightRaw as TimeWeight)
      : undefined;
    const weightChanged = weight && weight !== (cur?.weight ?? 'normal') ? weight : undefined;

    // 一个数都没变：这条不必让作者看一眼
    const moves = fromAt === null || round1(fromAt) !== round1(at);
    if (!moves && toAt === undefined && era === undefined && !weightChanged) continue;

    // 锁定条目：位置动了，时间文字必须跟着重写。模型给的 from 原样采纳；
    // 它漏给了就由这里兜一道 —— 拿新位置反推一句「N 年 / N 年 M 月」，
    // 总比让「120 年」留在 130 的位置上自相矛盾强。
    let from: string | undefined;
    if (cur?.locked && moves) {
      const modelFrom = str(r.from).trim();
      from = modelFrom || formatTimeText(round1(at));
    }

    items.push({
      entryId: entry.id,
      title: entry.title,
      at: round1(at),
      toAt,
      era,
      weight: weightChanged,
      from,
      reason: str(r.reason),
      fromAt,
    });
  }

  return { items, unmatched, note: str(data?.note), sent, total: entries.length };
}

/**
 * 一次「AI 猜测时间」的产出。形状与排版一致（`TimelineLayoutOutcome`），
 * 但语义不同：`items` 里的每条都是「给一条**没时间**的条目定出时间」，
 * `fromAt` 恒为 `null`（它们之前都在池子里）。`total` 是池子的条数。
 */
export interface TimelineGuessOutcome {
  items: TimeLayoutItem[];
  /** 模型报了标题、但池子里没有这一条 —— 如实交代 */
  unmatched: string[];
  /** 它自己对这次猜测的整体说明 */
  note: string;
  /** 送进提示词的池子条数 / 这个世界没设时间的总数 */
  sent: number;
  total: number;
}

/**
 * 让 AI 给一批还没设时间的条目**猜时间**。
 *
 * 与 `runTimelineLayout` 的区别：
 *   - 排版只动「先后」（`at`），猜测要连 `from` 文本一起定 —— 后者在替作者编日期，更重；
 *   - 排版送「已在轴上 + 池子」两块清单，猜测只对**池子**下手（轴上那些是参照，不动它们）。
 *
 * 纪律同排版：只猜有依据的、at 与 from 必须对得上、猜不出的不列。返回的 `from` 会由
 * 调用方（useTimelineGuess / agent 工具）落进 `guessDraft`，进审查队列由作者拍板。
 */
export async function runTimelineGuess(
  settings: AISettings,
  world: World,
  entries: Entry[],
  categories: Category[],
  opts: RunOptions = {},
): Promise<TimelineGuessOutcome> {
  const axis = entries.filter((e) => e.time).sort((a, b) => (a.time!.at ?? 0) - (b.time!.at ?? 0));
  const pool = entries.filter((e) => !e.time);

  const limit = Math.max(2, settings.contextLimit || 60);
  const axisSent = axis.slice(0, limit);
  const poolSent = pool.slice(0, Math.max(0, limit - axisSent.length));
  const sent = poolSent.length;

  const prompt = buildTimelineGuessPrompt(world, axisSent, poolSent, categories);
  const raw = await chat(
    settings,
    [
      { role: 'system', content: prompt.system },
      { role: 'user', content: prompt.user },
      ...extraInstructionMsg(opts),
    ],
    { onDelta: opts.onDelta, signal: opts.signal },
  );
  const data = extractJson<any>(raw);
  const list = requireList<any>(raw, data);

  const items: TimeLayoutItem[] = [];
  const unmatched: string[] = [];
  const seen = new Set<string>();

  for (const r of list) {
    const title = str(r.title).trim();
    if (!title) continue;
    const entry = findEntryByTitle(pool, title);
    if (!entry) {
      unmatched.push(title);
      continue;
    }
    if (seen.has(entry.id)) continue;
    seen.add(entry.id);

    const at = Number(r.at);
    if (!Number.isFinite(at)) {
      unmatched.push(title);
      continue;
    }
    const from = str(r.from).trim();
    // 猜测的核心就是「定时间」，没给 from 等于只给了半份 —— 报进 unmatched，别硬塞个空文本
    if (!from) {
      unmatched.push(title);
      continue;
    }

    const eraRaw = str(r.era).trim();
    const weightRaw = str(r.weight).trim();
    const weight = TIME_WEIGHTS.includes(weightRaw as TimeWeight)
      ? (weightRaw as TimeWeight)
      : undefined;

    items.push({
      entryId: entry.id,
      title: entry.title,
      at: round1(at),
      era: eraRaw || undefined,
      weight,
      from,
      reason: str(r.reason),
      fromAt: null,
    });
  }

  return { items, unmatched, note: str(data?.note), sent, total: pool.length };
}

/* ------------------------------------------------------------------ */

/**
 * 一次审计的产出。
 *
 * 不再是一个裸数组：作者要看的除了「找到了什么」，还有「**这一轮为什么只有这几条**」。
 * 后者只有这里知道 —— 模型可能又报了一遍旧账（`skipped`），也可能真的没有新东西。
 */
export interface ConsistencyOutcome {
  /** 这一轮**新的**问题（已经去掉账本上说过的） */
  items: ReviewItem[];
  /** 模型又报了一遍、被账本拦下的几条标题（如实交代用） */
  skipped: string[];
  /** 这一轮带进去的账本（界面上说明「检查带了 N 条已审记录」） */
  ledger: Ledger;
}

/** 正文单条上限：与提示词里的说法必须一致 */
const CONSIST_BODY_CAP = 900;

export async function runConsistency(
  settings: AISettings,
  world: World,
  entries: Entry[],
  categories: Category[],
  /** 这个世界的历次审计结果 —— 账本与判重都从它来 */
  history: ReviewItem[] = [],
  opts: RunOptions = {},
): Promise<ConsistencyOutcome> {
  const ledger = buildLedger(history, entries);
  if (!entries.length) {
    return { items: [], skipped: [], ledger };
  }

  // 「送入条目的数量上限」这个设置原先只作用在工作台，审计一直按写死的 80 条来 ——
  // 界面上却告诉作者「可以在设置里调小」。这里把它接上，设置才名副其实。
  const limit = settings.contextLimit || 60;
  const prompt = buildConsistencyPrompt(world, entries, categories, ledger, {
    indexLimit: limit,
    perEntryCap: CONSIST_BODY_CAP,
    // 总预算跟着设置走：上限调大的人多半用的是长窗口模型，正文也该跟着放宽。
    // 但始终给个总闸 —— 没有总闸时条目一多整段上下文会爆，服务端悄悄截尾，
    // 而排在前面的（按 updatedAt 最新）那批条目**每轮都排在前面** → 永远只报它们。
    bodyBudget: Math.max(20000, limit * CONSIST_BODY_CAP),
  });
  const raw = await chat(
    settings,
    [
      { role: 'system', content: prompt.system },
      { role: 'user', content: prompt.user },
      ...extraInstructionMsg(opts),
    ],
    { onDelta: opts.onDelta, signal: opts.signal },
  );
  const data = extractJson<any>(raw);
  const list = requireList<any>(raw, data);

  const parsed: ReviewItem[] = list.map((issue) => {
    const titles = strArray(issue.entryTitles ?? issue.relatedEntries);
    const related = titles
      .map((t) => findEntryByTitle(entries, t))
      .filter((e): e is Entry => !!e);
    const item = baseItem(
      world.id,
      'consistency',
      str(issue.title, tGlobal('ai.task.issueTitle')),
    );
    const sev = str(issue.severity, 'medium');
    item.severity = (['high', 'medium', 'low'].includes(sev) ? sev : 'medium') as ReviewItem['severity'];
    item.rationale = str(issue.detail);
    item.suggestion = str(issue.suggestion);
    item.relatedEntryIds = related.map((e) => e.id);
    item.note = titles.join(tGlobal('ai.task.listSep'));
    item.source = { task: 'consistency' };
    return item;
  });

  // 账本已经进过提示词了，但模型未必听话。**它不听话的部分由这里兜住** ——
  // 与其指望模型自觉，不如在入库前拦一道，并把拦下几条如实说出来。
  const { fresh, skipped } = splitDuplicates(parsed, blockedIssues(history, entries));
  return { items: fresh, skipped: skipped.map((s) => s.title), ledger };
}

/* ------------------------------------------------------------------ */

export interface ArticleReviewResult {
  verdict: string;
  consistencyScore: number;
  suggestions: {
    severity: 'high' | 'medium' | 'low';
    quote: string;
    issue: string;
    fix: string;
  }[];
  newEntityCandidates: { title: string; reason: string }[];
  usedEntries: { id: string; title: string }[];
}

export async function runArticleReview(
  settings: AISettings,
  world: World,
  article: string,
  entries: Entry[],
  categories: Category[],
  opts: RunOptions = {},
): Promise<ArticleReviewResult> {
  const prompt = buildArticleReviewPrompt(world, article, entries, categories);
  const raw = await chat(
    settings,
    [
      { role: 'system', content: prompt.system },
      { role: 'user', content: prompt.user },
    ],
    { onDelta: opts.onDelta, signal: opts.signal },
  );
  const data = extractJson<any>(raw);
  const used = retrieveRelevant(article.slice(0, 3000), entries, categories, 10);
  const sev = (v: unknown) => {
    const s = str(v, 'medium');
    return (['high', 'medium', 'low'].includes(s) ? s : 'medium') as 'high' | 'medium' | 'low';
  };
  return {
    verdict: str(data.verdict),
    consistencyScore: Number(data.consistencyScore) || 0,
    suggestions: asArray<any>(data.suggestions).map((s) => ({
      severity: sev(s.severity),
      quote: str(s.quote),
      issue: str(s.issue),
      fix: str(s.fix),
    })),
    newEntityCandidates: asArray<any>(data.newEntityCandidates).map((c) => ({
      title: str(c.title),
      reason: str(c.reason),
    })),
    usedEntries: used.map((e) => ({ id: e.id, title: e.title })),
  };
}

/* ------------------------------------------------------------------ */

export async function runAsk(
  settings: AISettings,
  world: World,
  question: string,
  entries: Entry[],
  categories: Category[],
  history: { role: 'user' | 'assistant'; content: string }[],
  opts: RunOptions = {},
  pieces: Piece[] = [],
): Promise<{ answer: string; cites: { id: string; title: string }[] }> {
  const prompt = buildAskPrompt(world, question, entries, categories, history, pieces);
  const answer = await chat(
    settings,
    [
      { role: 'system', content: prompt.system },
      { role: 'user', content: prompt.user },
    ],
    { onDelta: opts.onDelta, signal: opts.signal },
  );

  // 从 [[...]] 里解析引用
  const cites: { id: string; title: string }[] = [];
  const re = /\[\[([^\]|]+)(?:\|[^\]]+)?\]\]/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(answer))) {
    const found = findEntryByTitle(entries, m[1].trim());
    if (found && !cites.some((c) => c.id === found.id)) {
      cites.push({ id: found.id, title: found.title });
    }
  }
  return { answer, cites };
}

/**
 * 照着知识库出几条「接下来值得问什么」。
 * 这是给作者搭台阶用的，失败了也不该打断他 —— 调用方负责回落到内置示例。
 */
export async function runSuggest(
  settings: AISettings,
  world: World,
  entries: Entry[],
  categories: Category[],
  history: { role: 'user' | 'assistant'; content: string }[] = [],
  opts: RunOptions = {},
): Promise<string[]> {
  const prompt = buildSuggestPrompt(world, entries, categories, history);
  const raw = await chat(
    settings,
    [
      { role: 'system', content: prompt.system },
      { role: 'user', content: prompt.user },
    ],
    { onDelta: opts.onDelta, signal: opts.signal },
  );
  const data = extractJson<any>(raw);
  return strArray(data?.questions ?? data)
    .map((s) => s.trim())
    .filter(Boolean)
    .slice(0, 6);
}

/** 新建世界里「换一批」：针对某个追问，重新想几条可以直接点选的答案 */
export async function runSuggestAnswers(
  settings: AISettings,
  materials: DraftMaterial[],
  question: string,
  why: string,
  told: string[] = [],
  opts: RunOptions = {},
): Promise<string[]> {
  const prompt = buildSuggestAnswersPrompt(materials, question, why, told);
  const raw = await chat(
    settings,
    [
      { role: 'system', content: prompt.system },
      { role: 'user', content: prompt.user },
    ],
    { onDelta: opts.onDelta, signal: opts.signal },
  );
  const data = extractJson<any>(raw);
  return strArray(data?.suggestions ?? data)
    .map((s) => s.trim())
    .filter(Boolean)
    .slice(0, 4);
}

/* ------------------------------------------------------------------ */

export async function runDocExtract(
  settings: AISettings,
  world: World,
  docName: string,
  docText: string,
  entries: Entry[],
  categories: Category[],
  defaultCategory: Category,
  opts: RunOptions = {},
): Promise<{ items: ReviewItem[]; skipped: string }> {
  const prompt = buildDocExtractPrompt(
    world,
    docName,
    docText,
    entries,
    categories,
    [defaultCategory.name, ...categories.map((c) => c.name)].filter(
      (v, i, a) => a.indexOf(v) === i,
    ),
  );
  const raw = await chat(
    settings,
    [
      { role: 'system', content: prompt.system },
      { role: 'user', content: prompt.user },
    ],
    { onDelta: opts.onDelta, signal: opts.signal },
  );
  const data = extractJson<any>(raw);
  const list = asArray<any>(data);

  // 去重：同一批结果里标题归一化后相同的只留第一条；
  // 与库里已有条目 key 相同的跳过（别让审查队列塞满重名提议）。
  const seenKeys = new Set(entries.map((e) => e.key));
  const batchKeys = new Set<string>();
  const items: ReviewItem[] = [];
  for (const rawEntry of list) {
    const catName = str(rawEntry.category);
    const category =
      categories.find((c) => c.name === catName) ??
      categories.find((c) => catName && c.name.includes(catName)) ??
      defaultCategory;
    const draft = normalizeEntryDraft(rawEntry, world.id, category.id);
    if (!draft.title) continue;
    const key = entryKey(draft.title);
    if (seenKeys.has(key) || batchKeys.has(key)) continue;
    seenKeys.add(key);
    batchKeys.add(key);
    const conf = str(rawEntry.confidence, 'medium');
    const item = baseItem(world.id, 'create-entry', draft.title!);
    item.entryDraft = draft;
    const confKey = {
      high: 'ai.task.confidence.high',
      medium: 'ai.task.confidence.medium',
      low: 'ai.task.confidence.low',
    }[conf as 'high' | 'medium' | 'low'];
    item.rationale = tGlobal('ai.task.docExtractRationale', {
      docName,
      confidence: confKey ? tGlobal(confKey) : conf,
    });
    items.push(item);
  }
  return { items, skipped: str(data.skipped) };
}

/* ================================================================== */
/* 新建世界：材料统筹                                                   */
/* ================================================================== */

const ALLOWED_COLORS = [
  '#5b7c99',
  '#2f6fb0',
  '#7c5cbf',
  '#17805a',
  '#b4720d',
  '#b5352b',
  '#0e7c8a',
  '#8a6d3b',
];

/** 把素材里的图片抽出来（供多模态消息使用） */
function imageParts(materials: DraftMaterial[]): ContentPart[] {
  return materials
    .filter((m) => m.kind === 'image' && m.dataUrl)
    .slice(0, 8)
    .map((m) => ({
      type: 'image_url' as const,
      image_url: { url: m.dataUrl as string, detail: 'auto' as const },
    }));
}

/**
 * 带图片的调用：模型读不了图时自动去掉图片重试一次。
 *
 * 这是必要的降级 —— 用户可能配的是纯文本模型，或某家厂商不接受 dataURL。
 * 这种情况绝不能让整条新建流程卡死：丢掉图片继续走，并把这件事明确告诉用户。
 */
async function chatWithMaterials(
  settings: AISettings,
  system: string,
  userText: string,
  materials: DraftMaterial[],
  opts: RunOptions,
): Promise<{ raw: string; imagesDropped: number; imagesSent: number; reason?: string }> {
  const parts = settings.vision === false ? [] : imageParts(materials);
  const runOpts = { onDelta: opts.onDelta, signal: opts.signal };

  if (!parts.length) {
    const raw = await chat(
      settings,
      [
        { role: 'system', content: system },
        { role: 'user', content: userText },
      ],
      runOpts,
    );
    return { raw, imagesDropped: 0, imagesSent: 0 };
  }

  const content: ContentPart[] = [{ type: 'text', text: userText }, ...parts];
  const messages: ChatMessageInput[] = [
    { role: 'system', content: system },
    { role: 'user', content },
  ];

  try {
    const raw = await chat(settings, messages, runOpts);
    return { raw, imagesDropped: 0, imagesSent: parts.length };
  } catch (e) {
    const reason = (e as Error).message || tGlobal('ai.task.unknownError');
    // 带着图失败 → 去掉图再试一次。若这次也失败，把新错误抛出去（那才是真问题）
    const raw = await chat(
      settings,
      [
        { role: 'system', content: system },
        { role: 'user', content: userText },
      ],
      runOpts,
    );
    return { raw, imagesDropped: parts.length, imagesSent: 0, reason };
  }
}

export interface IntakeQuestion {
  question: string;
  why: string;
  suggest: string[];
}

export interface IntakeResult {
  understanding: string;
  observations: string[];
  questions: IntakeQuestion[];
  readyToDraft: boolean;
  /** 因模型不支持读图而被跳过的图片数量 */
  imagesDropped: number;
  imageWarning?: string;
}

/** 读懂素材，并决定还需不需要问作者 */
export async function runIntake(
  settings: AISettings,
  materials: DraftMaterial[],
  params: IntakeParams,
  opts: RunOptions = {},
): Promise<IntakeResult> {
  const prompt = buildIntakePrompt(materials, { ...params, told: params.told ?? [] });
  const { raw, imagesDropped, reason } = await chatWithMaterials(
    settings,
    prompt.system,
    prompt.user,
    materials,
    opts,
  );
  const data = extractJson<any>(raw);

  // 到轮次上限时强制收口，避免「一直问下去」把用户耗死
  const hardStop = params.round >= 3;
  let questions = asArray<any>(data.questions)
    .map((q) => ({
      question: str(q.question ?? q.q).trim(),
      why: str(q.why ?? q.reason),
      suggest: strArray(q.suggest ?? q.options).slice(0, 3),
    }))
    .filter((q) => q.question)
    .slice(0, 5);

  if (hardStop) questions = [];

  return {
    understanding: str(data.understanding),
    observations: strArray(data.observations ?? data.notes),
    questions,
    readyToDraft: hardStop || questions.length === 0 || data.readyToDraft === true,
    imagesDropped,
    imageWarning:
      imagesDropped > 0
        ? tGlobal('ai.task.imageDroppedIntake', {
            reason: reason ?? tGlobal('ai.task.imageUnsupported'),
            n: imagesDropped,
          })
        : undefined,
  };
}

/** 把模型返回的草案规整成可用的结构，顺便挡掉明显的坏数据 */
export function normalizeProposal(raw: any): WorldProposal {
  const color = str(raw.themeColor, '').trim().toLowerCase();
  const cats: WorldProposal['categories'] = asArray<any>(raw.categories)
    .map((c) => ({
      name: str(c.name).trim(),
      icon: str(c.icon, '📁') || '📁',
      desc: str(c.desc),
    }))
    .filter((c) => c.name);

  const entries: WorldProposal['entries'] = asArray<any>(raw.entries)
    .map((e) => ({
      id: uid('pe'),
      title: str(e.title).trim(),
      category: str(e.category).trim(),
      aliases: strArray(e.aliases),
      summary: str(e.summary),
      content: str(e.content),
      tags: strArray(e.tags),
      included: true,
    }))
    .filter((e) => e.title);

  // 条目引用了不存在的分类 → 补一个，避免落库时无处安放
  for (const e of entries) {
    if (!cats.some((c) => c.name === e.category)) {
      cats.push({
        name: e.category || tGlobal('ai.task.defaultCategory'),
        icon: '📁',
        desc: tGlobal('ai.task.aiCategory'),
      });
    }
  }
  if (!cats.length)
    cats.push({ name: tGlobal('ai.task.defaultCategory'), icon: '📁', desc: '' });

  const titles = new Set(entries.map((e) => e.title));
  const relations: WorldProposal['relations'] = asArray<any>(raw.relations)
    .map((r) => ({
      from: str(r.from ?? r.fromTitle).trim(),
      to: str(r.to ?? r.toTitle).trim(),
      type: str(r.type, tGlobal('ai.task.defaultRelation')),
      note: str(r.note),
      included: true,
    }))
    .filter((r) => r.from && r.to && r.from !== r.to && titles.has(r.from) && titles.has(r.to));

  return {
    name:
      str(raw.name, tGlobal('ai.task.unnamedWorld')).trim() ||
      tGlobal('ai.task.unnamedWorld'),
    tagline: str(raw.tagline),
    genre: str(raw.genre),
    tone: str(raw.tone),
    summary: str(raw.summary),
    themeColor: ALLOWED_COLORS.includes(color) ? color : ALLOWED_COLORS[0],
    rules: strArray(raw.rules).slice(0, 12),
    categories: cats,
    entries,
    relations,
    openQuestions: strArray(raw.openQuestions).slice(0, 6),
    rationale: str(raw.rationale),
  };
}

/** 把素材与问答统筹成完整设定草案 */
export async function runProposal(
  settings: AISettings,
  materials: DraftMaterial[],
  answers: { question: string; answer: string; delegated: boolean }[],
  told: string[],
  extra: string | undefined,
  opts: RunOptions = {},
): Promise<{ proposal: WorldProposal; imagesDropped: number; imageWarning?: string }> {
  const prompt = buildProposalPrompt(materials, answers, told ?? [], extra);
  const { raw, imagesDropped, reason } = await chatWithMaterials(
    settings,
    prompt.system,
    prompt.user,
    materials,
    opts,
  );
  const proposal = normalizeProposal(extractJson<any>(raw));
  if (!proposal.entries.length) {
    throw new Error(tGlobal('ai.task.noEntries'));
  }
  return {
    proposal,
    imagesDropped,
    imageWarning:
      imagesDropped > 0
        ? tGlobal('ai.task.imageDroppedProposal', {
            reason: reason ?? tGlobal('ai.task.imageUnsupported'),
          })
        : undefined,
  };
}

/** 按作者的意见修订草案，返回完整的新版本 */
export async function runProposalRevise(
  settings: AISettings,
  materials: DraftMaterial[],
  answers: { question: string; answer: string; delegated: boolean }[],
  told: string[],
  proposal: WorldProposal,
  instruction: string,
  revisionCount: number,
  opts: RunOptions = {},
): Promise<WorldProposal> {
  const prompt = buildProposalRevisePrompt(
    materials,
    answers,
    told ?? [],
    proposal,
    instruction,
    revisionCount,
  );
  const { raw } = await chatWithMaterials(
    settings,
    prompt.system,
    prompt.user,
    materials,
    opts,
  );
  const next = normalizeProposal(extractJson<any>(raw));
  if (!next.entries.length) throw new Error(tGlobal('ai.task.reviseNoEntries'));
  // 保留用户自己取消勾选的选择（AI 并不知道这些）
  const off = new Set(proposal.entries.filter((e) => !e.included).map((e) => e.title));
  next.entries = next.entries.map((e) => (off.has(e.title) ? { ...e, included: false } : e));
  return next;
}

/* ------------------------------------------------------------------ */
/* 重新生成：按当初的来源重跑一遍，产出新的提议                        */
/*                                                                     */
/* 「再一次生成」的落点。它只负责「照着 source 重新跑、把结果包成       */
/* 与原来同形的新 ReviewItem[]」，不碰 store —— 替换 / 撤回由审查页      */
/* 自己处理。这样它才能同时被审查页的按钮和（将来可能的）agent 复用。    */
/* ------------------------------------------------------------------ */

/**
 * 一次「重新生成」的产出：新的提议数组。
 * 空数组 = 这次重跑没产出可采纳的东西（例如打磨下来无改动、排版无可排）。
 */
export async function rerunBySource(
  settings: AISettings,
  world: World,
  entries: Entry[],
  categories: Category[],
  source: ReviewSource,
  extraInstruction: string,
  opts: RunOptions = {},
): Promise<ReviewItem[]> {
  const runOpts: RunOptions = { ...opts, extraInstruction };

  switch (source.task) {
    case 'generate': {
      const cat = categories.find((c) => c.id === source.categoryId) ?? categories[0];
      if (!cat) return [];
      return runGenerate(
        settings,
        world,
        entries,
        categories,
        cat,
        {
          instruction: source.instruction,
          count: source.count,
          keywords: source.keywords,
          allowRelations: source.allowRelations,
        },
        runOpts,
      );
    }

    case 'polish': {
      const entry = entries.find((e) => e.id === source.targetEntryId);
      if (!entry) return [];
      return runPolish(
        settings,
        world,
        entry,
        entries,
        categories,
        { focus: source.focus, instruction: source.instruction, i: 1, total: 1 },
        runOpts,
      );
    }

    case 'relations': {
      const out = await runRelations(settings, world, entries, categories, runOpts);
      return out.items;
    }

    case 'timeline-layout': {
      const out = await runTimelineLayout(settings, world, entries, categories, runOpts);
      if (!out.items.length) return [];
      const item = baseItem(world.id, 'timeline-layout', tGlobal('ai.task.relayoutTitle', { n: out.items.length }));
      item.layoutDraft = out.items;
      item.rationale = out.note;
      item.note = out.unmatched.length
        ? tGlobal('ai.task.relayoutUnmatched', {
            n: out.unmatched.length,
            list: out.unmatched.slice(0, 6).join(tGlobal('ai.task.listSep')),
          })
        : '';
      item.source = { task: 'timeline-layout' };
      return [item];
    }

    case 'timeline-guess': {
      const out = await runTimelineGuess(settings, world, entries, categories, runOpts);
      if (!out.items.length) return [];
      const item = baseItem(world.id, 'timeline-guess', tGlobal('ai.task.reguessTitle', { n: out.items.length }));
      item.guessDraft = out.items;
      item.rationale = out.note;
      item.note = out.unmatched.length
        ? tGlobal('ai.task.reguessUnmatched', {
            n: out.unmatched.length,
            list: out.unmatched.slice(0, 6).join(tGlobal('ai.task.listSep')),
          })
        : '';
      item.source = { task: 'timeline-guess' };
      return [item];
    }

    case 'consistency': {
      const out = await runConsistency(settings, world, entries, categories, [], runOpts);
      return out.items;
    }

    default:
      return [];
  }
}
