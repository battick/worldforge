/**
 * 型号清单：从厂商拉真实列表，解析，排序，搜索。
 *
 * **为什么要有这个模块。** 原先型号候选是仓库里写死的一小段数组 —— 型号这东西换得比
 * 代码快，写死必然过时，作者的体感就是「明明模型那么多型号，这里只有两个」。
 * 而所有 OpenAI 兼容厂商都有一个 `GET {baseUrl}/models`，返回**你这把钥匙真正能用**
 * 的全部型号。所以正确做法是去拉，而不是把清单写长一点（写长一点只是把过时的日期往后推）。
 *
 * 手填任意型号的能力一直保留：自建网关、私有部署、还没列出来的新模型，
 * 都在厂商的清单之外。
 */
import type { AISettings } from '../types';
import { AIError, apiRequest } from './client';
import { tGlobal } from '../i18n/translate';

export interface ModelInfo {
  id: string;
  /** 厂商自报的归属方 / 作者，有就显示出来（聚合站里这个字段很有用） */
  ownedBy?: string;
  /** 厂商给的创建时间（Unix 秒），有就按新的在前排 */
  createdAt?: number;
  /**
   * 猜它多半不是对话模型（向量、语音、画图那几类）。
   *
   * 注意是**排到后面 + 标一句**，不是藏起来 —— 猜错了顶多多看一眼，
   * 而藏起来就会变成「我明明知道有这个型号，它就是不在列表里」。
   */
  maybeNotChat: boolean;
}

const NON_CHAT_RE =
  /(embed|rerank|tts|text-to-speech|speech|transcri|whisper|audio|dall-?e|midjourney|stable-diffusion|\bsd[-_]|flux|vae|\bclip\b|moderation|guard|bge-|gte-|m3e|reranker)/i;

/** 抽出条目里的型号字符串。各家字段名不一样，认全这几种便宜的写法 */
function idOf(v: unknown): { id: string; ownedBy?: string; createdAt?: number } | null {
  if (typeof v === 'string') {
    const id = v.trim();
    return id ? { id } : null;
  }
  if (!v || typeof v !== 'object') return null;
  const o = v as Record<string, unknown>;
  const raw = o.id ?? o.model ?? o.model_id ?? o.name;
  if (typeof raw !== 'string' || !raw.trim()) return null;
  const ownedBy = typeof o.owned_by === 'string' ? o.owned_by : typeof o.owner === 'string' ? o.owner : undefined;
  const created = Number(o.created ?? o.created_at ?? o.createdAt);
  return {
    id: raw.trim(),
    ownedBy,
    createdAt: Number.isFinite(created) && created > 0 ? created : undefined,
  };
}

/**
 * 解析 `/models` 的返回。
 *
 * 形状只有三种可能（`data` 数组 / `models` 数组 / 裸数组），但条目的写法千奇百怪，
 * 所以两段都宽松：外层认全，条目也认全。去重按型号名，保留首次出现的顺序。
 */
export function parseModelList(data: unknown): ModelInfo[] {
  let arr: unknown[] = [];
  if (Array.isArray(data)) arr = data;
  else if (data && typeof data === 'object') {
    const o = data as Record<string, unknown>;
    if (Array.isArray(o.data)) arr = o.data;
    else if (Array.isArray(o.models)) arr = o.models;
    else if (Array.isArray(o.model_list)) arr = o.model_list;
  }

  const seen = new Set<string>();
  const out: ModelInfo[] = [];
  for (const item of arr) {
    const got = idOf(item);
    if (!got || seen.has(got.id)) continue;
    seen.add(got.id);
    out.push({ ...got, maybeNotChat: NON_CHAT_RE.test(got.id) });
  }
  return sortModels(out);
}

/**
 * 排序：能对话的在前，其余在后；组内按厂商给的创建时间新的在前。
 *
 * 用「下标」兜底保证稳定 —— 厂商没给 `created` 时（多数国内厂商都不给），
 * 顺序必须还是它原来的那个，否则同一份数据每次渲染都可能换位置。
 */
export function sortModels(list: ModelInfo[]): ModelInfo[] {
  return list
    .map((m, i) => ({ m, i }))
    .sort((a, b) => {
      if (a.m.maybeNotChat !== b.m.maybeNotChat) return a.m.maybeNotChat ? 1 : -1;
      const ca = a.m.createdAt ?? 0;
      const cb = b.m.createdAt ?? 0;
      if (ca !== cb) return cb - ca;
      return a.i - b.i;
    })
    .map((x) => x.m);
}

/** 关键词过滤：空格分开的多个词要**全部**命中（`qwen 4o` 这种是没人这么搜，但 `qwen max` 很常见） */
export function matchModel(m: ModelInfo, query: string): boolean {
  const q = query.trim().toLowerCase();
  if (!q) return true;
  const hay = `${m.id} ${m.ownedBy ?? ''}`.toLowerCase();
  return q.split(/\s+/).every((w) => hay.includes(w));
}

export type ModelSource = 'recent' | 'fetched' | 'builtin';

export interface ModelChoice extends ModelInfo {
  source: ModelSource;
}

export interface ModelChoices {
  recent: ModelChoice[];
  fetched: ModelChoice[];
  builtin: ModelChoice[];
}

/**
 * 把「最近用过 / 拉到的 / 内置兜底」三份合成面板要显示的分组。
 *
 * 三条规矩：
 *   - **同一个型号只出现一次**，分组优先级是 最近 ＞ 拉到的 ＞ 内置
 *     （拉到的比内置的新，内置清单里那些老名字如果厂商还在列，就该按厂商那份显示）；
 *   - 搜索时**不显示「最近用过」那组** —— 你都打出关键词了，顶上再堆八个不匹配的名字是噪音；
 *   - 内置兜底那组只留「拉到的里面没有」的，否则同一串名字会上下各出现一次。
 */
export function buildChoices(input: {
  recent: string[];
  builtin: string[];
  fetched: ModelInfo[];
  query: string;
}): ModelChoices {
  const used = new Set<string>();
  const take = (id: string, source: ModelSource, extra?: Partial<ModelInfo>): ModelChoice => {
    used.add(id);
    return {
      id,
      ownedBy: extra?.ownedBy,
      createdAt: extra?.createdAt,
      maybeNotChat: extra?.maybeNotChat ?? NON_CHAT_RE.test(id),
      source,
    };
  };

  const q = input.query;
  const recent: ModelChoice[] = [];
  if (q.trim()) {
    /* 搜索时不摆「最近用过」 */
  } else {
    for (const id of input.recent) {
      if (used.has(id)) continue;
      recent.push(take(id, 'recent'));
    }
  }

  const fetched: ModelChoice[] = [];
  for (const m of input.fetched) {
    if (used.has(m.id) || !matchModel(m, q)) continue;
    fetched.push(take(m.id, 'fetched', m));
  }

  const builtin: ModelChoice[] = [];
  for (const id of input.builtin) {
    if (used.has(id)) continue;
    const asInfo: ModelInfo = { id, maybeNotChat: NON_CHAT_RE.test(id) };
    if (!matchModel(asInfo, q)) continue;
    builtin.push(take(id, 'builtin'));
  }

  return { recent, fetched, builtin };
}

/* ------------------------------------------------------------------ */
/* 拉取 + 缓存                                                         */
/* ------------------------------------------------------------------ */

/**
 * 拉到的清单缓存在本机。
 *
 * 不缓存的话，每次打开设置页都得等一次网络往返才敢让你选型号；而这份清单变动很慢
 * （厂商上新以月计），缓存几天完全够用。**关键是别把缓存当真相**：界面上会显示
 * 「上次获取：3 小时前」并一直摆着「重新获取」，作者自己知道手上这份有多旧。
 */
const CACHE_PREFIX = 'worldforge:models:';

export interface ModelCache {
  at: number;
  models: ModelInfo[];
}

function cacheKey(settings: AISettings): string {
  return `${CACHE_PREFIX}${settings.provider}@${settings.baseUrl.replace(/\/+$/, '')}`;
}

export function readModelCache(settings: AISettings): ModelCache | null {
  try {
    const raw = localStorage.getItem(cacheKey(settings));
    if (!raw) return null;
    const parsed = JSON.parse(raw) as ModelCache;
    if (!parsed || !Array.isArray(parsed.models) || !parsed.models.length) return null;
    return { at: Number(parsed.at) || 0, models: parsed.models };
  } catch {
    return null;
  }
}

export function writeModelCache(settings: AISettings, models: ModelInfo[]): ModelCache {
  const entry: ModelCache = { at: Date.now(), models };
  try {
    localStorage.setItem(cacheKey(settings), JSON.stringify(entry));
  } catch {
    /* 存不下也不影响这一次使用 */
  }
  return entry;
}

export function clearModelCache(settings: AISettings): void {
  try {
    localStorage.removeItem(cacheKey(settings));
  } catch {
    /* ignore */
  }
}

/** 去厂商拉一次真实清单。失败时把原因原样带出来（那是排查的唯一线索） */
export async function fetchModels(
  settings: AISettings,
  signal?: AbortSignal,
): Promise<ModelInfo[]> {
  const { data } = await apiRequest(settings, { method: 'GET', path: '/models', signal });
  const list = parseModelList(data);
  if (!list.length) throw new AIError(tGlobal('ai.err.modelsEmpty'));
  return list;
}
