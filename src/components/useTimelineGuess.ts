/**
 * 「AI 猜测条目时间」这件事的**唯一一份实现**（入队 → 对账 → 进审查队列）。
 *
 * 与 `useTimelineLayout` 是姊妹：两者都挂在编年的「AI 行为」子菜单里，都是
 * 入队动作、结果进审查队列、不直接落库。区别只在**对谁下手**：
 *   - 排版给**已有时间**的条目定先后（只动 `at`，锁定的顺带改 `from`）；
 *   - 猜测给**没有时间**的池子条目定出时间（`from` + `at` 一起），替作者编日期。
 *
 * 对账逻辑刻意简化：猜测只对「当时还没设时间」的条目生效，落库前再确认一次
 * 它此刻仍然没设时间 —— 作者这期间自己补了时间，就跳过，别覆盖。
 */
import { useCallback, useEffect, useMemo, useRef } from 'react';
import { useStore } from '../state/store';
import { useToast } from './Toast';
import { useT } from '../i18n';
import { aiGuardKey } from '../state/aiTasks';
import { enqueueJob, hasLiveJobPrefix, liveJobCount, useJobs } from '../state/jobQueue';
import { runTimelineGuess } from '../ai/tasks';
import { uid } from '../lib/id';
import type { ReviewItem } from '../types';

export function useTimelineGuess() {
  const store = useStore();
  const toast = useToast();
  const t = useT();

  const guessKey = `tl-guess:${store.activeWorld?.id ?? ''}`;
  const jobs = useJobs();
  const job = useMemo(
    () =>
      jobs.find(
        (j) => j.dedupeKey === guessKey && (j.status === 'queued' || j.status === 'running'),
      ) ?? null,
    [jobs, guessKey],
  );

  /** 已经躺在审查队列里的猜测方案 —— 横幅靠它 */
  const plan = useMemo(
    () => store.review.find((r) => r.kind === 'timeline-guess' && r.status === 'pending') ?? null,
    [store.review],
  );

  const live = useRef(store);
  useEffect(() => {
    live.current = store;
  });

  const run = useCallback(() => {
    const world = store.activeWorld;
    if (!world) return;
    // 池子里得真有条目可猜，否则跑了也是「没有可猜的」
    const untimed = store.entries.filter((e) => !e.time).length;
    if (untimed === 0) {
      toast.warn(t('time.guess.needPool'));
      return;
    }
    const missing = aiGuardKey(store.settings.ai);
    if (missing) {
      toast.error(t(missing));
      return;
    }
    if (hasLiveJobPrefix(guessKey)) {
      toast.toast(t('time.guess.exists'));
      return;
    }

    const settings = store.settings.ai;
    const entriesSnap = store.entries;
    const catsSnap = store.categories;

    const added = enqueueJob({
      label: t('time.guess.label', { world: world.name }),
      group: t('time.guess.group'),
      dedupeKey: guessKey,
      worldId: world.id,
      navKey: 'graph',
      run: async (signal) => {
        const out = await runTimelineGuess(settings, world, entriesSnap, catsSnap, { signal });

        // 落库前再和当下库对账：只留「此刻仍然没设时间」的条目 ——
        // 作者这期间自己补过时间的，跳过，别覆盖。
        const nowEntries = live.current.entries;
        const items = out.items.filter((it) => {
          const e = nowEntries.find((x) => x.id === it.entryId);
          return !!e && !e.time;
        });

        if (!items.length) {
          return out.unmatched.length
            ? t('time.guess.unmatched', { n: out.unmatched.length })
            : t('time.guess.noChange');
        }

        const rest = out.total - out.sent;
        const item: ReviewItem = {
          id: uid('rv'),
          worldId: world.id,
          kind: 'timeline-guess',
          title: t('time.guess.planTitle', { n: items.length }),
          note: [
            rest > 0 ? t('time.guess.planNote', { sent: out.sent, rest }) : '',
            out.unmatched.length
              ? t('time.guess.planUnmatched', {
                  n: out.unmatched.length,
                  titles: out.unmatched.slice(0, 6).join(t('common.listSep')),
                })
              : '',
          ]
            .filter(Boolean)
            .join(' '),
          rationale: out.note,
          status: 'pending',
          createdAt: Date.now(),
          guessDraft: items,
          source: { task: 'timeline-guess' },
        };
        await live.current.pushReview([item]);
        return t('time.guess.note', { n: items.length });
      },
    });

    if (added) toast.success(t('time.guess.queued', { n: liveJobCount() }));
    else toast.toast(t('time.guess.exists'));
  }, [store, toast, t, guessKey]);

  return { job, plan, run };
}
