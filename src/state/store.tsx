import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import type {
  AppSettings,
  Category,
  ChatThread,
  Entry,
  EntryTime,
  ID,
  OpAction,
  OpActor,
  OpEntity,
  OpLog,
  OpUndo,
  Piece,
  Relation,
  ReviewItem,
  SourceDoc,
  World,
  WorldDraft,
} from '../types';
import { createStorage } from '../storage';
import { LocalAdapter } from '../storage/indexeddb';
import type { StorageAdapter } from '../storage/types';
import { STORE_NAMES } from '../storage/types';
import { DEFAULT_AI_SETTINGS } from '../ai/providers';
import { extOf } from '../lib/files';
import { collectPostMortem, diag, analyzeStall, type StallVerdict } from '../lib/diagLog';
import { revivePieceMedia } from '../lib/pieces';
import { entryKey, now, uid } from '../lib/id';
import { parseTimeText, formatTimeText } from '../lib/timeParse';
import { tGlobal } from '../i18n/translate';

const SETTINGS_KEY = 'worldforge:settings';

function loadSettings(): AppSettings {
  try {
    const raw = localStorage.getItem(SETTINGS_KEY);
    if (raw) {
      const parsed = JSON.parse(raw) as AppSettings;
      return {
        ai: { ...DEFAULT_AI_SETTINGS, ...(parsed.ai ?? {}) },
        activeWorldId: parsed.activeWorldId ?? null,
      };
    }
  } catch {
    /* ignore */
  }
  return { ai: { ...DEFAULT_AI_SETTINGS }, activeWorldId: null };
}

/**
 * 旧版的「时间线事件」。
 *
 * 它已经**不是**这个应用的一等公民 —— 时间现在挂在条目上（`Entry.time`）。
 * 保留这个形状只有一个用途：老库里可能还躺着若干条，第一次打开那个世界时
 * 把它们迁成条目（见 `migrateTimeline`）。**新代码一律不许再往这张表里写。**
 * 表也刻意留着（而不是升级时删掉）：迁移要读它，而且删表就得升 DB_VERSION，
 * 那会把全项目咬进来，收益不值这个风险。
 */
interface LegacyTimelineEvent {
  id: ID;
  worldId: ID;
  title: string;
  date: string;
  order: number;
  era: string;
  weight: 'major' | 'normal' | 'minor';
  detail: string;
  entryIds: ID[];
  createdAt: number;
  updatedAt: number;
}

interface DB {
  worlds: World[];
  categories: Category[];
  entries: Entry[];
  relations: Relation[];
  docs: SourceDoc[];
  review: ReviewItem[];
  drafts: WorldDraft[];
  pieces: Piece[];
  /** 只读的迁移来源，见 `LegacyTimelineEvent` */
  timeline: LegacyTimelineEvent[];
  ops: OpLog[];
  chats: ChatThread[];
}

const EMPTY_DB: DB = {
  worlds: [],
  categories: [],
  entries: [],
  relations: [],
  docs: [],
  review: [],
  drafts: [],
  pieces: [],
  timeline: [],
  ops: [],
  chats: [],
};

/** OpEntity → 它所在的 store（settings / note 不在 store 里，单独处理） */
const STORE_OF: Record<Exclude<OpEntity, 'settings' | 'note'>, keyof DB> = {
  world: 'worlds',
  category: 'categories',
  entry: 'entries',
  relation: 'relations',
  doc: 'docs',
  piece: 'pieces',
  review: 'review',
};

/** 操作日志上限：超出后丢掉最老的，避免日志慢慢长成第二个数据库 */
const OPS_CAP = 800;
/** 一段会话最多留几轮，防止单条 chats 记录无限膨胀 */
const THREAD_TURN_CAP = 60;

/** 关系在日志里的显示名：「甲 → 乙」 */
function relLabel(entries: Entry[], rel: Relation): string {
  const nameOf = (id: ID) => entries.find((e) => e.id === id)?.title ?? id;
  return `${nameOf(rel.fromEntryId)} → ${nameOf(rel.toEntryId)}`;
}

/** 刚给条目打开时间开关时的初值：一个空的时间点，落在轴的最末，且默认锁定 */
const DEFAULT_TIME: EntryTime = { kind: 'point', from: '', to: '', era: '', weight: 'normal', locked: true };

/**
 * 把一份时间规整成能落库的形状。
 *
 * 三件事必须是「一处实现」：①形态与 `to`/`toAt` 的对应关系 —— 时间点和「至今」都不该
 * 留着终结（否则作者切回「一段」时会看见一个他删过的旧值跳回来）；
 * ②缺数值位置时按 `fallbackAt` 排到最后，保证每份时间都有位置可算；
 * ③**锁定条目**的位置必须等于 `from` 文本解析值 —— 两者绑在一起，改文本位置跟着走。
 */
function normTime(t: EntryTime, fallbackAt: number): EntryTime {
  const kind = t.kind ?? 'point';
  const hasTo = kind === 'range';
  const locked = t.locked ?? true;
  // 锁定条目：位置从文本来；解析不出来的（纯文字纪元）退回 fallback，锁不住但也不报错
  const parsed = locked ? parseTimeText(t.from ?? '') : null;
  const at = parsed
    ? parsed.value
    : typeof t.at === 'number' && Number.isFinite(t.at)
      ? t.at
      : fallbackAt;
  return {
    kind,
    from: t.from ?? '',
    to: hasTo ? (t.to ?? '') : '',
    at,
    // 终点数值必须**晚于**起点，否则轴上会画出一根倒着走的横杠
    toAt:
      hasTo && typeof t.toAt === 'number' && Number.isFinite(t.toAt) && t.toAt > at
        ? t.toAt
        : undefined,
    era: t.era ?? '',
    weight: t.weight ?? 'normal',
    locked,
  };
}

export interface StoreValue {
  ready: boolean;
  /** 初始化失败时的可读原因，用于给出明确的排障提示 */
  initError: string | null;
  /** 结合环境探测对失败的判定（僵死队列 / 数据库缺失 / 未知），UI 按此给出针对性指引 */
  initDiagnosis: StallVerdict | null;
  /** 初始化失败后不刷新页面直接重试（会重建数据库连接） */
  retryInit: () => void;
  /** 数据库是旧版本：世界数据可用，但「新建世界」的草稿暂存要等升级完成 */
  pendingUpgrade: boolean;
  /** 正在等待升级完成（被其他标签页占用时会长时间停留，UI 应给出指引） */
  dbUpgrading: boolean;
  dbUpgradeError: string | null;
  storage: StorageAdapter;
  db: DB;
  settings: AppSettings;
  activeWorld: World | null;
  categories: Category[];
  entries: Entry[];
  relations: Relation[];
  docs: SourceDoc[];
  review: ReviewItem[];
  drafts: WorldDraft[];
  /** 杂物间：当前世界的全部藏品（置顶优先，其余按更新时间倒序） */
  pieces: Piece[];
  pendingReview: ReviewItem[];
  /** 正在进行中的「新建世界」草稿（同一时间只保留一份） */
  draft: WorldDraft | null;
  stats: {
    entries: number;
    canon: number;
    pending: number;
    relations: number;
    docs: number;
    pieces: number;
    /** 设了时间的条目数 —— 时间轴的「规模」就是它，不再是另一张表的条数 */
    timed: number;
    reviewPending: number;
  };

  updateSettings: (patch: Partial<AppSettings>) => void;
  updateAI: (patch: Partial<AppSettings['ai']>) => void;
  setActiveWorld: (id: ID) => void;

  createWorld: (data: Partial<World>) => Promise<World>;
  updateWorld: (id: ID, patch: Partial<World>) => Promise<void>;
  deleteWorld: (id: ID) => Promise<void>;

  /** 新建世界：草稿（确认前不会写入任何世界数据） */
  newDraft: () => WorldDraft;
  saveDraft: (draft: WorldDraft) => Promise<void>;
  discardDraft: (id?: ID) => Promise<void>;
  /** 把草稿里的草案正式落库，返回创建出的世界 */
  commitDraft: (draft: WorldDraft) => Promise<World>;

  createCategory: (data: Partial<Category>) => Promise<Category>;
  updateCategory: (id: ID, patch: Partial<Category>) => Promise<void>;
  deleteCategory: (id: ID) => Promise<void>;

  createEntry: (data: Partial<Entry>) => Promise<Entry>;
  /**
   * 改一条条目。
   *
   * 第三个参数是作者填的**编辑摘要**（真 wiki 里那一栏）—— 它不进条目本身，
   * 而是挂到这次操作日志的 `detail` 上。于是活动日志里那一行会从
   * 「改了灯塔守」变成「改了灯塔守 · 理由：把纪年统一成涨潮纪」。
   * 以后翻日志就知道当时为什么改，而不只是改了什么。
   */
  updateEntry: (id: ID, patch: Partial<Entry>, detail?: string) => Promise<void>;
  deleteEntry: (id: ID) => Promise<void>;

  createRelation: (data: Partial<Relation>) => Promise<Relation>;
  updateRelation: (id: ID, patch: Partial<Relation>) => Promise<void>;
  deleteRelation: (id: ID) => Promise<void>;

  addDoc: (doc: Omit<SourceDoc, 'id'>) => Promise<SourceDoc>;
  updateDoc: (id: ID, patch: Partial<SourceDoc>) => Promise<void>;
  deleteDoc: (id: ID) => Promise<void>;

  createPiece: (data: Partial<Piece>) => Promise<Piece>;
  updatePiece: (id: ID, patch: Partial<Piece>) => Promise<void>;
  deletePiece: (id: ID) => Promise<void>;

  /* ---------------- 时间 ---------------- */
  /**
   * 时间轴上的东西 —— 就是「设了时间的条目」，按数值位置排好（同位置按创建时间）。
   *
   * 「时间上的先后」是时间视图唯一的事实，让每个用它的地方各自 sort 一遍，
   * 迟早会出现「轴上按年代、列表按创建时间」这种自相矛盾。
   */
  timedEntries: Entry[];
  /**
   * 给条目设/改时间；传 `null` 就是「这条没有时间」（它随即离开时间轴）。
   *
   * 位置（`time.at`）缺失时由这里补一个，所以调用方不需要自己算 ——
   * 这条规则只该有一处实现。返回值是**落库后的那份时间**（含补出来的位置），
   * 编辑器据此把数值显示回输入框，而不是让作者对着一个空框猜它排到哪儿了。
   */
  setEntryTime: (
    entryId: ID,
    patch: Partial<EntryTime> | null,
  ) => Promise<EntryTime | undefined>;
  /**
   * 把旧版「时间线事件」迁成条目（正文=原来的「经过」、时间/纪元/分量照带、
   * 原来的关联条目转成关系）。每个世界只迁一次，返回迁了几条。
   * 已经不是事件实体了 —— 留着这个入口纯粹是为了不丢作者已经写过的东西。
   */
  migrateTimeline: (worldId: ID) => Promise<number>;

  pushReview: (items: ReviewItem[]) => Promise<void>;
  updateReview: (id: ID, patch: Partial<ReviewItem>) => Promise<void>;
  acceptReview: (id: ID, override?: Partial<ReviewItem>) => Promise<void>;
  rejectReview: (id: ID) => Promise<void>;
  clearReview: (status?: ReviewItem['status']) => Promise<void>;

  /* ---------------- 操作日志 ---------------- */
  /** 库里发生过的写入，最近的在前（当前世界 + 全局操作） */
  ops: OpLog[];
  /**
   * 以某个身份执行一批写操作。工作台 agent 调用 store 时用它 ——
   * 这样日志里能分清「这一步是作者点的」还是「agent 替他做的」。
   *
   * 返回值里的 `opIds` 是这次作用域内新产生的日志 id（按写入顺序），
   * 上层据此把「某一步动作」和「它留下的记录」对上号。
   */
  withActor: <T>(
    actor: OpActor,
    fn: () => Promise<T>,
    sessionId?: ID,
  ) => Promise<{ value: T; opIds: ID[] }>;
  /**
   * 底层日志写入。各写操作内部已经自动调用它；
   * 只有工具层需要自定义撤销快照（如改设置）时才直接用它。
   */
  logOp: (input: LogOpInput) => Promise<OpLog>;
  /** 记一条纯留痕（不改变数据）：agent 的「记录」能力与手工笔记共用 */
  logNote: (
    detail: string,
    opts?: { actor?: OpActor; target?: string; worldId?: ID | null; sessionId?: ID },
  ) => Promise<OpLog>;
  /** 撤销某一步操作（幂等：已撤销过或不可撤销的直接跳过） */
  undoOp: (id: ID) => Promise<void>;
  /** 清空操作日志；传 worldId 只清该世界的，传 null 只清全局的，不传则全清 */
  clearOps: (worldId?: ID | null) => Promise<void>;

  /* ---------------- 工作台 agent 会话 ---------------- */
  /** 当前世界的会话，最近更新的在前 */
  threads: ChatThread[];
  createThread: (title?: string) => Promise<ChatThread>;
  /**
   * 覆盖保存整段会话。
   * 刻意不做 appendTurns/patchTurn 那种「读旧值再改」的接口 ——
   * agent 会在一轮里连续追加多轮对话，闭包里读到的 db.chats 早就过期了，
   * 那样写会把手刚加的轮次覆盖掉。调用方自己持有一份最新副本更安全。
   */
  saveThread: (thread: ChatThread) => Promise<void>;
  deleteThread: (id: ID) => Promise<void>;

  importBackup: (payload: Partial<DB>, replace: boolean) => Promise<void>;
  resetAll: () => Promise<void>;
  reload: () => Promise<void>;
}

const StoreCtx = createContext<StoreValue | null>(null);

/** 写一条操作日志时需要填的东西 */
export interface LogOpInput {
  worldId: ID | null;
  action: OpAction;
  entity: OpEntity;
  target: string;
  targetId?: ID;
  detail?: string;
  fields?: string[];
  undo?: OpUndo | null;
}

export function StoreProvider({ children }: { children: React.ReactNode }) {
  const [storage, setStorage] = useState<StorageAdapter>(() => createStorage());

  const [ready, setReady] = useState(false);
  const [initError, setInitError] = useState<string | null>(null);
  const [initDiagnosis, setInitDiagnosis] = useState<StallVerdict | null>(null);
  const [pendingUpgrade, setPendingUpgrade] = useState(false);
  const [dbUpgrading, setDbUpgrading] = useState(false);
  const [dbUpgradeError, setDbUpgradeError] = useState<string | null>(null);
  const [db, setDbState] = useState<DB>(EMPTY_DB);
  /**
   * 库里那份数据的**最新副本**。
   *
   * 写函数（`updateEntry` / `setEntryTime` / `nextAt` …）一律读它，而不是读参数里
   * 那个渲染期闭包捕获的 `db`。原因是「一次点击里写两回同一个东西」：
   *
   *   await save();      // 把标题写进条目 A
   *   await saveTime();  // 给条目 A 设时间
   *
   * 第二回拿到的 `store` 还是**点击那一刻**那一份，它捕获的 `db.entries` 里标题仍是旧的，
   * 于是「读旧条目 → 只改时间 → 整条写回」把刚存好的标题覆盖掉了。
   * 界面上看不出任何异常，正文却悄悄退回上一个版本 —— 典型的静默丢数据。
   *
   * 所以 `setDb` 改成「先把新值记进 ref，再交给 React」：同一轮里连续写的每一回，
   * 读到都是上一回刚写下去的结果。
   */
  const dbRef = useRef<DB>(EMPTY_DB);
  const setDb = useCallback((updater: DB | ((d: DB) => DB)) => {
    const next = typeof updater === 'function' ? (updater as (d: DB) => DB)(dbRef.current) : updater;
    dbRef.current = next;
    setDbState(next);
  }, []);
  const [settings, setSettings] = useState<AppSettings>(() => loadSettings());

  /** 初始化失败后重建数据库连接再试一次（不刷新页面） */
  const retryInit = useCallback(() => {
    diag('app:retry-init', tGlobal('lib.state.diag.retryInit'));
    try {
      (storage as LocalAdapter).dispose?.();
    } catch {
      /* ignore */
    }
    setInitError(null);
    setInitDiagnosis(null);
    setReady(false);
    setPendingUpgrade(false);
    setDbUpgrading(false);
    setDbUpgradeError(null);
    setStorage(createStorage());
  }, [storage]);

  /* --------------------------- 初始化 --------------------------- */
  useEffect(() => {
    let cancelled = false;
    setInitError(null);
    setInitDiagnosis(null);
    diag('app:boot', tGlobal('lib.state.diag.boot', { kind: storage.kind }));
    (async () => {
      try {
        await storage.init();
        const loaded: DB = { ...EMPTY_DB };
        for (const name of STORE_NAMES) {
          const items = await storage.getAll(name);
          diag('app:load-store', tGlobal('lib.state.diag.loadStore', { name, count: items.length }));
          if (cancelled) return;
          (loaded as any)[name] = items;
        }
        // 旧库回填：早期条目没有 key 字段，这里补上（同世界内若撞 key 只保留第一条，
        // 其余的 key 后接序号 —— 不丢数据，只让约束能立起来）。
        const seenKeys = new Map<string, number>();
        const migrated: Entry[] = [];
        loaded.entries = loaded.entries.map((e) => {
          if (e.key) return e;
          const base = entryKey(e.title);
          let k = base;
          const mapKey = `${e.worldId}:${k}`;
          if (seenKeys.has(mapKey)) {
            const n = seenKeys.get(mapKey)! + 1;
            seenKeys.set(mapKey, n);
            k = `${base}_${n}`;
          } else {
            seenKeys.set(mapKey, 1);
          }
          const withKey = { ...e, key: k };
          migrated.push(withKey);
          return withKey;
        });
        if (migrated.length) {
          // 异步写回，不阻塞首屏
          void putMany('entries', migrated);
          diag('app:backfill-keys', tGlobal('lib.state.diag.backfillKeys', { n: String(migrated.length) }));
        }
        // 不预置任何示例世界：世界的诞生交给用户，由「新建世界」流程产出。
        if (cancelled) return;
        setPendingUpgrade(!!(storage as LocalAdapter).pendingUpgrade);
        setDb(loaded);
        setSettings((s) => {
          const activeId =
            s.activeWorldId && loaded.worlds.some((w) => w.id === s.activeWorldId)
              ? s.activeWorldId
              : (loaded.worlds[0]?.id ?? null);
          const next = { ...s, activeWorldId: activeId };
          localStorage.setItem(SETTINGS_KEY, JSON.stringify(next));
          return next;
        });
        setReady(true);
        diag('app:ready', tGlobal('lib.state.diag.ready'));

        /* 旧版库：数据已可用，立刻渲染；升级放到后台做。
         * 升级请求一旦发出就不能放弃（放弃会让本页再也打不开库），
         * 被其他标签页占用时通过 UI 提示用户，占用者关闭后自动完成。 */
        const adapter = storage as LocalAdapter;
        if (adapter.pendingUpgrade) {
          (async () => {
            // 无占用时升级毫秒级完成，别让提示闪一下
            const overlayTimer = setTimeout(() => setDbUpgrading(true), 3000);
            try {
              await adapter.finishUpgrade(() => {
                clearTimeout(overlayTimer);
                setDbUpgrading(true);
              });
              clearTimeout(overlayTimer);
              if (cancelled) return;
              setDbUpgrading(false);
              setPendingUpgrade(false);
              // drafts store 现在可用了，重读一遍
              const refreshed: DB = { ...EMPTY_DB };
              for (const name of STORE_NAMES) {
                (refreshed as any)[name] = await storage.getAll(name);
              }
              if (!cancelled) setDb(refreshed);
            } catch (e) {
              clearTimeout(overlayTimer);
              if (cancelled) return;
              setDbUpgrading(false);
              setDbUpgradeError((e as Error).message || tGlobal('lib.state.upgradeTimeout'));
            }
          })();
        }
      } catch (e) {
        if (cancelled) return;
        const msg = (e as Error).message || String(e);
        diag('app:init-failed', msg);
        // 出错后补一轮环境探测，让用户复制日志时带上关键线索
        const pm = await collectPostMortem();
        if (cancelled) return;
        const verdict = analyzeStall(pm);
        diag('app:diagnosis', verdict.kind + (verdict.dbVersion ? ` v${verdict.dbVersion}` : ''));
        setInitDiagnosis(verdict);
        setInitError(msg);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [storage]);

  const persistSettings = useCallback((next: AppSettings) => {
    setSettings(next);
    localStorage.setItem(SETTINGS_KEY, JSON.stringify(next));
  }, []);

  const updateSettings = useCallback(
    (patch: Partial<AppSettings>) => persistSettings({ ...settings, ...patch }),
    [settings, persistSettings],
  );

  const updateAI = useCallback(
    (patch: Partial<AppSettings['ai']>) =>
      persistSettings({ ...settings, ai: { ...settings.ai, ...patch } }),
    [settings, persistSettings],
  );

  const setActiveWorld = useCallback(
    (id: ID) => persistSettings({ ...settings, activeWorldId: id }),
    [settings, persistSettings],
  );

  /* --------------------------- 通用写入 --------------------------- */
  const put = useCallback(
    async <T extends { id: string }>(store: keyof DB, item: T) => {
      await storage.put(store as any, item);
    },
    [storage],
  );

  const putMany = useCallback(
    async <T extends { id: string }>(store: keyof DB, items: T[]) => {
      await storage.putMany(store as any, items);
    },
    [storage],
  );

  const remove = useCallback(
    async (store: keyof DB, id: ID) => {
      await storage.remove(store as any, id);
    },
    [storage],
  );

  const reload = useCallback(async () => {
    const loaded: DB = { ...EMPTY_DB };
    for (const name of STORE_NAMES) {
      (loaded as any)[name] = await storage.getAll(name);
    }
    setDb(loaded);
  }, [storage]);

  /* --------------------------- 操作日志 --------------------------- */
  /**
   * 库里每一次写入都留一条记录。
   *
   * 这里不是「记日志给人看」那么简单 —— 每条记录都带一份撤销快照，
   * 所以任何一步都能原样退回去。工作台里的 agent 之所以敢放手改数据，
   * 靠的就是这条底线。
   */
  const actorRef = useRef<OpActor>('user');
  const sessionRef = useRef<ID | undefined>(undefined);
  /** 当前 withActor 作用域内产生的日志 id，用于把「动作」与「记录」对上号 */
  const emittedRef = useRef<ID[] | null>(null);

  const logOp = useCallback(
    async (input: LogOpInput): Promise<OpLog> => {
      const full: OpLog = {
        id: uid('op'),
        worldId: input.worldId,
        actor: actorRef.current,
        action: input.action,
        entity: input.entity,
        target: input.target,
        targetId: input.targetId,
        detail: input.detail ?? '',
        fields: input.fields?.length ? input.fields : undefined,
        undo: input.undo ?? null,
        undone: false,
        sessionId: sessionRef.current,
        createdAt: now(),
      };
      emittedRef.current?.push(full.id);
      setDb((d) => ({ ...d, ops: [full, ...d.ops].slice(0, OPS_CAP) }));
      await put('ops', full);
      return full;
    },
    [put],
  );

  const withActor = useCallback(
    async <T,>(
      actor: OpActor,
      fn: () => Promise<T>,
      sessionId?: ID,
    ): Promise<{ value: T; opIds: ID[] }> => {
      const prevActor = actorRef.current;
      const prevSession = sessionRef.current;
      const prevEmitted = emittedRef.current;
      actorRef.current = actor;
      sessionRef.current = sessionId;
      emittedRef.current = [];
      try {
        const value = await fn();
        return { value, opIds: emittedRef.current ?? [] };
      } finally {
        actorRef.current = prevActor;
        sessionRef.current = prevSession;
        emittedRef.current = prevEmitted;
      }
    },
    [],
  );

  const logNote = useCallback(
    async (
      detail: string,
      opts: { actor?: OpActor; target?: string; worldId?: ID | null; sessionId?: ID } = {},
    ): Promise<OpLog> => {
      const prevActor = actorRef.current;
      const prevSession = sessionRef.current;
      if (opts.actor) actorRef.current = opts.actor;
      if (opts.sessionId !== undefined) sessionRef.current = opts.sessionId;
      try {
        return await logOp({
          worldId:
            opts.worldId !== undefined
              ? opts.worldId
              : (settings.activeWorldId ?? dbRef.current.worlds[0]?.id ?? null),
          action: 'note',
          entity: 'note',
          target: opts.target?.trim() || '',
          detail,
        });
      } finally {
        actorRef.current = prevActor;
        sessionRef.current = prevSession;
      }
    },
    [logOp, settings.activeWorldId, db.worlds],
  );

  /** 撤销一步：把记录里带的快照原样写回去。写回走底层 storage，不再产生新日志。 */
  const undoOp = useCallback(
    async (id: ID) => {
      const op = dbRef.current.ops.find((o) => o.id === id);
      if (!op || op.undone || !op.undo) return;
      const { remove: toRemove, restore: toRestore, settings: settingsSnapshot } = op.undo;

      if (toRemove?.length) {
        // 连带清理：条目一旦消失，挂在它两端的关系就指向了不存在的目标。
        // 不清理的话，撤销「新建条目」会在图谱里留下一条悬空的线。
        const known = new Set(
          toRemove.filter((r) => r.entity === 'relation').map((r) => r.id),
        );
        const orphanRels = dbRef.current.relations
          .filter(
            (rel) =>
              toRemove.some((r) => r.entity === 'entry' && (rel.fromEntryId === r.id || rel.toEntryId === r.id)) &&
              !known.has(rel.id),
          )
          .map((rel) => ({ entity: 'relation' as OpEntity, id: rel.id }));

        // 撤回一条提议 = 把那条待审记录删掉。但它要是已经被采纳/驳回，这一步就已经
        // 没有东西可撤了 —— 硬删只会把「已采纳」的痕迹抹掉，而那条条目本身还留着，
        // 反而更乱。真正该撤销的是「采纳」那一步。
        const withdrawn = dbRef.current.review.filter(
          (x) => x.status === 'pending' && toRemove.some((r) => r.entity === 'review' && r.id === x.id),
        );
        // 挂在待审条目上的关系提议，牵的是一个还不存在的东西 ——
        // 提议撤了、它却留着，采纳时就会变成一条断头的线。
        // 和「删条目要清关系」是同一个道理，一并撤回。
        const followReview = withdrawn.flatMap((w) =>
          w.kind === 'create-entry' && w.entryDraft?.id
            ? dbRef.current.review.filter(
                (x) =>
                  x.status === 'pending' &&
                  x.kind === 'relation' &&
                  (x.relationDraft?.fromEntryId === w.entryDraft!.id ||
                    x.relationDraft?.toEntryId === w.entryDraft!.id),
              )
            : [],
        );

        const removeList = [
          ...toRemove.filter((r) => r.entity !== 'review' || withdrawn.some((w) => w.id === r.id)),
          ...followReview.map((x) => ({ entity: 'review' as OpEntity, id: x.id })),
          ...orphanRels,
        ];

        for (const r of removeList) {
          const store = STORE_OF[r.entity as Exclude<OpEntity, 'settings' | 'note'>];
          if (!store) continue;
          setDb(
            (d) =>
              ({
                ...d,
                [store]: (d as any)[store].filter((x: { id: string }) => x.id !== r.id),
              }) as DB,
          );
          await storage.remove(store as any, r.id);
        }
      }

      if (toRestore?.length) {
        for (const r of toRestore) {
          const store = STORE_OF[r.entity as Exclude<OpEntity, 'settings' | 'note'>];
          if (!store) continue;
          const item = r.item as { id: string };
          if (!item?.id) continue;
          setDb((d) => {
            const list = (d as any)[store] as { id: string }[];
            const has = list.some((x) => x.id === item.id);
            return {
              ...d,
              [store]: has
                ? list.map((x) => (x.id === item.id ? item : x))
                : [...list, item],
            } as DB;
          });
          await storage.put(store as any, item);
        }
      }

      if (settingsSnapshot) persistSettings(settingsSnapshot);

      const next = { ...op, undone: true };
      setDb((d) => ({ ...d, ops: d.ops.map((o) => (o.id === id ? next : o)) }));
      await put('ops', next);
    },
    [db.ops, db.relations, db.review, storage, put, persistSettings],
  );

  const clearOps = useCallback(
    async (worldId?: ID | null) => {
      const targets = dbRef.current.ops.filter((o) =>
        worldId === undefined ? true : (o.worldId ?? null) === worldId,
      );
      if (!targets.length) return;
      const ids = new Set(targets.map((o) => o.id));
      setDb((d) => ({ ...d, ops: d.ops.filter((o) => !ids.has(o.id)) }));
      await storage.removeMany('ops', [...ids]);
    },
    [db.ops, storage],
  );

  /* --------------------------- 工作台 agent 会话 --------------------------- */

  const saveThread = useCallback(
    async (thread: ChatThread) => {
      // 一段会话留最近 N 轮就够：再往前的既读不回去，也只会把库撑大
      const next: ChatThread = {
        ...thread,
        turns: thread.turns.slice(-THREAD_TURN_CAP),
      };
      setDb((d) => ({ ...d, chats: [next, ...d.chats.filter((c) => c.id !== next.id)] }));
      await put('chats', next);
    },
    [put],
  );

  const createThread = useCallback(
    async (title = '') => {
      const t = now();
      const thread: ChatThread = {
        id: uid('th'),
        worldId: settings.activeWorldId ?? dbRef.current.worlds[0]?.id ?? '',
        title: title.trim() || tGlobal('lib.state.newThread'),
        turns: [],
        createdAt: t,
        updatedAt: t,
      };
      setDb((d) => ({ ...d, chats: [thread, ...d.chats] }));
      await put('chats', thread);
      return thread;
    },
    [put, settings.activeWorldId, db.worlds],
  );

  const deleteThread = useCallback(
    async (id: ID) => {
      setDb((d) => ({ ...d, chats: d.chats.filter((c) => c.id !== id) }));
      await remove('chats', id);
    },
    [remove],
  );

  /* --------------------------- 世界 --------------------------- */
  const createWorld = useCallback(
    async (data: Partial<World>) => {
      const t = now();
      const world: World = {
        id: uid('wd'),
        name: data.name?.trim() || tGlobal('lib.state.unnamedWorld'),
        tagline: data.tagline ?? '',
        summary: data.summary ?? '',
        genre: data.genre ?? '',
        tone: data.tone ?? '',
        themeColor: data.themeColor ?? '#5b7c99',
        createdAt: t,
        updatedAt: t,
      };
      setDb((d) => ({ ...d, worlds: [...d.worlds, world] }));
      await put('worlds', world);
      const prevSettings = settings;
      persistSettings({ ...settings, activeWorldId: world.id });
      await logOp({
        worldId: world.id,
        action: 'create',
        entity: 'world',
        target: world.name,
        targetId: world.id,
        undo: { remove: [{ entity: 'world', id: world.id }], settings: prevSettings },
      });
      return world;
    },
    [put, settings, persistSettings, logOp],
  );

  const updateWorld = useCallback(
    async (id: ID, patch: Partial<World>) => {
      const current = dbRef.current.worlds.find((w) => w.id === id);
      if (!current) return;
      const next = { ...current, ...patch, updatedAt: now() };
      setDb((d) => ({ ...d, worlds: d.worlds.map((w) => (w.id === id ? next : w)) }));
      await put('worlds', next);
      await logOp({
        worldId: id,
        action: 'update',
        entity: 'world',
        target: next.name,
        targetId: id,
        fields: Object.keys(patch),
        undo: { restore: [{ entity: 'world', item: current }] },
      });
    },
    [db.worlds, put, logOp],
  );

  const deleteWorld = useCallback(
    async (id: ID) => {
      const world = dbRef.current.worlds.find((w) => w.id === id);
      if (!world) return;
      const cats = dbRef.current.categories.filter((c) => c.worldId === id);
      const ents = dbRef.current.entries.filter((e) => e.worldId === id);
      const rels = dbRef.current.relations.filter((r) => r.worldId === id);
      const docItems = dbRef.current.docs.filter((x) => x.worldId === id);
      const revs = dbRef.current.review.filter((x) => x.worldId === id);
      const pcs = dbRef.current.pieces.filter((p) => p.worldId === id);
      const evs = dbRef.current.timeline.filter((e) => e.worldId === id);
      const worldOps = dbRef.current.ops.filter((o) => o.worldId === id);
      const worldChats = dbRef.current.chats.filter((c) => c.worldId === id);

      const catIds = cats.map((c) => c.id);
      const entIds = ents.map((e) => e.id);
      const relIds = rels.map((r) => r.id);
      const docIds = docItems.map((x) => x.id);
      const revIds = revs.map((x) => x.id);
      const pieceIds = pcs.map((p) => p.id);
      const evIds = evs.map((e) => e.id);

      setDb((d) => ({
        worlds: d.worlds.filter((w) => w.id !== id),
        categories: d.categories.filter((c) => c.worldId !== id),
        entries: d.entries.filter((e) => e.worldId !== id),
        relations: d.relations.filter((r) => r.worldId !== id),
        docs: d.docs.filter((x) => x.worldId !== id),
        review: d.review.filter((x) => x.worldId !== id),
        pieces: d.pieces.filter((p) => p.worldId !== id),
        timeline: d.timeline.filter((e) => e.worldId !== id),
        // 草稿不属于任何世界，删世界不影响正在进行的新建流程
        drafts: d.drafts,
        // 日志与会话随世界一起走：留着只会指向不存在的东西
        ops: d.ops.filter((o) => o.worldId !== id),
        chats: d.chats.filter((c) => c.worldId !== id),
      }));

      const groups: [keyof DB, string[]][] = [
        ['categories', catIds],
        ['entries', entIds],
        ['relations', relIds],
        ['docs', docIds],
        ['review', revIds],
        ['pieces', pieceIds],
        ['timeline', evIds],
        ['ops', worldOps.map((o) => o.id)],
        ['chats', worldChats.map((c) => c.id)],
      ];
      for (const [store, ids] of groups) await storage.removeMany(store as any, ids);
      await remove('worlds', id);

      const prevSettings = settings;
      if (settings.activeWorldId === id) {
        const rest = dbRef.current.worlds.filter((w) => w.id !== id);
        persistSettings({ ...settings, activeWorldId: rest[0]?.id ?? null });
      }

      // 世界没了，这条日志只能挂在全局上 —— 但它仍然可以整体撤销
      await logOp({
        worldId: null,
        action: 'delete',
        entity: 'world',
        target: world.name,
        targetId: id,
        detail: '',
        undo: {
          restore: [
            { entity: 'world', item: world },
            ...cats.map((c) => ({ entity: 'category' as const, item: c })),
            ...ents.map((e) => ({ entity: 'entry' as const, item: e })),
            ...rels.map((r) => ({ entity: 'relation' as const, item: r })),
            ...docItems.map((x) => ({ entity: 'doc' as const, item: x })),
            ...pcs.map((p) => ({ entity: 'piece' as const, item: p })),
          ],
          settings: prevSettings,
        },
      });
    },
    [db, storage, remove, settings, persistSettings, logOp],
  );

  /* --------------------------- 分类 --------------------------- */
  const createCategory = useCallback(
    async (data: Partial<Category>) => {
      const t = now();
      const cat: Category = {
        id: uid('ct'),
        worldId: data.worldId!,
        name: data.name?.trim() || tGlobal('lib.state.newCategory'),
        icon: data.icon ?? '📁',
        fieldDefs: data.fieldDefs ?? [],
        color: data.color,
        order: data.order ?? 999,
        createdAt: t,
        updatedAt: t,
      };
      setDb((d) => ({ ...d, categories: [...d.categories, cat] }));
      await put('categories', cat);
      await logOp({
        worldId: cat.worldId,
        action: 'create',
        entity: 'category',
        target: cat.name,
        targetId: cat.id,
        undo: { remove: [{ entity: 'category', id: cat.id }] },
      });
      return cat;
    },
    [put, logOp],
  );

  const updateCategory = useCallback(
    async (id: ID, patch: Partial<Category>) => {
      const current = dbRef.current.categories.find((c) => c.id === id);
      if (!current) return;
      const next = { ...current, ...patch, updatedAt: now() };
      setDb((d) => ({ ...d, categories: d.categories.map((c) => (c.id === id ? next : c)) }));
      await put('categories', next);
      await logOp({
        worldId: next.worldId,
        action: 'update',
        entity: 'category',
        target: next.name,
        targetId: id,
        fields: Object.keys(patch),
        undo: { restore: [{ entity: 'category', item: current }] },
      });
    },
    [db.categories, put, logOp],
  );

  /**
   * 删分类会连带删掉它下面的条目。
   * 注意关系也要一起清 —— 否则条目没了，图谱上还留着指向空气的连线。
   */
  const deleteCategory = useCallback(
    async (id: ID) => {
      const cat = dbRef.current.categories.find((c) => c.id === id);
      if (!cat) return;
      const ents = dbRef.current.entries.filter((e) => e.categoryId === id);
      const entIds = new Set(ents.map((e) => e.id));
      const rels = dbRef.current.relations.filter(
        (r) => entIds.has(r.fromEntryId) || entIds.has(r.toEntryId),
      );
      setDb((d) => ({
        ...d,
        categories: d.categories.filter((c) => c.id !== id),
        entries: d.entries.filter((e) => e.categoryId !== id),
        relations: d.relations.filter(
          (r) => !entIds.has(r.fromEntryId) && !entIds.has(r.toEntryId),
        ),
      }));
      await storage.removeMany('relations', rels.map((r) => r.id));
      await storage.removeMany('entries', ents.map((e) => e.id));
      await remove('categories', id);
      await logOp({
        worldId: cat.worldId,
        action: 'delete',
        entity: 'category',
        target: cat.name,
        targetId: id,
        undo: {
          restore: [
            { entity: 'category', item: cat },
            ...ents.map((e) => ({ entity: 'entry' as const, item: e })),
            ...rels.map((r) => ({ entity: 'relation' as const, item: r })),
          ],
        },
      });
    },
    [db.categories, db.entries, db.relations, storage, remove, logOp],
  );

  /* --------------------------- 条目 --------------------------- */
  /* --------------------------- 条目 --------------------------- */
  /**
   * 下一条有时间的东西落在轴上的哪儿？
   *
   * 作者没给数值位置时，排在现有**有时间**的条目**之后**，并且刻意留出间隔（+10）——
   * 轴上还要能往两个已有条目**中间**塞，挨着 +1 排的话第三天就得开始填小数。
   * 第一条从 10 起步，同样是为了给「更早的」留出地方。
   *
   * `exceptId` 是给「改自己那条」用的：不把自己算进最大值里，
   * 否则每次改别的时间都会把自己往后再推一格。
   */
  const nextAt = useCallback(
    (worldId: ID, exceptId?: ID): number => {
      const max = dbRef.current.entries.reduce((m, e) => {
        if (e.worldId !== worldId || e.id === exceptId) return m;
        const at = e.time?.at;
        return typeof at === 'number' && Number.isFinite(at) ? Math.max(m, at) : m;
      }, Number.NaN);
      return Number.isFinite(max) ? max + 10 : 10;
    },
    [db.entries],
  );

  const createEntry = useCallback(
    async (data: Partial<Entry>) => {
      const t = now();
      const title = data.title?.trim() || tGlobal('lib.state.unnamedEntry');
      const key = entryKey(title);
      // 同一世界里 key 不许重复：拦住重名条目
      const dup = dbRef.current.entries.find(
        (e) => e.worldId === data.worldId && e.key === key,
      );
      if (dup) throw new Error(tGlobal('lib.state.entryDuplicate', { title }));
      const entry: Entry = {
        id: data.id ?? uid('en'),
        worldId: data.worldId!,
        categoryId: data.categoryId!,
        title,
        key,
        aliases: data.aliases ?? [],
        summary: data.summary ?? '',
        content: data.content ?? '',
        tags: data.tags ?? [],
        fields: data.fields ?? {},
        status: data.status ?? 'draft',
        // 时间是可选的，但一旦给了就得有数值位置 —— 补位置这条规则只在这里和 setEntryTime 各一份
        time: data.time ? normTime(data.time, nextAt(data.worldId!)) : undefined,
        sourceRefs: data.sourceRefs ?? [],
        originTaskId: data.originTaskId,
        createdAt: t,
        updatedAt: t,
      };
      setDb((d) => ({ ...d, entries: [...d.entries, entry] }));
      await put('entries', entry);
      await logOp({
        worldId: entry.worldId,
        action: 'create',
        entity: 'entry',
        target: entry.title,
        targetId: entry.id,
        undo: { remove: [{ entity: 'entry', id: entry.id }] },
      });
      return entry;
    },
    [put, logOp, nextAt],
  );

  const updateEntry = useCallback(
    async (id: ID, patch: Partial<Entry>, detail?: string) => {
      const current = dbRef.current.entries.find((e) => e.id === id);
      if (!current) return;
      // 标题变了 → key 跟着重算，并校验同世界内不冲突
      let next = { ...current, ...patch, updatedAt: now() };
      if (patch.title !== undefined && patch.title.trim() !== current.title) {
        const title = patch.title.trim() || tGlobal('lib.state.unnamedEntry');
        const key = entryKey(title);
        const dup = dbRef.current.entries.find(
          (e) => e.id !== id && e.worldId === current.worldId && e.key === key,
        );
        if (dup) throw new Error(tGlobal('lib.state.entryDuplicate', { title }));
        next = { ...next, title, key };
      }
      setDb((d) => ({ ...d, entries: d.entries.map((e) => (e.id === id ? next : e)) }));
      await put('entries', next);
      await logOp({
        worldId: next.worldId,
        action: 'update',
        entity: 'entry',
        target: next.title,
        targetId: id,
        detail,
        fields: Object.keys(patch),
        undo: { restore: [{ entity: 'entry', item: current }] },
      });
    },
    [db.entries, put, logOp],
  );

  const deleteEntry = useCallback(
    async (id: ID) => {
      const entry = dbRef.current.entries.find((e) => e.id === id);
      if (!entry) return;
      const rels = dbRef.current.relations.filter((r) => r.fromEntryId === id || r.toEntryId === id);
      setDb((d) => ({
        ...d,
        entries: d.entries.filter((e) => e.id !== id),
        relations: d.relations.filter((r) => r.fromEntryId !== id && r.toEntryId !== id),
      }));
      await storage.removeMany('relations', rels.map((r) => r.id));
      await remove('entries', id);
      await logOp({
        worldId: entry.worldId,
        action: 'delete',
        entity: 'entry',
        target: entry.title,
        targetId: id,
        undo: {
          restore: [
            { entity: 'entry', item: entry },
            ...rels.map((r) => ({ entity: 'relation' as const, item: r })),
          ],
        },
      });
    },
    [db.entries, db.relations, storage, remove, logOp],
  );

  /* --------------------------- 关系 --------------------------- */
  const createRelation = useCallback(
    async (data: Partial<Relation>) => {
      const rel: Relation = {
        id: uid('rl'),
        worldId: data.worldId!,
        fromEntryId: data.fromEntryId!,
        toEntryId: data.toEntryId!,
        type: data.type?.trim() || tGlobal('lib.state.defaultRelation'),
        note: data.note ?? '',
        status: data.status ?? 'canon',
        originTaskId: data.originTaskId,
        createdAt: now(),
      };
      setDb((d) => ({ ...d, relations: [...d.relations, rel] }));
      await put('relations', rel);
      await logOp({
        worldId: rel.worldId,
        action: 'create',
        entity: 'relation',
        target: relLabel(dbRef.current.entries, rel),
        targetId: rel.id,
        undo: { remove: [{ entity: 'relation', id: rel.id }] },
      });
      return rel;
    },
    [put, db.entries, logOp],
  );

  const updateRelation = useCallback(
    async (id: ID, patch: Partial<Relation>) => {
      const current = dbRef.current.relations.find((r) => r.id === id);
      if (!current) return;
      const next = { ...current, ...patch };
      setDb((d) => ({ ...d, relations: d.relations.map((r) => (r.id === id ? next : r)) }));
      await put('relations', next);
      await logOp({
        worldId: next.worldId,
        action: 'update',
        entity: 'relation',
        target: relLabel(dbRef.current.entries, next),
        targetId: id,
        fields: Object.keys(patch),
        undo: { restore: [{ entity: 'relation', item: current }] },
      });
    },
    [db.relations, db.entries, put, logOp],
  );

  const deleteRelation = useCallback(
    async (id: ID) => {
      const rel = dbRef.current.relations.find((r) => r.id === id);
      if (!rel) return;
      setDb((d) => ({ ...d, relations: d.relations.filter((r) => r.id !== id) }));
      await remove('relations', id);
      await logOp({
        worldId: rel.worldId,
        action: 'delete',
        entity: 'relation',
        target: relLabel(dbRef.current.entries, rel),
        targetId: id,
        undo: { restore: [{ entity: 'relation', item: rel }] },
      });
    },
    [db.relations, db.entries, remove, logOp],
  );

  /* --------------------------- 资料 --------------------------- */
  const addDoc = useCallback(
    async (doc: Omit<SourceDoc, 'id'>) => {
      const full: SourceDoc = { ...doc, id: uid('dc') };
      setDb((d) => ({ ...d, docs: [...d.docs, full] }));
      await put('docs', full);
      await logOp({
        worldId: full.worldId,
        action: 'create',
        entity: 'doc',
        target: full.name,
        targetId: full.id,
        undo: { remove: [{ entity: 'doc', id: full.id }] },
      });
      return full;
    },
    [put, logOp],
  );

  const updateDoc = useCallback(
    async (id: ID, patch: Partial<SourceDoc>) => {
      const current = dbRef.current.docs.find((x) => x.id === id);
      if (!current) return;
      const next = { ...current, ...patch };
      setDb((d) => ({ ...d, docs: d.docs.map((x) => (x.id === id ? next : x)) }));
      await put('docs', next);
      await logOp({
        worldId: next.worldId,
        action: 'update',
        entity: 'doc',
        target: next.name,
        targetId: id,
        fields: Object.keys(patch),
        undo: { restore: [{ entity: 'doc', item: current }] },
      });
    },
    [db.docs, put, logOp],
  );

  const deleteDoc = useCallback(
    async (id: ID) => {
      const doc = dbRef.current.docs.find((x) => x.id === id);
      if (!doc) return;
      setDb((d) => ({ ...d, docs: d.docs.filter((x) => x.id !== id) }));
      await remove('docs', id);
      await logOp({
        worldId: doc.worldId,
        action: 'delete',
        entity: 'doc',
        target: doc.name,
        targetId: id,
        undo: { restore: [{ entity: 'doc', item: doc }] },
      });
    },
    [db.docs, remove, logOp],
  );

  /* --------------------------- 杂物间 --------------------------- */
  const createPiece = useCallback(
    async (data: Partial<Piece>) => {
      const t = now();
      const piece: Piece = {
        id: uid('pc'),
        worldId: data.worldId!,
        kind: data.kind ?? 'other',
        title: data.title?.trim() || tGlobal('lib.state.unnamedPiece'),
        content: data.content ?? '',
        tags: data.tags ?? [],
        media: data.media,
        thumb: data.thumb,
        linkedEntryIds: data.linkedEntryIds ?? [],
        pinned: data.pinned ?? false,
        createdAt: t,
        updatedAt: t,
      };
      setDb((d) => ({ ...d, pieces: [...d.pieces, piece] }));
      await put('pieces', piece);
      await logOp({
        worldId: piece.worldId,
        action: 'create',
        entity: 'piece',
        target: piece.title,
        targetId: piece.id,
        undo: { remove: [{ entity: 'piece', id: piece.id }] },
      });
      return piece;
    },
    [put, logOp],
  );

  const updatePiece = useCallback(
    async (id: ID, patch: Partial<Piece>) => {
      const current = dbRef.current.pieces.find((p) => p.id === id);
      if (!current) return;
      const next = { ...current, ...patch, updatedAt: now() };
      setDb((d) => ({ ...d, pieces: d.pieces.map((p) => (p.id === id ? next : p)) }));
      await put('pieces', next);
      await logOp({
        worldId: next.worldId,
        action: 'update',
        entity: 'piece',
        target: next.title,
        targetId: id,
        fields: Object.keys(patch),
        undo: { restore: [{ entity: 'piece', item: current }] },
      });
    },
    [db.pieces, put, logOp],
  );

  const deletePiece = useCallback(
    async (id: ID) => {
      const piece = dbRef.current.pieces.find((p) => p.id === id);
      if (!piece) return;
      setDb((d) => ({ ...d, pieces: d.pieces.filter((p) => p.id !== id) }));
      await remove('pieces', id);
      await logOp({
        worldId: piece.worldId,
        action: 'delete',
        entity: 'piece',
        target: piece.title,
        targetId: id,
        undo: { restore: [{ entity: 'piece', item: piece }] },
      });
    },
    [db.pieces, remove, logOp],
  );

  /* --------------------------- 时间 --------------------------- */
  /**
   * 给条目设/改时间。传 `null` = 这条没有时间（它随即离开时间轴）。
   *
   * 数值位置的补全和形态规整都收在这里，只此一处 —— 界面上拖一下、
   * agent 提议一条、资料抽取认出一个年代，走的都是这条规则。
   */
  const setEntryTime = useCallback(
    async (entryId: ID, patch: Partial<EntryTime> | null): Promise<EntryTime | undefined> => {
      const entry = dbRef.current.entries.find((e) => e.id === entryId);
      if (!entry) return undefined;
      if (patch === null) {
        await updateEntry(entryId, { time: undefined });
        return undefined;
      }
      // 锁定条目的**双向联动**：改了位置、没动文本 → 文本跟着位置重写；
      // 改了文本、没动位置 → 位置跟着文本重算（后者在 normTime 里做）。
      // 只认「这次显式传进来的字段」—— 没传就等于没碰，别拿旧值去互相覆盖。
      const cur = entry.time;
      const locked = (cur ?? DEFAULT_TIME).locked ?? true;
      let effective: Partial<EntryTime> = patch;
      if (
        locked &&
        cur &&
        'at' in patch &&
        !('from' in patch) &&
        typeof patch.at === 'number' &&
        patch.at !== cur.at
      ) {
        effective = { ...patch, from: formatTimeText(patch.at) };
      }
      const merged: EntryTime = { ...(entry.time ?? DEFAULT_TIME), ...effective };
      const next = normTime(merged, nextAt(entry.worldId, entryId));
      await updateEntry(entryId, { time: next });
      return next;
    },
    [db.entries, nextAt, updateEntry],
  );

  /**
   * 把旧版「时间线事件」迁成条目。
   *
   * 一件事件本来就是一个条目 —— 与其让「事件」和「条目」两份说法长期并存、
   * 迟早对不上，不如一次性折过去：
   *   - 标题、时间文本、纪元、分量、正文全部照带；
   *   - 数值位置沿用原来的 `order`，轴上先后一点不变；
   *   - 原来的「牵涉到哪些条目」转成**关系**，图谱里的连线因此不会丢。
   *
   * 迁完把旧记录删掉（它们已经变成条目了），并在日志里留一条痕 ——
   * 这是替作者改库，必须他自己看得见、也能撤销。
   */
  const migrateTimeline = useCallback(
    async (worldId: ID): Promise<number> => {
      const world = dbRef.current.worlds.find((w) => w.id === worldId);
      if (!world || world.timelineMigratedAt) return 0;
      const events = dbRef.current.timeline.filter((e) => e.worldId === worldId);
      const fallbackCat = [...dbRef.current.categories]
        .filter((c) => c.worldId === worldId)
        .sort((a, b) => a.order - b.order)[0];
      await updateWorld(worldId, { timelineMigratedAt: now() });
      if (!events.length || !fallbackCat) return 0;

      const ids = new Map<ID, ID>();
      for (const ev of events) {
        const entry = await createEntry({
          worldId,
          categoryId: fallbackCat.id,
          title: ev.title,
          content: ev.detail,
          time: normTime(
            {
              kind: 'point',
              from: ev.date,
              to: '',
              at: ev.order,
              era: ev.era,
              weight: ev.weight,
            },
            ev.order,
          ),
        });
        ids.set(ev.id, entry.id);
      }
      const rels = events.flatMap((ev) =>
        ev.entryIds
          .filter((eid) => eid !== ids.get(ev.id) && dbRef.current.entries.some((e) => e.id === eid))
          .map((eid) => ({ from: ids.get(ev.id)!, to: eid })),
      );
      for (const r of rels) {
        await createRelation({
          worldId,
          fromEntryId: r.from,
          toEntryId: r.to,
          type: tGlobal('lib.state.migratedTimelineRelation'),
          status: 'pending',
        });
      }
      setDb((d) => ({
        ...d,
        timeline: d.timeline.filter((e) => e.worldId !== worldId),
      }));
      await storage.removeMany('timeline', events.map((e) => e.id));
      await logNote(tGlobal('lib.state.migratedTimeline', { n: String(events.length) }), {
        worldId,
        target: world.name,
      });
      return events.length;
    },
    [db.worlds, db.timeline, db.categories, db.entries, updateWorld, createEntry, createRelation, storage, logNote],
  );

  /**
   * 旧账一次性折过来 —— 「调用它」这一步。
   *
   * 必须放在**另一个 effect 里**，不能在初始化那个 effect 里顺手调：
   * 那边 `setDb(loaded)` 之后，这一轮闭包里的 `db` 还是空的 —— 而迁移要靠
   * `db.timeline` 认出有哪些旧事件、靠 `nextAt` 给位置兜底，读空库等于什么都没迁。
   * 所以等到库就绪、并且这次 `db` 真的带着数据渲染过之后，再动手。
   *
   * `timelineMigratedAt` 是闸门：迁过的世界直接跳过（哪怕旧表里一件都没有，
   * 也要关上，否则每次开页面都得重查一遍）。
   */
  useEffect(() => {
    if (!ready) return;
    const worldId = settings.activeWorldId;
    if (!worldId) return;
    const world = dbRef.current.worlds.find((w) => w.id === worldId);
    if (!world || world.timelineMigratedAt) return;
    void migrateTimeline(worldId);
  }, [ready, settings.activeWorldId, dbRef.current.worlds, dbRef.current.timeline, migrateTimeline]);

  /* --------------------------- 审查队列 --------------------------- */
  const pushReview = useCallback(
    async (items: ReviewItem[]) => {
      if (!items.length) return;
      setDb((d) => ({ ...d, review: [...items, ...d.review] }));
      await putMany('review', items);
    },
    [putMany],
  );

  const updateReview = useCallback(
    async (id: ID, patch: Partial<ReviewItem>) => {
      const current = dbRef.current.review.find((r) => r.id === id);
      if (!current) return;
      const next = { ...current, ...patch };
      setDb((d) => ({ ...d, review: d.review.map((r) => (r.id === id ? next : r)) }));
      await put('review', next);
    },
    [db.review, put],
  );

  const markReview = useCallback(
    async (items: ReviewItem[], status: ReviewItem['status']) => {
      const updated = items.map((i) => ({ ...i, status }));
      setDb((d) => ({
        ...d,
        review: d.review.map((r) => {
          const hit = updated.find((u) => u.id === r.id);
          return hit ? { ...r, status } : r;
        }),
      }));
      await putMany('review', updated);
    },
    [putMany],
  );

  /** 采纳一条提议后补一条日志（采纳是复合动作，撤销要连带上它带出来的关系） */
  const logAccept = useCallback(
    async (
      merged: ReviewItem,
      newEntries: Entry[],
      newRelations: Relation[],
      updatedBefore: Entry | null,
    ) => {
      if (merged.kind === 'create-entry' && newEntries[0]) {
        const ne = newEntries[0];
        await logOp({
          worldId: merged.worldId,
          action: 'create',
          entity: 'entry',
          target: ne.title,
          targetId: ne.id,
          detail: merged.rationale,
          undo: {
            remove: [
              { entity: 'entry', id: ne.id },
              ...newRelations.map((r) => ({ entity: 'relation' as const, id: r.id })),
            ],
          },
        });
        return;
      }
      if (merged.kind === 'update-entry' && updatedBefore) {
        await logOp({
          worldId: merged.worldId,
          action: 'update',
          entity: 'entry',
          target: updatedBefore.title,
          targetId: updatedBefore.id,
          detail: merged.rationale,
          undo: { restore: [{ entity: 'entry', item: updatedBefore }] },
        });
        return;
      }
      if (merged.kind === 'relation' && newRelations[0]) {
        const nr = newRelations[0];
        await logOp({
          worldId: merged.worldId,
          action: 'create',
          entity: 'relation',
          target: relLabel(dbRef.current.entries, nr),
          targetId: nr.id,
          detail: merged.rationale,
          undo: { remove: [{ entity: 'relation', id: nr.id }] },
        });
        return;
      }
      /*
       * 「AI 自动排版」不再额外记一条汇总。
       *
       * 它在上面**逐条**走过 `setEntryTime`，每条已经各自留下一条「修改了条目「X」」
       * 并带着自己的撤销快照。这里再来一条「记下了：时间轴排版 · 7 处」，作者撤销时
       * 会看到一条听起来更权威、却什么都退不回去的记录 —— 那比不记更糟。
       */
      if (merged.kind === 'timeline-layout') return;
      // delete-entry：deleteEntry 已经留了「删除了条目 X」的日志并带撤销快照，
      // 这里再记一条就重复了（而且这条什么都退不回去）。
      if (merged.kind === 'delete-entry') return;
      // update-relation / delete-relation：updateRelation / deleteRelation 已经各留了一条
      // 带撤销快照的日志，这里不重复记。
      if (merged.kind === 'update-relation' || merged.kind === 'delete-relation') return;
      // consistency：问题报告本身不改数据，只留一条处理痕迹
      await logOp({
        worldId: merged.worldId,
        action: 'note',
        entity: 'note',
        target: merged.title,
        detail: merged.rationale,
      });
    },
    [logOp, db.entries],
  );

  /**
   * 采纳一条审查提议：按 kind 落到真实数据上。
   * - create-entry：新建条目，并把附带的 pending 关系一并采纳
   * - update-entry：字段级覆盖目标条目
   * - delete-entry：删除目标条目（含其关系、撤销快照，走 deleteEntry）
   * - relation：写入关系
   * - consistency：仅标记已处理（问题报告本身不改数据）
   */
  const acceptReview = useCallback(
    async (id: ID, override?: Partial<ReviewItem>) => {
      const item = dbRef.current.review.find((r) => r.id === id);
      if (!item) return;
      const merged: ReviewItem = { ...item, ...override, status: 'accepted' };

      const t = now();
      const newEntries: Entry[] = [];
      const newRelations: Relation[] = [];
      const followIds: string[] = [];
      /** 采纳「改写已有条目」时，留一份改前快照供撤销 */
      let updatedBefore: Entry | null = null;

      if (merged.kind === 'create-entry' && merged.entryDraft) {
        const title = merged.entryDraft.title?.trim() || tGlobal('lib.state.unnamedEntry');
        const key = entryKey(title);
        // 审查队列里也可能攒了重名提议（资料抽取没拦住），采纳时再卡一道
        const dup = dbRef.current.entries.find(
          (e) => e.worldId === merged.worldId && e.key === key,
        );
        if (dup) throw new Error(tGlobal('lib.state.entryDuplicate', { title }));
        const newId = merged.entryDraft.id ?? uid('en');
        newEntries.push({
          id: newId,
          worldId: merged.worldId,
          categoryId: merged.entryDraft.categoryId ?? '',
          title,
          key,
          aliases: merged.entryDraft.aliases ?? [],
          summary: merged.entryDraft.summary ?? '',
          content: merged.entryDraft.content ?? '',
          tags: merged.entryDraft.tags ?? [],
          fields: merged.entryDraft.fields ?? {},
          status: 'canon',
          time: merged.entryDraft.time
            ? normTime(merged.entryDraft.time, nextAt(merged.worldId))
            : undefined,
          sourceRefs: merged.entryDraft.sourceRefs ?? [],
          originTaskId: merged.id,
          createdAt: t,
          updatedAt: t,
        });
        // 自动带上依赖该新条目的关系提议。
        // 两个方向都要认：待审的可能是关系的 from，也可能是 to（「甲 隶属于 乙」而 乙 还没批），
        // 只认 from 会让反向那条关系永远挂不上，采纳完还得手工再连一次。
        dbRef.current.review
          .filter(
            (r) =>
              r.status === 'pending' &&
              r.kind === 'relation' &&
              (r.relationDraft?.fromEntryId === newId || r.relationDraft?.toEntryId === newId),
          )
          .forEach((r) => {
            followIds.push(r.id);
            if (r.relationDraft) {
              newRelations.push({
                id: uid('rl'),
                worldId: merged.worldId,
                fromEntryId: r.relationDraft.fromEntryId,
                toEntryId: r.relationDraft.toEntryId,
                type: r.relationDraft.type || tGlobal('lib.state.defaultRelation'),
                note: r.relationDraft.note ?? '',
                status: 'canon',
                originTaskId: r.id,
                createdAt: t,
              });
            }
          });
      }

      if (merged.kind === 'update-entry' && merged.targetEntryId && merged.entryDraft) {
        const target = dbRef.current.entries.find((e) => e.id === merged.targetEntryId);
        if (target) {
          updatedBefore = target;
          const draft = merged.entryDraft;
          const title = draft.title !== undefined ? draft.title.trim() || tGlobal('lib.state.unnamedEntry') : target.title;
          // 标题变了 → 重算 key 并查重
          let key = target.key;
          if (title !== target.title) {
            key = entryKey(title);
            const dup = dbRef.current.entries.find(
              (e) => e.id !== target.id && e.worldId === target.worldId && e.key === key,
            );
            if (dup) throw new Error(tGlobal('lib.state.entryDuplicate', { title }));
          }
          const next: Entry = {
            ...target,
            title,
            key,
            categoryId: draft.categoryId ?? target.categoryId,
            summary: draft.summary ?? target.summary,
            content: draft.content ?? target.content,
            tags: draft.tags ?? target.tags,
            aliases: draft.aliases ?? target.aliases,
            status: draft.status ?? target.status,
            color: draft.color ?? target.color,
            updatedAt: t,
          };
          setDb((d) => ({
            ...d,
            entries: d.entries.map((e) => (e.id === next.id ? next : e)),
          }));
          await put('entries', next);
          /*
           * 时间不能跟着字段一起覆盖：`setEntryTime` 会补轴上位置、按形态规整，
           * 那套只有它一个入口会做。`draft.time` 三态：
           *   · undefined —— 这次没碰时间，跳过；
           *   · null —— 显式摘掉；
           *   · EntryTime —— 合并进现有时间。
           */
          if (draft.time !== undefined) {
            await setEntryTime(target.id, draft.time);
          }
        }
      }

      /*
       * 「删除条目」：走 store.deleteEntry，而不是在这里自己拼删除逻辑 ——
       * 删条目会连带清掉它的关系、并留一份带快照的撤销日志，那套东西只有
       * deleteEntry 那一个入口会做；在这里重写一遍，迟早和它说的不一样。
       * 条目在这期间已经被删了就当无事发生（比硬写一条指向空的撤销强）。
       */
      if (merged.kind === 'delete-entry' && merged.targetEntryId) {
        const exists = dbRef.current.entries.some((e) => e.id === merged.targetEntryId);
        if (exists) await deleteEntry(merged.targetEntryId);
      }

      /*
       * 「AI 自动排版」：一条条落到 `time` 上。
       *
       * 刻意**逐条走 `setEntryTime`**，而不是在这里自己拼一份新时间再批量写：
       * 补数值位置、按形态规整终结、留撤销快照，都只有那一个入口会做；
       * 在这里再写一遍，迟早和它说的不一样。顺带得到两件事：
       *   · 每条各留一条日志 —— 撤销是逐条退回去的，粒度刚刚好；
       *   · 这条方案里**当时还不存在**的条目（这期间被删了）自然跳过，
       *     不会硬写出一条指向空条目的时间。
       */
      if (merged.kind === 'timeline-layout' && merged.layoutDraft?.length) {
        for (const it of merged.layoutDraft) {
          if (!dbRef.current.entries.some((e) => e.id === it.entryId)) continue;
          const patch: Partial<EntryTime> = { at: it.at };
          if (typeof it.toAt === 'number') patch.toAt = it.toAt;
          if (it.era) patch.era = it.era;
          if (it.weight) patch.weight = it.weight;
          // 锁定条目：位置动了，时间文本跟着重写，两者才继续对得上
          if (it.from !== undefined) patch.from = it.from;
          await setEntryTime(it.entryId, patch);
        }
      }

      /*
       * 「AI 猜测时间」：给池子里的条目定出时间，同样逐条走 `setEntryTime`。
       * 与排版的区别只在一件事 —— 这里**连 `from` 文本一起给**（猜测就是「替作者
       * 编一个日期」，只给位置不叫猜）；其余对账、撤销、跳过已删条目都与排版同源。
       */
      if (merged.kind === 'timeline-guess' && merged.guessDraft?.length) {
        for (const it of merged.guessDraft) {
          const target = dbRef.current.entries.find((e) => e.id === it.entryId);
          if (!target) continue;
          // 这期间作者已经自己给它设过时间了：不再覆盖，直接跳过
          if (target.time) continue;
          const patch: Partial<EntryTime> = { at: it.at };
          if (typeof it.toAt === 'number') patch.toAt = it.toAt;
          if (it.era) patch.era = it.era;
          if (it.weight) patch.weight = it.weight;
          if (it.from) patch.from = it.from;
          await setEntryTime(it.entryId, patch);
        }
      }

      if (merged.kind === 'relation' && merged.relationDraft) {
        // 这条关系牵着的条目必须已经真的存在。一端还停在审查队列里（或者提议被撤了），
        // 硬写就会在库里留下一条指向空条目的线 —— 图谱上凭空多一条断头线，
        // 比少一条关系难查得多。所以这里退回驳回，并把原因写在提案上。
        const ends = [merged.relationDraft.fromEntryId, merged.relationDraft.toEntryId];
        const landed = ends.every((id) => dbRef.current.entries.some((e) => e.id === id));
        if (landed) {
          newRelations.push({
            id: uid('rl'),
            worldId: merged.worldId,
            fromEntryId: merged.relationDraft.fromEntryId,
            toEntryId: merged.relationDraft.toEntryId,
            type: merged.relationDraft.type || tGlobal('lib.state.defaultRelation'),
            note: merged.relationDraft.note ?? '',
            status: 'canon',
            originTaskId: merged.id,
            createdAt: t,
          });
        } else {
          merged.status = 'rejected';
          merged.note = [merged.note, tGlobal('lib.state.relationEndpointMissing')]
            .filter(Boolean)
            .join(' ');
        }
      }

      /*
       * 「改关系」：走 store.updateRelation，它自带字段级日志和撤销快照。
       * 关系在这期间已经被删了就当无事发生。
       */
      if (merged.kind === 'update-relation' && merged.targetRelationId && merged.relationDraft) {
        const exists = dbRef.current.relations.some((r) => r.id === merged.targetRelationId);
        if (exists) {
          await updateRelation(merged.targetRelationId, {
            type: merged.relationDraft.type,
            note: merged.relationDraft.note,
          });
        }
      }

      /*
       * 「删关系」：走 store.deleteRelation（自带撤销快照）。
       */
      if (merged.kind === 'delete-relation' && merged.targetRelationId) {
        const exists = dbRef.current.relations.some((r) => r.id === merged.targetRelationId);
        if (exists) await deleteRelation(merged.targetRelationId);
      }

      if (newEntries.length || newRelations.length) {
        setDb((d) => ({
          ...d,
          entries: [...d.entries.filter((e) => !newEntries.some((n) => n.id === e.id)), ...newEntries],
          relations: [
            ...d.relations.filter((r) => !newRelations.some((n) => n.id === r.id)),
            ...newRelations,
          ],
        }));
        await putMany('entries', newEntries);
        await putMany('relations', newRelations);
      }

      await put('review', merged);
      await markReview(
        dbRef.current.review.filter(
          (r) => r.status === 'pending' && (r.id === id || followIds.includes(r.id)),
        ),
        // 关系提议可能因为「一端还没落地」被退回驳回（见上面那段），
        // 那样这条记录就该如实显示成驳回，而不是显示成采纳了却什么都没发生。
        merged.status,
      );
      await logAccept(merged, newEntries, newRelations, updatedBefore);
    },
    [db, put, putMany, markReview, logAccept, nextAt, setEntryTime, deleteEntry, updateRelation, deleteRelation],
  );

  const rejectReview = useCallback(
    async (id: ID) => {
      const item = dbRef.current.review.find((r) => r.id === id);
      if (!item) return;
      const follow = dbRef.current.review.filter(
        (r) =>
          r.status === 'pending' &&
          r.kind === 'relation' &&
          (r.relationDraft?.fromEntryId === item.entryDraft?.id ||
            r.relationDraft?.toEntryId === item.entryDraft?.id),
      );
      await markReview([item, ...follow], 'rejected');
    },
    [db.review, markReview],
  );

  const clearReview = useCallback(
    async (status?: ReviewItem['status']) => {
      const targets = dbRef.current.review.filter((r) => (status ? r.status === status : true));
      if (!targets.length) return;
      setDb((d) => ({
        ...d,
        review: status ? d.review.filter((r) => r.status !== status) : [],
      }));
      await storage.removeMany('review', targets.map((r) => r.id));
    },
    [db.review, storage],
  );

  /* --------------------------- 备份 / 重置 --------------------------- */
  const importBackup = useCallback(
    async (payload: Partial<DB>, replace: boolean) => {
      if (replace) {
        for (const name of STORE_NAMES) await storage.clear(name);
      }
      const next: DB = replace ? { ...EMPTY_DB } : { ...db };
      // 媒体杂物从 JSON 备份恢复时，media 是 dataUrl 字符串，先转回 Blob
      const incomingPieces: Piece[] = (payload as any).pieces ?? [];
      const revived = await Promise.all(incomingPieces.map((p) => revivePieceMedia(p)));
      if (revived.length) (payload as any).pieces = revived;
      for (const name of STORE_NAMES) {
        const incoming: any[] = (payload as any)[name] ?? [];
        if (!incoming.length) continue;
        // 导入的条目可能来自旧版备份（没有 key），就地补上，免得查重时漏判
        if (name === 'entries') {
          const seen = new Set<string>();
          for (const e of incoming) {
            if (!e.key) {
              const base = entryKey(e.title);
              let k = base;
              const mk = `${e.worldId}:${k}`;
              if (seen.has(mk)) {
                let n = 2;
                while (seen.has(`${e.worldId}:${base}_${n}`)) n++;
                k = `${base}_${n}`;
                seen.add(`${e.worldId}:${k}`);
              } else {
                seen.add(mk);
              }
              e.key = k;
            }
          }
        }
        if (replace) {
          (next as any)[name] = incoming;
        } else {
          const map = new Map<string, any>((next as any)[name].map((x: any) => [x.id, x]));
          incoming.forEach((x) => map.set(x.id, x));
          (next as any)[name] = [...map.values()];
        }
        await putMany(name, incoming);
      }
      setDb(next);
      if (!settings.activeWorldId || !next.worlds.some((w) => w.id === settings.activeWorldId)) {
        persistSettings({ ...settings, activeWorldId: next.worlds[0]?.id ?? null });
      }
    },
    [db, storage, putMany, settings, persistSettings],
  );

  const resetAll = useCallback(async () => {
    for (const name of STORE_NAMES) await storage.clear(name);
    setDb({ ...EMPTY_DB });
    persistSettings({ ...settings, activeWorldId: null });
  }, [storage, settings, persistSettings]);

  /* --------------------------- 新建世界草稿 --------------------------- */
  /**
   * 用一个空草稿开启新建流程。
   * 注意：这里不写任何世界数据 —— 草稿只是草稿，用户点确认前一切都不算数。
   */
  const newDraft = useCallback((): WorldDraft => {
    const t = now();
    return {
      id: uid('dr'),
      stage: 'materials',
      materials: [],
      told: [],
      qa: [],
      questions: [],
      understanding: '',
      observations: [],
      round: 0,
      readyToDraft: false,
      proposal: null,
      revisions: [],
      createdAt: t,
      updatedAt: t,
    };
  }, []);

  const saveDraft = useCallback(
    async (draft: WorldDraft) => {
      const next = { ...draft, updatedAt: now() };
      setDb((d) => ({
        ...d,
        drafts: [...d.drafts.filter((x) => x.id !== next.id), next],
      }));
      await put('drafts', next);
    },
    [put],
  );

  const discardDraft = useCallback(
    async (id?: ID) => {
      const targets = dbRef.current.drafts.filter((d) => (id ? d.id === id : true));
      if (!targets.length) return;
      setDb((d) => ({ ...d, drafts: id ? d.drafts.filter((x) => x.id !== id) : [] }));
      await storage.removeMany(
        'drafts',
        targets.map((d) => d.id),
      );
    },
    [db.drafts, storage],
  );

  /**
   * 确认创建：把草稿里的设定草案正式写进库里。
   * 这是整条流程里唯一会产出世界数据的入口。
   */
  const commitDraft = useCallback(
    async (draft: WorldDraft) => {
      const p = draft.proposal;
      if (!p) throw new Error(tGlobal('lib.state.draftNoProposal'));
      const t = now();

      const rules = (p.rules ?? []).filter((r) => r && r.trim());
      const summary = [
        (p.summary ?? '').trim(),
        rules.length
          ? `${tGlobal('lib.state.worldRulesHeading')}\n${rules.map((r) => `- ${r.trim()}`).join('\n')}`
          : '',
      ]
        .filter(Boolean)
        .join('\n\n');

      const world: World = {
        id: uid('wd'),
        name: (p.name ?? '').trim() || tGlobal('lib.state.unnamedWorld'),
        tagline: p.tagline ?? '',
        summary,
        genre: p.genre ?? '',
        tone: p.tone ?? '',
        themeColor: p.themeColor || '#5b7c99',
        createdAt: t,
        updatedAt: t,
      };

      const catDefs = p.categories?.length
        ? p.categories
        : [{ name: tGlobal('lib.state.defaultCategory'), icon: '📁', desc: '' }];
      const categories: Category[] = catDefs.map((c, i) => ({
        id: uid('ct'),
        worldId: world.id,
        name: (c.name ?? '').trim() || tGlobal('lib.state.categoryN', { n: i + 1 }),
        icon: c.icon || '📁',
        fieldDefs: [],
        order: i,
        createdAt: t,
        updatedAt: t,
      }));
      const catByName = new Map(categories.map((c) => [c.name, c.id]));

      const entries: Entry[] = (p.entries ?? [])
        .filter((e) => e.included && e.title?.trim())
        .map((e) => ({
          id: uid('en'),
          worldId: world.id,
          categoryId: catByName.get(e.category) ?? categories[0].id,
          title: e.title.trim(),
          key: entryKey(e.title),
          aliases: e.aliases ?? [],
          summary: e.summary ?? '',
          content: e.content ?? '',
          tags: e.tags ?? [],
          fields: {},
          status: 'canon',
          sourceRefs: [],
          createdAt: t,
          updatedAt: t,
        }));

      const idOf = (title: string): ID | undefined => {
        const q = (title ?? '').trim();
        if (!q) return undefined;
        const exact = entries.find((e) => e.title === q);
        if (exact) return exact.id;
        return entries.find((e) => e.title.includes(q) || q.includes(e.title))?.id;
      };

      const relations: Relation[] = [];
      for (const r of (p.relations ?? []).filter((x) => x.included)) {
        const from = idOf(r.from);
        const to = idOf(r.to);
        if (!from || !to || from === to) continue;
        relations.push({
          id: uid('rl'),
          worldId: world.id,
          fromEntryId: from,
          toEntryId: to,
          type: (r.type ?? '').trim() || tGlobal('lib.state.defaultRelation'),
          note: r.note ?? '',
          status: 'canon',
          createdAt: t,
        });
      }

      // 用户投喂的素材一并进入新世界的资料库，保留设定来源
      const docs: SourceDoc[] = (draft.materials ?? []).map((m) => ({
        id: uid('dc'),
        worldId: world.id,
        name:
          m.name ||
          (m.kind === 'rule'
            ? tGlobal('lib.state.tempRule')
            : tGlobal('lib.state.unnamedMaterial')),
        ext: m.kind === 'image' ? extOf(m.name) || 'png' : m.kind,
        size: m.size ?? m.text?.length ?? 0,
        text:
          m.kind === 'image'
            ? tGlobal('lib.state.imageMaterialDoc', {
                note: m.note ? tGlobal('lib.state.imageMaterialNote', { note: m.note }) : '',
              })
            : m.note
              ? tGlobal('lib.state.noteBlock', { note: m.note, text: m.text })
              : m.text,
        parsed: false,
        addedAt: m.addedAt,
      }));

      setDb((d) => ({
        ...d,
        worlds: [...d.worlds, world],
        categories: [...d.categories, ...categories],
        entries: [...d.entries, ...entries],
        relations: [...d.relations, ...relations],
        docs: [...d.docs, ...docs],
        drafts: d.drafts.filter((x) => x.id !== draft.id),
      }));

      await put('worlds', world);
      await putMany('categories', categories);
      await putMany('entries', entries);
      await putMany('relations', relations);
      await putMany('docs', docs);
      await storage.removeMany('drafts', [draft.id]);
      const prevSettings = settings;
      persistSettings({ ...settings, activeWorldId: world.id });

      // 一次确认建出来的东西：撤销要整体退回，所以快照里带上全部子项
      await logOp({
        worldId: world.id,
        action: 'create',
        entity: 'world',
        target: world.name,
        targetId: world.id,
        detail: p.rationale ?? '',
        undo: {
          remove: [
            { entity: 'world', id: world.id },
            ...categories.map((c) => ({ entity: 'category' as const, id: c.id })),
            ...entries.map((e) => ({ entity: 'entry' as const, id: e.id })),
            ...relations.map((r) => ({ entity: 'relation' as const, id: r.id })),
            ...docs.map((x) => ({ entity: 'doc' as const, id: x.id })),
          ],
          settings: prevSettings,
        },
      });

      return world;
    },
    [put, putMany, storage, settings, persistSettings, logOp],
  );

  /* --------------------------- 派生数据 --------------------------- */
  const activeWorld = useMemo(
    () => db.worlds.find((w) => w.id === settings.activeWorldId) ?? db.worlds[0] ?? null,
    [db.worlds, settings.activeWorldId],
  );

  const wid = activeWorld?.id;

  const categories = useMemo(
    () => db.categories.filter((c) => c.worldId === wid).sort((a, b) => a.order - b.order),
    [db.categories, wid],
  );
  const entries = useMemo(
    () =>
      db.entries
        .filter((e) => e.worldId === wid)
        .sort((a, b) => b.updatedAt - a.updatedAt),
    [db.entries, wid],
  );
  const relations = useMemo(
    () => db.relations.filter((r) => r.worldId === wid),
    [db.relations, wid],
  );
  const docs = useMemo(
    () => db.docs.filter((d) => d.worldId === wid).sort((a, b) => b.addedAt - a.addedAt),
    [db.docs, wid],
  );
  const review = useMemo(
    () => db.review.filter((r) => r.worldId === wid).sort((a, b) => b.createdAt - a.createdAt),
    [db.review, wid],
  );
  const pendingReview = useMemo(() => review.filter((r) => r.status === 'pending'), [review]);

  /** 杂物间：置顶优先，其余按更新时间倒序 */
  const pieces = useMemo(
    () =>
      db.pieces
        .filter((p) => p.worldId === wid)
        .sort((a, b) => Number(b.pinned) - Number(a.pinned) || b.updatedAt - a.updatedAt),
    [db.pieces, wid],
  );

  /**
   * 时间轴上的东西：**设了时间的条目**，一次就排好序交出去。
   *
   * 「轴上的先后」是时间视图唯一的事实，让每个用它的地方各自 sort 一遍，
   * 迟早会出现「轴上按年代、列表按创建时间」这种自相矛盾。
   * 位置相同时按创建时间兜底，顺序才是稳定的。
   */
  const timedEntries = useMemo(
    () =>
      db.entries
        .filter((e) => e.worldId === wid && !!e.time)
        .sort((a, b) => (a.time!.at ?? 0) - (b.time!.at ?? 0) || a.createdAt - b.createdAt),
    [db.entries, wid],
  );

  /** 正在进行中的新建世界草稿（取最近更新的一份） */
  const draft = useMemo(
    () => [...db.drafts].sort((a, b) => b.updatedAt - a.updatedAt)[0] ?? null,
    [db.drafts],
  );

  /** 操作日志：当前世界的 + 全局的（删世界留下的那条挂在全局上） */
  const ops = useMemo(
    () =>
      db.ops
        .filter((o) => o.worldId === wid || o.worldId === null)
        .sort((a, b) => b.createdAt - a.createdAt),
    [db.ops, wid],
  );

  /** 当前世界的 agent 会话，最近更新的在前 */
  const threads = useMemo(
    () => db.chats.filter((c) => c.worldId === wid).sort((a, b) => b.updatedAt - a.updatedAt),
    [db.chats, wid],
  );

  const stats = useMemo(
    () => ({
      entries: entries.length,
      canon: entries.filter((e) => e.status === 'canon').length,
      pending: entries.filter((e) => e.status === 'pending').length,
      relations: relations.length,
      docs: docs.length,
      pieces: pieces.length,
      timed: timedEntries.length,
      reviewPending: pendingReview.length,
    }),
    [entries, relations, docs, pieces, timedEntries, pendingReview],
  );

  const value: StoreValue = {
    ready,
    initError,
    initDiagnosis,
    retryInit,
    pendingUpgrade,
    dbUpgrading,
    dbUpgradeError,
    storage,
    db,
    settings,
    activeWorld,
    categories,
    entries,
    relations,
    docs,
    review,
    pieces,
    drafts: db.drafts,
    pendingReview,
    draft,
    stats,
    updateSettings,
    updateAI,
    setActiveWorld,
    createWorld,
    updateWorld,
    deleteWorld,
    newDraft,
    saveDraft,
    discardDraft,
    commitDraft,
    createCategory,
    updateCategory,
    deleteCategory,
    createEntry,
    updateEntry,
    deleteEntry,
    createRelation,
    updateRelation,
    deleteRelation,
    addDoc,
    updateDoc,
    deleteDoc,
    createPiece,
    updatePiece,
    deletePiece,
    timedEntries,
    setEntryTime,
    migrateTimeline,
    pushReview,
    updateReview,
    acceptReview,
    rejectReview,
    clearReview,
    ops,
    withActor,
    logOp,
    logNote,
    undoOp,
    clearOps,
    threads,
    createThread,
    saveThread,
    deleteThread,
    importBackup,
    resetAll,
    reload,
  };

  return <StoreCtx.Provider value={value}>{children}</StoreCtx.Provider>;
}

export function useStore(): StoreValue {
  const ctx = useContext(StoreCtx);
  if (!ctx) throw new Error('useStore 必须在 StoreProvider 内使用'); // i18n-allow（开发者错误）
  return ctx;
}
