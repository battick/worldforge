import type { AISettings } from '../types';
import { tGlobal } from '../i18n/translate';

/** 多模态消息的一部分：纯文本，或一张图片（dataURL / http URL） */
export type ContentPart =
  | { type: 'text'; text: string }
  | { type: 'image_url'; image_url: { url: string; detail?: 'auto' | 'low' | 'high' } };

export interface ChatMessageInput {
  role: 'system' | 'user' | 'assistant';
  /** 纯文本对话直接传字符串；需要读图时传 content 数组 */
  content: string | ContentPart[];
}

/** 有的厂商在流式响应里把 delta.content 返回成数组，这里统一取文本 */
function pickText(v: unknown): string {
  if (typeof v === 'string') return v;
  if (Array.isArray(v)) {
    return v
      .map((p: any) => (typeof p === 'string' ? p : (p?.text ?? '')))
      .join('');
  }
  return '';
}

export interface ChatOptions {
  /** 流式回调，提供时使用 SSE 流式输出 */
  onDelta?: (chunk: string) => void;
  signal?: AbortSignal;
  temperature?: number;
  maxTokens?: number;
  /** 这个任务本来就需要 JSON 输出（部分厂商支持） */
  json?: boolean;
}

export class AIError extends Error {
  constructor(
    message: string,
    readonly status?: number,
  ) {
    super(message);
  }
}

function normalizeBase(baseUrl: string): string {
  return baseUrl.replace(/\/+$/, '');
}

function endpoint(settings: AISettings, path: string): string {
  const base = normalizeBase(settings.baseUrl);
  if (!base) throw new AIError(tGlobal('ai.err.noBaseUrl'));
  return `${base}${path}`;
}

/** 本机转发器的同源路径（由 server.mjs / vite 中间件实现） */
const PROXY_PATH = '/__wf-proxy';

/** 只有页面由本机 http 服务提供时，同源转发才可用 */
function proxyAvailable(): boolean {
  if (typeof location === 'undefined') return false;
  if (location.protocol !== 'http:' && location.protocol !== 'https:') return false;
  return /^(localhost|127\.0\.0\.1|\[::1\])$/.test(location.hostname);
}

/* ------------------------------------------------------------------ */
/* 「额外请求头 / 额外请求体」这两栏的读写                               */
/*                                                                     */
/* 它们是作者手写的 JSON 文本，所以「写歪了」是常态而不是异常。整套设计   */
/* 就围绕这一点：解析单独一个函数、结果既给界面做即时提示、也给发送前把关， */
/* 而且**绝不静默忽略** —— 悄悄丢掉作者写的头，比报错难查十倍。           */
/* ------------------------------------------------------------------ */

export type ExtraKind = 'headers' | 'body';

/**
 * 解析结果。
 *
 * 刻意把 `message` / `value` 在**两个分支上都声明**（各自另一边是 `undefined`），
 * 这样读 `x.message` 不需要先收窄类型。原因很实际：应用是按 `strict` 编译的，
 * 收窄当然没问题；但开发期的几个单测脚本各自用不同的 `tsc` 参数编译同一份源码，
 * 少一个 `--strictNullChecks` 就会在这儿报「属性不存在」，
 * 而报错长在 client.ts 上、看着像源码坏了 —— 排查方向全错（踩过）。
 * 形状上也让调用方更好写：`if (!r.ok) show(r.message)` 一行就够。
 */
export type ExtraParse =
  | { ok: true; value: Record<string, unknown> | null; message?: undefined }
  | { ok: false; message: string; value?: undefined };

/**
 * 把那一栏文本解析成对象。
 *
 * 空文本 = 没写 = `{ ok: true, value: null }`（**不是**错误，别让空栏一直报红）。
 */
export function parseExtraObject(text: string | undefined, kind: ExtraKind): ExtraParse {
  const raw = (text ?? '').trim();
  if (!raw) return { ok: true, value: null };

  const which = tGlobal(kind === 'headers' ? 'ai.extra.kind.headers' : 'ai.extra.kind.body');
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (e) {
    return {
      ok: false,
      message: tGlobal('ai.err.extraBadJson', {
        which,
        detail: (e as Error).message.slice(0, 120),
      }),
    };
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    return { ok: false, message: tGlobal('ai.err.extraNotObject', { which }) };
  }
  return { ok: true, value: parsed as Record<string, unknown> };
}

export interface AIExtras {
  headers: Record<string, string>;
  body: Record<string, unknown>;
}

/** 读两栏额外配置；写歪了就抛（发送前的把关，跟界面上那行红字是同一句话） */
export function readExtras(settings: AISettings): AIExtras {
  const h = parseExtraObject(settings.extraHeaders, 'headers');
  if (!h.ok) throw new AIError(h.message);
  const b = parseExtraObject(settings.extraBody, 'body');
  if (!b.ok) throw new AIError(b.message);

  const headers: Record<string, string> = {};
  for (const [k, v] of Object.entries(h.value ?? {})) {
    // 请求头只能是字符串；数字顺手转掉，嵌套结构就当没写（写进 header 也没意义）
    if (typeof v === 'string' || typeof v === 'number') headers[k] = String(v);
  }
  return { headers, body: b.value ?? {} };
}

/** 合并请求头：额外头**按名字（不分大小写）覆盖**内置头，两条路（直连 / 转发）都算 */
export function mergeHeaders(
  base: Record<string, string>,
  extra: Record<string, string>,
): Record<string, string> {
  const out = { ...base };
  for (const [k, v] of Object.entries(extra)) {
    const lower = k.toLowerCase();
    const hit = Object.keys(out).find((x) => x.toLowerCase() === lower);
    if (hit) delete out[hit];
    out[k] = v;
  }
  return out;
}

/* ------------------------------------------------------------------ */
/* 请求体构造                                                          */
/* ------------------------------------------------------------------ */

/**
 * 这一趟该不该走流式。
 *
 * 设置里关掉流式时**不能只是不传回调** —— 上层（工作台、任务表）靠 `onDelta` 显示
 * 「它正在写」的预览，回调没了它们就以为这一趟不会打字。所以关掉流式是
 * 「改用一次性请求，拿到全文后补一次回调」，见 `chat()`。
 */
export function shouldStream(settings: AISettings, options: ChatOptions): boolean {
  return typeof options.onDelta === 'function' && settings.stream !== false;
}

/**
 * 组装 `POST /chat/completions` 的请求体。
 *
 * 抽成纯函数是为了能直接断言 —— 这些开关的效果表现在「发出去的那个对象长什么样」，
 * 靠 e2e 从界面上反推是推不出来的。
 */
export function buildChatBody(
  settings: AISettings,
  messages: ChatMessageInput[],
  streaming: boolean,
  options: ChatOptions = {},
): Record<string, unknown> {
  const extras = readExtras(settings);

  const body: Record<string, unknown> = {
    model: settings.model,
    messages,
    temperature: options.temperature ?? settings.temperature ?? 0.8,
    stream: streaming,
  };

  // token 上限：本次调用明确要的优先（「测试连接」那种刻意要短的），
  // 其次是设置里的；都没写就干脆不传，交给厂商默认。
  const cap = options.maxTokens ?? (Number(settings.maxTokens) > 0 ? Number(settings.maxTokens) : 0);
  if (cap > 0) body.max_tokens = cap;

  // top_p：1 是多数厂商的默认值，等于没设，不传更省事（有的网关对 1.0 还会挑刺）
  const topP = Number(settings.topP);
  if (Number.isFinite(topP) && topP > 0 && topP < 1) body.top_p = topP;

  // response_format：三态见 AIJsonMode
  if (settings.jsonMode === 'always') body.response_format = { type: 'json_object' };
  else if (options.json === true && settings.jsonMode !== 'never') {
    body.response_format = { type: 'json_object' };
  }

  // 额外请求体：合并在最后，允许顶掉上面任何一个字段（自建网关常要这么干）——
  // 唯独 `messages` 不行，那是应用自己组织的，被顶掉就等于整趟失控。
  for (const [k, v] of Object.entries(extras.body)) {
    if (k === 'messages') continue;
    body[k] = v;
  }

  return body;
}

/* ------------------------------------------------------------------ */
/* 传输                                                                */
/* ------------------------------------------------------------------ */

export interface SendInit {
  method: 'GET' | 'POST';
  /** 相对 baseUrl 的路径，例如 `/chat/completions`、`/models` */
  path: string;
  body?: Record<string, unknown>;
  signal?: AbortSignal;
}

/**
 * 发一次请求：先直连厂商；若被拦截（浏览器 CORS 是最常见原因），
 * 再自动改走本机同源转发。两条路都失败才报错。
 */
async function sendRequest(
  settings: AISettings,
  init: SendInit,
): Promise<{ res: Response; viaProxy: boolean; target: string }> {
  const direct = endpoint(settings, init.path);
  const payload = init.body === undefined ? undefined : JSON.stringify(init.body);
  const extras = readExtras(settings).headers;
  const headers = mergeHeaders(
    {
      ...(init.body === undefined ? {} : { 'Content-Type': 'application/json' }),
      Authorization: `Bearer ${settings.apiKey}`,
    },
    extras,
  );

  try {
    const res = await fetch(direct, {
      method: init.method,
      headers,
      body: payload,
      signal: init.signal,
    });
    return { res, viaProxy: false, target: direct };
  } catch (e) {
    if (init.signal?.aborted) throw e;

    if (!proxyAvailable()) {
      const isFile = typeof location !== 'undefined' && location.protocol === 'file:';
      throw new AIError(
        tGlobal(isFile ? 'ai.err.networkFile' : 'ai.err.networkGeneric', {
          message: (e as Error).message,
        }),
      );
    }

    let res: Response;
    try {
      res = await fetch(PROXY_PATH, {
        method: init.method,
        headers: { ...headers, 'x-wf-upstream': direct },
        body: payload,
        signal: init.signal,
      });
    } catch (e2) {
      if (init.signal?.aborted) throw e2;
      throw new AIError(
        tGlobal('ai.err.networkBoth', { message: (e as Error).message, direct }),
      );
    }

    if (res.status === 404 || res.status === 405) {
      throw new AIError(tGlobal('ai.err.proxyUnavailable'));
    }
    return { res, viaProxy: true, target: direct };
  }
}

/** 把「非 2xx」整理成一句能直接给作者看的话（转发器返回的错误体也是 JSON，尽量抠 message） */
async function readErrorBody(res: Response, viaProxy: boolean): Promise<AIError> {
  let detail = '';
  try {
    detail = await res.text();
  } catch {
    /* ignore */
  }
  let hint = '';
  try {
    const j = JSON.parse(detail);
    hint = j?.error?.message ?? j?.message ?? '';
  } catch {
    /* 不是 JSON，直接用原文 */
  }
  const prefix = viaProxy ? tGlobal('ai.err.viaProxy') : '';
  return new AIError(
    tGlobal('ai.err.modelStatus', {
      status: res.status,
      prefix,
      detail: (hint || detail).slice(0, 400) || res.statusText,
    }),
    res.status,
  );
}

/**
 * 通用的兼容端点请求（当前用于 `/models`）。
 *
 * 和 `chat()` 共用同一套「直连 → 本机转发」与错误整理 —— 拉模型列表也有 CORS 问题，
 * 另写一份的话就会出现「对话走通了、取列表死活失败」这种查半天的怪事。
 */
export async function apiRequest(
  settings: AISettings,
  init: SendInit,
): Promise<{ data: unknown; viaProxy: boolean; target: string }> {
  if (!settings.apiKey && !/localhost|127\.0\.0\.1/.test(settings.baseUrl)) {
    throw new AIError(tGlobal('ai.err.noApiKey'));
  }
  let res: Response;
  let viaProxy = false;
  let target = '';
  try {
    const sent = await sendRequest(settings, init);
    res = sent.res;
    viaProxy = sent.viaProxy;
    target = sent.target;
  } catch (e) {
    throw e instanceof AIError
      ? e
      : new AIError(tGlobal('ai.err.requestFailed', { message: (e as Error).message }));
  }
  if (!res.ok) throw await readErrorBody(res, viaProxy);

  let text = '';
  try {
    text = await res.text();
  } catch {
    /* ignore */
  }
  try {
    return { data: JSON.parse(text), viaProxy, target };
  } catch {
    throw new AIError(tGlobal('ai.err.modelsBadShape', { body: text.slice(0, 300) }));
  }
}

/**
 * 统一的对话调用：默认非流式，传入 onDelta 则走 SSE 流式。
 * 所有兼容 OpenAI 协议的厂商共用这一段代码。
 */
export async function chat(
  settings: AISettings,
  messages: ChatMessageInput[],
  options: ChatOptions = {},
): Promise<string> {
  if (!settings.apiKey && !/localhost|127\.0\.0\.1/.test(settings.baseUrl)) {
    throw new AIError(tGlobal('ai.err.noApiKey'));
  }
  if (!settings.model) throw new AIError(tGlobal('ai.err.noModel'));

  const streaming = shouldStream(settings, options);
  const body = buildChatBody(settings, messages, streaming, options);

  let res: Response;
  let viaProxy = false;
  try {
    const sent = await sendRequest(settings, { method: 'POST', path: '/chat/completions', body, signal: options.signal });
    res = sent.res;
    viaProxy = sent.viaProxy;
  } catch (e) {
    throw e instanceof AIError
      ? e
      : new AIError(tGlobal('ai.err.requestFailed', { message: (e as Error).message }));
  }

  if (!res.ok) throw await readErrorBody(res, viaProxy);

  if (!streaming) {
    const data = await res.json();
    const content = pickText(data?.choices?.[0]?.message?.content);
    if (!content) {
      throw new AIError(tGlobal('ai.err.badShape', { body: JSON.stringify(data).slice(0, 300) }));
    }
    // 关掉流式不代表上层不想要预览 —— 拿到全文后补一次，界面的「正在写」才有东西显示
    options.onDelta?.(content);
    return content;
  }

  // ---- 流式解析 ----
  const reader = res.body?.getReader();
  if (!reader) throw new AIError(tGlobal('ai.err.noStream'));
  const decoder = new TextDecoder('utf-8');
  let buffer = '';
  let full = '';

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });

    const lines = buffer.split('\n');
    buffer = lines.pop() ?? '';

    for (const raw of lines) {
      const line = raw.trim();
      if (!line || !line.startsWith('data:')) continue;
      const payload = line.slice(5).trim();
      if (payload === '[DONE]') continue;
      try {
        const json = JSON.parse(payload);
        const delta = pickText(
          json?.choices?.[0]?.delta?.content ?? json?.choices?.[0]?.message?.content,
        );
        if (delta) {
          full += delta;
          options.onDelta?.(delta);
        }
      } catch {
        /* 忽略半包/心跳 */
      }
    }
  }
  return full;
}

/** 连接测试：发一条极短的请求确认 Key / 地址 / 模型可用 */
export async function testConnection(settings: AISettings): Promise<string> {
  const reply = await chat(
    settings,
    [
      { role: 'system', content: tGlobal('ai.test.system') },
      { role: 'user', content: tGlobal('ai.test.user') },
    ],
    { temperature: 0, maxTokens: 16 },
  );
  return reply.trim();
}
