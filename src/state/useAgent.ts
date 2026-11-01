/**
 * 工作台 agent 的执行循环。
 *
 * 一轮对话的走法：
 *   1. 把世界现状 + 工具清单 + 作者的话发给模型；
 *   2. 模型回一个 JSON：{ say, plan }；
 *   3. plan 为空 → say 就是最终答复，收工；
 *      plan 非空 → 按「放手程度」决定是先等作者点头、还是立刻执行；
 *   4. 把执行结果回灌给模型，回到第 1 步（最多 MAX_STEPS 轮）。
 *
 * 两个「写代码时容易踩、但踩了很难查」的点，这里刻意回避了：
 *
 * - **数据快照会过期**。第 3 步里连着做 `新建条目` → `连关系` 时，
 *   第二步若还看着第一轮之前读到的 entries，就找不到刚建的条目。
 *   所以每次写操作之后打一个 dirty 标记，下一个动作前重新从库里取一份快照。
 *
 * - **会话对象不能用 store 的闭包读改写**。这一轮里会连续追加好几条消息，
 *   而闭包里的 db.chats 早就停在最开始那一刻了。所以运行态自己持有一份
 *   最新副本，每次都整段覆盖保存。
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import type {
  AgentMode,
  AgentTodoItem,
  AgentToolCall,
  ChatThread,
  ChatTurn,
  Entry,
  ID,
  OpLog,
  ReviewItem,
} from '../types';
import { useStore, type StoreValue } from './store';
import { finishTask, setTaskStream, startTask, taskOf } from './aiTasks';
import { useToast } from '../components/Toast';
import { chat } from '../ai/client';
import { tGlobal } from '../i18n/translate';
import { now, uid } from '../lib/id';
import { findTool, normalizeArgs, checkRequired, type AgentContext, type ToolOutcome } from '../ai/agent/tools';
import { parseAgentReply, partialSay, type AgentAction } from '../ai/agent/protocol';
import {
  buildAgentSystemPrompt,
  buildGoalMessage,
  buildResultMessage,
  type ResultPhase,
  type StepResult,
} from '../ai/agent/prompts';
import { STORE_NAMES } from '../storage/types';

/**
 * 一件事最多来回几轮。够做「查 → 建 → 连 → 汇报」，又不至于失控烧 token。
 *
 * 从 6 提到 20 是「清点式」任务逼出来的：作者说「把提到过、还没建的人物和物品补全」，
 * 那是**一趟要把几十条条目读完**的活 —— 一轮读 3~4 条也要六七轮，再加对库、提议、报数。
 * 6 轮的天花板让它在半路就到顶了，而到顶时它给的是「先把已经做完的交代一下」，
 * 作者拿到的是半成品（真实翻车：20 条条目只读了 3 条就收工）。
 * 打转由 STALL_NUDGE / STALL_STOP 那两道闸单独管，所以抬高上限不会放着它空转。
 */
const MAX_STEPS = 20;
/**
 * 清单上还有未完成项时，最多催它几轮。
 *
 * 催不是目的 —— 催两次还不接着做，就**如实告诉作者还剩几条**，别让这一轮悄悄收尾。
 */
const TODO_NUDGE_MAX = 2;
/**
 * 「它说要接着做、却没给动作」最多说破几次。
 *
 * 只一次：作者问一句「这是什么」，模型答完顺手写一句「接下来你可以……」是常事，
 * 那不是承诺。说破一次足够把真承诺和顺口一说分开，再多就变成每轮都多嘴。
 */
const PROMISE_NUDGE_MAX = 1;
const MODE_KEY = 'worldforge:agentMode';

/**
 * 「我接下来还要做…」的判据。
 *
 * 这是**解析用的关键词表**，不是界面文案 —— 模型用哪种语言回话，跟作者当前的界面语言
 * 没有必然关系，所以中英都列上，也不跟着语言包走。
 *
 * 为什么值得留这一手：真实翻车的收尾长这样 ——「接下来，我将继续检查其他条目……」，
 * plan 给 []，循环照旧收工。光看「plan 为空」区分不了「做完了」和「说到一半停下来了」。
 * 判据宁可窄一点：漏判只是少说一句，误判会让每一轮都多一次往返。
 */
/**
 * 带几轮历史、每条留多长。
 *
 * 够「接着刚才那句说」就行，多了是白烧 token：真正要它依据的是库的现状
 * （条目索引、最近操作），历史只是让代词和话题有个落脚点。
 */
const RECENT_TURNS = 6;
const RECENT_CHARS = 220;

/**
 * 从会话里挑出**还能当语境用**的那几轮。
 *
 * 三条挑法，都是为了让这段文字读起来像对话、而不像日志：
 *   - 循环自己插的那些话不带（「清单上还剩几条」「它说要接着做却没有动作」）——
 *     那是**系统对它说的**，带回去它会当成自己讲过的话；
 *   - 一句话都没说的轮次不带（只调了工具的那种），占地方又没信息；
 *   - 从末尾往前取，取够就停。
 */
function recentContext(turns: ChatTurn[]): { role: 'user' | 'assistant'; content: string }[] {
  const out: { role: 'user' | 'assistant'; content: string }[] = [];
  for (let i = turns.length - 1; i >= 0 && out.length < RECENT_TURNS; i--) {
    const t = turns[i];
    if (t.todoLeft || t.promised || t.stuck || t.exhausted) continue;
    const text = (t.content ?? '').trim();
    if (!text) continue;
    out.unshift({ role: t.role, content: text.slice(0, RECENT_CHARS) });
  }
  return out;
}

const PROMISE_RE =
  /(我将|我会|我继续|接着我|然后我|稍后我|我这就|我马上|我再去|我再继续|接下来我还)|\b(I will|I'll|I am going to|Let me now|I still need to)\b/i; // i18n-allow

/** 这一轮它自己说要接着做、却一个动作都没给 */
function looksLikePromise(say: string): boolean {
  return !!say && PROMISE_RE.test(say);
}

/**
 * 把清单里那几条摊成一段文字。
 *
 * 既回灌给模型（催它的时候），也印在给作者的那句收尾里 —— 两处都要求
 * **看得出还剩什么**，所以条目原文照抄，不摘要、不改写。
 */
function todoLines(list: AgentTodoItem[], cap = 12): string {
  const shown = list.slice(0, cap).map((t) => `- ${t.text}`).join('\n');
  return list.length > cap ? `${shown}\n- …` : shown;
}

/**
 * 打转的护栏阈值。
 *
 * 真实的模型有个很典型的毛病：查不到就换个说法再查，一轮一轮地试。
 * 从外面看，它「很努力」；从作者这边看，是它说了半天什么也没发生 —— 而且它本来
 * 只需要回头问一句。这两道闸就是治这个：
 *
 * - 攒到 NUDGE 次「没收获」→ 插一句要求它开口问的话，再给它一轮；
 * - 攒到 STOP 次（也就是被要求之后还是不听）→ 直接停下来，界面上如实说明。
 *
 * 计数只算「失败 / 零命中 / 原地重复」，正常的多步任务一步都不会被误伤。
 */
const STALL_NUDGE = 2;
const STALL_STOP = 4;

/** 全局任务表里的键 —— 侧栏据此在「AI 工作台」上转圈 */
const AGENT_TASK_KEY = 'studio.agent';

export type AgentPhase = 'idle' | 'thinking' | 'awaiting';

export interface PendingPlan {
  turnId: ID;
  calls: AgentToolCall[];
}

function readStoredMode(): AgentMode {
  try {
    const v = localStorage.getItem(MODE_KEY);
    if (v === 'plan' || v === 'auto' || v === 'hybrid') return v;
  } catch {
    /* ignore */
  }
  // 默认最保守的一档：这个产品的底色是「AI 提议、人拍板」
  return 'plan';
}

function aiConfigured(ai: { baseUrl: string; apiKey: string; model: string }): {
  ok: boolean;
  reason?: string;
} {
  if (!ai.baseUrl) return { ok: false, reason: 'ai.guard.noBaseUrl' };
  if (!ai.apiKey && !/localhost|127\.0\.0\.1/.test(ai.baseUrl)) {
    return { ok: false, reason: 'ai.guard.noApiKey' };
  }
  if (!ai.model) return { ok: false, reason: 'ai.guard.noModel' };
  return { ok: true };
}

/** 从 [[标题]] 里把引用抠出来（与问答页同一套写法） */
function extractCites(text: string, entries: Entry[]): { id: ID; title: string }[] {
  const out: { id: ID; title: string }[] = [];
  const re = /\[\[([^\]|]+)(?:\|[^\]]+)?\]\]/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text))) {
    const key = m[1].trim().toLowerCase();
    const hit =
      entries.find((e) => e.title.toLowerCase() === key) ??
      entries.find((e) => e.aliases.some((a) => a.toLowerCase() === key));
    if (hit && !out.some((c) => c.id === hit.id)) out.push({ id: hit.id, title: hit.title });
  }
  return out;
}

/**
 * 一次调用的指纹，用来认出「同一件事又问了一遍」。
 * 参数按 key 排序，免得 `{a,b}` 和 `{b,a}` 被当成两次不同的调用。
 */
function signature(tool: string, args: Record<string, unknown>): string {
  try {
    const pairs = Object.keys(args)
      .sort()
      .map((k) => [k, (args as Record<string, unknown>)[k]]);
    return `${tool}|${JSON.stringify(pairs)}`;
  } catch {
    // 参数里有循环引用之类的东西：退化成「必不重复」，宁可放它跑一次
    return `${tool}|?`;
  }
}

interface RunState {
  threadId: ID;
  /** 本次会话的标记，写进操作日志用于归类 */
  sessionId: ID;
  /** 发给模型的消息（不含 system） */
  history: { role: 'user' | 'assistant'; content: string }[];
  /**
   * 这次交代**之前**聊过的话，每轮印回系统提示词。
   *
   * 它跟 `history` 是两回事：`history` 是这一次交代的来回（结果回灌、纠正），
   * 走的是协议；这一份是**上一句人话**，走的是语境 —— 作者问「他的真正动机是什么」，
   * 那个「他」得有个落脚点。
   */
  recentTurns: { role: 'user' | 'assistant'; content: string }[];
  step: number;
  /** 正在等作者拍板的一批动作 */
  awaiting: { turnId: ID; actions: AgentAction[]; calls: AgentToolCall[] } | null;
  /** 已经因为「没按协议回」请它重说过一次没有 —— 每个问题只纠一次，免得来回烧 token */
  repaired: boolean;
  /**
   * 这次交代里已经**成功做过**的调用（工具 + 参数），用来拦住原地打转。
   *
   * 值里存着上一次的真实结果和当时的「库版本」，规矩有三条（都是被真实翻车逼出来的）：
   *   1. **只记成功的**。失败过的动作不记 —— 失败之后前提条件可能已经变了
   *      （「没有叫「物品」的分类」→ 它自己把分类建了出来 → 同一个动作本该能重来），
   *      记成「做过了」就会把唯一正确的下一步永久堵死，而且回执还说「结果一样」，是句假话。
   *   2. **写操作作废旧的签名**。库变了，同一个查询的答案也会变（`worldRev`）。
   *   3. **拦下时要说清上一次的真结果**，让模型自己判断该不该换个做法。
   */
  signatures: Map<string, { summary: string; rev: number }>;
  /** 库的「版本」：每成功写一次 +1。用来作废写操作之前的那些签名 */
  worldRev: number;
  /**
   * 它自己给自己立的待办清单（这一次交代的账）。
   *
   * 「清点式」任务（把提到过、还没建的补全）没有它就是一盘散沙：读了三五条就以为
   * 「差不多了」。清单写在会话上，每轮随系统提示词回到它眼前，界面上也摆给作者看。
   */
  todos: AgentTodoItem[];
  /** 攒下来的「没收获」次数 */
  stalls: number;
  /** 其中有多少次是**调用格式不对**（缺必填、参数名不认）—— 护栏据此给对的建议 */
  badCalls: number;
  /** 已经就「别查了，去问」提醒过它一次没有 */
  nudged: boolean;
  /** 已经就「清单上还剩东西」催过几轮 */
  todoNudges: number;
  /** 已经就「说了要做却没做」说破过几次 */
  promiseNudges: number;
}

/**
 * 「没收获」里，是「动作写错」占多数吗？
 *
 * 决定护栏该给哪条建议：查不到 → 让它去问作者；写错了 → 让它照参数名重写。
 * 两者给反了，模型就会去做一件解决不了当前问题的事。
 */
function badCallDriven(run: RunState): boolean {
  return run.badCalls > 0 && run.badCalls * 2 > run.stalls;
}

export function useAgent() {
  const store = useStore();
  const toast = useToast();

  const [mode, setModeState] = useState<AgentMode>(() => readStoredMode());
  const [phase, setPhase] = useState<AgentPhase>('idle');
  const [stream, setStream] = useState('');
  const [pending, setPending] = useState<PendingPlan | null>(null);
  /** 工作台当前在看哪一段会话。由页面告知 —— 页面卸载不会把它清掉，这正是「切页也接着干」的一半 */
  const [attachedId, setAttachedId] = useState<ID | null>(null);

  const abortRef = useRef<AbortController | null>(null);
  const runRef = useRef<RunState | null>(null);
  const threadRef = useRef<ChatThread | null>(null);
  /** agent 眼中的「当前世界数据」，写操作后会重新取一份 */
  const liveRef = useRef<StoreValue>(store);
  const dirtyRef = useRef(false);
  /**
   * 会话列表的**最新**副本。
   * `send` 这类回调不会因为会话变了就重建（依赖里没有它），闭包里那份 `store.threads`
   * 可能已经落后好几轮 —— 拿它去找会话会找不到，或者找到旧的。
   */
  const threadsRef = useRef(store.threads);
  threadsRef.current = store.threads;

  /** 页面挂载、或切换会话时告诉运行器「现在看的是哪一段」 */
  const attach = useCallback((threadId: ID | null) => setAttachedId(threadId), []);

  /**
   * 切世界时，agent 眼里的「当前世界」必须跟着换。
   *
   * `liveRef` 在挂载时塞了一份 store，之后只靠 `refreshLive` 按 `settings.activeWorldId`
   * 重新过滤数据 —— 但 `liveRef.settings` 从不更新，结果切了世界它还拿旧世界的 id 去过滤，
   * AI 读到的是旧世界的条目、往旧世界写关系，看起来就像「它还记得上一个世界」。
   *
   * 这里在活跃世界变化时把 `liveRef` 整体换成最新 store（entries/categories 已经按新世界过滤好了），
   * 同时中止正在跑的循环 —— 那是为旧世界服务的，跨世界接着跑只会写错地方。
   */
  useEffect(() => {
    liveRef.current = store;
    if (runRef.current) {
      abortRef.current?.abort();
      abortRef.current = null;
      runRef.current = null;
      setPending(null);
      setStream('');
      setPhase('idle');
    }
    // 只在活跃世界变化时触发，不依赖 store 整体引用（否则每次写库都会重跑）
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [store.settings.activeWorldId]);

  /**
   * 这一次交代的待办清单 —— 界面读的就是这一份（响应式）。
   *
   * 真身住在运行态（`run.todos`），落库在会话上（`thread.todos`）。
   * 三处必须一起改：只改运行态，刷新就丢；只改会话，界面不会跟着动。
   */
  const [todos, setTodos] = useState<AgentTodoItem[]>([]);

  const saveTodos = useCallback(
    async (next: AgentTodoItem[]) => {
      const run = runRef.current;
      if (run) run.todos = next;
      setTodos(next);
      const cur = threadRef.current;
      if (!cur) return;
      // 本来就没有、这次也没有：不必为一份空清单白写一次库
      if (!(cur.todos ?? []).length && !next.length) return;
      const th: ChatThread = { ...cur, todos: next, updatedAt: now() };
      threadRef.current = th;
      await store.saveThread(th);
    },
    [store],
  );

  // 会话对象按 id 从库里取，而不是由页面塞进来：页面会卸载、会重挂，
  // 而运行器始终待在同一个地方。跑着的时候不去碰它 —— 循环自己持有最新副本，
  // 被外面那份（可能已经过期的）盖掉会让刚写进去的几轮凭空消失。
  useEffect(() => {
    if (runRef.current) return;
    if (!attachedId) {
      threadRef.current = null;
      return;
    }
    if (threadRef.current?.id === attachedId) return;
    threadRef.current = threadsRef.current.find((th) => th.id === attachedId) ?? null;
    // 换了会话：上一个会话的待拍板批次和半句预览都不该跟过来
    setPending(null);
    setPhase('idle');
    setStream('');
    // 清单挂在会话上，所以换会话要跟着换；刷新回来也一样能从会话里读回来
    setTodos(threadRef.current?.todos ?? []);
  }, [attachedId, store.threads]);

  const setMode = useCallback((next: AgentMode) => {
    try {
      localStorage.setItem(MODE_KEY, next);
    } catch {
      /* ignore */
    }
    setModeState(next);
  }, []);

  /** 写操作之后重新取一份数据快照（只读，不改任何东西） */
  const refreshLive = useCallback(async () => {
    const base = liveRef.current;
    const loaded: Partial<StoreValue> = {};
    const bucket: Record<string, unknown[]> = {};
    for (const name of STORE_NAMES) {
      const items = await base.storage.getAll<{ id: string }>(name);
      bucket[name] = items;
    }
    const worlds = bucket.worlds as StoreValue['db']['worlds'];
    const wid = base.settings.activeWorldId;
    const activeWorld = worlds.find((w) => w.id === wid) ?? worlds[0] ?? null;
    const wid2 = activeWorld?.id;

    loaded.db = { ...base.db, ...(bucket as unknown as StoreValue['db']) };
    loaded.activeWorld = activeWorld;
    loaded.categories = (bucket.categories as StoreValue['categories'])
      .filter((c) => c.worldId === wid2)
      .sort((a, b) => a.order - b.order);
    loaded.entries = (bucket.entries as StoreValue['entries'])
      .filter((e) => e.worldId === wid2)
      .sort((a, b) => b.updatedAt - a.updatedAt);
    loaded.relations = (bucket.relations as StoreValue['relations']).filter(
      (r) => r.worldId === wid2,
    );
    loaded.docs = (bucket.docs as StoreValue['docs']).filter((d) => d.worldId === wid2);
    loaded.pieces = (bucket.pieces as StoreValue['pieces']).filter((p) => p.worldId === wid2);
    const review = (bucket.review as StoreValue['review']).filter((r) => r.worldId === wid2);
    loaded.review = review;
    loaded.pendingReview = review.filter((r) => r.status === 'pending') as ReviewItem[];
    loaded.ops = (bucket.ops as OpLog[])
      .filter((o) => o.worldId === wid2 || o.worldId === null)
      .sort((a, b) => b.createdAt - a.createdAt);

    liveRef.current = { ...base, ...loaded } as StoreValue;
  }, []);

  /* ---------------- 会话落库（自己持有最新副本） ---------------- */

  const pushTurn = useCallback(
    async (turn: ChatTurn) => {
      const cur = threadRef.current;
      if (!cur) return;
      const next: ChatThread = { ...cur, turns: [...cur.turns, turn], updatedAt: now() };
      threadRef.current = next;
      await store.saveThread(next);
    },
    [store],
  );

  const patchTurn = useCallback(
    async (turnId: ID, patch: Partial<ChatTurn>) => {
      const cur = threadRef.current;
      if (!cur) return;
      const next: ChatThread = {
        ...cur,
        turns: cur.turns.map((t) => (t.id === turnId ? { ...t, ...patch } : t)),
        updatedAt: now(),
      };
      threadRef.current = next;
      await store.saveThread(next);
    },
    [store],
  );

  /* ---------------- 执行一批动作 ---------------- */

  const execute = useCallback(
    async (
      run: RunState,
      turnId: ID,
      actions: AgentAction[],
      calls: AgentToolCall[],
      resultPhase: ResultPhase,
    ): Promise<{ results: StepResult[]; halted: boolean }> => {
      const results: StepResult[] = [];
      const working = [...calls];

      for (let i = 0; i < actions.length; i++) {
        const action = actions[i];
        const tool = findTool(action.tool);
        /**
         * 参数先归一。
         *
         * 模型把 `entry` 写成 `title`、`query` 写成 `keyword` 是常态，而工具内部只读规范名，
         * 读不到就等于「没传」—— 于是报出「缺少标题」这种看起来像它漏传、其实它明明写了的错。
         * 签名也按归一后的参数算：同一个动作换个名字写，还是同一个动作。
         */
        const args = tool ? normalizeArgs(tool, action.args) : action.args;
        let outcome: ToolOutcome;
        let opIds: ID[] = [];
        const sig = signature(action.tool, args);

        const badCall = tool ? checkRequired(tool, args) : null;
        /**
         * 同一个工具、同一套参数，**这次交代里已经成功跑过一遍**，并且那之后库没被改过。
         * 两个条件缺一不可：
         *   - 只看「成功过」的：失败的动作前提可能已经变了，重试是正当的；
         *   - 只看「库没变」的：写操作之后，同一个查询的答案本来就该不一样。
         */
        const prev = run.signatures.get(sig);
        const repeated = prev !== undefined && prev.rev === run.worldRev;
        if (!tool) {
          outcome = {
            ok: false,
            summary: tGlobal('agent.fail.unknownTool', { name: action.tool }),
            // 工具名认不出也是「调用写错」，不是「查不到」
            badCall: true,
          };
        } else if (badCall) {
          // 必填项缺了。这里刻意**不**记签名：模型照着报错把参数补上重试是本轮该发生的事，
          // 拦成「重复」反而会让它读不到那句「这个工具认哪些参数名」的提示。
          outcome = badCall;
        } else if (repeated) {
          // 拦下它并把**上一次的真结果**引出来：只写「这步做过了」的话，模型会自己
          // 脑补成「它已经办好了」——真实翻车就是这样，它随后对作者宣称
          // 「这些条目的创建请求已经在审查队列中了」，而队列里其实一条都没有。
          outcome = {
            ok: false,
            summary: tGlobal('agent.fail.repeated', { prev: prev.summary }),
            empty: true,
          };
        } else {
          // 上一个动作可能是写操作，这里的快照得是新的
          if (dirtyRef.current) {
            await refreshLive();
            dirtyRef.current = false;
          }
          const live = liveRef.current;
          const ctx: AgentContext = {
            store: live,
            sessionId: run.sessionId,
            why: action.why,
            // 作者按「停止」时能一路传到工具里。批量打磨一跑就是十几次模型往返，
            // 没有这条信号，他按了停止也只能看着它继续烧 token。
            signal: abortRef.current?.signal,
          };
          try {
            const r = await live.withActor(
              'agent',
              () => tool.run(ctx, args),
              run.sessionId,
            );
            outcome = r.value;
            opIds = r.opIds;
          } catch (e) {
            outcome = {
              ok: false,
              summary: (e as Error).message || tGlobal('ai.err.unknown'),
            };
          }
          // 签名**跑完才记，而且只记成功的**：失败过的允许重试（前提可能已经变了），
          // 这跟「没传必填项」是同一个道理 —— 拦住的代价远大于多跑一次。
          if (outcome.ok) run.signatures.set(sig, { summary: outcome.summary, rev: run.worldRev });
          else run.signatures.delete(sig);
        }

        if (tool?.risk === 'write' && outcome.ok) {
          dirtyRef.current = true;
          // 库变了：这之前的签名一律作废 —— 同一个查询现在可能给出不同的答案
          run.worldRev++;
        }
        // 三种「没收获」：失败、零命中、原地重复。有没有收获是模型够不够聪明的分水岭，
        // 也是这个循环唯一能自己判断的事 —— 所以这里数准它。
        if (!outcome.ok || outcome.empty) run.stalls++;
        // 再单独数一份「写错了的」：这类失败该改调用，不该去问作者。
        if (outcome.badCall) run.badCalls++;

        working[i] = {
          ...working[i],
          status: outcome.ok ? 'done' : 'failed',
          result: outcome.summary,
          opIds: opIds.length ? opIds : undefined,
          review: outcome.proposal || undefined,
        };
        results.push({
          action,
          call: working[i],
          ok: outcome.ok,
          empty: outcome.empty,
          badCall: outcome.badCall,
          data: outcome.data,
        });

        // 边做边把回执刷到对话里：10 秒的空窗比「慢」更让人不安
        await patchTurn(turnId, { calls: [...working], pending: null });

        if (tool?.terminal && outcome.ok) {
          // 它把话交回给作者了 —— 本轮到此为止。
          // 后面那些动作多半建立在「作者会怎么回答」的假设上，假设一错就全是白工，
          // 还得再撤一遍。所以一律不执行，标成跳过。
          for (let j = i + 1; j < actions.length; j++) {
            working[j] = {
              ...working[j],
              status: 'skipped',
              result: tGlobal('agent.sys.resultSkipped'),
            };
          }
          await patchTurn(turnId, { calls: [...working], pending: null });
          return { results, halted: true };
        }
      }

      // 结果里没有实际改动时，把这一步的 pending 彻底清掉
      void resultPhase;
      return { results, halted: false };
    },
    [patchTurn, refreshLive],
  );

  /* ---------------- 主循环 ---------------- */

  const stepLoop = useCallback(async () => {
    const run = runRef.current;
    if (!run) return;
    const cfg = store.settings.ai;

    while (run.step < MAX_STEPS) {
      run.step++;
      setPhase('thinking');
      setStream('');

      if (dirtyRef.current) {
        await refreshLive();
        dirtyRef.current = false;
      }
      const live = liveRef.current;

      const system = buildAgentSystemPrompt({
        world: live.activeWorld,
        entries: live.entries,
        categories: live.categories,
        pendingReview: live.pendingReview.length,
        // 它自己立的清单每轮都回到它眼前 —— 否则多轮之后它就把「还剩什么」忘了，
        // 只知道「我刚才读过几条」。作者在界面上看到的进度，必须是它能看见的那一份。
        todos: run.todos,
        // 上一次交代里聊过的话。「没有上下文记忆」就是这么补的：
        // 每次发问对它来说都该是**接着聊**，而不是第一次见面。
        recentTurns: run.recentTurns,
        recentOps: live.ops.slice(0, 12).map((o) => ({
          action: o.action,
          entity: o.entity,
          target: o.target,
          detail: o.undone ? tGlobal('log.undone') : o.detail,
        })),
        mode,
      });

      const controller = new AbortController();
      abortRef.current = controller;
      let flown = '';
      let raw = '';
      try {
        raw = await chat(
          cfg,
          [{ role: 'system', content: system }, ...run.history],
          {
            // 边流边把 say 抠出来给作者看，别让他盯着一个转圈
            onDelta: (d) => {
              flown += d;
              setStream(partialSay(flown) || '');
            },
            signal: controller.signal,
          },
        );
      } catch (e) {
        abortRef.current = null;
        const msg = (e as Error).message || tGlobal('ai.err.unknown');
        if (!/aborted|AbortError/i.test(msg)) toast.error(msg);
        setPhase('idle');
        setStream('');
        runRef.current = null;
        return;
      }
      abortRef.current = null;

      const reply = parseAgentReply(raw);
      // 这一轮没照协议来、而且还没纠过 —— 待会儿要请它重说一遍。
      // 先把「打算怎么处置」定下来再落 turn：界面上的措辞要一次说准，不能回头再翻。
      const willRetry = reply.protocolBroken && !run.repaired;
      // 这一轮是不是「问作者」。提问由它的问句本身承载，不需要 say 再复述一遍。
      const willAsk = reply.plan.some((a) => findTool(a.tool)?.terminal);
      /**
       * 这一轮是不是**把话交回给作者**了（收工，或者抛一个问题）。
       *
       * 下一步建议只在这时候才算数。手上还有动作在跑的时候，任何「接下来你可以…」
       * 都是噪音 —— 作者连结果都还没看到，先看到一排按钮，只会以为它又要自作主张。
       */
      const settling =
        reply.plan.length === 0 || reply.plan.every((a) => findTool(a.tool)?.terminal === true);
      const calls: AgentToolCall[] = reply.plan.map((a) => ({
        id: uid('tc'),
        tool: a.tool,
        args: a.args,
        why: a.why,
        status: 'pending',
        result: '',
      }));
      const turn: ChatTurn = {
        id: uid('ct'),
        role: 'assistant',
        // 只有动作、一句话都没有的轮次给个占位，免得留一个空气泡
        content: reply.say || (calls.length && !willAsk ? tGlobal('agent.fallback.planOnly') : ''),
        cites: extractCites(reply.say, live.entries),
        calls: calls.length ? calls : undefined,
        pending: null,
        // 它交回话时顺手给的「下一步可以做点什么」。界面把它渲染成一排一点就跑的按钮 ——
        // 作者抱怨的正是「它答完就完了，接着问什么得我自己想」。
        suggest: settling && reply.suggest.length ? reply.suggest : undefined,
        // 三态的要紧处是**如实**：修好了照常执行，但得让作者知道它不是照约定写出来的
        protocolBroken: reply.salvaged
          ? 'repaired'
          : reply.protocolBroken
            ? willRetry
              ? 'retried'
              : 'gaveUp'
            : undefined,
        createdAt: now(),
      };
      await pushTurn(turn);
      // 把模型原话按原样回灌，协议才对得上
      run.history.push({ role: 'assistant', content: raw });
      setStream('');

      /**
       * 清单：它给了就换一份（自己的账，允许随时重排）。
       *
       * 少掉的那些**未完成项**要单独数一份 —— 因为「删清单」是最省事的糊弄法：
       * 把没做的事从表上划掉，看上去就全干完了。所以这里如实记一笔，
       * 下一步回灌时连同结果一起告诉它（也让作者能在回执里看见）。
       */
      let droppedTodo = 0;
      if (reply.todosGiven) {
        droppedTodo = run.todos.filter(
          (t) => !t.done && !reply.todos.some((n) => n.text === t.text),
        ).length;
        await saveTodos(reply.todos);
      }

      if (!reply.plan.length) {
        // 没给动作，而且这一轮压根没照 JSON 协议来 —— 如果就此收工，
        // 作者看到的就是「它说完了，然后什么都没发生」，也分不清是模型不想做
        // 还是格式没对上。所以给它一次重说的机会（每个问题只纠一次）。
        if (willRetry) {
          run.repaired = true;
          run.history.push({ role: 'user', content: tGlobal('agent.sys.repair') });
          continue;
        }

        const left = run.todos.filter((t) => !t.done);
        if (left.length) {
          // 清单上还剩东西 —— 不许收工。
          // 这是「清点式」任务最容易烂掉的地方：读了几条、感觉差不多了、说句
          // 「接下来我将继续」就停住，作者拿到的是半成品，还无从知道漏了多少。
          if (run.todoNudges < TODO_NUDGE_MAX) {
            run.todoNudges++;
            run.history.push({
              role: 'user',
              content: tGlobal('agent.sys.todoNudge', {
                n: left.length,
                list: todoLines(left),
              }),
            });
            continue;
          }
          // 催过了还不做：如实收尾，把还剩几条摆出来，别假装干完了
          await pushTurn({
            id: uid('ct'),
            role: 'assistant',
            content: tGlobal('agent.err.todoLeft', {
              n: left.length,
              list: todoLines(left),
            }),
            todoLeft: left.length,
            createdAt: now(),
          });
          setPhase('idle');
          runRef.current = null;
          return;
        }

        // 清单空了，但它这一轮**说的是「我接着做」、却一个动作都没给**。
        // 「做完了」和「说到一半停了」光看「plan 为空」是分不出来的，所以要么它
        // 明说 done:true，要么有一个动作；两样都没有、话里又是承诺，就说破一次。
        if (!reply.done && run.promiseNudges < PROMISE_NUDGE_MAX && looksLikePromise(reply.say)) {
          run.promiseNudges++;
          run.history.push({ role: 'user', content: tGlobal('agent.sys.promiseNudge') });
          continue;
        }
        // 说破过还是这样 —— 它多半是真收了尾，但它上一条话里留着一个没兑现的承诺。
        // 这一句得补上，不然作者会一直等一个不会来的下一轮。
        if (!reply.done && looksLikePromise(reply.say)) {
          await pushTurn({
            id: uid('ct'),
            role: 'assistant',
            content: tGlobal('agent.err.promised'),
            promised: true,
            createdAt: now(),
          });
        }
        setPhase('idle');
        runRef.current = null;
        return;
      }

      // 需要作者点头才做的那些动作。
      // 「问作者」不算：拦住一个提问，等于要作者先批准它提问，说不通 ——
      // 而且作者本来就正等着这个问题。
      const gated = reply.plan.filter((a) => !findTool(a.tool)?.terminal);
      // 计划模式：整份计划都要先过目（连查询也算，这就是「计划」的含义）
      // 混合模式：查直接做，改数据才问
      // 直接执行：什么都不问
      const held =
        gated.length === 0
          ? false
          : mode === 'plan'
            ? true
            : mode === 'hybrid'
              ? gated.some((a) => findTool(a.tool)?.risk === 'write')
              : false;

      if (held) {
        run.awaiting = { turnId: turn.id, actions: reply.plan, calls };
        await patchTurn(turn.id, { pending: { calls } });
        setPending({ turnId: turn.id, calls });
        setPhase('awaiting');
        return;
      }

      const { results, halted } = await execute(run, turn.id, reply.plan, calls, 'auto');
      if (halted) {
        // 它把话交回给作者了。等他的回答，本轮结束。
        setPhase('idle');
        runRef.current = null;
        return;
      }

      // 护栏：连着几步颗粒无收。
      // 先提醒一次，让它自己开口问；提醒过还不改，就停下来说实话 ——
      // 「它一直在查但什么都没发生」是作者最没法处理的状态。
      // 但「没收获」有两种，给的建议正好相反：查不到要它去问作者，
      // 动作写错了要它照参数名重写。所以这里分开说，不许混。
      const driven = badCallDriven(run);
      if (run.stalls >= STALL_STOP) {
        await pushTurn({
          id: uid('ct'),
          role: 'assistant',
          content: tGlobal(driven ? 'agent.err.stuckBadCall' : 'agent.err.stuck'),
          stuck: driven ? 'badCall' : 'empty',
          createdAt: now(),
        });
        setPhase('idle');
        runRef.current = null;
        return;
      }
      if (run.stalls >= STALL_NUDGE && !run.nudged) {
        run.nudged = true;
        run.history.push({
          role: 'user',
          content: tGlobal(driven ? 'agent.sys.badCallNudge' : 'agent.sys.stuckNudge'),
        });
        continue;
      }

      run.history.push({
        role: 'user',
        content: buildResultMessage(
          results,
          'auto',
          // 它把没做的项从清单上划掉了：这件事必须说破，不然「删清单」就成了
          // 最省事的假装做完，而作者看到的是一份漂亮的空表
          droppedTodo > 0 ? tGlobal('agent.sys.todoCleared', { n: droppedTodo }) : '',
        ),
      });
    }

    await pushTurn({
      id: uid('ct'),
      role: 'assistant',
      content: run.todos.some((t) => !t.done)
        ? tGlobal('agent.err.maxStepsTodo', {
            n: run.todos.filter((t) => !t.done).length,
            list: todoLines(run.todos.filter((t) => !t.done)),
          })
        : tGlobal('agent.err.maxSteps'),
      todoLeft: run.todos.filter((t) => !t.done).length || undefined,
      // 这一句是循环说的，不是它说的 —— 记一笔，免得下一轮把它当「自己讲过的话」带进语境
      exhausted: true,
      createdAt: now(),
    });
    setPhase('idle');
    runRef.current = null;
  }, [mode, store, toast, pushTurn, patchTurn, execute, refreshLive, saveTodos]);

  /* ---------------- 对外动作 ---------------- */

  const send = useCallback(
    async (goal: string, threadId: ID) => {
      const text = goal.trim();
      if (!text || phase !== 'idle') return;
      const check = aiConfigured(store.settings.ai);
      if (!check.ok) {
        toast.error(tGlobal(check.reason!));
        return;
      }

      // 轮次要写进**它自己那一段**会话。页面传进来的 id 优先（那是作者正看着的），
      // 找不到才退回当前挂着的那段 —— 免得页面刚切过去、threadRef 还没跟上时写到别处。
      const th = threadsRef.current.find((x) => x.id === threadId) ?? threadRef.current;
      if (!th) return;
      /*
       * 语境取「这次交代之前」的对话，而且**谁新用谁**。
       *
       * `threadRef` 里那份是循环自己一路写下来的，`store.threads` 要等库重新读回来才更新；
       * 上一趟刚跑完、store 还没跟上时，用 store 那份当语境会少掉刚聊过的那一句。
       */
      const latest =
        threadRef.current?.id === th.id && threadRef.current.turns.length >= th.turns.length
          ? threadRef.current
          : th;
      const recentTurns = recentContext(latest.turns ?? []);
      threadRef.current = th;

      await pushTurn({ id: uid('ct'), role: 'user', content: text, createdAt: now() });
      runRef.current = {
        threadId,
        sessionId: uid('ag'),
        history: [{ role: 'user', content: buildGoalMessage(text) }],
        recentTurns,
        step: 0,
        awaiting: null,
        repaired: false,
        signatures: new Map(),
        worldRev: 0,
        // 清单归**这一次交代**管：新的交代从头立账，上一趟的账不该在这里继续催
        // （上一趟做到哪儿，它自己的那些轮次里写着）。
        todos: [],
        stalls: 0,
        badCalls: 0,
        nudged: false,
        todoNudges: 0,
        promiseNudges: 0,
      };
      await saveTodos([]);
      dirtyRef.current = true;
      await stepLoop();
    },
    [phase, store.settings.ai, toast, pushTurn, stepLoop, saveTodos],
  );

  const approve = useCallback(async () => {
    const run = runRef.current;
    const aw = run?.awaiting;
    if (!run || !aw) return;
    run.awaiting = null;
    setPending(null);
    setPhase('thinking');
    const { results, halted } = await execute(run, aw.turnId, aw.actions, aw.calls, 'approved');
    if (halted) {
      // 这批里有一步是「问作者」，执行到它就结束了 —— 等他的回答
      setPhase('idle');
      runRef.current = null;
      return;
    }
    run.history.push({ role: 'user', content: buildResultMessage(results, 'approved') });
    await stepLoop();
  }, [execute, stepLoop]);

  const reject = useCallback(async () => {
    const run = runRef.current;
    const aw = run?.awaiting;
    if (!run || !aw) return;
    run.awaiting = null;
    setPending(null);

    const skipped: AgentToolCall[] = aw.calls.map((c) => ({
      ...c,
      status: 'skipped',
      result: tGlobal('agent.sys.resultSkipped'),
    }));
    await patchTurn(aw.turnId, { calls: skipped, pending: null });
    run.history.push({
      role: 'user',
      content: buildResultMessage(
        skipped.map((c, i) => ({ action: aw.actions[i], call: c, ok: false })),
        'skipped',
      ),
    });
    await stepLoop();
  }, [patchTurn, stepLoop]);

  const abort = useCallback(async () => {
    const aw = runRef.current?.awaiting;
    if (aw) {
      // 等拍板时按「停止」= 这批不做了。这里刻意不走 reject()：
      // 那个会把「被跳过」回灌给模型、再开一轮，而作者此刻要的是停下来。
      runRef.current = null;
      setPending(null);
      setPhase('idle');
      setStream('');
      const skipped: AgentToolCall[] = aw.calls.map((c) => ({
        ...c,
        status: 'skipped',
        result: tGlobal('agent.sys.resultSkipped'),
      }));
      await patchTurn(aw.turnId, { calls: skipped, pending: null });
      return;
    }
    abortRef.current?.abort();
    abortRef.current = null;
    runRef.current = null;
    setPending(null);
    setPhase('idle');
    setStream('');
  }, [patchTurn]);

  /* ---------------- 让侧栏知道「这一页正在干活」 ---------------- */

  // agent 的运行态住在运行器里，而侧栏读的是全局任务表。这里把「忙不忙」镜像过去，
  // 侧栏就只需要认识一个来源 —— 将来再加一处 AI 也不必动侧栏。
  // 只镜「真的在跑」（thinking）。等作者拍板不算在忙：那时该做的是让按钮可点，
  // 而不是让侧栏一直转圈催他。
  useEffect(() => {
    const mirrored = taskOf(AGENT_TASK_KEY);
    if (phase === 'thinking') {
      if (mirrored.phase !== 'running') {
        startTask(AGENT_TASK_KEY, 'studio', store.settings.activeWorldId ?? null);
      }
      setTaskStream(AGENT_TASK_KEY, stream);
      return;
    }
    if (mirrored.phase === 'running') finishTask(AGENT_TASK_KEY);
  }, [phase, stream, store.settings.activeWorldId]);

  return {
    mode,
    setMode,
    phase,
    /** 正在生成中的那半句 say，用于即时反馈 */
    stream,
    /** 等作者拍板的一批动作 */
    pending,
    /**
     * 这一次交代的待办清单（含已完成/未完成）。
     *
     * 界面照着它渲染那块「交代清单」—— 它是**模型自己立的账**，
     * 不是界面替它演的进度条：模型改了它就会变，它没立就是空的。
     */
    todos,
    /** 页面挂载/切换会话时调用，告诉运行器现在看的是哪一段 */
    attach,
    /**
     * 「真的在跑」—— 只有 thinking 算忙。
     *
     * 这里刻意不等同于 `phase !== 'idle'`：等作者拍板时 phase 是 awaiting，
     * 那时「执行 / 跳过」的按钮恰恰必须可点。如果把它们算成忙，
     * 按钮会把自己禁掉，整批动作就永远卡在那里没人能动。
     */
    busy: phase === 'thinking',
    /** 「有未决的事」—— 换模式、开新对话这类动作该在这时避开 */
    locked: phase !== 'idle',
    send,
    approve,
    reject,
    abort,
  };
}
