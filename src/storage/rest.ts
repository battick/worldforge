import { StorageAdapter, StoreName, Entity, StorageError } from './types';
import { uid } from '../lib/id';
import { tGlobal } from '../i18n/translate';

/**
 * 云端适配器（升级预留）
 *
 * 当你想把数据搬到一台小服务器 / Serverless 上时，只需后端按下面这套
 * 极简 REST 约定实现接口，然后把 createStorage() 切到 'cloud' 即可：
 *
 *   GET    {base}/:store                  -> Entity[]
 *   GET    {base}/:store/:id              -> Entity | 404
 *   PUT    {base}/:store/:id              -> 写入/覆盖，body 为完整记录
 *   POST   {base}/:store/bulk             -> body { items: Entity[] } 批量写入
 *   DELETE {base}/:store/:id              -> 删除单条
 *   DELETE {base}/:store                  -> 清空
 *
 * 表名与 StoreName 一一对应，字段名与 types.ts 中的实体字段完全一致，
 * 因此后端可以零转换直接映射到数据库表。
 */
export class RestAdapter implements StorageAdapter {
  readonly kind = 'cloud' as const;
  readonly label: string;

  constructor(
    private baseUrl: string,
    private token = '',
  ) {
    this.label = tGlobal('lib.storage.cloudLabel', { baseUrl });
  }

  private async call(path: string, init?: RequestInit): Promise<any> {
    if (!this.baseUrl) throw new StorageError(tGlobal('lib.storage.noBaseUrl'));
    const res = await fetch(this.baseUrl.replace(/\/$/, '') + path, {
      ...init,
      headers: {
        'Content-Type': 'application/json',
        ...(this.token ? { Authorization: `Bearer ${this.token}` } : {}),
        ...(init?.headers ?? {}),
      },
    });
    if (!res.ok) {
      throw new StorageError(
        tGlobal('lib.storage.requestFailed', { status: res.status, body: await res.text() }),
      );
    }
    const text = await res.text();
    return text ? JSON.parse(text) : null;
  }

  async init(): Promise<void> {
    await this.call('/worlds');
  }

  async getAll<T extends Entity>(store: StoreName): Promise<T[]> {
    return ((await this.call(`/${store}`)) ?? []) as T[];
  }

  async get<T extends Entity>(store: StoreName, id: string): Promise<T | null> {
    try {
      return (await this.call(`/${store}/${encodeURIComponent(id)}`)) as T;
    } catch {
      return null;
    }
  }

  async put<T extends Entity>(store: StoreName, item: T): Promise<void> {
    await this.call(`/${store}/${encodeURIComponent(item.id)}`, {
      method: 'PUT',
      body: JSON.stringify(item),
    });
  }

  async putMany<T extends Entity>(store: StoreName, items: T[]): Promise<void> {
    if (!items.length) return;
    await this.call(`/${store}/bulk`, {
      method: 'POST',
      body: JSON.stringify({ items }),
    });
  }

  async remove(store: StoreName, id: string): Promise<void> {
    await this.call(`/${store}/${encodeURIComponent(id)}`, { method: 'DELETE' });
  }

  async removeMany(store: StoreName, ids: string[]): Promise<void> {
    const os = this;
    await Promise.all(ids.map((id) => os.remove(store, id)));
  }

  async clear(store: StoreName): Promise<void> {
    await this.call(`/${store}`, { method: 'DELETE' });
  }
}

/** 纯内存适配器：用于测试或「临时草稿」模式 */
export class MemoryAdapter implements StorageAdapter {
  readonly kind = 'local' as const;
  readonly label = tGlobal('lib.storage.memoryLabel');
  private data = new Map<StoreName, Map<string, Entity>>();

  async init() {
    /* noop */
  }

  private bucket(store: StoreName) {
    if (!this.data.has(store)) this.data.set(store, new Map());
    return this.data.get(store)!;
  }

  async getAll<T extends Entity>(store: StoreName): Promise<T[]> {
    return [...this.bucket(store).values()] as T[];
  }

  async get<T extends Entity>(store: StoreName, id: string): Promise<T | null> {
    return (this.bucket(store).get(id) as T) ?? null;
  }

  async put<T extends Entity>(store: StoreName, item: T): Promise<void> {
    this.bucket(store).set(item.id || uid(), item);
  }

  async putMany<T extends Entity>(store: StoreName, items: T[]): Promise<void> {
    items.forEach((i) => this.bucket(store).set(i.id, i));
  }

  async remove(store: StoreName, id: string): Promise<void> {
    this.bucket(store).delete(id);
  }

  async removeMany(store: StoreName, ids: string[]): Promise<void> {
    ids.forEach((id) => this.bucket(store).delete(id));
  }

  async clear(store: StoreName): Promise<void> {
    this.bucket(store).clear();
  }
}
