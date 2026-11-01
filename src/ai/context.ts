import type { Category, Entry, World } from '../types';
import { tokenize, scoreEntry } from '../lib/text';
import { tGlobal } from '../i18n/translate';

/**
 * 这一层负责把世界数据「翻译成给模型看的上下文」。
 * 上下文本身也是提示词的一部分，所以它的字段名同样跟随界面语言：
 * 用英文界面时就给模型英文上下文，让模型更容易顺着英文输出。
 */

/** 把世界基础信息压成一段简短上下文 */
export function worldBrief(world: World): string {
  return [
    tGlobal('ai.ctx.worldName', { name: world.name }),
    world.genre ? tGlobal('ai.ctx.worldGenre', { genre: world.genre }) : '',
    world.tone ? tGlobal('ai.ctx.worldTone', { tone: world.tone }) : '',
    world.summary ? tGlobal('ai.ctx.worldSummary', { summary: world.summary }) : '',
  ]
    .filter(Boolean)
    .join('\n');
}

/** 单条目压缩成一行，用于给模型建立「已有设定」的边界，避免重复与冲突 */
export function entryLine(e: Entry, catName: string): string {
  const alias = e.aliases.length
    ? tGlobal('ai.ctx.aliasSuffix', { aliases: e.aliases.join(tGlobal('ai.ctx.listSep')) })
    : '';
  const brief = (e.summary || e.content).replace(/\s+/g, ' ').slice(0, 120);
  return tGlobal('ai.ctx.entryLine', {
    category: catName,
    title: e.title,
    alias,
    brief,
  });
}

export function catNameMap(categories: Category[]): Record<string, string> {
  const map: Record<string, string> = {};
  for (const c of categories) map[c.id] = c.name;
  return map;
}

/** 索引截断的交代：`picked` 实际列了几条、`total` 池子里一共几条 */
export interface IndexReport {
  text: string;
  picked: number;
  total: number;
}

/**
 * 构建「已有设定索引」—— 这是保证 AI 不跑偏、不与旧设定打架的关键。
 *
 * 带一份「列了几条、一共几条」的回执：索引一旦被截断，模型看到的条目表就是不完整的，
 * 它会拿这份不完整的表去判断「谁和谁打架」。**这件事必须让调用方能说出来** ——
 * 否则界面上写着「已送入全部 N 条」，而模型手里其实只有前 80 条，两边对不上。
 */
export function existingIndexWithReport(
  entries: Entry[],
  categories: Category[],
  limit: number,
  filterCategoryId?: string,
): IndexReport {
  const names = catNameMap(categories);
  const pool = filterCategoryId
    ? entries.filter((e) => e.categoryId === filterCategoryId)
    : entries;
  const canon = pool.filter((e) => e.status === 'canon');
  const rest = pool.filter((e) => e.status !== 'canon');
  const picked = [...canon, ...rest].slice(0, limit);
  if (!picked.length) {
    return { text: tGlobal('ai.ctx.emptyIndex'), picked: 0, total: pool.length };
  }
  return {
    text: picked
      .map((e) => entryLine(e, names[e.categoryId] ?? tGlobal('ai.ctx.uncategorized')))
      .join('\n'),
    picked: picked.length,
    total: pool.length,
  };
}

export function existingIndex(
  entries: Entry[],
  categories: Category[],
  limit: number,
  filterCategoryId?: string,
): string {
  return existingIndexWithReport(entries, categories, limit, filterCategoryId).text;
}

/**
 * 轻量检索：不依赖向量库，用「标题/别名精确命中 + 关键词重合度」排序。
 * 用于世界问答与文章审校时挑选最相关的条目作为上下文。
 */
export function retrieveRelevant(
  query: string,
  entries: Entry[],
  categories: Category[],
  topK = 8,
): Entry[] {
  if (!entries.length) return [];
  const qTerms = new Set(tokenize(query));
  const scored = entries.map((e) => ({ e, s: scoreEntry(e, qTerms, query) }));
  scored.sort((a, b) => b.s - a.s);
  const hits = scored.filter((x) => x.s > 0).slice(0, topK);
  // 一个都没命中时，退化为「定稿条目优先」
  if (!hits.length) {
    return entries.filter((e) => e.status === 'canon').slice(0, topK);
  }
  return hits.map((x) => x.e);
}

/**
 * 正文切成几条、每条最多多少字 —— 各自该分多少。
 *
 * **为什么要有总预算。** 只有「单条上限」而没有「总量上限」时，条目一多，整段上下文直接
 * 爆掉模型窗口：多半是服务端悄悄截尾，而按 `updatedAt` 排在前面的那批条目**每次都排在前面** ——
 * 于是模型每一轮都只看到同一批，报出来的永远是那几个问题。
 * 分预算之后至少是「每一条都有机会被看到」，而且少看了多少可以说得出口。
 */
export function perEntryBudget(count: number, cap: number, totalBudget: number): number {
  if (count <= 0) return cap;
  if (totalBudget <= 0) return cap;
  const share = Math.floor(totalBudget / count);
  // 下限 200 字：再少就只剩下标题了，不如别送
  return Math.max(200, Math.min(cap, share));
}

export interface ExpandReport {
  text: string;
  /** 每条实际给了多少字 */
  perEntry: number;
  count: number;
}

/** 把选中条目展开成正文 + 一份「每条给了多少字」的回执 */
export function expandEntriesWithReport(
  entries: Entry[],
  categories: Category[],
  maxCharsPerEntry = 1600,
  totalBudget = 0,
): ExpandReport {
  const perEntry = perEntryBudget(entries.length, maxCharsPerEntry, totalBudget);
  const names = catNameMap(categories);
  const text = entries
    .map((e) => {
      const body = (e.content || e.summary || '').slice(0, perEntry);
      return [
        `### ${e.title}`,
        tGlobal('ai.ctx.expandCategory', {
          category: names[e.categoryId] ?? tGlobal('ai.ctx.uncategorized'),
          aliases: e.aliases.length
            ? tGlobal('ai.ctx.expandAliases', {
                aliases: e.aliases.join(tGlobal('ai.ctx.listSep')),
              })
            : '',
        }),
        e.summary ? tGlobal('ai.ctx.expandSummary', { summary: e.summary }) : '',
        body,
      ]
        .filter(Boolean)
        .join('\n');
    })
    .join('\n\n');
  return { text, perEntry, count: entries.length };
}

/** 把选中条目展开成完整正文（供问答/审校使用） */
export function expandEntries(
  entries: Entry[],
  categories: Category[],
  maxCharsPerEntry = 1600,
): string {
  return expandEntriesWithReport(entries, categories, maxCharsPerEntry).text;
}
