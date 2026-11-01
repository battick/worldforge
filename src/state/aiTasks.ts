/**
 * 全局 AI 任务表。
 *
 * **为什么要有它。** AI 任务的状态原先住在各自页面的 `useState` 里，而路由切换会把页面卸载，
 * 于是「AI 正在干活时切到别的页面」会露出两种错位：
 *
 *   1. 它其实还在跑（fetch 没被取消），但界面上的 loading 与流式预览随着卸载没了；
 *   2. 跑完之后写回 `setState` 时页面已经不在 —— 成果直接丢掉，token 白烧一遍，
 *      作者回来看到的却像是「什么都没发生过」。
 *
 * 所以把任务状态搬到这个**模块级**的表里：它不随任何组件卸载而消失，页面只负责「订阅并渲染」。
 * 顺带得到第二件事：侧栏能知道「哪个页面正在干活」，据此在对应导航项上转圈。
 *
 * **换世界要隔离。** 任务起跑时记下当前世界，读的时候世界对不上就按「没跑过」渲染 ——
 * 否则切了世界还会看到上一个世界的抽取结果，那比没有结果更糟。
 *
 * 铁律：这是纯逻辑层，不许 import 任何带 React 组件的模块（语言包只能从 `i18n/translate` 取
 * `tGlobal`）。
 */
import { useCallback, useMemo, useSyncExternalStore } from 'react';
import { useStore } from './store';
import { useToast } from '../components/Toast';
import { tGlobal, type MsgKey } from '../i18n/translate';
import type { AISettings } from '../types';

/**
 * AI 配置齐了没有 —— 没齐就返回「该提示哪一句」。
 *
 * 单独抽出来是因为**判据有三处要用**：单发任务（下面的 `run`）、任务队列入队之前、
 * 以及工作台里那个「静默判断」。三处各写一份的话，迟早会出现「这边放行、那边拦下」
 * 的错位（比如本机地址免 Key 这条规则只改了一处）。
 */
export function aiGuardKey(ai: AISettings): MsgKey | null {
  if (!ai.baseUrl) return 'ai.guard.noBaseUrl';
  if (!ai.apiKey && !/localhost|127\.0\.0\.1/.test(ai.baseUrl)) return 'ai.guard.noApiKey';
  if (!ai.model) return 'ai.guard.noModel';
  return null;
}

export type AITaskPhase = 'idle' | 'running' | 'done' | 'error';

export interface AITask {
  key: string;
  /** 对应侧栏哪个导航项 —— 「这里正在干活」的动画提示靠它定位 */
  navKey: string;
  /** 起跑时是哪个世界 */
  worldId: string | null;
  phase: AITaskPhase;
  /** 流式预览文本（截尾保留，够看就行） */
  stream: string;
  result: unknown;
  error: string | null;
  startedAt: number | null;
  finishedAt: number | null;
  /**
   * 批量任务的进度：跑第几条、共几条、当前在收拾谁。
   *
   * 「一次跑十五条条目」这种任务，只转个圈是不够的 —— 作者看不出它是卡住了
   * 还是在推进、也判断不了还要多久，只能干等。有了进度就能显示「3/15 · 潮汐律」。
   */
  progress: AITaskProgress | null;
}

export interface AITaskProgress {
  done: number;
  total: number;
  /** 正在处理的那一项（人话名字，不是 id） */
  label: string;
}

/** 流式预览留多少字。跟页面原先的 `.slice(-3000)` 一个量级，长文也不至于把内存撑起来 */
const STREAM_CAP = 4000;

const tasks = new Map<string, AITask>();
const listeners = new Set<() => void>();
const controllers = new Map<string, AbortController>();

function idleTask(key: string): AITask {
  return {
    key,
    navKey: '',
    worldId: null,
    phase: 'idle',
    stream: '',
    result: null,
    error: null,
    startedAt: null,
    finishedAt: null,
    progress: null,
  };
}

/**
 * 取一个任务的当前状态。
 *
 * 必须返回**稳定引用**：`useSyncExternalStore` 会在「看起来没变化」时反复取快照，
 * 每次都 new 一个对象会让 React 认为一直在变，直接转成无限重渲染。
 * 所以缺省时把这条 idle 记录**写进表里**再返回，后续命中的是同一个对象。
 */
export function taskOf(key: string): AITask {
  let cur = tasks.get(key);
  if (!cur) {
    cur = idleTask(key);
    tasks.set(key, cur);
  }
  return cur;
}

function commit(key: string, patch: Partial<AITask>): AITask {
  const next: AITask = { ...taskOf(key), ...patch, key };
  tasks.set(key, next);
  for (const fn of listeners) fn();
  return next;
}

export function subscribeTasks(fn: () => void): () => void {
  listeners.add(fn);
  return () => {
    listeners.delete(fn);
  };
}

/** 开跑。同一个 key 上若还挂着上一次的，先掐掉 —— 结果只会互相覆盖 */
export function startTask(key: string, navKey: string, worldId: string | null): AbortController {
  controllers.get(key)?.abort();
  const controller = new AbortController();
  controllers.set(key, controller);
  commit(key, {
    navKey,
    worldId,
    phase: 'running',
    stream: '',
    result: null,
    error: null,
    startedAt: Date.now(),
    finishedAt: null,
    progress: null,
  });
  return controller;
}

/** 追加一段流式文本（有些任务的 onDelta 给的是增量） */
export function appendTaskStream(key: string, chunk: string): void {
  const cur = taskOf(key);
  if (cur.phase !== 'running') return;
  commit(key, { stream: (cur.stream + chunk).slice(-STREAM_CAP) });
}

/** 整段替换流式文本（有些给的是「截至目前解析出来的全文」） */
export function setTaskStream(key: string, text: string): void {
  const cur = taskOf(key);
  if (cur.phase !== 'running') return;
  commit(key, { stream: text.slice(-STREAM_CAP) });
}

export function setTaskResult(key: string, result: unknown): void {
  commit(key, { result });
}

/** 报告批量进度。只在跑着的时候认 —— 收工后晚到的进度不该把状态改回去 */
export function setTaskProgress(key: string, progress: AITaskProgress | null): void {
  if (taskOf(key).phase !== 'running') return;
  commit(key, { progress });
}

// 收工时把 progress 清掉：进度只对「还在跑」有意义，跑完的结果由调用方放进 result
// （页面据此显示「已送审 8 条、跳过 3 条」这种汇总，比停在「15/15」有用）。
export function finishTask(key: string): void {
  controllers.delete(key);
  commit(key, { phase: 'done', finishedAt: Date.now(), progress: null });
}

export function failTask(key: string, message: string): void {
  controllers.delete(key);
  commit(key, { phase: 'error', error: message, finishedAt: Date.now(), progress: null });
}

/** 回到「没跑过」。页面主动清场（比如关闭结果面板）时用 */
export function resetTask(key: string): void {
  controllers.get(key)?.abort();
  controllers.delete(key);
  commit(key, { phase: 'idle', stream: '', result: null, error: null, progress: null });
}

/**
 * 作者按的「停止」：既不算成功也不算错误。
 * 这里不弹错误提示、也不留半截流式文本 —— 是作者自己不想要的。
 */
export function abortTask(key: string): void {
  const controller = controllers.get(key);
  controllers.delete(key);
  controller?.abort();
  commit(key, { phase: 'idle', stream: '', error: null, progress: null });
}

/**
 * 正在干活的导航项。
 *
 * 返回**排序后拼成的字符串**而不是 Set：`useSyncExternalStore` 比较的是引用，
 * 每次新建一个 Set 会让它认为快照一直在变。字符串按值比较，天然稳定。
 */
export function runningNavSignature(): string {
  const hit: string[] = [];
  for (const t of tasks.values()) {
    if (t.phase === 'running' && t.navKey) hit.push(t.navKey);
  }
  return [...new Set(hit)].sort().join(',');
}

/** 侧栏用：哪些导航项正在干活 */
export function useRunningNavKeys(): Set<string> {
  const subscribe = useCallback((fn: () => void) => subscribeTasks(fn), []);
  const sig = useSyncExternalStore(subscribe, runningNavSignature, runningNavSignature);
  return useMemo(() => new Set(sig ? sig.split(',') : []), [sig]);
}

/** 单条任务的状态订阅（不关心怎么跑，只想显示） */
export function useAITaskState(key: string): AITask {
  const subscribe = useCallback((fn: () => void) => subscribeTasks(fn), []);
  const snapshot = useCallback(() => taskOf(key), [key]);
  return useSyncExternalStore(subscribe, snapshot, snapshot);
}

export type TaskFn<R> = (opts: {
  onDelta: (chunk: string) => void;
  signal: AbortSignal;
}) => Promise<R>;

export interface AITaskHandle<T> {
  phase: AITaskPhase;
  loading: boolean;
  stream: string;
  /** 批量任务的进度；非批量任务恒为 null */
  progress: AITaskProgress | null;
  result: T | null;
  error: string | null;
  /** 跑一次。返回 null 表示失败或被中止 */
  run: <R = T>(fn: TaskFn<R>) => Promise<R | null>;
  /** 把结果放进全局任务槽 —— 放这儿才活得过页面卸载 */
  setResult: (value: T | null) => void;
  /** 报告批量进度（第几条 / 共几条 / 在收拾谁） */
  setProgress: (value: AITaskProgress | null) => void;
  reset: () => void;
  abort: () => void;
}

/**
 * 一次性的 AI 任务。
 *
 * 用法与原来的 `useAIAction` 几乎一样，差别在**状态活在组件外面**：
 * 页面卸载不会让 loading / 流式文本 / 结果消失，切回来照样在。
 * 代价是结果得经 `setResult` 显式存进任务槽（别再存进页面自己的 useState）。
 */
export function useAITask<T = unknown>(key: string, navKey: string): AITaskHandle<T> {
  const store = useStore();
  const toast = useToast();
  const worldId = store.settings.activeWorldId ?? null;

  const task = useAITaskState(key);

  // 换了世界：上一个世界的任务结果不该冒充新世界的。视图上按「没跑过」渲染
  // （表里那条记录留着不动 —— 切回去还能看到它）。
  const foreign = !!task.worldId && !!worldId && task.worldId !== worldId;
  const phase: AITaskPhase = foreign ? 'idle' : task.phase;
  const stream = foreign ? '' : task.stream;
  const error = foreign ? null : task.error;
  const result = (foreign ? null : task.result) as T | null;

  const run = useCallback(
    async <R,>(fn: TaskFn<R>): Promise<R | null> => {
      const ai = store.settings.ai;
      const missing = aiGuardKey(ai);
      if (missing) {
        toast.error(tGlobal(missing));
        return null;
      }
      // 同一个任务不许叠着跑：上一发还没回来就再发，结果会互相覆盖
      if (taskOf(key).phase === 'running') return null;

      const controller = startTask(key, navKey, worldId);
      try {
        const r = await fn({
          onDelta: (chunk) => appendTaskStream(key, chunk),
          signal: controller.signal,
        });
        finishTask(key);
        return r;
      } catch (e) {
        const msg = (e as Error).message || tGlobal('ai.err.unknown');
        if (/aborted|AbortError/i.test(msg)) {
          // 作者自己按的停止，不是错误，别弹红条
          commit(key, { phase: 'idle', stream: '', error: null });
        } else {
          failTask(key, msg);
          toast.error(msg);
        }
        return null;
      }
    },
    [key, navKey, worldId, store.settings.ai, toast],
  );

  const setResult = useCallback((value: T | null) => setTaskResult(key, value), [key]);
  const setProgress = useCallback(
    (value: AITaskProgress | null) => setTaskProgress(key, value),
    [key],
  );
  const reset = useCallback(() => resetTask(key), [key]);
  const abort = useCallback(() => abortTask(key), [key]);

  return {
    phase,
    loading: phase === 'running',
    stream,
    progress: foreign ? null : task.progress,
    result,
    error,
    run,
    setResult,
    setProgress,
    reset,
    abort,
  };
}
