import { defineConfig, type Plugin } from 'vite';
import react from '@vitejs/plugin-react';
// @ts-ignore -- 纯 JS 工具模块，类型见 tools/local-proxy.d.ts
import { proxyMiddleware } from './tools/local-proxy.mjs';

/**
 * 给 dev / preview 服务挂上本机转发中间件。
 * 作用：浏览器直连模型厂商被 CORS 拦时，前端会自动改走同源转发。
 * （同一个转发器也被 server.mjs 用于托管构建产物，避免逻辑重复）
 */
function localProxyPlugin(): Plugin {
  return {
    name: 'worldforge-local-proxy',
    configureServer(server) {
      server.middlewares.use(proxyMiddleware);
    },
    configurePreviewServer(server) {
      server.middlewares.use(proxyMiddleware);
    },
  };
}

export default defineConfig({
  plugins: [react(), localProxyPlugin()],
  base: './',
  server: {
    port: 5180,
    host: '127.0.0.1',
  },
  build: {
    outDir: 'dist',
    chunkSizeWarningLimit: 1600,
  },
});
