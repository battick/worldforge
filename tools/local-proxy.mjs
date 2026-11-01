/**
 * 本地请求转发（解决浏览器直连模型厂商被 CORS 拦截的问题）
 *
 * 背景：这个应用是「单机优先」的，AI 请求直接从浏览器发往厂商。
 * 但不少厂商（或公司网络、某些浏览器策略）不给浏览器直连放行，
 * 表现为 `TypeError: Failed to fetch`，用户完全不知道该怎么修。
 *
 * 做法：前端直连失败时，改发到 `同源 + /__wf-proxy`，
 * 由本机这个转发器代发到真实地址，再把响应（含 SSE 流）原样吐回来。
 * 因为是同源请求，不存在 CORS 问题。
 *
 * 这个转发器只监听 127.0.0.1，不对外网开放。
 */

export const PROXY_PREFIX = '/__wf-proxy';

/** 上游地址靠这个头传进来（完整 URL）。转发时必须把它去掉，别让厂商看见 */
export const UPSTREAM_HEADER = 'x-wf-upstream';

/** 判断一个请求是否要交给转发器处理 */
export function isProxyRequest(req) {
  const url = req.url || '';
  return url === PROXY_PREFIX || url.startsWith(PROXY_PREFIX + '/');
}

/**
 * 这些头**不转发**。
 *
 * 分三类：我们自己显式设的（Content-Type / Authorization）、浏览器自带的
 * （Accept-* / Sec-* / Origin / Referer…）、以及逐跳头（Connection 那一族，
 * 转发出去在语义上就是错的）。
 *
 * **除了它们，其余一律原样转发** —— 作者在设置里「额外请求头」那栏写的东西，
 * 正是靠这条规矩活下来的。原先这里是把头**重建**成三个（Content-Type / Accept /
 * User-Agent）再加 Authorization，于是同一个配置直连能用、一退回本机转发就悄悄没了，
 * 而厂商那边只会回一句「参数不对」—— 极难查。这一条是 e2e 在**不加 --cors**
 * 的那一趟里逼出来的。
 */
const SKIP_HEADERS = new Set([
  'host',
  'connection',
  'content-length',
  'transfer-encoding',
  'keep-alive',
  'te',
  'trailer',
  'upgrade',
  'content-type', // 下面按上游需要显式设
  'authorization', // 同上（而且是逐个转发，不重建）
  'accept',
  'user-agent',
  'accept-encoding', // node 的 fetch 自己会设，手动带容易和它打架
  'accept-language',
  'cache-control',
  'pragma',
  'priority',
  'dnt',
  'origin',
  'referer', // 转发给厂商只会让人困惑，不构成鉴权信息
  'cookie',
  UPSTREAM_HEADER,
]);

/**
 * 把浏览器发来的头整理成要发给上游的样子。
 *
 * 单独抽出来是为了能被断言 —— 「额外请求头到底有没有被转发出去」这件事
 * 只能在这一层验，浏览器那边看不出来。
 */
export function forwardHeaders(incoming) {
  const out = {
    Accept: 'text/event-stream, application/json',
    'User-Agent': 'WorldForge-LocalProxy/1.0',
  };
  for (const [k, v] of Object.entries(incoming || {})) {
    if (v === undefined || v === null) continue;
    const lower = k.toLowerCase();
    if (SKIP_HEADERS.has(lower) || lower.startsWith('sec-')) continue;
    out[k] = Array.isArray(v) ? v.join(', ') : String(v);
  }
  // 这两个显式设，且要在循环之后 —— 免得被上面某个同名头覆盖掉
  out['Content-Type'] = incoming?.['content-type'] || 'application/json';
  if (incoming?.authorization) out.Authorization = incoming.authorization;
  return out;
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    req.on('data', (c) => chunks.push(c));
    req.on('end', () => resolve(Buffer.concat(chunks)));
    req.on('error', reject);
  });
}

function fail(res, status, message) {
  if (res.headersSent) return res.end();
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
  });
  res.end(JSON.stringify({ error: { message, type: 'local_proxy_error' } }));
}

/**
 * 转发一次请求。
 * 上游地址通过 `x-wf-upstream` 头传入（完整 URL）。
 */
export async function handleProxy(req, res) {
  const DBG = process.env.WF_PROXY_DEBUG === '1';
  const log = (...a) => DBG && console.error('[proxy]', ...a);
  log('hit', req.method, req.url);

  if (req.method === 'OPTIONS') {
    res.writeHead(204, {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Headers': '*',
      'Access-Control-Allow-Methods': 'POST, OPTIONS',
    });
    return res.end();
  }

  const target = req.headers[UPSTREAM_HEADER];
  if (!target || typeof target !== 'string') {
    return fail(res, 400, `缺少 ${UPSTREAM_HEADER} 头，无法确定转发目标`);
  }

  let url;
  try {
    url = new URL(target);
  } catch {
    return fail(res, 400, `非法的上游地址：${target}`);
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    return fail(res, 400, `只允许 http/https 上游，收到：${url.protocol}`);
  }

  const body = await readBody(req);
  const headers = forwardHeaders(req.headers);

  // 实测注意：req/res 的 'close' 事件在本机服务里会在「请求体读完」时立刻触发，
  // 用它做中止信号会把还没返回的上游响应（尤其是 SSE）当场掐断。
  // 所以这里不用 AbortController，改为显式读写循环 + 收尾保证。
  log('forwarding →', url.toString());

  let upstream;
  try {
    upstream = await fetch(url, {
      method: req.method || 'POST',
      headers,
      body: body.length ? body : undefined,
      redirect: 'follow',
    });
  } catch (e) {
    return fail(
      res,
      502,
      `本地转发失败：${e.message}。请确认本机能访问 ${url.origin}（公司网络/代理可能需要额外配置）。`,
    );
  }

  if (res.writableEnded || res.destroyed) return;

  res.writeHead(upstream.status, {
    'Content-Type': upstream.headers.get('content-type') || 'application/json',
    'Cache-Control': 'no-cache, no-transform',
    'X-Accel-Buffering': 'no',
  });

  if (!upstream.body) return res.end();

  log('upstream', upstream.status, upstream.headers.get('content-type'));

  // 原样透传（SSE 流式响应也走这里）
  let bytes = 0;
  try {
    const reader = upstream.body.getReader();
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      // 浏览器已断开就不要继续拉了
      if (res.writableEnded || res.destroyed) {
        await reader.cancel().catch(() => {});
        break;
      }
      bytes += value.length;
      if (!res.write(Buffer.from(value))) {
        await new Promise((r) => res.once('drain', r));
      }
    }
  } catch (e) {
    log('relay error', e.message);
  } finally {
    // 无论成功还是上游中断，都要把响应收尾，否则浏览器会一直转圈
    if (!res.writableEnded && !res.destroyed) res.end();
    log('relayed bytes=', bytes);
  }
}

/** 挂到 connect 风格的中间件链上（Vite dev / preview 用） */
export function proxyMiddleware(req, res, next) {
  if (!isProxyRequest(req)) return next();
  handleProxy(req, res).catch((e) => fail(res, 500, `转发器异常：${e.message}`));
}
