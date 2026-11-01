/**
 * 右下角的任务队列提示。
 *
 * 它回答的是**一个页面回答不了的问题**：「我刚点的那五下，到底排上了没有、现在做到哪一件了？」
 *
 * 页面自己的进度条只讲页面内那一批；而这个队列是跨页面的 —— 作者常常在这儿排一堆、
 * 然后切去别处等。所以它挂在 Shell 上（路由切换不卸载），收起时是一枚胶囊，
 * 展开是一张清单：每一件叫什么、排队中还是正在做、跑了几秒、失败原因、撤单 / 重试。
 *
 * 收起态也要把话说全：**正在做什么 + 后面还压着几件**。只显示一个转圈等于什么都没说 ——
 * 那正是它要替代的东西。
 *
 * 世界隔离：**跑着的照显、别的世界跑完的不显**。前者不让显的话，切了世界就撤不掉单了；
 * 后者留着只会变成上一个世界飘过来的垃圾。
 */
import { useEffect, useMemo, useState } from 'react';
import { useStore } from '../state/store';
import {
  cancelAllJobs,
  cancelJob,
  clearFinishedJobs,
  dismissJob,
  jobCanRetry,
  retryJob,
  useJobs,
  type Job,
} from '../state/jobQueue';
import { useT } from '../i18n';

/** 在队列里待着（还没结束）的状态 */
function isLive(j: Job): boolean {
  return j.status === 'queued' || j.status === 'running';
}

function elapsed(job: Job, now: number): number {
  const from = job.startedAt ?? job.queuedAt;
  const to = job.finishedAt ?? now;
  return Math.max(0, Math.round((to - from) / 1000));
}

export function TaskDock() {
  const t = useT();
  const store = useStore();
  const all = useJobs();
  const [open, setOpen] = useState(false);

  const wid = store.settings.activeWorldId ?? null;
  const jobs = useMemo(
    () => all.filter((j) => isLive(j) || !j.worldId || j.worldId === wid),
    [all, wid],
  );

  const running = useMemo(() => jobs.filter((j) => j.status === 'running'), [jobs]);
  const queued = useMemo(() => jobs.filter((j) => j.status === 'queued'), [jobs]);
  const failed = useMemo(() => jobs.filter((j) => j.status === 'error'), [jobs]);
  const finished = useMemo(() => jobs.filter((j) => !isLive(j)), [jobs]);
  const active = running.length + queued.length;

  // 「已跑 12 秒」要真的在走 —— 否则一件活儿卡住时，面板自己看着也像卡住了。
  // 只在有活儿在跑时才起心跳。
  const [, setTick] = useState(0);
  useEffect(() => {
    if (!running.length) return;
    const id = window.setInterval(() => setTick((n) => n + 1), 1000);
    return () => window.clearInterval(id);
  }, [running.length]);

  /** 正在跑的排前面（作者最关心的就是这个），跑完的沉到后面、新的在前 */
  const ordered = useMemo(() => {
    const live = jobs.filter(isLive);
    const dead = jobs.filter((j) => !isLive(j)).reverse();
    return [...live, ...dead];
  }, [jobs]);

  if (!jobs.length) return null;

  const now = Date.now();
  const head = running[0] ?? queued[0];
  let summary: string;
  if (active > 0 && head) {
    summary =
      queued.length > 0
        ? t('queue.summary.runningMany', { label: head.label, n: queued.length })
        : t('queue.summary.running', { label: head.label });
  } else if (failed.length) {
    summary = t('queue.summary.failed', { n: failed.length });
  } else {
    summary = t('queue.summary.idle', { n: finished.length });
  }

  const tone = active > 0 ? 'busy' : failed.length ? 'bad' : 'ok';

  return (
    <div className="dock" data-role="task-dock" data-tone={tone} data-open={open ? '1' : '0'}>
      {open && (
        <div className="dock-panel" data-role="task-dock-panel">
          <div className="dock-head">
            <span className="bold small">{t('queue.title')}</span>
            <div className="grow" />
            {active > 0 && (
              <button
                className="btn xs ghost"
                data-role="task-dock-stop"
                onClick={() => cancelAllJobs()}
              >
                {t('queue.btn.stopAll')}
              </button>
            )}
            {finished.length > 0 && (
              <button
                className="btn xs ghost"
                data-role="task-dock-clear"
                onClick={() => clearFinishedJobs()}
              >
                {t('queue.btn.clear')}
              </button>
            )}
          </div>
          <div className="dock-desc small muted">{t('queue.desc')}</div>

          <div className="dock-list">
            {ordered.map((j) => (
              <div
                key={j.id}
                className="dock-job"
                data-role="task-job"
                data-job-id={j.id}
                data-status={j.status}
              >
                <span className={`dock-dot ${j.status}`} aria-hidden>
                  {j.status === 'running' ? <span className="spinner" /> : null}
                </span>
                <div className="grow">
                  <div className="dock-job-top">
                    <span className="dock-job-label" data-role="task-job-label">
                      {j.label}
                    </span>
                    <span className="dock-group">{j.group}</span>
                  </div>
                  <div className="dock-job-sub" data-role="task-job-status">
                    {j.status === 'queued' &&
                      t('queue.status.queued') +
                        (queued.indexOf(j) > 0
                          ? ` · ${t('queue.row.waiting', { n: queued.indexOf(j) })}`
                          : '')}
                    {j.status === 'running' && t('queue.row.runningFor', { s: elapsed(j, now) })}
                    {j.status === 'done' && t('queue.row.doneIn', { s: elapsed(j, now) })}
                    {j.status === 'error' && t('queue.status.error')}
                    {j.status === 'canceled' && t('queue.status.canceled')}
                    {j.note ? ` · ${j.note}` : ''}
                  </div>
                  {j.error && (
                    <div className="dock-job-err" data-role="task-job-error">
                      {j.error}
                    </div>
                  )}
                </div>
                <div className="dock-job-acts">
                  {isLive(j) && (
                    <button
                      className="btn xs ghost"
                      data-role="task-job-cancel"
                      onClick={() => cancelJob(j.id)}
                    >
                      {t('queue.btn.cancel')}
                    </button>
                  )}
                  {!isLive(j) && jobCanRetry(j.id) && (
                    <button
                      className="btn xs ghost"
                      data-role="task-job-retry"
                      onClick={() => retryJob(j.id)}
                    >
                      {t('queue.btn.retry')}
                    </button>
                  )}
                  {!isLive(j) && (
                    <button
                      className="btn xs ghost"
                      data-role="task-job-remove"
                      onClick={() => dismissJob(j.id)}
                    >
                      {t('queue.btn.remove')}
                    </button>
                  )}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      <div className="dock-bar">
        <button
          className="dock-pill"
          data-role="task-dock-toggle"
          title={open ? t('queue.btn.collapse') : t('queue.btn.toggle')}
          onClick={() => setOpen((o) => !o)}
        >
          {active > 0 ? (
            <span className="spinner" />
          ) : failed.length ? (
            <span className="dock-glyph bad">!</span>
          ) : (
            <span className="dock-glyph ok">✓</span>
          )}
          <span className="dock-text" data-role="task-dock-summary">
            {summary}
          </span>
          {active > 0 && (
            <span className="dock-badge" data-role="task-dock-badge">
              {t('queue.badge.remaining', { n: active })}
            </span>
          )}
        </button>
        {/* 全跑完的时候给一个「不用展开也能收掉」的出口，省一次点击 */}
        {active === 0 && (
          <button
            className="dock-dismiss"
            data-role="task-dock-dismiss"
            title={t('queue.btn.clear')}
            onClick={() => clearFinishedJobs()}
          >
            ✕
          </button>
        )}
      </div>
    </div>
  );
}
