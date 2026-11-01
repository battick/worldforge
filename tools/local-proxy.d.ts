import type { IncomingMessage, ServerResponse } from 'node:http';

export declare const PROXY_PREFIX: string;
export declare function isProxyRequest(req: IncomingMessage): boolean;
export declare function handleProxy(req: IncomingMessage, res: ServerResponse): Promise<void>;
export declare function proxyMiddleware(
  req: IncomingMessage,
  res: ServerResponse,
  next: (err?: unknown) => void,
): void;
