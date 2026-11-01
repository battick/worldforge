/**
 * 启动诊断日志
 *
 * 数据库打不开这种问题，用户只能看到「超时」两个字，排查全靠猜。
 * 这里把启动全过程（数据库打开、升级、每个 store 的加载）都记上时间戳，
 * 出错时自动补一轮环境探测（indexedDB.databases / 存储配额 / 隐私模式），
 * 生成一份可以一键复制发给开发者的纯文本报告。
 *
 * 设计约束：
 * - 绝不能因为日志本身抛错把应用搞挂 —— 所有探测都带超时和 try/catch；
 * - 常驻内存，不上传、不落盘（localStorage 都不写），只在本页生命周期内有效。
 */

import { currentLocale, localeMeta } from '../i18n/core';
import { tGlobal } from '../i18n/translate';

interface DiagEntry {
  /** 距页面加载的毫秒数 */
  t: number;
  event: string;
  detail?: string;
}

const MAX_ENTRIES = 200;
const entries: DiagEntry[] = [];
const bootedAt = new Date();
const t0 = performance.now();

export function diag(event: string, detail?: unknown): void {
  const item: DiagEntry = {
    t: Math.round(performance.now() - t0),
    event,
    detail: detail === undefined ? undefined : String(detail),
  };
  entries.push(item);
  if (entries.length > MAX_ENTRIES) entries.shift();
  // 同步打到控制台，方便开发者 F12 直接看
  // eslint-disable-next-line no-console
  console.debug(`[diag +${item.t}ms] ${event}${item.detail ? ' :: ' + item.detail : ''}`);
}

/** 出错后环境探测的结构化结果（诊断判定用） */
export interface PostMortem {
  /** indexedDB.databases() 的结果；null = 不支持或探测失败 */
  databases: { name: string; version?: number }[] | null;
  persisted: boolean | null;
  usageMB: number | null;
  quotaMB: number | null;
}

/** 僵死队列判定：数据库存在、但 open 请求超时 —— 排队中的请求把队列堵死了 */
export interface StallVerdict {
  kind: 'starved-queue' | 'db-missing' | 'unknown';
  /** worldforge 数据库当前停留的版本号（starved-queue 时非空） */
  dbVersion: number | null;
}

/**
 * 出错后的补充探测。逐项记录：
 * - 浏览器是否处于隐私模式（storage.estimate 在隐私模式常返回极小配额）
 * - 本源下所有 IndexedDB 数据库的名字和版本（能看出 worldforge 是否存在、卡在哪个版本）
 * - 存储配额用量
 */
export async function collectPostMortem(): Promise<PostMortem> {
  diag('post-mortem:start');
  const pm: PostMortem = {
    databases: null,
    persisted: null,
    usageMB: null,
    quotaMB: null,
  };

  // 隐私 / 无痕探测
  try {
    if (navigator.storage?.persisted) {
      pm.persisted = await navigator.storage.persisted();
      diag('env:storage-persisted', pm.persisted);
    }
  } catch {
    /* ignore */
  }

  // 数据库清单（Chrome/Edge 支持；返回每个库的名字+版本，不经过 open 队列）
  if (typeof indexedDB !== 'undefined' && (indexedDB as any).databases) {
    try {
      const dbs = (await Promise.race([
        (indexedDB as any).databases() as Promise<{ name?: string; version?: number }[]>,
        new Promise<never>((_, rej) => setTimeout(() => rej(new Error('timeout')), 3000)),
      ])) as { name?: string; version?: number }[];
      pm.databases = dbs.map((d) => ({ name: d.name ?? '?', version: d.version }));
      diag(
        'indexedDB.databases',
        pm.databases.length
          ? pm.databases.map((d) => `${d.name}@v${d.version ?? '?'}`).join(', ')
          : tGlobal('lib.diag.noDatabases'),
      );
    } catch {
      diag('indexedDB.databases', tGlobal('lib.diag.probeFailed'));
    }
  } else {
    diag('env:idb-databases-api', tGlobal('lib.diag.idbApiUnsupported'));
  }

  // 存储配额
  if (navigator.storage?.estimate) {
    try {
      const est = await Promise.race([
        navigator.storage.estimate(),
        new Promise<never>((_, rej) => setTimeout(() => rej(new Error('timeout')), 3000)),
      ]);
      const mb = (n?: number) => (n == null ? '?' : (n / 1024 / 1024).toFixed(1) + 'MB');
      pm.usageMB = est.usage != null ? +(est.usage / 1024 / 1024).toFixed(1) : null;
      pm.quotaMB = est.quota != null ? +(est.quota / 1024 / 1024).toFixed(1) : null;
      diag(
        'storage.estimate',
        tGlobal('lib.diag.storageEstimate', { used: mb(est.usage), quota: mb(est.quota) }),
      );
    } catch {
      diag('storage.estimate', tGlobal('lib.diag.probeFailed'));
    }
  }
  return pm;
}

/**
 * 结合超时报错与探测结果，判定卡死的类型：
 * - starved-queue：worldforge 存在，但连「不带版本的 open」都超时 ——
 *   连接队列被一个僵死的升级请求堵死（刷新页面不会取消排队请求）。
 *   页面内无解，必须彻底重启浏览器进程（Edge 注意「启动加速/后台应用」）。
 * - db-missing：连数据库都不存在 —— 多半是隐私模式或站点数据被禁用。
 */
export function analyzeStall(pm: PostMortem | null): StallVerdict {
  if (!pm) return { kind: 'unknown', dbVersion: null };
  if (pm.databases === null) return { kind: 'unknown', dbVersion: null };
  const wf = pm.databases.find((d) => d.name === 'worldforge');
  if (!wf) return { kind: 'db-missing', dbVersion: null };
  return { kind: 'starved-queue', dbVersion: wf.version ?? 1 };
}

/** 生成可复制的完整诊断报告 */
export function getDiagReport(): string {
  const env = [
    tGlobal('lib.diag.time', {
      time: bootedAt.toLocaleString(localeMeta(currentLocale()).htmlLang),
    }),
    tGlobal('lib.diag.page', { url: location.href }),
    tGlobal('lib.diag.ua', { ua: navigator.userAgent }),
    tGlobal('lib.diag.visibility', { state: document.visibilityState }),
    tGlobal('lib.diag.idbAvailable', {
      value: tGlobal(typeof indexedDB !== 'undefined' ? 'lib.diag.boolTrue' : 'lib.diag.boolFalse'),
    }),
  ];
  try {
    localStorage.setItem('__wf_diag_probe', '1');
    localStorage.removeItem('__wf_diag_probe');
    env.push(tGlobal('lib.diag.localStorageOk'));
  } catch {
    env.push(tGlobal('lib.diag.localStorageBlocked'));
  }

  const lines = entries.map(
    (e) => `+${String(e.t).padStart(6)}ms  ${e.event}${e.detail ? '\n           ' + e.detail : ''}`,
  );

  return [
    tGlobal('lib.diag.title'),
    ...env,
    tGlobal('lib.diag.eventHeader'),
    ...lines,
    tGlobal('lib.diag.end'),
  ].join('\n');
}
