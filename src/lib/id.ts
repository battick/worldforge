import { tGlobal } from '../i18n/translate';

export function uid(prefix = ''): string {
  const rand = Math.random().toString(36).slice(2, 10);
  const t = Date.now().toString(36);
  return `${prefix}${prefix ? '_' : ''}${t}${rand}`;
}

/**
 * 把条目标题归一化成「世界内唯一标识」。
 *
 * 为什么需要它：标题可以改、可以重名（理论上不该，但导入/批量生成可能撞车），
 * 而 `id` 是随机串、不携带可比对的信息。`key` 是标题的归一化形态，
 * 同一世界里两条 key 相同的条目就是重复 —— 在落库前拦住，比事后去重干净。
 *
 * 归一化规则：去首尾空白 → 小写 → 空白折成下划线 → 只留字母数字下划线短横 →
 * 连续下划线合一 → 去首尾下划线。空标题落成 `untitled`。
 */
export function entryKey(title: string): string {
  const k = (title ?? '')
    .trim()
    .toLowerCase()
    .replace(/\s+/g, '_')
    .replace(/[^\p{L}\p{N}_-]/gu, '')
    .replace(/[_-]+/g, '_')
    .replace(/^_+|_+$/g, '');
  return k || 'untitled';
}

export function now(): number {
  return Date.now();
}

export function formatTime(ts: number): string {
  const d = new Date(ts);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

export function formatRelative(ts: number): string {
  const diff = Date.now() - ts;
  const min = Math.floor(diff / 60000);
  if (min < 1) return tGlobal('common.justNow');
  if (min < 60) return tGlobal('common.minutesAgo', { n: min });
  const h = Math.floor(min / 60);
  if (h < 24) return tGlobal('common.hoursAgo', { n: h });
  const d = Math.floor(h / 24);
  if (d < 30) return tGlobal('common.daysAgo', { n: d });
  return formatTime(ts).slice(0, 10);
}

export function clamp(n: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, n));
}
