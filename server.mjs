/**
 * WorldForge 本地启动器
 *
 * 为什么需要它：
 * 1. 生产包是 ES Module，用 file:// 双击打开会被浏览器 CORS 拦死，必须走 http。
 * 2. 浏览器直连模型厂商 API 有被 CORS 拦截的风险，这里顺带做了本机转发。
 *
 * 用法：
 *   node server.mjs            # 打开已构建的 dist
 *   node server.mjs --port 5188
 *   node server.mjs --no-open  # 不自动开浏览器
 */
import { createServer } from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { extname, join, normalize, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';
import { handleProxy, isProxyRequest } from './tools/local-proxy.mjs';

const ROOT = resolve(fileURLToPath(new URL('.', import.meta.url)));
const DIST = join(ROOT, 'dist');

const argv = process.argv.slice(2);
const portArgIdx = argv.indexOf('--port');
const PORT = portArgIdx >= 0 ? Number(argv[portArgIdx + 1]) : Number(process.env.PORT) || 5188;
const AUTO_OPEN = !argv.includes('--no-open');

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.ico': 'image/x-icon',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.ttf': 'font/ttf',
  '.map': 'application/json; charset=utf-8',
  '.txt': 'text/plain; charset=utf-8',
  '.wasm': 'application/wasm',
};

/** 把请求路径安全地映射到 dist 内的真实文件 */
function resolveWithin(root, urlPath) {
  const clean = decodeURIComponent(urlPath.split('?')[0].split('#')[0]);
  const rel = normalize(clean).replace(/^([/\\])+/, '');
  const full = resolve(root, rel);
  // 防目录穿越
  if (full !== root && !full.startsWith(root + sep)) return null;
  return full;
}

async function serveStatic(req, res) {
  if (!existsSync(DIST)) {
    res.writeHead(500, { 'Content-Type': 'text/html; charset=utf-8' });
    return res.end(
      '<h1>还没有构建产物</h1><p>请先在项目目录执行：<code>npm run build</code></p>',
    );
  }

  const urlPath = (req.url || '/').split('?')[0];
  let filePath = resolveWithin(DIST, urlPath);
  if (!filePath) {
    res.writeHead(403);
    return res.end('Forbidden');
  }

  // 目录 → index.html
  try {
    const info = await stat(filePath);
    if (info.isDirectory()) filePath = join(filePath, 'index.html');
  } catch {
    /* 交给下面的回退逻辑 */
  }

  try {
    const data = await readFile(filePath);
    const type = MIME[extname(filePath).toLowerCase()] || 'application/octet-stream';
    res.writeHead(200, {
      'Content-Type': type,
      'Cache-Control': filePath.endsWith('index.html') ? 'no-store' : 'public, max-age=3600',
    });
    return res.end(data);
  } catch {
    // SPA 回退：未知路径一律给 index.html（HashRouter 也依赖这个）
    try {
      const html = await readFile(join(DIST, 'index.html'));
      res.writeHead(200, { 'Content-Type': MIME['.html'], 'Cache-Control': 'no-store' });
      return res.end(html);
    } catch {
      res.writeHead(404);
      return res.end('Not Found');
    }
  }
}

function createApp() {
  return createServer((req, res) => {
    if (isProxyRequest(req)) {
      handleProxy(req, res).catch((e) => {
        if (!res.headersSent) res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: { message: `转发器异常：${e.message}` } }));
      });
      return;
    }
    serveStatic(req, res).catch(() => {
      if (!res.headersSent) res.writeHead(500);
      res.end('Internal Server Error');
    });
  });
}

/**
 * 探测某个端口上是否已经有 WorldForge 在跑。
 * 这点很重要：数据是按「源」隔离的（端口不同 = 不同 IndexedDB），
 * 如果已经有一个实例在跑，再另起一个换端口的实例，用户会以为数据丢了。
 */
async function probeExisting(targetPort) {
  try {
    const res = await fetch(`http://127.0.0.1:${targetPort}/`, {
      signal: AbortSignal.timeout(1500),
    });
    if (!res.ok) return false;
    const html = await res.text();
    return /WorldForge/i.test(html);
  } catch {
    return false;
  }
}

function openBrowser(url) {
  // Windows 用 start；macOS 用 open；Linux 用 xdg-open
  const cmd =
    process.platform === 'win32'
      ? ['cmd', ['/c', 'start', '', url]]
      : process.platform === 'darwin'
        ? ['open', [url]]
        : ['xdg-open', [url]];
  try {
    spawn(cmd[0], cmd[1], { detached: true, stdio: 'ignore' }).unref();
  } catch {
    /* 自动打开失败不影响使用，用户手动访问即可 */
  }
}

/**
 * 端口被占用时：先看是不是自己的另一个实例（是 → 打开它并退出，保住数据源），
 * 否则自动向后找一个可用端口。单机应用最怕「上次没关干净 → 这次双击打不开」，
 * 所以这里绝不直接退出。
 */
const MAX_TRIES = 20;
let port = PORT;
let tries = 0;

function start() {
  const server = createApp();

  server.on('error', async (e) => {
    if (e.code === 'EADDRINUSE') {
      if (tries === 0 && (await probeExisting(port))) {
        const url = `http://127.0.0.1:${port}/`;
        console.log('');
        console.log('  WorldForge 已经在运行了');
        console.log(`  ${url}`);
        console.log('');
        console.log('  已为你打开这个窗口（数据仍在同一个地址下，不会丢）。');
        console.log('');
        if (AUTO_OPEN) openBrowser(url);
        process.exit(0);
      }

      if (tries < MAX_TRIES) {
        tries += 1;
        console.log(`  端口 ${port} 已被其他程序占用，改用 ${port + 1}`);
        port += 1;
        setTimeout(start, 0);
        return;
      }

      console.error(
        `\n  从 ${PORT} 起连续 ${MAX_TRIES} 个端口都被占用。\n` +
          '  请先关闭其他占用端口的程序，或用 --port 指定端口：node server.mjs --port 6000\n',
      );
    } else {
      console.error('\n  启动失败：', e.message, '\n');
    }
    process.exit(1);
  });

  server.listen(port, '127.0.0.1', () => {
    const url = `http://127.0.0.1:${port}/`;
    console.log('');
    console.log('  WorldForge 已启动');
    console.log(`  ${url}`);
    console.log('');
    console.log('  数据保存在本机浏览器里，不会上传。按 Ctrl+C 关闭。');
    console.log('');

    if (AUTO_OPEN) openBrowser(url);
  });
}

start();
