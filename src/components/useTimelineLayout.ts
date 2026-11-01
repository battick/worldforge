/**
 * 「AI 自动排版」这件事的**唯一一份实现**（入队 → 对账 → 进审查队列）。
 *
 * 为什么抽出来：时间轴有**两种读法**（`TimeAxis` 的点轴、`ChronicleView` 的编年），
 * 它们看的是同一份 `Entry.time`，所以「让 AI 排一遍」也必须只有一份实现 ——
 * 抄第二份出去，两边迟早会在「怎么对账」「什么时候算没改动」上分岔，
 * 而作者看到的将是「同一个按钮在两页里给出不同结果」。
 *
 * 这套逻辑有三处不显然、但都不能省的地方：
 *
 *   ① **它是入队动作，不是跑一件活儿**。按下去立刻返回，真正的工作排到右下角那条
 *      队列里做 —— 于是它不怕连点（第二下会被去重拦下），切页也不会中断。
 *   ② **读按入队那一刻、写按当下那一刻**。队列可能压着别的活儿，等轮到它时页面上的
 *      `store` 早就过期了；拿旧快照去覆盖，等于把作者这期间自己拖过、改过的调整抹掉。
 *      所以落库前要拿**当下**的库逐条对账：位置已经和提案一样、又没有别的要改的行，
 *      直接丢掉。
 *   ③ **结果进审查队列，不直接落库**。AI 只提议，改不改是作者的事 —— 这条不因为
 *      「在哪个视图点的」而改变。
 */
import { useCallback, useEffect, useMemo, useRef } from 'react';
import { useStore } from '../state/store';
import { useToast } from './Toast';
import { useT } from '../i18n';
import { aiGuardKey } from '../state/aiTasks';
import { enqueueJob, hasLiveJobPrefix, liveJobCount, useJobs } from '../state/jobQueue';
import { runTimelineLayout } from '../ai/tasks';
import { uid } from '../lib/id';
import type { ReviewItem } from '../types';

export function useTimelineLayout() {
  const store = useStore();
  const toast = useToast();
  const t = useT();

  /**
   * 判「这件活儿排过没有」问的是**队列模块本身**（同步、永远最新），
   * 而 `useJobs()` 这份快照只负责显示 —— 一口气点两下时，第二下发生在 React
   * 重渲染之前，拿快照去拦会一律判成「没人排过」。
   */
  const layoutKey = `tl-layout:${store.activeWorld?.id ?? ''}`;
  const jobs = useJobs();
  const job = useMemo(
    () =>
      jobs.find(
        (j) => j.dedupeKey === layoutKey && (j.status === 'queued' || j.status === 'running'),
      ) ?? null,
    [jobs, layoutKey],
  );

  /** 已经躺在审查队列里的排版方案 —— 两处那条横幅都靠它 */
  const plan = useMemo(
    () => store.review.find((r) => r.kind === 'timeline-layout' && r.status === 'pending') ?? null,
    [store.review],
  );

  /** 写必须打在**当下**这份库上，理由见文件头第 ② 条 */
  const live = useRef(store);
  useEffect(() => {
    live.current = store;
  });

  const run = useCallback(() => {
    const world = store.activeWorld;
    if (!world) return;
    if (store.entries.length < 2) {
      toast.warn(t('time.layout.needEntries'));
      return;
    }
    // 先把 AI 配置拦一道：不然会排上一件注定失败、只在右下角留个红条的活儿
    const missing = aiGuardKey(store.settings.ai);
    if (missing) {
      toast.error(t(missing));
      return;
    }
    if (hasLiveJobPrefix(layoutKey)) {
      toast.toast(t('time.layout.exists'));
      return;
    }

    const settings = store.settings.ai;
    const entriesSnap = store.entries;
    const catsSnap = store.categories;

    const added = enqueueJob({
      label: t('time.layout.label', { world: world.name }),
      group: t('time.layout.group'),
      dedupeKey: layoutKey,
      worldId: world.id,
      navKey: 'graph',
      run: async (signal) => {
        const out = await runTimelineLayout(settings, world, entriesSnap, catsSnap, { signal });

        /*
         * 落库前再和**当下**的库对一次账。方案是相对某一份库算出来的，
         * 而排队这段时间里作者可能自己拖过、改过、删过 —— 拿旧账去覆盖，
         * 等于把他刚做的调整抹掉。这里只留「此刻仍然真的会发生」的那些行。
         */
        const nowEntries = live.current.entries;
        const items = out.items.filter((it) => {
          const e = nowEntries.find((x) => x.id === it.entryId);
          if (!e) return false;
          const at = typeof e.time?.at === 'number' ? e.time.at : null;
          if (at === null || Math.round(at * 10) !== Math.round(it.at * 10)) return true;
          return it.era !== undefined || it.weight !== undefined;
        });

        if (!items.length) {
          // 「不用动」与「它报了一堆对不上的东西」都是结论，但该让作者做的事完全不同
          return out.unmatched.length
            ? t('time.layout.unmatched', { n: out.unmatched.length })
            : t('time.layout.noChange');
        }

        const rest = out.total - out.sent;
        const item: ReviewItem = {
          id: uid('rv'),
          worldId: world.id,
          kind: 'timeline-layout',
          title: t('time.layout.planTitle', { n: items.length }),
          // note 会被渲染成一条 ⚠ —— 它只在「这次没把话说全」时才该出现
          note: [
            rest > 0 ? t('time.layout.planNote', { sent: out.sent, rest }) : '',
            out.unmatched.length
              ? t('time.layout.planUnmatched', {
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
          layoutDraft: items,
          source: { task: 'timeline-layout' },
        };
        await live.current.pushReview([item]);
        return t('time.layout.note', { n: items.length });
      },
    });

    if (added) toast.success(t('time.layout.queued', { n: liveJobCount() }));
    else toast.toast(t('time.layout.exists'));
  }, [store, toast, t, layoutKey]);

  return { job, plan, run };
}
