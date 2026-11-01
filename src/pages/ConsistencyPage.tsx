import React, { useEffect, useMemo, useRef, useState } from 'react';
import { useStore } from '../state/store';
import { useToast } from '../components/Toast';
import { Empty, StatusPill } from '../components/Modal';
import { IcCheck, IcClose, IcShield, IcSparkles, IcStop } from '../components/icons';
import { useAITask, aiGuardKey } from '../state/aiTasks';
import { enqueueJob, hasLiveJobPrefix, liveJobCount, useJobs } from '../state/jobQueue';
import { runConsistency, runExpand } from '../ai/tasks';
import { formatRelative, uid } from '../lib/id';
import { pt } from '../ai/promptText';
import { useT } from '../i18n';
import type { Entry, ReviewItem } from '../types';

interface Props {
  onOpenEntry: (id: string) => void;
  onNavigate: (route: string) => void;
}

/** 一次「全部生成修订方案」跑完之后的交代 */
interface FixAllResult {
  kind: 'fixAll';
  batchId: string;
  /** 计划生成的修订条数（按目标条目归并之后） */
  planned: number;
  /** 真正送进审查队列的条数 */
  submitted: number;
  /** 被并进同一条修订的问题数 —— 它们自己不再单独占一个队列位置 */
  merged: number;
  /** 目标条目已有待审修订、这次先放过的条目名 */
  heldBack: string[];
  /** 在库里找不到可改条目、生成不了修订的问题标题 */
  orphan: string[];
  /** 中途出错没做完的条目名 */
  failed: string[];
}

/**
 * 一次审计跑完之后的交代。
 *
 * 审计原先只弹一句 toast，那句话说不清作者最想知道的事：**为什么这轮只有这几条。**
 * 是模型没挖出新的，还是它把旧账又报了一遍被拦下了？这两种情况长得一模一样，
 * 而它们该让作者做的事完全不同 —— 前者该去改设定，后者该去处理手上那几条。
 */
interface AuditResult {
  kind: 'audit';
  /** 本轮真正收下的新问题条数 */
  fresh: number;
  /** 模型又报了一遍、被账本拦下的标题 */
  skipped: string[];
  /** 这轮带去的账本 */
  ledger: { total: number; open: number; settled: number; revisit: number; truncated: number };
}

/** 任务槽里存的可能是这两件事之一 —— 同一页、同一个槽 */
type ConsistResult = FixAllResult | AuditResult;

/**
 * 这条问题该改哪个条目。
 *
 * 取「第一个**还在库里**的相关条目」，而不是死取 `relatedEntryIds[0]`：
 * 相关条目被删掉之后，那个 id 指向空气 —— 早先这里会安静地什么都不做，
 * 作者点了按钮只看到「没反应」，比报错还难查。
 */
const fixTargetOf = (issue: ReviewItem, entries: Entry[]): string | null =>
  issue.relatedEntryIds?.find((id) => entries.some((e) => e.id === id)) ?? null;

/** 队列里去重键的前缀 */
const FIX_DEDUPE_PREFIX = 'consist-fix:';

/**
 * 队列键里塞了两件事：**改哪个条目**与**是哪一条问题**。
 * 前者用来守住「同一条条目一次只改一份修订」（同一条目摆两份，作者会不知道按哪份改），
 * 后者用来点亮对应的那张卡 —— 同一条条目上的第二条问题不该跟着一起转圈。
 */
const fixKey = (entryId: string, issueId: string) =>
  `${FIX_DEDUPE_PREFIX}${entryId}:${issueId}`;

/**
 * 「全部生成修订方案」的施工图：按目标条目把待处理问题归并。
 *
 * 归并而不是一条问题发一次请求，有两个理由：
 *   1. 同一个条目连着改三遍，后一次会把前一次的结果推翻 —— 作者拿到的是三份互相打架的方案；
 *   2. 一条修订只该占队列里一个位置，「同一目标不叠两份待审」这条纪律才守得住。
 */
function planFixes(issues: ReviewItem[], entries: Entry[]): [string, ReviewItem[]][] {
  const byTarget = new Map<string, ReviewItem[]>();
  for (const issue of issues) {
    const id = fixTargetOf(issue, entries);
    if (!id) continue;
    const bucket = byTarget.get(id);
    if (bucket) bucket.push(issue);
    else byTarget.set(id, [issue]);
  }
  return [...byTarget.entries()];
}

export function ConsistencyPage({ onOpenEntry, onNavigate }: Props) {
  const store = useStore();
  const toast = useToast();
  // 扫描与「改一条」「全部改」共用同一个任务槽：它们在同一个页面上，本来也只允许跑一件，
  // 合成一条之后侧栏「一致性检查」那一格的转圈语义才干净。
  // 结果经由 `setResult` 存进全局任务槽 —— 要的不只是「切页也不中断」，
  // 还有「切回来结果卡还在」。
  const ai = useAITask<ConsistResult>('consist.scan', 'consistency');
  const t = useT();
  /** 列表筛选：默认只看待处理 —— 已判定的混在里面，「怎么老这几条」有一半是这么来的 */
  const [showAll, setShowAll] = useState(false);

  /**
   * 单条「让 AI 生成修订方案」走**右下角的任务队列**，不再直接调 `ai.run()`。
   *
   * 以前这里调的是同一个 `consist.scan` 槽，而那个 `run()` 的纪律是「同一个 key 还在跑就直接
   * 返回 null」（防结果互相覆盖）—— 单发场景没问题，可作者手快连点三条时，**后两条会静默消失**：
   * 按钮闪一下、什么也没发生、也没有任何交代。那不是「慢」，是「按了没反应」，比报错还让人不放心。
   *
   * 改成入队之后，「点几条就做几条」成了明确承诺：排队、按点下去的顺序逐件做，右下角看得见进度，
   * 中途还能撤单。
   */
  const jobs = useJobs();
  /** 眼下排在队里的问题 id —— 用来点亮对应的那张卡（纯显示用，判断别拿它） */
  const queuedIssueIds = useMemo(() => {
    const set = new Set<string>();
    for (const j of jobs) {
      if (!j.dedupeKey?.startsWith(FIX_DEDUPE_PREFIX)) continue;
      if (j.status !== 'queued' && j.status !== 'running') continue;
      const issueId = j.dedupeKey.slice(FIX_DEDUPE_PREFIX.length).split(':')[1];
      if (issueId) set.add(issueId);
    }
    return set;
  }, [jobs]);

  /**
   * 本次「全部生成修订」自己打出去的批号。
   *
   * 跑的过程中会一条条往队列里推修订，而那些修订的目标正是施工图上的条目 ——
   * 若不加区分，第二圈渲染就会把它们自己当成「已有待审修订」而把施工图越缩越小，
   * 界面上的条数会一路掉。把自己产出的那批排除掉，施工图在跑的过程中就是稳定的。
   */
  const [runBatchId, setRunBatchId] = useState<string | null>(null);

  /**
   * 队列里的活儿是**过一会儿**才跑的（前面可能压着好几件），而闭包里的 `store` 是入队那一刻的。
   * 让它一直指向最新的那一份 —— 否则一件活儿轮到时，手里的库可能是几轮之前的。
   *
   * 注意区分：**读**（世界内容、条目、分类）要按入队那一刻的快照走，那是作者的意图；
   * **写**（推审查、标记处理）必须打在当下这份库上，否则会覆盖掉这期间别人的改动。
   */
  const liveStore = useRef(store);
  useEffect(() => {
    liveStore.current = store;
  });

  const issues = store.review
    .filter((r) => r.kind === 'consistency')
    .sort((a, b) => {
      const w = { high: 0, medium: 1, low: 2 } as Record<string, number>;
      return (w[a.severity ?? 'medium'] ?? 1) - (w[b.severity ?? 'medium'] ?? 1);
    });

  const pendingIssues = issues.filter((i) => i.status === 'pending');
  /** 列表里真正摆出来的那些 —— 「全部」时才算上已判定的 */
  const visibleIssues = showAll ? issues : pendingIssues;

  /* ------------------------ 全部生成修订方案 ------------------------ */

  const plan = planFixes(pendingIssues, store.entries);

  /** 已经有待审修订/删除提议的条目先放过：同一条目同时摆两份提议，作者会不知道按哪份 */
  const heldTargets = new Set(
    store.review
      .filter(
        (r) =>
          r.status === 'pending' &&
          (r.kind === 'update-entry' || r.kind === 'delete-entry') &&
          r.targetEntryId &&
          // 但本次自己刚推出去的那批不算 —— 见上面 runBatchId 那段
          (!runBatchId || r.batchId !== runBatchId),
      )
      .map((r) => r.targetEntryId as string),
  );
  const readyPlan = plan.filter(([id]) => !heldTargets.has(id));
  const heldPlan = plan.filter(([id]) => heldTargets.has(id));
  const heldIssueCount = heldPlan.reduce((n, [, list]) => n + list.length, 0);
  const orphanIssues = pendingIssues.filter((i) => !fixTargetOf(i, store.entries));

  // 跑着的时候施工图会随队列变化，条数改用任务槽里的总数（它从起跑那一刻就定住了）
  const fixCount = ai.loading ? (ai.progress?.total ?? readyPlan.length) : readyPlan.length;
  // 面板要不要露头：够两条才值得给「全部」这个入口（只一条时旁边那张卡片上的按钮就够了），
  // 但跑着的时候必须留着 —— 否则作者切页回来看到的是「侧栏在转圈，页面上什么都没有」。
  const showFixAll = ai.loading ? plan.length > 0 : readyPlan.length >= 2;

  const runAllFixes = async () => {
    const world = store.activeWorld;
    if (!world) return;
    if (!readyPlan.length) {
      toast.warn(t('consist.toast.fixAllHeld'));
      return;
    }

    // 起跑时按下快照：整批共用同一份「世界里已经有什么」。
    // 跑到一半作者若在别处采纳了什么，也不该让这批后面换了套参照。
    const entriesSnap = store.entries;
    const catsSnap = store.categories;
    const settings = store.settings.ai;
    const batchId = uid('bt');
    const queue = readyPlan.map(([entryId, list]) => ({ entryId, list }));
    const heldNames = heldPlan.map(
      ([id]) => entriesSnap.find((e) => e.id === id)?.title ?? t('consist.related.deleted'),
    );
    const orphans = orphanIssues.map((i) => i.title);
    // 立刻记下自己的批号，好让施工图在跑的过程中不把自己的产出算成「别处的待审修订」
    setRunBatchId(batchId);

    const summary = await ai.run<FixAllResult>(async ({ signal }) => {
      const submitted: string[] = [];
      const covered: string[] = [];
      const failed: string[] = [];

      for (let i = 0; i < queue.length; i++) {
        if (signal.aborted) break;
        const { entryId, list } = queue[i];
        const entry = entriesSnap.find((e) => e.id === entryId);
        if (!entry) {
          failed.push(t('consist.related.deleted'));
          continue;
        }
        ai.setProgress({ done: i, total: queue.length, label: entry.title });

        // 一处问题用单条那条模板（措辞更贴合「就改这一处」），
        // 多处用合并模板（它会提醒模型「几处改动互相牵动，一起想」）。
        const instruction =
          list.length === 1
            ? pt('consistencyFix', {
                issue: list[0].title,
                detail: list[0].rationale,
                suggestion: list[0].suggestion ?? '',
              })
            : pt('consistencyFixMany', {
                n: list.length,
                list: list
                  .map((it, k) =>
                    pt('consistencyFixItem', {
                      i: k + 1,
                      issue: it.title,
                      detail: it.rationale,
                      suggestion: it.suggestion ?? '',
                    }),
                  )
                  .join('\n\n'),
              });

        try {
          const item = await runExpand(settings, world, entry, entriesSnap, catsSnap, instruction, {
            signal,
          });
          // 同一批打同一个批号：审查页据此把它们归到一起，并提供「采纳这一批」。
          await store.pushReview([{ ...item, batchId }]);
          submitted.push(entry.title);
          covered.push(...list.map((it) => it.id));
        } catch {
          if (signal.aborted) break;
          failed.push(entry.title);
        }
      }

      // 修订方案已经摆到队列里了，这一页就不该再挂着同样的问题 ——
      // 否则同一条冲突在两边都「待办」，作者会重复处理。
      for (const id of covered) await store.acceptReview(id, {});

      return {
        kind: 'fixAll' as const,
        batchId,
        planned: queue.length,
        submitted: submitted.length,
        merged: covered.length - submitted.length,
        heldBack: heldNames,
        orphan: orphans,
        failed,
      };
    });

    if (!summary) {
      // 失败（已经弹过错误）。顺手把上一批的结果收掉 —— 留着会让人以为它就是刚才那次跑的
      ai.setResult(null);
      setRunBatchId(null);
      return;
    }
    // 结果必须**显式**放进全局任务槽：`run` 只负责跑，不会帮你存。
    // 不存的话，切走再回来这段就什么都看不见了（而那正是这个功能的意义所在）。
    ai.setResult(summary);
    // 跑完了就把自己的批号摘掉：这批产出的修订从此也是「队列里已有的待审修订」，
    // 下一轮再点「全部」时该被放过 —— 否则同一个条目会被叠上第二份修订。
    setRunBatchId(null);
    if (summary.submitted) toast.success(t('consist.toast.fixAllDone', { n: summary.submitted }));
    else toast.warn(t('consist.toast.fixAllNothing'));
  };

  /**
   * 跑一次审计。
   *
   * 关键差别在**把账本一起送过去**：`store.review` 里那些既有的问题不是只给模型读的，
   * 它们同时决定了「哪些答案会被拒收」。入库前还会再拦一道 —— 模型未必听话，
   * 而它不听话的部分不该由作者来发现。
   */
  const runAudit = async () => {
    if (store.entries.length < 2) {
      toast.warn(t('consist.toast.needEntries'));
      return;
    }
    const world = store.activeWorld;
    if (!world) return;

    // 起跑那一刻的账本：跑到一半作者若在别处处理掉一条，不该让这次审计前后换了套判据
    const history = store.review;
    const out = await ai.run((opts) =>
      runConsistency(
        store.settings.ai,
        world,
        store.entries,
        store.categories,
        history,
        opts,
      ),
    );
    if (!out) {
      // 失败（已经弹过错误）或作者自己按了停止 —— 顺手把上一轮的结果收掉，
      // 留着会让人以为它就是刚才那次跑的
      ai.setResult(null);
      return;
    }

    if (out.items.length) await store.pushReview(out.items);
    ai.setResult({
      kind: 'audit',
      fresh: out.items.length,
      skipped: out.skipped,
      ledger: {
        total: out.ledger.entries.length,
        open: out.ledger.open,
        settled: out.ledger.settled,
        revisit: out.ledger.revisit,
        truncated: out.ledger.truncated,
      },
    });

    if (out.items.length) toast.success(t('consist.toast.foundNew', { n: out.items.length }));
    else if (out.skipped.length) toast.toast(t('consist.toast.foundAllDup', { n: out.skipped.length }));
    // 「账本压着」与「真的没发现问题」是两回事，不能共用一句 ——
    // 前者说成「没有发现冲突」会让作者以为设定已经干净了
    else if (out.ledger.entries.length)
      toast.toast(t('consist.toast.foundNothingNew', { n: out.ledger.entries.length }));
    else toast.success(t('consist.toast.noIssues'));
  };

  /**
   * 针对某个冲突，让 AI 生成对应条目的修订建议（再进审查队列）。
   *
   * 这是个**入队动作**，不是「跑一件活儿」：它立刻返回，真正的工作排到队列里按顺序做。
   * 所以这里能连点 —— 点几条就是几条。
   */
  const generateFix = (issueId: string, entryId: string) => {
    const issue = store.review.find((r) => r.id === issueId);
    const entry = store.entries.find((e) => e.id === entryId);
    if (!issue || !entry) return;

    // 先把 AI 配置拦一道：不然每一件都会在右下角挂一条红色失败，
    // 而作者真正需要的是「去设置里填一下」这一句。
    const missing = aiGuardKey(store.settings.ai);
    if (missing) {
      toast.error(t(missing));
      return;
    }

    // 同一条条目上只该摆一份修订 —— 与「全部生成修订方案」的归并是同一条纪律。
    // 队列里已经在做它了，就不该再排第二份（作者会不知道按哪份改）。
    //
    // 这里问的是**队列模块本身**，不是上面那份给界面用的快照：一口气连点三下时，
    // 三下都发生在 React 重渲染之前，快照里一件都还没排上。
    if (hasLiveJobPrefix(`${FIX_DEDUPE_PREFIX}${entryId}:`)) {
      toast.toast(t('consist.queue.sameTarget', { title: entry.title }));
      return;
    }
    // 库里已经有一份待审的修订/删除提议更是如此：等它被处理掉再生成
    const hasPending = store.review.some(
      (r) =>
        r.status === 'pending' &&
        (r.kind === 'update-entry' || r.kind === 'delete-entry') &&
        r.targetEntryId === entryId,
    );
    if (hasPending) {
      toast.warn(t('consist.queue.hasPending', { title: entry.title }));
      return;
    }

    // 排队前按下快照：轮到它的时候，世界可能已经被别处的活儿改过了。
    // 这一件该用「点下去那一刻」的世界，作者按的也是那一刻的判断。
    const world = store.activeWorld!;
    const settings = store.settings.ai;
    const entriesSnap = store.entries;
    const catsSnap = store.categories;
    const instruction = pt('consistencyFix', {
      issue: issue.title,
      detail: issue.rationale,
      suggestion: issue.suggestion ?? '',
    });

    const added = enqueueJob({
      label: t('consist.queue.label', { title: entry.title }),
      group: t('consist.queue.group'),
      dedupeKey: fixKey(entryId, issueId),
      worldId: world.id,
      run: async (signal) => {
        const item = await runExpand(
          settings,
          world,
          entry,
          entriesSnap,
          catsSnap,
          instruction,
          { signal },
        );
        await liveStore.current.pushReview([item]);
        // 生成成功才算处理过这条问题 —— 失败了问题得留在原地，好让作者重试
        await liveStore.current.acceptReview(issueId, {});
        return t('consist.queue.note');
      },
    });

    if (added) toast.success(t('consist.queue.queued', { n: liveJobCount() }));
    else toast.toast(t('consist.queue.exists'));
  };

  if (!store.activeWorld) return <Empty icon="🌍" title={t('consist.noWorld')} />;

  const sevCount = (s: string) => pendingIssues.filter((i) => i.severity === s).length;

  return (
    <>
      <div className="page-head">
        <div>
          <h1 className="page-title">{t('consist.title')}</h1>
          <p className="page-desc">{t('consist.desc')}</p>
        </div>
        <div className="page-actions">
          <button
            className="btn primary sm"
            data-role="consist-audit"
            onClick={runAudit}
            disabled={ai.loading}
          >
            {ai.loading ? <span className="spinner" /> : <IcShield size={14} />}
            {ai.loading ? t('consist.btn.auditing') : t('consist.btn.audit')}
          </button>
          {ai.loading && (
            <button className="btn sm" data-role="consist-abort" onClick={ai.abort}>
              <IcStop size={14} /> {t('consist.btn.abort')}
            </button>
          )}
        </div>
      </div>

      <div className="grid c4">
        <div className={`stat ${sevCount('high') ? 'warn' : ''}`} data-role="consist-stat" data-key="high">
          <div className="stat-num">{sevCount('high')}</div>
          <div className="stat-label">{t('consist.stat.high')}</div>
        </div>
        <div className="stat" data-role="consist-stat" data-key="medium">
          <div className="stat-num">{sevCount('medium')}</div>
          <div className="stat-label">{t('consist.stat.medium')}</div>
        </div>
        <div className="stat" data-role="consist-stat" data-key="low">
          <div className="stat-num">{sevCount('low')}</div>
          <div className="stat-label">{t('consist.stat.low')}</div>
        </div>
        <div className="stat success" data-role="consist-stat" data-key="handled">
          <div className="stat-num">{issues.filter((i) => i.status === 'accepted').length}</div>
          <div className="stat-label">{t('consist.stat.handled')}</div>
        </div>
      </div>

      <div className="banner info mt16">
        <IcShield size={16} />
        <div>
          <span className="bold">{t('consist.scope.title')}</span>
          <div className="mt8">
            {t('consist.scope.desc', {
              n: store.entries.length,
              limit: store.settings.ai.contextLimit || 60,
            })}
          </div>
          {/* 账本的存在必须在跑之前就讲清楚：不然「怎么没新问题」看上去就像检查坏了 */}
          <div className="mt8 muted" data-role="consist-scope-ledger">
            {issues.length
              ? t('consist.scope.ledger', { n: issues.length })
              : t('consist.scope.ledgerEmpty')}
          </div>
        </div>
      </div>

      {ai.loading && ai.stream && <div className="stream-box mt16">{ai.stream.slice(-3000)}</div>}

      {/* 一次能给好几条问题生成修订时，才值得给「全部」这个入口 */}
      {showFixAll && (
        <div className="banner info mt16" data-role="consist-fixall-bar">
          <IcSparkles size={16} />
          <div className="grow">
            <span className="bold" data-role="consist-fixall-title">
              {t('consist.fixAll.title', { n: fixCount })}
            </span>
            <div className="mt8">{t('consist.fixAll.desc')}</div>
            {heldIssueCount > 0 && (
              <div className="mt8 muted" data-role="consist-fixall-held">
                {t('consist.fixAll.someHeld', { n: heldIssueCount })}
              </div>
            )}
          </div>
          <button
            className="btn primary sm"
            data-role="consist-fixall"
            disabled={ai.loading}
            onClick={runAllFixes}
          >
            {ai.loading ? <span className="spinner" /> : <IcSparkles size={14} />}
            {ai.loading
              ? t('consist.btn.fixAllRunning')
              : t('consist.btn.fixAll', { n: fixCount })}
          </button>
        </div>
      )}

      {ai.loading && ai.progress && (
        <div className="batch-progress mt16" data-role="consist-fixall-progress">
          <div className="batch-bar">
            <i
              style={{
                width: `${Math.round(
                  (Math.min(ai.progress.done + 1, ai.progress.total) / Math.max(1, ai.progress.total)) *
                    100,
                )}%`,
              }}
            />
          </div>
          <div className="tiny muted mt8" data-role="consist-fixall-progress-text">
            {t('consist.fixAll.progress', {
              done: Math.min(ai.progress.done + 1, ai.progress.total),
              total: ai.progress.total,
              label: ai.progress.label,
            })}
          </div>
        </div>
      )}

      {/* 审计的结果卡：新增几条、拦下几条、账本里还有多少条没动 ——
          这三样合起来才回答得了「为什么这次只有这几条」 */}
      {ai.result?.kind === 'audit' && !ai.loading && (
        <div className="batch-result mt16" data-role="consist-audit-result">
          <div className="batch-head">
            <IcCheck size={15} />
            <span className="bold" data-role="consist-audit-count">
              {ai.result.fresh
                ? t('consist.audit.newTitle', { n: ai.result.fresh })
                : t('consist.audit.cleanTitle')}
            </span>
            <div className="grow" />
            <button
              className="btn xs ghost"
              data-role="consist-audit-dismiss"
              onClick={ai.reset}
            >
              {t('consist.fixAll.dismiss')}
            </button>
          </div>
          <div className="small mt8">{t('consist.audit.desc')}</div>
          <ul className="tiny muted mt8" style={{ margin: 0, paddingLeft: 18, lineHeight: 1.85 }}>
            {ai.result.skipped.length > 0 && (
              <li data-role="consist-audit-skipped">
                {t('consist.audit.skipped', {
                  n: ai.result.skipped.length,
                  titles: ai.result.skipped.join(t('common.listSep')),
                })}
              </li>
            )}
            {ai.result.ledger.total > 0 && (
              <li data-role="consist-audit-ledger">
                {t('consist.audit.ledger', {
                  n: ai.result.ledger.total,
                  open: ai.result.ledger.open,
                  settled: ai.result.ledger.settled,
                  revisit: ai.result.ledger.revisit,
                })}
                {ai.result.ledger.truncated > 0 &&
                  t('consist.audit.ledgerMore', { n: ai.result.ledger.truncated })}
              </li>
            )}
            {/* 说清「账本压着」这件事 —— 判据是**账本非空**，不是「还有待处理的」：
                作者把老账全忽略掉之后，「怎么还是没新问题」更需要一句解释 */}
            {!ai.result.fresh && ai.result.ledger.total > 0 && (
              <li data-role="consist-audit-clean">
                {t('consist.audit.cleanNote', { n: ai.result.ledger.total })}
              </li>
            )}
          </ul>
        </div>
      )}

      {ai.result?.kind === 'fixAll' && !ai.loading && (
        <div className="batch-result mt16" data-role="consist-fixall-result">
          <div className="batch-head">
            <IcCheck size={15} />
            <span className="bold" data-role="consist-fixall-count">
              {t('consist.fixAll.resultTitle', { n: ai.result.submitted })}
            </span>
            <div className="grow" />
            <button
              className="btn xs primary"
              data-role="consist-fixall-review"
              onClick={() => onNavigate('review')}
            >
              {t('consist.fixAll.goReview', { n: store.stats.reviewPending })}
            </button>
            <button className="btn xs ghost" data-role="consist-fixall-dismiss" onClick={ai.reset}>
              {t('consist.fixAll.dismiss')}
            </button>
          </div>
          <div className="small mt8">{t('consist.fixAll.resultDesc')}</div>
          <ul className="tiny muted mt8" style={{ margin: 0, paddingLeft: 18, lineHeight: 1.85 }}>
            {ai.result.merged > 0 && (
              <li data-role="consist-fixall-merged">
                {t('consist.fixAll.merged', { n: ai.result.merged })}
              </li>
            )}
            {ai.result.heldBack.length > 0 && (
              <li data-role="consist-fixall-heldback">
                {t('consist.fixAll.heldBack', { n: ai.result.heldBack.length })}
              </li>
            )}
            {ai.result.orphan.length > 0 && (
              <li data-role="consist-fixall-orphan">
                {t('consist.fixAll.orphan', { n: ai.result.orphan.length })}
              </li>
            )}
            {ai.result.failed.length > 0 && (
              <li data-role="consist-fixall-failed">
                {t('consist.fixAll.failed', { n: ai.result.failed.length })}
              </li>
            )}
          </ul>
        </div>
      )}

      {/* 列表筛选。已判定的那些是历史，不该和待处理的一起占着视线 ——
          「查完还是那几条」有一半是这么来的。 */}
      {issues.length > 0 && (
        <div className="row mt16" style={{ gap: 8 }} data-role="consist-filter">
          <button
            className={`btn xs ${showAll ? '' : 'primary'}`}
            data-role="consist-filter-pending"
            onClick={() => setShowAll(false)}
          >
            {t('consist.filter.pending', { n: pendingIssues.length })}
          </button>
          <button
            className={`btn xs ${showAll ? 'primary' : ''}`}
            data-role="consist-filter-all"
            onClick={() => setShowAll(true)}
          >
            {t('consist.filter.all', { n: issues.length })}
          </button>
        </div>
      )}

      <div className="mt16">
        {visibleIssues.length === 0 ? (
          issues.length === 0 ? (
            <Empty
              icon="🛡️"
              title={t('consist.empty.title')}
              desc={t('consist.empty.desc')}
            />
          ) : (
            <Empty
              icon="✅"
              title={t('consist.empty.cleared')}
              desc={t('consist.empty.clearedDesc')}
            />
          )
        ) : (
          visibleIssues.map((issue, idx) => (
            <div key={issue.id} className="review-item" data-role="consist-issue" data-idx={idx}>
              <div className="review-head">
                {issue.severity && <StatusPill status={issue.severity} />}
                <span className="review-title">{issue.title}</span>
                <StatusPill status={issue.status} />
                <span className="muted tiny" style={{ marginLeft: 'auto' }}>
                  {formatRelative(issue.createdAt)}
                </span>
              </div>

              <div className="mt8 small" style={{ lineHeight: 1.75 }}>
                {issue.rationale}
              </div>

              {issue.relatedEntryIds && issue.relatedEntryIds.length > 0 && (
                <div className="row wrap mt8" style={{ gap: 6 }}>
                  <span className="muted tiny">{t('consist.related')}</span>
                  {issue.relatedEntryIds.map((id) => (
                    <button
                      key={id}
                      className="pill pointer"
                      style={{ border: 'none', cursor: 'pointer' }}
                      onClick={() => onOpenEntry(id)}
                    >
                      {store.entries.find((e) => e.id === id)?.title ?? t('consist.related.deleted')}
                    </button>
                  ))}
                </div>
              )}

              {issue.suggestion && (
                <div
                  style={{
                    marginTop: 10,
                    padding: '9px 12px',
                    background: 'var(--primary-soft)',
                    borderRadius: 8,
                    fontSize: 12.8,
                    lineHeight: 1.7,
                    color: 'var(--primary-dark)',
                  }}
                >
                  <span className="bold">{t('consist.suggestion')}</span>
                  {issue.suggestion}
                </div>
              )}

              {issue.status === 'pending' && (
                <div className="review-actions">
                  {issue.relatedEntryIds?.[0] && fixTargetOf(issue, store.entries) && (
                    <button
                      className="btn primary sm"
                      data-role="consist-fix"
                      disabled={queuedIssueIds.has(issue.id) || ai.loading}
                      onClick={() => generateFix(issue.id, fixTargetOf(issue, store.entries)!)}
                    >
                      {queuedIssueIds.has(issue.id) ? (
                        <span className="spinner" />
                      ) : (
                        <IcSparkles size={14} />
                      )}
                      {t('consist.btn.generateFix')}
                    </button>
                  )}
                  <button
                    className="btn success sm"
                    data-role="consist-handle"
                    onClick={async () => {
                      await store.acceptReview(issue.id);
                      toast.success(t('consist.toast.handled'));
                    }}
                  >
                    <IcCheck size={14} /> {t('consist.btn.markHandled')}
                  </button>
                  <button
                    className="btn danger sm"
                    data-role="consist-ignore"
                    onClick={async () => {
                      await store.rejectReview(issue.id);
                      toast.toast(t('consist.toast.ignored'));
                    }}
                  >
                    <IcClose size={14} /> {t('consist.btn.ignore')}
                  </button>
                </div>
              )}
            </div>
          ))
        )}
      </div>

      {pendingIssues.length > 0 && (
        <div className="mt16 center">
          <button className="btn sm" onClick={() => onNavigate('review')}>
            {t('consist.gotoReview', { n: store.stats.reviewPending })}
          </button>
        </div>
      )}
    </>
  );
}
