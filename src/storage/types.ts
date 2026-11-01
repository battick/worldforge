/**
 * 存储抽象层
 *
 * 本地单机版使用 IndexedDB；未来升级到小型云端时，只需实现同一个
 * StorageAdapter 接口（见 rest.ts 里的 RestAdapter 骨架），在 index.ts
 * 中切换工厂即可，上层业务代码零改动。
 *
 * 约定：每个 store 里的记录必须带唯一 `id` 字段，云端表结构可直接对应。
 */

export type StoreName =
  | 'worlds'
  | 'categories'
  | 'entries'
  | 'relations'
  | 'docs'
  | 'review'
  /** 新建世界的共创草稿（确认前不属于任何世界，因此没有 worldId） */
  | 'drafts'
  /** 杂物间：长文/短文/碎片/剧情/图片/音频/视频等非结构化藏品 */
  | 'pieces'
  /** 时间线：这个世界「什么时候发生了什么」 */
  | 'timeline'
  /** 操作日志：库里每一次写入的留痕（含撤销快照） */
  | 'ops'
  /** 工作台 agent 的对话会话 */
  | 'chats';

export const STORE_NAMES: StoreName[] = [
  'worlds',
  'categories',
  'entries',
  'relations',
  'docs',
  'review',
  'drafts',
  'pieces',
  'timeline',
  'ops',
  'chats',
];

/** 不带 worldId 的 store，建库时不需要建 worldId 索引 */
export const GLOBAL_STORES: StoreName[] = ['worlds', 'drafts'];

export interface Entity {
  id: string;
}

export interface StorageAdapter {
  readonly kind: 'local' | 'cloud';
  readonly label: string;
  /** 非空 = 降级运行（原因）。如本地库被旧标签页占用时，世界数据可用但 drafts 暂缺 */
  readonly degradedReason?: string | null;

  init(): Promise<void>;

  getAll<T extends Entity>(store: StoreName): Promise<T[]>;
  get<T extends Entity>(store: StoreName, id: string): Promise<T | null>;
  put<T extends Entity>(store: StoreName, item: T): Promise<void>;
  putMany<T extends Entity>(store: StoreName, items: T[]): Promise<void>;
  remove(store: StoreName, id: string): Promise<void>;
  removeMany(store: StoreName, ids: string[]): Promise<void>;
  clear(store: StoreName): Promise<void>;
}

export class StorageError extends Error {}