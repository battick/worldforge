/**
 * Wiki 陈列层的派生数据。
 *
 * 这里全是**纯函数**：目录里摆什么、按什么顺序摆、一条条目牵扯着谁 ——
 * 这些都是「拿数据算出来的」，不是组件状态。抽出来的理由很实际：
 * 抽出来才测得到。摆在页面里的话，验「排序对不对」就只能靠截图，
 * 而在这里一行断言就够。
 *
 * 不 import 任何 React、不 import 语言包 —— 文案一律由调用方给。
 */
import { stripMarkdown } from './markdown';
import type { Entry, EntryStatus, ID, Relation, SourceDoc } from '../types';

/* ---------------------------- 摘录 ---------------------------- */

/** 悬停预览的默认上限（字）。再长就不叫「预览」了，提示条也未必显示得全 */
export const EXCERPT_MAX = 160;

/**
 * 「这条讲了什么」的一句话。
 *
 * 左栏目录里只有标题 —— 鼠标停在上面时给一行提示（`title`），扫目录的人
 * 不用每一条都点进去才看得到内容。
 *
 * 优先用作者自己写的 `summary` —— 那是他特意为「让 AI 快速理解」写的一句话，
 * 拿机器截的正文盖过它反而是丢信息。没有 summary 才退到正文。
 *
 * 退到正文时**跳过标题行**（见 `firstProse`）：标题本身已经在目录里摆着了，
 * 预览再把同一句话摆一遍等于占着地方什么都没说。
 */
export function excerptOf(entry: Entry, max = EXCERPT_MAX): string {
  const summary = entry.summary.trim();
  if (summary) return clip(summary, max);
  const body = entry.content;
  if (!body.trim()) return '';
  const prose = stripMarkdown(firstProse(body));
  if (prose) return clip(prose, max);
  // 整篇只有标题、没有一句正文 —— 那也只能把标题本身摆出来
  return clip(stripMarkdown(body), max);
}

/**
 * 正文里第一段「不是标题、不是代码」的话。
 *
 * 只在标题之间找（撞到下一个标题就收工）：`## 概览` 底下那一小段就是这一节的
 * 引子，正是预览该露的那句。前一个标题底下空着就往后找，不空手回来。
 */
function firstProse(src: string): string {
  const buf: string[] = [];
  let fenced = false;
  for (const line of src.replace(/\r\n?/g, '\n').split('\n')) {
    if (line.trim().startsWith('```')) {
      fenced = !fenced;
      continue;
    }
    if (fenced) continue;
    if (/^\s*#{1,6}\s+/.test(line)) {
      if (buf.length) break; // 这一节的话已经够了
      continue;
    }
    if (/^\s*([-*_])\1{2,}\s*$/.test(line)) continue; // 分隔线不参与
    if (line.trim()) buf.push(line.trim());
    else if (buf.length) break; // 段落到此为止
  }
  return buf.join(' ');
}

/** 压成一行再截断 —— 悬停提示只有一行，带着换行进去会顶成好几行 */
function clip(s: string, max: number): string {
  const one = s.replace(/\s+/g, ' ').trim();
  return one.length > max ? one.slice(0, max) + '…' : one;
}

/* ---------------------------- 筛选 ---------------------------- */

export interface WikiFilter {
  /** 关键词 */
  q?: string;
  /** `all`（或省略）= 不按分类筛 */
  categoryId?: string;
  status?: EntryStatus | 'all';
}

/**
 * 关键词命中判定。
 *
 * 口径与条目库那一套**刻意保持一致**（标题 / 别名 / 摘要 / 标签 / 正文全搜）：
 * 同一个世界里同一个词，在「编辑」子页搜得到、在「阅读」子页搜不到，
 * 作者只会觉得其中一个坏了。
 */
export function matches(entry: Entry, q: string): boolean {
  const kw = q.trim().toLowerCase();
  if (!kw) return true;
  return (
    entry.title.toLowerCase().includes(kw) ||
    entry.aliases.some((a) => a.toLowerCase().includes(kw)) ||
    entry.summary.toLowerCase().includes(kw) ||
    entry.tags.some((t) => t.toLowerCase().includes(kw)) ||
    entry.content.toLowerCase().includes(kw)
  );
}

/** 分类 + 状态 + 关键词三道筛，逐条按序过 */
export function filterEntries(entries: Entry[], f: WikiFilter): Entry[] {
  const cat = f.categoryId ?? 'all';
  const status = f.status ?? 'all';
  const q = f.q ?? '';
  return entries.filter((e) => {
    if (cat !== 'all' && e.categoryId !== cat) return false;
    if (status !== 'all' && e.status !== status) return false;
    return matches(e, q);
  });
}

/* ---------------------------- 排序 ---------------------------- */

/**
 * 摆放顺序。三档都是作者翻库时真实会有的念想：
 *   updated — 「我刚改过的在哪儿」（默认）
 *   title   — 按名字找
 *   links   — 让枢纽条目先露脸（牵线最多的那条往往是最该先看的）
 */
export type WikiSort = 'updated' | 'title' | 'links';

export const WIKI_SORTS: WikiSort[] = ['updated', 'title', 'links'];

/** 每条条目被多少条关系牵连（出边 + 入边） */
export function linkCounts(relations: Relation[]): Map<ID, number> {
  const m = new Map<ID, number>();
  for (const r of relations) {
    m.set(r.fromEntryId, (m.get(r.fromEntryId) ?? 0) + 1);
    // 自环（自己连自己）只算一次：同一条关系不该在两端各记一笔
    if (r.toEntryId !== r.fromEntryId) m.set(r.toEntryId, (m.get(r.toEntryId) ?? 0) + 1);
  }
  return m;
}

/**
 * 排序。
 *
 * **每一档都以标题兜底**，这不是洁癖：瀑布流是按内容定高的，「最近更新」
 * 里同时刻的两条如果在两次渲染里换了位置，整面墙的内容会跟着重排，
 * 看着像在抖。稳定的顺序是这种布局能不能读的前提。
 *
 * 中文用 `localeCompare('zh-Hans-CN')` 而不是比码位 —— 后者按 Unicode
 * 排出来是「赵钱孙李」乱序，作者按名字找的时候完全对不上。
 */
export function sortEntries(entries: Entry[], sort: WikiSort, counts?: Map<ID, number>): Entry[] {
  const byTitle = (a: Entry, b: Entry) => a.title.localeCompare(b.title, 'zh-Hans-CN');
  const arr = [...entries];
  if (sort === 'title') return arr.sort(byTitle);
  if (sort === 'links') {
    const n = (e: Entry) => counts?.get(e.id) ?? 0;
    return arr.sort((a, b) => n(b) - n(a) || byTitle(a, b));
  }
  return arr.sort((a, b) => b.updatedAt - a.updatedAt || byTitle(a, b));
}

/* ---------------------------- 关联 ---------------------------- */

/** 一条关系，从「我」这一端看过去的样子 */
export interface RelatedEntry {
  /** 对端条目 */
  other: Entry;
  /** 关系类型（隶属 / 位置 / 血缘 …） */
  type: string;
  note: string;
  /** 方向：我指向它（out）／它指向我（in） */
  dir: 'out' | 'in';
  /**
   * 双向关系里，「回来」那一边（对端指回我）的类型。
   *
   * 只有 A→B 与 B→A 都齐全时才存在：那时这一对会合并成**一条**（`dir` 固定取
   * 出发那一边），而这里存的是反向那句的类型，界面上两个方向各说各的。
   */
  mutual?: { type: string; note: string };
}

/**
 * 从一条条目出发，把它牵扯到的人事物摆出来。
 *
 * 出入两个方向**都算，但分开记**。「A 效忠 B」和「B 效忠 A」是两句不同的话；
 * 揉成一份不分方向的「相关条目」，作者读到「灯塔看守 — 隶属 — 守夜人团」时
 * 就分不清谁隶属谁了，而那正是这些关系唯一的意思。
 *
 * 例外：当同一对条目**两个方向都连着**（A→B 且 B→A），就合成**一条**，把反向
 * 那句的类型塞进 `mutual` —— 否则列表里会出现两行各说各的，读不出一对互相关系。
 *
 * 对端已经不在了的（条目被删）**跳过** —— 关系表里可能还留着记录，
 * 但列表上不该出现一行空白。
 */
export function relatedTo(entryId: ID, entries: Entry[], relations: Relation[]): RelatedEntry[] {
  const byId = new Map(entries.map((e) => [e.id, e]));
  const out: RelatedEntry[] = [];
  for (const r of relations) {
    const outgoing = r.fromEntryId === entryId;
    const incoming = r.toEntryId === entryId;
    if (!outgoing && !incoming) continue;
    const other = byId.get(outgoing ? r.toEntryId : r.fromEntryId);
    if (!other) continue;
    out.push({ other, type: r.type, note: r.note, dir: outgoing ? 'out' : 'in' });
  }

  // 双向归并：同一对端上「出」和「入」都有的，合成一条，反向那句塞进 mutual
  const byOther = new Map<string, RelatedEntry[]>();
  for (const rel of out) {
    const arr = byOther.get(rel.other.id);
    if (arr) arr.push(rel);
    else byOther.set(rel.other.id, [rel]);
  }
  const merged: RelatedEntry[] = [];
  for (const arr of byOther.values()) {
    const outRel = arr.find((x) => x.dir === 'out');
    const inRel = arr.find((x) => x.dir === 'in');
    if (outRel && inRel) {
      merged.push({ ...outRel, mutual: { type: inRel.type, note: inRel.note } });
    } else {
      merged.push(...arr);
    }
  }

  const rank = (d: RelatedEntry['dir']) => (d === 'out' ? 0 : 1);
  return merged.sort(
    (a, b) =>
      rank(a.dir) - rank(b.dir) ||
      a.type.localeCompare(b.type, 'zh-Hans-CN') ||
      a.other.title.localeCompare(b.other.title, 'zh-Hans-CN'),
  );
}

/** 来源资料：这条条目是从哪几份材料里读出来的（资料被删了就跳过） */
export function sourceDocs(entry: Entry, docs: SourceDoc[]): SourceDoc[] {
  const byId = new Map(docs.map((d) => [d.id, d]));
  const out: SourceDoc[] = [];
  for (const ref of entry.sourceRefs) {
    const d = byId.get(ref);
    if (d) out.push(d);
  }
  return out;
}

/* ---------------------------- 内链 ---------------------------- */

/**
 * 按名字找条目 —— 阅读视图里点 `[[涨潮纪]]` 落在这儿。
 *
 * 比编辑器里那一版宽松一点：**全名或别名**都认，且不分大小写。
 * 作者的正文里写的是「他效忠过[[守夜人团]]」，而那条条目的正式名可能是
 * 「守夜人团（北境）」、别名才是「守夜人团」—— 只认全名的话，一半内链是死的。
 *
 * 别名与前缀都命中时**优先全名**：正式名是作者的意图所在。
 */
export function findByTitle(entries: Entry[], name: string): Entry | null {
  const want = name.trim().toLowerCase();
  if (!want) return null;
  return (
    entries.find((e) => e.title.toLowerCase() === want) ??
    entries.find((e) => e.aliases.some((a) => a.toLowerCase() === want)) ??
    null
  );
}
