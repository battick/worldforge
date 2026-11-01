/**
 * 通用后台任务队列。
 *
 * **为什么要有它。** 界面上有一类活儿是「一件一件来、但作者想一次点好几下」的：
 * 一致性检查里逐条生成修订、条目列表里逐条打磨、以后还会有别的。它们原先各自
 * 调 `useAITask(key).run()` —— 而那个 `run()` 有个刻意的约束：**同一个 key 还跑着就
 * 直接返回 null**（防结果互相覆盖）。单发场景下这个约束是对的，可一旦作者手快连点三条，
 * 后两条就**静默消失**：按钮闪了一下、什么都没发生、也没有任何提示。这不是「慢」，
 * 是「按了没反应」——比报错更让人不放心。
 *
 * 所以把它拆成两层：
 *   · `useAITask` 继续管「一个页面上一件大事」的流式状态（进度、流式预览、结果卡）；
 *   · **这个队列**管「一堆小活儿，排队慢慢做」：点一下加一件，点十下加十件，
 *     串行地一件件跑完，顺序就是点下去的顺序，中途可以撤单。
 *
 * **为什么是全局模块级的表**（与 aiTasks 同一个理由）：任务状态不能住在页面里 ——
 * 路由一换页面就卸载了。队列尤其如此：作者常常是「在这儿排一堆、然后去别的页面等」。
 *
 * **串行，不并发。** 一次只跑一件：AI 调用是按量计费的，且并发发出去多半会撞上
 * 上游的速率限制、反而更慢；更要紧的是**写库的顺序会乱**（两件同时改世界，
 * 谁先落盘说不准），而作者点下去的顺序本身就是他的意图表达。想改并发只需动
 * 下面的 `CONCURRENCY`，但要先把「同一条目被两件活儿同时改」这件事想清楚。
 *
 * **失败不堵队列。** 一件烂了记下错误继续下一件 —— 卡住整条队伍会让后面那些本来
 * 能成的活儿陪着一起死。失败的留在列表里可以单独重试（`retryJob`）。
 *
 * 铁律：这是纯逻辑层，不许 import 任何带 React 组件的模块（语言包只能从
 * `i18n/translate` 取 `tGlobal`）。
 */
import { useCallback, useMemo, useSyncExternalStore } from 'react';
import { uid } from '../lib/id';
import { tGlobal } from '../i18n/translate';

export type JobStatus = 'queued' | 'running' | 'done' | 'error' | 'canceled';

export interface Job {
  id: string;
  /** 这一件是什么，人话（「生成《匠人同盟》的修订」）。入队时就定好，不随后续语言切换改 */
  label: string;
  /** 归组标签（「一致性修订」「条目打磨」），面板里当小标签显示，一眼看出这堆是什么活儿 */
  group: string;
  /** 同一件活儿不许重复排队（连点两下 = 一次）。为空表示不做去重 */
  dedupeKey: string | null;
  /** 起跑时是哪个世界 —— 面板按当前世界过滤，切了世界不显示上一个世界的遗留 */
  worldId: string | null;
  /**
   * 这件活儿算在哪一格导航上（「entries」…），用来在侧栏那一格转圈。
   *
   * 与 `AITask.navKey` 同一个用途：活儿排进队列之后，页面自己已经没有进度条了，
   * 侧栏那点动画是「哪个页面在干活」唯一还能一眼看到的地方。
   * 留空 = 不点亮任何一格。
   */
  navKey: string | null;
  status: JobStatus;
  /** 失败原因（人话） */
  error: string | null;
  /** 成功时的一句回执（「已生成 1 条修订」），比一个「完成」有用 */
  note: string | null;
  queuedAt: number;
  startedAt: number | null;
  finishedAt: number | null;
}

/** 干完活返回一句回执（或什么都不返回）。抛异常 = 这一件失败 */
export type JobRun = (signal: AbortSignal) => Promise<string | null | undefined>;

export interface JobSpec {
  label: string;
  group: string;
  run: JobRun;
  /** 去重键：同键且**还在排队或正在跑**时，重复入队会被丢掉 */
  dedupeKey?: string;
  worldId?: string | null;
  /** 算在哪一格导航上（侧栏据此转圈）。见 `Job.navKey` */
  navKey?: string;
}

/** 同时跑几件。见文件头「串行，不并发」那段 —— 改之前先把话说清楚 */
const CONCURRENCY = 1;

/** 排队顺序 + 所有状态都在这里，Map 的插入顺序就是点下去的顺序 */
const jobs = new Map<string, Job>();
/** 跑法单独放：它是函数，不该混进给 React 的快照里 */
const runners = new Map<string, JobRun>();
const controllers = new Map<string, AbortController>();
const listeners = new Set<() => void>();

/**
 * 给 `useSyncExternalStore` 的快照。
 *
 * 必须**引用稳定**：那个 hook 会在「看起来没变化」时反复取快照，每次都新建一个数组
 * 会让 React 认为一直在变，直接转成无限重渲染。所以只在真正提交变更时才重建一次，
 * 没变就一直是同一个数组。
 */
let snapshot: Job[] = [];

function notify(): void {
  snapshot = [...jobs.values()];
  for (const fn of listeners) fn();
}

function commit(id: string, patch: Partial<Job>): void {
  const cur = jobs.get(id);
  if (!cur) return;
  jobs.set(id, { ...cur, ...patch });
  notify();
}

export function subscribeJobs(fn: () => void): () => void {
  listeners.add(fn);
  return () => {
    listeners.delete(fn);
  };
}

/** 当前队列快照（稳定引用）。组件里请用 `useJobs()` */
export function jobsSnapshot(): Job[] {
  return snapshot;
}

/** 还在排队或正在跑的那些 */
function isLive(j: Job): boolean {
  return j.status === 'queued' || j.status === 'running';
}

/** 某件活儿是不是还在队列里（排队中或跑着）。用于按钮的「已经排上了」状态 */
export function hasLiveJob(dedupeKey: string): boolean {
  for (const j of jobs.values()) if (j.dedupeKey === dedupeKey && isLive(j)) return true;
  return false;
}

/**
 * 队列里有没有**键以此开头**的活儿还在跑。
 *
 * 用处是「同一类活儿只许排一件」：比如同一条条目上的修订 —— 键里带着条目 id，
 * 于是问一句 `consist-fix:<条目>: ` 就知道该条目是不是已经在做着了。
 *
 * 它读的是**模块里那张表**（同步、永远最新），不是 `useJobs()` 的快照 ——
 * 这一条很重要：作者一口气连点三下时，三下都发生在 React 重渲染**之前**，
 * 拿快照去判断会一律判成「没人排过」，三件照样全排上。
 * 界面显示用快照（可以慢一拍），**做判断一律用这里**。
 */
export function hasLiveJobPrefix(prefix: string): boolean {
  for (const j of jobs.values()) {
    if (j.dedupeKey?.startsWith(prefix) && isLive(j)) return true;
  }
  return false;
}

/**
 * 还在队里（排队中 + 跑着）的件数。
 *
 * 直接读内部表而不是 `useJobs()` 的快照：入队是同步的，但 React 那一份要等下一次渲染才更新 ——
 * 刚入队就想说「已排上 3 件」的提示会数少了。这里读的永远是当下这一刻的真数。
 */
export function liveJobCount(): number {
  let n = 0;
  for (const j of jobs.values()) if (isLive(j)) n++;
  return n;
}

let running = false;

/**
 * 队列泵：有空位就取队首那件来跑，跑完接着下一件。
 *
 * 只在跑完之后才把 `running` 放回 false，中间没有 await 的空隙 ——
 * 所以「边跑边入队」的新活儿一定会被这一轮循环看到，不需要额外的唤醒逻辑。
 */
async function pump(): Promise<void> {
  if (running) return;
  running = true;
  try {
    for (;;) {
      let next: Job | null = null;
      for (const j of jobs.values()) {
        if (j.status === 'queued') {
          next = j;
          break;
        }
      }
      if (!next) break;

      const run = runners.get(next.id);
      if (!run) {
        // 跑法丢了（理论上不该发生）：如实记成失败，别让队伍停在这儿
        commit(next.id, {
          status: 'error',
          error: tGlobal('queue.err.noRunner'),
          finishedAt: Date.now(),
        });
        continue;
      }

      const controller = new AbortController();
      controllers.set(next.id, controller);
      commit(next.id, { status: 'running', startedAt: Date.now() });

      try {
        const note = await run(controller.signal);
        commit(next.id, {
          status: 'done',
          note: typeof note === 'string' && note ? note : null,
          finishedAt: Date.now(),
        });
        // 跑法用过就扔：它闭包着一份当时的快照，留着只会占内存
        runners.delete(next.id);
      } catch (e) {
        const msg = ((e as Error)?.message || '').trim() || tGlobal('ai.err.unknown');
        if (controller.signal.aborted || /aborted|AbortError/i.test(msg)) {
          // 作者自己按的停止：既不算成功也不算失败，也不留错误文本吓人
          commit(next.id, { status: 'canceled', finishedAt: Date.now() });
        } else {
          commit(next.id, { status: 'error', error: msg, finishedAt: Date.now() });
        }
      } finally {
        controllers.delete(next.id);
      }

      if (CONCURRENCY > 1) {
        // 留个位置：真要并发时在这儿起下一件（同时要处理「同一条目被两件同时改」）
        continue;
      }
    }
  } finally {
    running = false;
    // 兜底：万一有活儿是在 `running` 刚落、循环还没重启的空隙里进来的
    // （同步代码里其实进不来，但代价只有一个 hasQueued 判断）
    for (const j of jobs.values()) {
      if (j.status === 'queued') {
        void pump();
        break;
      }
    }
  }
}

/**
 * 排队。
 *
 * 返回真正排进去的件数 —— 调用方据此说「3 件已排上，2 件本来就在队里」，
 * 比笼统的「已加入队列」诚实。去重只看**还在队里**的：跑完的再点一次是有意义的
 * （作者就是想再来一遍），那时候该不该拦是调用方的事。
 */
export function enqueueJobs(specs: JobSpec[]): number {
  const seen = new Set<string>();
  for (const j of jobs.values()) if (j.dedupeKey && isLive(j)) seen.add(j.dedupeKey);

  let added = 0;
  for (const spec of specs) {
    const key = spec.dedupeKey ?? null;
    if (key) {
      if (seen.has(key)) continue;
      seen.add(key);
    }
    const job: Job = {
      id: uid('job'),
      label: spec.label,
      group: spec.group,
      dedupeKey: key,
      worldId: spec.worldId ?? null,
      navKey: spec.navKey ?? null,
      status: 'queued',
      error: null,
      note: null,
      queuedAt: Date.now(),
      startedAt: null,
      finishedAt: null,
    };
    jobs.set(job.id, job);
    runners.set(job.id, spec.run);
    added++;
  }

  if (added) {
    notify();
    void pump();
  }
  return added;
}

export function enqueueJob(spec: JobSpec): boolean {
  return enqueueJobs([spec]) > 0;
}

/** 撤单。排着队的直接标掉；跑着的先掐断（那一件会走 canceled 分支） */
export function cancelJob(id: string): void {
  const j = jobs.get(id);
  if (!j || !isLive(j)) return;
  controllers.get(id)?.abort();
  if (j.status === 'queued') {
    // 跑法留着：撤单不等于不要了，作者可能只是想把它挪到后面再跑（面板上能重试）
    commit(id, { status: 'canceled', finishedAt: Date.now() });
  }
}

/** 停掉全部：跑着的掐断，排着的全撤 */
export function cancelAllJobs(): void {
  for (const j of jobs.values()) if (isLive(j)) cancelJob(j.id);
}

/** 重试一件失败的（或撤单的）。跑法还在才重试得了 —— 跑完的那条已经扔了 */
export function retryJob(id: string): boolean {
  const j = jobs.get(id);
  if (!j || isLive(j)) return false;
  if (!runners.has(id)) return false;
  commit(id, { status: 'queued', error: null, note: null, startedAt: null, finishedAt: null });
  void pump();
  return true;
}

/** 这一件能不能重试（面板据此决定要不要摆「重试」那颗按钮） */
export function jobCanRetry(id: string): boolean {
  const j = jobs.get(id);
  return !!j && !isLive(j) && runners.has(id);
}

/** 移掉一件**已经不在跑**的（失败的重试不了的、跑完的、撤单的） */
export function dismissJob(id: string): void {
  const j = jobs.get(id);
  if (!j || isLive(j)) return;
  jobs.delete(id);
  runners.delete(id);
  notify();
}

/** 清空所有已结束的（完成 / 失败 / 撤单）。队列空下来后，面板自己就收起来了 */
export function clearFinishedJobs(): void {
  let changed = false;
  for (const j of [...jobs.values()]) {
    if (isLive(j)) continue;
    jobs.delete(j.id);
    runners.delete(j.id);
    changed = true;
  }
  if (changed) notify();
}

/** 订阅整个队列快照 */
export function useJobs(): Job[] {
  const subscribe = useCallback((fn: () => void) => subscribeJobs(fn), []);
  const get = useCallback(() => snapshot, []);
  return useSyncExternalStore(subscribe, get, get);
}

/**
 * 排队中 + 正在跑的活儿分别点亮哪几格导航。
 *
 * 返回**排序后拼成的字符串**而不是 Set：`useSyncExternalStore` 比的是引用，
 * 每次新建一个 Set 会让它以为快照一直在变。字符串按值比较，天然稳定
 * （与 `aiTasks.runningNavSignature` 同一个道理）。
 */
export function liveJobNavSignature(): string {
  const hit: string[] = [];
  for (const j of jobs.values()) if (isLive(j) && j.navKey) hit.push(j.navKey);
  return [...new Set(hit)].sort().join(',');
}

/** 侧栏用：队列里的活儿正在点亮哪几格 */
export function useLiveJobNavs(): Set<string> {
  const subscribe = useCallback((fn: () => void) => subscribeJobs(fn), []);
  const sig = useSyncExternalStore(subscribe, liveJobNavSignature, liveJobNavSignature);
  return useMemo(() => new Set(sig ? sig.split(',') : []), [sig]);
}

// 开发期热更新时把模块级的表清干净：否则改一行代码热替换之后，
// 上一轮的「跑着的」会永远停在那儿（它的 promise 已经随旧模块没了）。
if (import.meta.hot) {
  import.meta.hot.dispose(() => {
    jobs.clear();
    runners.clear();
    for (const c of controllers.values()) c.abort();
    controllers.clear();
    listeners.clear();
    snapshot = [];
  });
}
