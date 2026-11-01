/**
 * 双向关系的归并。
 *
 * 关系是有方向的（`fromEntryId` → `toEntryId`）。当 A→B 和 B→A 两条关系**同时存在**，
 * 它们在图上是同一条边、在「关联」列表里是同一个对端 —— 硬拆成两条，作者会看到
 * 「A 敌对 B」和「B 效忠 A」两行各说各的，反而读不出这是一对**互相**的关系。
 *
 * 所以这里把它们归并成**一个单元**：图上画双箭头，列表里合成一行，把两个方向
 * 各自的关系类型都摆出来。归并只是**展示层**的事 —— 底层仍是两条独立的
 * `Relation`，各自的 type / note / status 都不动。
 */

import type { Relation } from '../types';

/** 归并后的一个关系单元：单向是一条，双向是一对 */
export interface MergedRel {
  /** 这一单元牵着的全部关系（双向时恒为两条，顺序已按方向归一） */
  rels: Relation[];
  /** 是不是双向（A→B 且 B→A 都齐全） */
  mutual: boolean;
}

/**
 * 一对无序条目的稳定键：A↔B 与 B↔A 落在同一个键上，不因方向互换而拆开。
 * 用 `\u0000` 分隔，避免 id 里出现分隔符时撞车（id 是 `uid()` 生成的，本不含它）。
 */
function pairKey(a: string, b: string): string {
  return a < b ? `${a}\u0000${b}` : `${b}\u0000${a}`;
}

/**
 * 把一组关系归并成「显示单元」：互为反向的两条合成一个双向单元，其余保持单向。
 *
 * 排序约定：`from` 较小的排前（`fromEntryId` 字典序），让 A↔B 与 B↔A 的归并结果
 * 稳定一致 —— 否则同样的数据，换一次遍历顺序就会得到不同顺序的双向对。
 */
export function mergeMutual(relations: Relation[]): MergedRel[] {
  const byPair = new Map<string, Relation[]>();
  for (const r of relations) {
    const key = pairKey(r.fromEntryId, r.toEntryId);
    const bucket = byPair.get(key);
    if (bucket) bucket.push(r);
    else byPair.set(key, [r]);
  }

  const out: MergedRel[] = [];
  for (const bucket of byPair.values()) {
    // 只有恰好反向的两条才算「双向」；同一方向连两条（少见）仍各算各的
    const hasForward = bucket.some((r) => r.fromEntryId === bucket[0].fromEntryId);
    const hasBackward = bucket.some(
      (r) => r.fromEntryId === bucket[0].toEntryId && r.toEntryId === bucket[0].fromEntryId,
    );
    if (hasForward && hasBackward && bucket.length === 2) {
      // 归一：from 字典序小的那条排前
      const sorted = [...bucket].sort((a, b) =>
        a.fromEntryId < b.fromEntryId ? -1 : a.fromEntryId > b.fromEntryId ? 1 : 0,
      );
      out.push({ rels: sorted, mutual: true });
    } else {
      for (const r of bucket) out.push({ rels: [r], mutual: false });
    }
  }

  // 稳定排序：按（from, to）字典序，双向与单向混在一起也保持可预期
  return out.sort((a, b) => {
    const af = a.rels[0].fromEntryId;
    const bf = b.rels[0].fromEntryId;
    if (af !== bf) return af < bf ? -1 : 1;
    return a.rels[0].toEntryId < b.rels[0].toEntryId ? -1 : 1;
  });
}

/**
 * 从一条条目出发，把与它相关的关系归并成单元（`mutual` = 它与对端互相连着）。
 *
 * 与 `mergeMutual` 的区别只在于视角：这里只留下**牵扯到 `entryId`** 的那些关系，
 * 且每个单元里把「对端」摆在稳定的位置（`rels[0]` 是从 entryId 出发的那条，
 * 双向时 `rels[1]` 是从对端出发回来的那条）。
 */
export function mergeMutualOf(entryId: string, relations: Relation[]): MergedRel[] {
  const mine = relations.filter(
    (r) => r.fromEntryId === entryId || r.toEntryId === entryId,
  );
  const merged = mergeMutual(mine);

  // 对每个单元，把「从 entryId 出发」的那条排到 rels[0]（双向时才需要调整顺序）
  return merged.map((m) => {
    if (!m.mutual) return m;
    const first = m.rels[0];
    if (first.fromEntryId === entryId) return m;
    return { ...m, rels: [m.rels[1], m.rels[0]] };
  });
}
