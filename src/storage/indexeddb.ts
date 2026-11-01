import { GLOBAL_STORES, STORE_NAMES, StorageAdapter, StoreName, Entity, StorageError } from './types';
import { diag } from '../lib/diagLog';
import { tGlobal } from '../i18n/translate';

const DB_NAME = 'worldforge';
/**
 * v3：新增 pieces（杂物间：长文/短文/碎片/剧情/图片/音频/视频等）。
 * v4：新增 ops（操作日志）与 chats（工作台 agent 会话）。
 * v5：新增 timeline（世界观时间线：什么时候发生了什么）。
 * onupgradeneeded 里按需补建缺失的 store，老数据不受影响。
 */
const DB_VERSION = 5;

/** 常规打开的兜底超时（被僵尸请求饿死时给出可读报错，而不是无限转圈） */
const OPEN_TIMEOUT_MS = 12_000;
/** 升级等待上限：占用者（其他标签页）关闭后升级会自动完成，给用户足够时间去关 */
const UPGRADE_WAIT_MS = 10 * 60_000;

function req<T>(r: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    r.onsuccess = () => resolve(r.result);
    r.onerror = () => reject(r.error);
  });
}

/** 标记「被占用 / 挂起」这类卡顿（区别于硬错误） */
function stallError(message: string): StorageError {
  const e = new StorageError(message) as StorageError & { stall: boolean };
  e.stall = true;
  return e;
}

/** 诊断日志里版本号的统一写法：undefined → 「不带版本」 */
function verLabel(version?: number): string {
  return version === undefined ? tGlobal('lib.idb.noVersion') : String(version);
}

/**
 * 本地 IndexedDB 适配器：单机版默认实现，离线可用、无容量焦虑（按域名配额）。
 *
 * 【打开策略】浏览器有几个硬性行为，决定了这里的设计：
 * 1. 不带版本号的 open 与现有连接同版本共存，永远不会被 blocked。
 * 2. 一旦发出「带更高版本号的 open」且被旧连接阻塞，该请求会一直排队，
 *    并把后续所有 open（包括不带版本号的）都堵死，直到占用者关闭。
 *    而且页面刷新也不会取消这个排队的请求（会跟着渲染进程残留）。
 * 3. 因此：绝不能「试着升级、不行就放弃」—— 放弃后本页将再也打不开库。
 *    升级请求一旦发出，就只能等它完成（占用者关闭后自动成功）。
 *
 * 流程：
 * - init() 先不带版本号打开（保证数据总能读到）。版本已最新 → 直接用。
 * - 版本落后 → 先用旧连接正常干活（世界数据完全可用），并标记 pendingUpgrade，
 *   由上层在数据加载完成后调用 finishUpgrade() 在后台完成升级；
 *   升级期间若被其他标签页占用，通过 onBlocked 回调告知 UI 提示用户关闭它们，
 *   占用者关闭后升级自动完成，无需刷新。
 */
export class LocalAdapter implements StorageAdapter {
  readonly kind = 'local' as const;
  /** 显示名走 i18n；用 getter，切换语言后重新取用 */
  get label(): string {
    return tGlobal('lib.idb.label');
  }
  /** 非空 = 旧版库：数据可正常读写，但 drafts 缺失，等 finishUpgrade() 完成升级 */
  pendingUpgrade = false;
  /** 本次要升级到的版本（正常为 DB_VERSION；库版本被顶高时取 conn.version + 1 以强制触发升级） */
  private upgradeTarget = DB_VERSION;
  private db: IDBDatabase | null = null;
  /** 本页连接已因其他页面升级而让位：一切读写都应提示刷新 */
  private displaced = false;
  /** finishUpgrade 进行中：读写暂不可用 */
  private upgrading = false;

  private openRaw(
    version?: number,
    opts: { timeoutMs?: number; patient?: boolean; onBlocked?: () => void } = {},
  ): Promise<IDBDatabase> {
    return new Promise<IDBDatabase>((resolve, reject) => {
      const open = version === undefined ? indexedDB.open(DB_NAME) : indexedDB.open(DB_NAME, version);
      diag('idb-open', tGlobal('lib.idb.diag.openRequested', { version: verLabel(version) }));
      let done = false;
      const timer = setTimeout(() => {
        if (done) return;
        done = true;
        clearInterval(beat);
        diag(
          'idb-open:timeout',
          tGlobal('lib.idb.diag.openTimeout', {
            ms: opts.timeoutMs ?? OPEN_TIMEOUT_MS,
            version: verLabel(version),
          }),
        );
        // 超时 ≠ 取消：请求仍排在队列里。若占用随后解除，它会「迟到成功」——
        // 这条幽灵连接必须立刻关闭，否则它将永久占着旧版本，
        // 把本页之后的一切升级请求（以及再 open 的请求）全部堵死。
        open.onsuccess = () => {
          try {
            open.result.close();
          } catch {
            /* ignore */
          }
          diag('idb-open:late-success', tGlobal('lib.idb.diag.lateSuccess'));
        };
        open.onblocked = () => diag('idb-open:late-blocked', tGlobal('lib.idb.diag.lateBlocked'));
        reject(stallError(tGlobal('lib.idb.openTimeout')));
      }, opts.timeoutMs ?? OPEN_TIMEOUT_MS);
      // 心跳：每 4 秒记一笔，用于区分「真的挂着」和「事件丢了」
      const beat = setInterval(() => {
        if (!done) diag('idb-open:pending', tGlobal('lib.idb.diag.pending', { version: verLabel(version) }));
      }, 4000);
      const settle = (fn: () => void) => {
        if (done) return;
        done = true;
        clearTimeout(timer);
        clearInterval(beat);
        fn();
      };

      if (version !== undefined) {
        open.onblocked = () => {
          diag(
            'idb-open:blocked',
            tGlobal('lib.idb.diag.blocked', {
              version: String(version),
              mode: tGlobal(opts.patient ? 'lib.idb.diag.blockedWaiting' : 'lib.idb.diag.blockedAbandon'),
            }),
          );
          if (done) return;
          opts.onBlocked?.();
          // patient 模式：不放弃，占用者关闭后本请求会自动完成
          if (!opts.patient) {
            settle(() => reject(stallError(tGlobal('lib.idb.upgradeBlocked'))));
          }
        };
      }

      open.onupgradeneeded = () => {
        diag('idb-open:upgradeneeded', `${open.result.version - 1} → ${open.result.version}`);
        const db = open.result;
        for (const name of STORE_NAMES) {
          if (!db.objectStoreNames.contains(name)) {
            const store = db.createObjectStore(name, { keyPath: 'id' });
            if (!GLOBAL_STORES.includes(name)) {
              store.createIndex('worldId', 'worldId', { unique: false });
            }
          }
        }
      };

      open.onsuccess = () =>
        settle(() => {
          const db = open.result;
          diag('idb-open:success', tGlobal('lib.idb.diag.opened', { version: db.version }));
          // 别的页面要升级数据库时主动让位，避免把对方卡死
          db.onversionchange = () => {
            diag('idb:versionchange', tGlobal('lib.idb.diag.versionchange'));
            db.close();
            if (this.db === db) {
              this.db = null;
              this.displaced = true;
            }
          };
          resolve(db);
        });
      open.onerror = () =>
        settle(() => {
          diag('idb-open:error', open.error?.name + ': ' + open.error?.message);
          reject(open.error ?? new StorageError(tGlobal('lib.idb.openFailed')));
        });
    });
  }

  private adopt(db: IDBDatabase) {
    this.db = db;
    this.displaced = false;
    this.upgrading = false;
  }

  /** 主动释放连接（重试前调用，避免本页成为占用者） */
  dispose(): void {
    try {
      this.db?.close();
    } catch {
      /* ignore */
    }
    this.db = null;
  }

  /** 缺任一 store（版本号被僵尸升级顶高、或库损坏）都会走升级路径补齐 */
  private missingStores(db: IDBDatabase): boolean {
    return STORE_NAMES.some((n) => !db.objectStoreNames.contains(n));
  }

  async init(): Promise<void> {
    if (this.db) return;
    this.pendingUpgrade = false;
    diag('storage.init:start');
    const conn = await this.openRaw();
    if (conn.version >= DB_VERSION && !this.missingStores(conn)) {
      this.adopt(conn);
      return;
    }
    // 旧版库（或 store 不齐的库）：先用这条连接正常干活，升级交给 finishUpgrade()
    this.upgradeTarget = Math.max(DB_VERSION, conn.version + 1);
    diag(
      'storage.init:old-version',
      tGlobal('lib.idb.diag.oldVersion', { version: conn.version, target: this.upgradeTarget }),
    );
    this.adopt(conn);
    this.pendingUpgrade = true;
  }

  /**
   * 把旧版库升级到当前版本。必须在 init() 且数据加载完成后调用。
   * 升级期间连接会短暂断开；若被其他标签页占用，会等到对方关闭后自动完成（patient）。
   * 升级完成后如果 store 仍不齐（被无处理器的僵尸升级抢了先），再补一轮。
   */
  async finishUpgrade(onBlocked?: () => void): Promise<void> {
    if (!this.db || !this.pendingUpgrade) return;
    this.pendingUpgrade = false;
    const old = this.db;
    this.db = null;
    this.upgrading = true;
    old.close();
    let target = this.upgradeTarget;
    try {
      // 最多补两轮：第一轮正常升级；若 store 仍缺（僵尸升级抢先）再顶一版补齐
      for (let round = 0; round < 3; round++) {
        diag('storage.upgrade:start', tGlobal('lib.idb.diag.upgradeStart', { target }));
        const db = await this.openRaw(target, {
          timeoutMs: UPGRADE_WAIT_MS,
          patient: true,
          onBlocked,
        });
        if (!this.missingStores(db)) {
          this.adopt(db);
          diag('storage.upgrade:done', tGlobal('lib.idb.diag.upgradeDone', { version: db.version }));
          return;
        }
        // store 不齐：再顶一版强制触发 onupgradeneeded 补建
        db.close();
        target = Math.max(DB_VERSION, db.version + 1);
        diag('storage.upgrade:incomplete', tGlobal('lib.idb.diag.upgradeStillMissing', { target }));
      }
      throw new StorageError(tGlobal('lib.idb.upgradeIncomplete'));
    } catch (e) {
      this.upgrading = false;
      diag('storage.upgrade:failed', (e as Error).message);
      throw e;
    }
  }

  /** 旧库没有 drafts store 时：读返回空、写静默跳过，不让整个应用崩掉 */
  private tx(store: StoreName, mode: IDBTransactionMode): IDBObjectStore | null {
    if (!this.db) {
      throw new StorageError(
        this.displaced
          ? tGlobal('lib.idb.txDisplaced')
          : this.upgrading
            ? tGlobal('lib.idb.txUpgrading')
            : tGlobal('lib.idb.txNotReady'),
      );
    }
    if (!this.db.objectStoreNames.contains(store)) return null;
    return this.db.transaction(store, mode).objectStore(store);
  }

  async getAll<T extends Entity>(store: StoreName): Promise<T[]> {
    const os = this.tx(store, 'readonly');
    if (!os) return [];
    return (await req(os.getAll())) as T[];
  }

  async get<T extends Entity>(store: StoreName, id: string): Promise<T | null> {
    const os = this.tx(store, 'readonly');
    if (!os) return null;
    const r = (await req(os.get(id))) as T | undefined;
    return r ?? null;
  }

  async put<T extends Entity>(store: StoreName, item: T): Promise<void> {
    const os = this.tx(store, 'readwrite');
    if (!os) return;
    await req(os.put(item));
  }

  async putMany<T extends Entity>(store: StoreName, items: T[]): Promise<void> {
    if (!items.length) return;
    const os = this.tx(store, 'readwrite');
    if (!os) return;
    await Promise.all(items.map((it) => req(os.put(it))));
  }

  async remove(store: StoreName, id: string): Promise<void> {
    const os = this.tx(store, 'readwrite');
    if (!os) return;
    await req(os.delete(id));
  }

  async removeMany(store: StoreName, ids: string[]): Promise<void> {
    if (!ids.length) return;
    const os = this.tx(store, 'readwrite');
    if (!os) return;
    await Promise.all(ids.map((id) => req(os.delete(id))));
  }

  async clear(store: StoreName): Promise<void> {
    const os = this.tx(store, 'readwrite');
    if (!os) return;
    await req(os.clear());
  }
}
