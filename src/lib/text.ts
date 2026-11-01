import type { Entry } from '../types';

// 检索用的停用词表（中英并列）—— 属于语言数据，不是界面文案
const STOP = new Set([
  '的', '了', '是', '在', '和', '与', '及', '或', '一个', '这个', '那个', // i18n-allow
  'the', 'a', 'an', 'of', 'and', 'or', 'to', 'in', 'is', 'are', 'was',
]);

/**
 * 中文友好的分词：CJK 按二元组切分，拉丁按单词切分。
 * 不引入分词库，够用于「相关性排序」这种粗粒度检索。
 */
export function tokenize(text: string): string[] {
  if (!text) return [];
  const out: string[] = [];
  const lower = text.toLowerCase();

  const latin = lower.match(/[a-z0-9_]{2,}/g) ?? [];
  out.push(...latin);

  const cjkRuns = lower.match(/[\u4e00-\u9fa5]+/g) ?? [];
  for (const run of cjkRuns) {
    if (run.length === 1) {
      out.push(run);
      continue;
    }
    for (let i = 0; i < run.length - 1; i++) out.push(run.slice(i, i + 2));
    if (run.length <= 4) out.push(run);
  }

  return out.filter((t) => t.length > 1 && !STOP.has(t));
}

/** 判断 query 是否直接点名了某个条目（标题或别名整体出现） */
export function mentionsEntry(query: string, entry: Entry): boolean {
  const q = query.toLowerCase();
  const names = [entry.title, ...entry.aliases].filter(Boolean);
  return names.some((n) => n.length >= 2 && q.includes(n.toLowerCase()));
}

/**
 * 条目与查询的相关度打分。
 * 信号：标题/别名精确命中（权重最高）> 标签 > 概述 > 正文，以及词重合率。
 */
export function scoreEntry(entry: Entry, qTerms: Set<string>, rawQuery: string): number {
  let score = 0;

  if (mentionsEntry(rawQuery, entry)) score += 50;

  const titleTerms = new Set(tokenize(entry.title + ' ' + entry.aliases.join(' ')));
  const tagTerms = new Set(tokenize(entry.tags.join(' ')));
  const summaryTerms = new Set(tokenize(entry.summary));
  const bodyTerms = new Set(tokenize(entry.content));

  for (const t of qTerms) {
    if (titleTerms.has(t)) score += 6;
    if (tagTerms.has(t)) score += 4;
    if (summaryTerms.has(t)) score += 3;
    if (bodyTerms.has(t)) score += 1;
  }

  // 定稿条目更权威，轻微加权
  if (entry.status === 'canon') score *= 1.15;

  return score;
}

/** 余弦相似度（仅用于简单的文本近重复判断） */
export function similarity(a: string, b: string): number {
  const ta = tokenize(a);
  const tb = tokenize(b);
  if (!ta.length || !tb.length) return 0;
  const map = new Map<string, number>();
  ta.forEach((t) => map.set(t, (map.get(t) ?? 0) + 1));
  let dot = 0;
  let nb = 0;
  const seen = new Map<string, number>();
  tb.forEach((t) => {
    seen.set(t, (seen.get(t) ?? 0) + 1);
    nb += 1;
  });
  const na = ta.length;
  for (const [t, c] of seen) {
    const ca = map.get(t);
    if (ca) dot += ca * c;
  }
  if (!dot) return 0;
  return dot / (Math.sqrt(na) * Math.sqrt(nb));
}

/** 在长文本中截取包含关键词的片段，用于展示检索依据 */
export function snippet(text: string, query: string, len = 90): string {
  if (!text) return '';
  const flat = text.replace(/\s+/g, ' ').trim();
  if (flat.length <= len) return flat;
  const terms = tokenize(query);
  let idx = -1;
  for (const t of terms) {
    const i = flat.indexOf(t);
    if (i >= 0 && (idx < 0 || i < idx)) idx = i;
  }
  if (idx < 0) return flat.slice(0, len) + '…';
  const start = Math.max(0, idx - Math.floor(len / 3));
  return (start > 0 ? '…' : '') + flat.slice(start, start + len) + '…';
}

export function countWords(text: string): number {
  if (!text) return 0;
  const cjk = (text.match(/[\u4e00-\u9fa5]/g) ?? []).length;
  const latin = (text.match(/[a-zA-Z]+/g) ?? []).length;
  return cjk + latin;
}
