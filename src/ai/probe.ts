/**
 * 型号可用性探测。
 *
 * **为什么需要它。** `GET /models` 只回答「这把钥匙**账面上**能用哪些型号」——
 * 它不是「能不能真的跑通」。中转站尤其如此：清单里躺着几十个型号，其中一部分会回
 * `402 Sorry, your account balance is insufficient.`，而作者往往是在**已经坐下来开始写**
 * 之后才发现 —— 那时才去找原因，成本高得多。
 *
 * 所以：清单到手就**自动逐个探一次**，用一个极短的对话请求（`max_tokens: 1`）确认它真能回话。
 * 结论在列表每一项旁边用小竖条表示。
 *
 * 四条纪律（都是在别的模块踩过、这里必须提前守住的）：
 *
 *   1. **只有真的拿到回复才算可用。** 2xx 但内容为空、或回了一坨别的东西，都不算 ——
 *      这是「测试成功」唯一的判据，也是作者明确要的那条。
 *   2. **「余额不足」和「这个型号没有」必须分开。** 前者充钱就好、后者换型号就好；
 *      给反了建议，作者会去做一件解决不了当前问题的事。
 *   3. **「没探完」不等于「不可用」。** 被中止、还没轮到的，一律不写结论 ——
 *      宁可不显示，也不能把「我不知道」画成红的（那是凭空多出来的一条错信息）。
 *   4. **探不动就别硬探。** 连着几个都是「连不上」，说明是渠道/网络断了，
 *      再打完剩下几十个只是白等一遍，还看不出新东西。停手并如实说。
 *
 * 本文件是纯逻辑 + 一个执行器；**不 import React、不 import 语言包本体**
 * （非 React 层只能从 `../i18n/translate` 取 `tGlobal`）。
 */
import type { AISettings } from '../types';
import { AIError, chat } from './client';
import { tGlobal } from '../i18n/translate';
import type { ModelInfo } from './models';

export type ProbeState =
  /** 真的回话了 —— 唯一算「可用」的状态 */
  | 'ok'
  /** 渠道报余额 / 额度不足（402，或文案里说了但状态码乱写） */
  | 'noBalance'
  /** 这把钥匙没通过鉴权 */
  | 'noAuth'
  /** 这个型号不存在 / 不被支持 */
  | 'noModel'
  /** 被限流（不代表不能用，只是现在不行） */
  | 'rateLimited'
  /** 厂商服务端出错 */
  | 'serverError'
  /** 通了，但回的既不是对话内容也不是明确错误 */
  | 'noContent'
  /** 连不上（网络 / 转发 / 超时） */
  | 'unreachable'
  /** 没得出结论 */
  | 'unknown';

export interface ProbeResult {
  state: ProbeState;
  /** 厂商原话（排查的唯一线索），界面挂在小竖条的悬停说明里 */
  detail?: string;
  at: number;
}

/** 缓存多久算新鲜。清单变动慢，但**余额会变** —— 所以这个值不能太长 */
export const PROBE_TTL = 24 * 60 * 60 * 1000;

/**
 * 一轮自动探测**默认**最多打多少条。
 *
 * 为什么默认是 40（而不是「全打一遍」）：
 * ① 每一次探测都是**一条真实的对话请求**，作者为此付钱、厂商为此计数；聚合站的清单动辄
 *    一两百条，全打一遍就是拿一堆自己根本不会用的型号去敲门；
 * ② 更要紧的是**限流**：中转站在并发和短时总量上都比在长期总量上翻脸快得多，而一旦被
 *    限流，耽误的是作者真正想干的活（他自己那几轮对话）；
 * ③ 被截掉的那些**不是丢弃** —— `planProbe` 会把它们报成 `pending`，界面上写着
 *    「还有 N 个没探」，作者点「重新探测」接着来。
 *
 * 这个数**只是默认值**：作者可以在探测那一行改成任意条数，或者勾「不限制」把整份清单
 * 探完（`resolveProbeLimit`）。默认值保守、上限交给他自己定，是这里唯一说得通的取舍。
 */
export const PROBE_LIMIT = 40;

/** 自定义上限时的下限。0 或负数没有意义（那等于「探 0 条」，但界面另有「停止」） */
export const PROBE_LIMIT_MIN = 1;

/** 同时打几个。不能太高：中转站在并发上翻脸比在总量上快得多 */
export const PROBE_CONCURRENCY = 3;

/** 连着几条「连不上」就认定是渠道问题、停止这一轮 */
export const PROBE_UNREACHABLE_STREAK = 3;

/* ------------------------------------------------------------------ */
/* 小竖条的色调 —— CSS 只认这三档，状态名字将来再加也不用动样式        */
/* ------------------------------------------------------------------ */

export type ProbeTone = 'ok' | 'warn' | 'bad' | 'idle' | 'busy';

export function toneOf(state: ProbeState | undefined): ProbeTone {
  if (!state) return 'idle';
  if (state === 'ok') return 'ok';
  // 余额不足单独一档：它「不是这个型号的错」，作者要做的事也和别的不一样（去充钱）
  if (state === 'noBalance') return 'warn';
  return 'bad';
}

/* ------------------------------------------------------------------ */
/* 判据                                                                */
/* ------------------------------------------------------------------ */

/**
 * 文案里的关键词。
 *
 * **为什么不能只看状态码。** 现实中转站把「余额不足」回成 400 / 429 / 500 的都有，
 * 而 402 也有被网关改写成 403 的。所以：**先看文案，再看状态码**。
 */
const AUTH_RE =
  /unauthor|invalid[ _-]?api[ _-]?key|authentication|invalid[ _-]?token|permission|forbidden|鉴权|密钥|未授权|无权限/i;
const BALANCE_RE =
  /insufficient|balance|quota|credit|billing|arrears|exceeded your current|欠费|余额|额度|没钱|充值/i;
const NO_MODEL_RE =
  /no such model|unknown model|invalid model|model[^.]{0,24}(not|un)(exist|found|available|support)|does not exist|not supported|不存在|没有这个模型|不支持的模型|无法找到该模型/i;
/**
 * 「连不上」这一类。
 *
 * 最后那几条是**网关自己的话**（Envoy / Istio / nginx）：目标不可达时它回的是
 * `502 upstream connect error or disconnect/reset before headers`，而不是浏览器那句
 * `Failed to fetch`。只看浏览器的话术会把「渠道断了」误判成「厂商服务端出错」，
 * 而这两件事要做的事不一样（前者去查地址/网络，后者只能等）。
 */
const NET_RE =
  /failed to fetch|networkerror|network error|load failed|\bnet::|timeout|timed out|econn|socket|dns|连接|网络|超时|connect error|connection (refused|reset|failure|timed out)|disconnect\/reset|reset before headers|upstream connect|no route to host|getaddrinfo|unreachable/i;

/** 中止不是失败 —— 调用方靠它把「作者按了停止」与「探不通」分开 */
export function isAbort(e: unknown): boolean {
  if (e instanceof DOMException && e.name === 'AbortError') return true;
  return /abort/i.test((e as Error)?.name ?? '') || /aborted/i.test((e as Error)?.message ?? '');
}

export interface ProbeEvidence {
  /** 拿到回复时的正文。**非空才算可用** */
  content?: string;
  /** 出错时的 HTTP 状态码（有的话） */
  status?: number;
  /** 出错时的那句话 */
  message?: string;
}

/**
 * 把「这一趟的结果」判成一个状态。
 *
 * 顺序是刻意的：**有正文 → 先判鉴权 → 再判余额 → 最后按状态码**。
 * 鉴权排在余额前面，是因为「insufficient permissions」这类文案会被余额的正则命中，
 * 而它其实是权限问题 —— 顺序反了就会让作者去充钱。
 */
export function classifyProbe(ev: ProbeEvidence): { state: ProbeState; detail?: string } {
  const content = (ev.content ?? '').trim();
  if (content) return { state: 'ok' };

  const msg = (ev.message ?? '').trim();
  // 去掉我们自己套上去的那层壳（`模型返回 402：…`），只拿厂商原话做判断，
  // 免得壳里的字（比如「连接」）把结论带偏
  const raw = msg.replace(/^[^：:]{0,24}[：:]\s*/, '') || msg;
  const hay = `${msg} ${raw}`;

  if (AUTH_RE.test(hay)) return { state: 'noAuth', detail: raw.slice(0, 200) || undefined };
  if (BALANCE_RE.test(hay)) return { state: 'noBalance', detail: raw.slice(0, 200) || undefined };
  if (NO_MODEL_RE.test(hay)) return { state: 'noModel', detail: raw.slice(0, 200) || undefined };

  /*
   * **「连不上」必须排在状态码之前。**
   *
   * 网关在目标不可达时回的是 `502`，而消息里写着 `upstream connect error` ——
   * 它就是一件连接问题。按状态码先判的话会被 `>= 500` 抢成「厂商服务端出错」，
   * 于是作者去等厂商修，而实际该查的是自己的地址/网络。
   * （反过来说，一条没有这类字样的 500 仍然算 serverError —— 顺序只影响带线索的那些。）
   */
  if (NET_RE.test(hay)) return { state: 'unreachable', detail: raw.slice(0, 200) || undefined };

  const s = ev.status;
  if (s === 402) return { state: 'noBalance', detail: raw.slice(0, 200) || undefined };
  if (s === 401 || s === 403) return { state: 'noAuth', detail: raw.slice(0, 200) || undefined };
  if (s === 404) return { state: 'noModel', detail: raw.slice(0, 200) || undefined };
  if (s === 429) return { state: 'rateLimited', detail: raw.slice(0, 200) || undefined };
  if (typeof s === 'number' && s >= 500) return { state: 'serverError', detail: raw.slice(0, 200) || undefined };

  /*
   * **没有 HTTP 状态码 = 这一趟是应用层自己抛的。**
   *
   * 排除了上面几类之后，剩下的就是那一种：请求发出去了、也回来了，但拿回来的东西
   * 谁都读不懂 —— `chat()` 抛的「模型返回格式异常」（2xx 但 `choices[0].message.content`
   * 是空的，或干脆不是对话结构）。它**不是「未知」**：这种型号就是不能用来对话，
   * 灰不溜秋地放着等于让作者以为「可能能用」。所以归到 `noContent`（红）。
   *
   * 真正什么都不带的（连一句话都没有）才留给 `unknown`。
   */
  if (!s) {
    return raw
      ? { state: 'noContent', detail: raw.slice(0, 200) }
      : { state: 'unknown', detail: undefined };
  }
  return { state: 'noContent', detail: raw.slice(0, 200) || undefined };
}

/* ------------------------------------------------------------------ */
/* 该探哪些                                                            */
/* ------------------------------------------------------------------ */

export type ProbeMap = Record<string, ProbeResult>;

export function freshResults(map: ProbeMap, now = Date.now()): ProbeMap {
  const out: ProbeMap = {};
  for (const [id, r] of Object.entries(map)) {
    if (r && now - r.at < PROBE_TTL) out[id] = r;
  }
  return out;
}

/**
 * 这一份清单里「还没结论、且值得探」的型号。
 *
 * 单独拎出来，是因为界面上有两个**语义不同**的问题要问它：
 * 「现在还有多少个没结论」（拿它的长度）和「这一轮该探哪几条」（`planProbe`）。
 * 早先只有一个 `planProbe(...).pending`，它的意思是「这一轮打完之后还剩多少」——
 * 拿它去回答前一个问题，就会出现「还剩 5 条没探，界面却说还有 3 条」这种自相矛盾的话。
 */
export function probeCandidates(models: ModelInfo[], results: ProbeMap, now = Date.now()): ModelInfo[] {
  const fresh = freshResults(results, now);
  return models.filter((m) => !m.maybeNotChat && !fresh[m.id]);
}

/**
 * 挑出这一轮该探的型号。
 *
 * 三条筛选，各有理由：
 *   - **跳过「多半不是对话模型」的。** 向量 / 语音 / 画图那几类本来就回不了对话，
 *     探它们必然红 —— 列表里一片红看着像「渠道坏了」，其实是问错了问题。
 *   - **跳过已有新鲜结论的。** 这就是缓存的意义：重复打开面板不该重复打。
 *   - **截到上限。** 一两百条全打一遍，对真实厂商是骚扰、对中转站会触发限流。
 *     截断不是丢弃：界面会显示「还有 N 个没探」，作者自己决定要不要继续。
 *     上限由作者定，`Infinity`（勾了「不限制」）就是这一份清单全探。
 *
 * 返回的 `pending` 是**这一轮打完之后**还剩几条（不是「现在还剩几条」，那个问
 * `probeCandidates`）。
 */
export function planProbe(
  models: ModelInfo[],
  results: ProbeMap,
  limit = PROBE_LIMIT,
  now = Date.now(),
): { ids: string[]; pending: number } {
  const candidates = probeCandidates(models, results, now);
  const capped = Number.isFinite(limit) ? Math.max(0, Math.floor(limit)) : candidates.length;
  return {
    ids: candidates.slice(0, capped).map((m) => m.id),
    pending: Math.max(0, candidates.length - capped),
  };
}

/**
 * 从设置里算出这一轮的上限。
 *
 * 三个来源、一条优先级：**作者明确勾了「不限制」> 作者填的条数 > 默认值**。
 * 单独写成纯函数，是为了让「设置里填的数到底有没有生效」这件事能被单测钉住 ——
 * 否则它只在某次真实点击里才对得上，改坏了没人发现。
 *
 * 填了非法值（0、负数、NaN）时**回落到默认值**而不是回落到「不限制」：一个坏输入
 * 不该悄悄把请求量放大到整个清单。
 */
export function resolveProbeLimit(ai: Pick<AISettings, 'probeLimit' | 'probeUnlimited'>): number {
  if (ai.probeUnlimited) return Infinity;
  const n = ai.probeLimit;
  if (typeof n === 'number' && Number.isFinite(n) && n >= PROBE_LIMIT_MIN) return Math.floor(n);
  return PROBE_LIMIT;
}

/* ------------------------------------------------------------------ */
/* 缓存                                                                */
/* ------------------------------------------------------------------ */

const CACHE_PREFIX = 'worldforge:probe:';

/**
 * 钥匙的短指纹。
 *
 * 换个 Key 就是换了个账户，余额、权限全变了 —— 拿旧结论当新结论是最容易骗到人的。
 * 所以把它拌进缓存键里。用哈希而不是原文，只是为了别把钥匙再抄到另一个键名上。
 */
function fp(s: string): string {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return (h >>> 0).toString(36);
}

export function probeCacheKey(settings: AISettings): string {
  return `${CACHE_PREFIX}${settings.provider}@${settings.baseUrl.replace(/\/+$/, '')}@${fp(settings.apiKey ?? '')}`;
}

export function readProbeCache(settings: AISettings): ProbeMap {
  try {
    const raw = localStorage.getItem(probeCacheKey(settings));
    if (!raw) return {};
    const parsed = JSON.parse(raw) as ProbeMap;
    if (!parsed || typeof parsed !== 'object') return {};
    return freshResults(parsed);
  } catch {
    return {};
  }
}

export function writeProbeCache(settings: AISettings, map: ProbeMap): void {
  try {
    localStorage.setItem(probeCacheKey(settings), JSON.stringify(map));
  } catch {
    /* 存不下不影响这一次使用 */
  }
}

export function clearProbeCache(settings: AISettings): void {
  try {
    localStorage.removeItem(probeCacheKey(settings));
  } catch {
    /* ignore */
  }
}

/* ------------------------------------------------------------------ */
/* 执行器                                                              */
/* ------------------------------------------------------------------ */

/**
 * 探一个型号：发一条最短的对话请求。
 *
 * `maxTokens: 1` 是刻意的 —— 探测只关心「能不能回话」，不关心它回什么。
 * 内容也故意用一句无意义的话（`ai.probe.ping`，中英同值）：它不是给人读的，
 * 是「这一趟是探测」的标记，顺便让作者在渠道日志里一眼认出这些请求。
 */
export async function probeOne(
  settings: AISettings,
  model: string,
  signal?: AbortSignal,
): Promise<string> {
  return chat(
    { ...settings, model },
    [{ role: 'user', content: tGlobal('ai.probe.ping') }],
    { temperature: 0, maxTokens: 1, signal },
  );
}

export interface ProbeRunOutcome {
  /** 作者/上层按了停止 */
  aborted: boolean;
  /** 连着几条连不上，这一轮提前收手 */
  gaveUpUnreachable: boolean;
}

/**
 * 跑一轮探测：限并发、可中止、每出一条立刻回调。
 *
 * 边跑边回调（而不是攒完再给）是必要的：一两百条全探完要几十秒，
 * 攒完再显示等于让作者干等，而这期间界面上一片「未知」，看着像卡住了。
 */
export async function runProbe(
  settings: AISettings,
  ids: string[],
  opts: {
    signal: AbortSignal;
    onOne: (id: string, r: ProbeResult) => void;
    concurrency?: number;
    stopAfterUnreachable?: number;
  },
): Promise<ProbeRunOutcome> {
  const concurrency = Math.max(1, opts.concurrency ?? PROBE_CONCURRENCY);
  const streakLimit = Math.max(1, opts.stopAfterUnreachable ?? PROBE_UNREACHABLE_STREAK);

  const queue = [...ids];
  let streak = 0;
  let aborted = false;
  let gaveUp = false;

  const worker = async (): Promise<void> => {
    for (;;) {
      if (opts.signal.aborted) {
        aborted = true;
        return;
      }
      if (gaveUp) return;
      const id = queue.shift();
      if (id === undefined) return;

      let r: ProbeResult;
      try {
        const content = await probeOne(settings, id, opts.signal);
        // 走 classifyProbe 而不是直接写 ok：万一将来 chat() 对空内容放宽了，
        // 「只有真的拿到回复才算可用」这条纪律仍然在这一处守得住
        r = { ...classifyProbe({ content }), at: Date.now() };
      } catch (e) {
        if (opts.signal.aborted || isAbort(e)) {
          aborted = true;
          return;
        }
        r = {
          ...classifyProbe({ status: (e as AIError).status, message: (e as Error).message }),
          at: Date.now(),
        };
      }

      if (r.state === 'unreachable') {
        streak += 1;
        if (streak >= streakLimit) gaveUp = true;
      } else {
        streak = 0;
      }
      // 被中止后仍要把手上这条记下（它是真结论，不是猜测）
      opts.onOne(id, r);
    }
  };

  await Promise.all(Array.from({ length: Math.min(concurrency, queue.length) }, () => worker()));
  return { aborted, gaveUpUnreachable: gaveUp };
}

/* ------------------------------------------------------------------ */
/* 界面用的一句话                                                      */
/* ------------------------------------------------------------------ */

/** 每档结论对应的文案键。
 *  这里刻意写成**字面量表**而不是 `tGlobal(\`ai.probe.state.${state}\`)`：
 *  ① `.dev/unit-ai-config.mjs` 的「ai.* 没有孤儿键」守卫是拿字面量去源码里找引用的，
 *     拼出来的键它看不见 —— 会被判成死键（作者什么都没少写，却被说成没人用）；
 *  ② 以后给 `ProbeState` 加一档，TS 会在这里报少了一项，文案不会漏。 */
const STATE_KEY: Record<ProbeState | 'idle', string> = {
  idle: 'ai.probe.state.idle',
  ok: 'ai.probe.state.ok',
  noBalance: 'ai.probe.state.noBalance',
  noAuth: 'ai.probe.state.noAuth',
  noModel: 'ai.probe.state.noModel',
  rateLimited: 'ai.probe.state.rateLimited',
  serverError: 'ai.probe.state.serverError',
  noContent: 'ai.probe.state.noContent',
  unreachable: 'ai.probe.state.unreachable',
  unknown: 'ai.probe.state.unknown',
};

export function probeStateText(state: ProbeState): string {
  return tGlobal(STATE_KEY[state]);
}

/** 悬停说明：结论 + 厂商原话 */
export function probeTitle(r: ProbeResult | undefined): string {
  if (!r) return tGlobal('ai.probe.state.idle');
  const head = probeStateText(r.state);
  return r.detail ? `${head}\n${r.detail}` : head;
}
