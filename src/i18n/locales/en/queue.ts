/**
 * Background job queue (the little indicator docked at the bottom right).
 * Namespace convention: `queue.*`; second level is the area (status / buttons / groups).
 *
 * Only the dock's own wording lives here. What a particular job is called
 * ("Generate a fix for “Artisan League”") belongs to that feature's namespace
 * (`consist.*` / `entries.*`) — the queue is generic plumbing and must not know about business.
 */
import type zh from '../zh/queue';

/** 与 zh/queue.ts 的 key 一一对应，缺一个都会在这里报类型错误 */
const en: Record<keyof typeof zh, string> = {
  'queue.title': 'Job queue',
  'queue.desc':
    'The AI does one thing at a time: click several and they line up, finishing in the order you clicked. You can pull any of them back.',
  /* ---------------- status ---------------- */
  'queue.status.queued': 'Waiting',
  'queue.status.error': 'Failed',
  'queue.status.canceled': 'Canceled',
  /* ---------------- summary ---------------- */
  'queue.summary.running': '{label}',
  'queue.summary.runningMany': '{label}, {n} more waiting',
  'queue.summary.idle': 'Queue empty · {n} done',
  'queue.summary.failed': '{n} failed',
  'queue.badge.remaining': '{n}',
  /* ---------------- buttons ---------------- */
  'queue.btn.toggle': 'Show the job queue',
  'queue.btn.collapse': 'Hide the job queue',
  'queue.btn.cancel': 'Cancel',
  'queue.btn.retry': 'Retry',
  'queue.btn.remove': 'Remove',
  'queue.btn.clear': 'Clear finished',
  'queue.btn.stopAll': 'Stop all',
  /* ---------------- rows ---------------- */
  'queue.row.waiting': '{n} ahead',
  'queue.row.runningFor': '{s}s so far',
  'queue.row.doneIn': 'in {s}s',
  /* ---------------- errors ---------------- */
  'queue.err.noRunner':
    'The code for this job is gone (the page was most likely just hot-reloaded). Please click it again.',
};

export default en;
