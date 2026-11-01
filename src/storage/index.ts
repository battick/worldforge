import { LocalAdapter } from './indexeddb';
import { RestAdapter } from './rest';
import { StorageAdapter } from './types';

export interface CloudConfig {
  baseUrl: string;
  token?: string;
}

const CLOUD_KEY = 'worldforge:cloud';

export function readCloudConfig(): CloudConfig | null {
  try {
    const raw = localStorage.getItem(CLOUD_KEY);
    return raw ? (JSON.parse(raw) as CloudConfig) : null;
  } catch {
    return null;
  }
}

export function writeCloudConfig(cfg: CloudConfig | null): void {
  if (!cfg) localStorage.removeItem(CLOUD_KEY);
  else localStorage.setItem(CLOUD_KEY, JSON.stringify(cfg));
}

/**
 * 存储工厂：单机版默认返回 LocalAdapter。
 * 未来要升级云端，只要在设置里填入云端地址并保存，这里就会返回 RestAdapter，
 * 上层业务代码完全不用改。
 */
export function createStorage(): StorageAdapter {
  const cfg = readCloudConfig();
  if (cfg?.baseUrl) return new RestAdapter(cfg.baseUrl, cfg.token);
  return new LocalAdapter();
}

export * from './types';
