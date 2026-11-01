import React, { useEffect, useMemo, useRef, useState } from 'react';
import { useStore } from '../state/store';
import { useToast } from '../components/Toast';
import { Empty, Modal, StatusPill } from '../components/Modal';
import { EntryEditor } from '../components/EntryEditor';
import {
  IcCheck,
  IcEdit,
  IcPlus,
  IcSearch,
  IcSparkles,
  IcStop,
  IcTrash,
} from '../components/icons';
import { formatRelative, uid } from '../lib/id';
import { aiGuardKey } from '../state/aiTasks';
import {
  cancelJob,
  enqueueJob,
  enqueueJobs,
  jobsSnapshot,
  liveJobCount,
  useJobs,
  type JobRun,
} from '../state/jobQueue';
import { runPolish } from '../ai/tasks';
import { POLISH_FOCUS, type PolishFocus } from '../ai/prompts';
import { useT } from '../i18n';
import type { MsgKey } from '../i18n';
import type { AISettings, Category, Entry, EntryStatus, World } from '../types';

interface Props {
  focusEntryId?: string | null;
  onOpenEntry: (id: string) => void;
  onCloseEntry: () => void;
  onNavigate: (route: string) => void;
  /**
   * 嵌进 Wiki（当它的「编辑」子页）时为 true。
   *
   * 只影响一件事：**不再渲染自己的页标题**。那一层已经被 Wiki 的标题占着了，
   * 再摆一个「条目库」就是同一页上两个大标题。操作按钮一个不少 ——
   * 那些按钮是这一支唯一能新建条目/分类的地方，藏起来等于功能没了。
   *
   * 其余 DOM（分类导航、行、批量面板、`data-role`）**一律不动**：
   * e2e 与巡检都靠它们选元素。
   */
  embedded?: boolean;
}

/**
 * 最近一次「加入队列」的那一批。
 *
 * 只记两件东西：批号（审查页据此归组）与交给队列的条目 id。
 * 状态一概不另存 —— 队列本身就是状态（`useJobs()` 拿），送审条数从审查表按批号数。
 * 记两份状态就得操心它们什么时候对不上，而它们**迟早**会对不上。
 */
interface PolishBatch {
  batchId: string;
  entryIds: string[];
}

/** 这一批交给队列之后的落点：还在排队 / 正在做 / 跑完 / 没做成 */
interface BatchTally {
  running: number;
  queued: number;
  done: number;
  failed: number;
}

const FOCUS_LABEL: Record<PolishFocus, MsgKey> = {
  detail: 'entries.batch.focus.detail',
  style: 'entries.batch.focus.style',
  trim: 'entries.batch.focus.trim',
  links: 'entries.batch.focus.links',
  conflict: 'entries.batch.focus.conflict',
};

/** 队列里去重键的前缀：同一条条目连点两下是误触，不该排两遍 */
const POLISH_DEDUPE_PREFIX = 'polish:';

export function EntriesPage({
  focusEntryId,
  onOpenEntry,
  onCloseEntry,
  onNavigate,
  embedded,
}: Props) {
  const store = useStore();
  const toast = useToast();
  const t = useT();

  const statusLabel: Record<EntryStatus | 'all', string> = {
    all: t('common.all'),
    canon: t('kind.status.canon'),
    pending: t('kind.status.pending'),
    draft: t('kind.status.draft'),
  };

  const [activeCat, setActiveCat] = useState<string>('all');
  const [status, setStatus] = useState<'all' | EntryStatus>('all');
  const [q, setQ] = useState('');
  const [catModal, setCatModal] = useState<Partial<Category> | null>(null);
  const [creating, setCreating] = useState(false);

  const filtered = useMemo(() => {
    const kw = q.trim().toLowerCase();
    return store.entries.filter((e) => {
      if (activeCat !== 'all' && e.categoryId !== activeCat) return false;
      if (status !== 'all' && e.status !== status) return false;
      if (!kw) return true;
      return (
        e.title.toLowerCase().includes(kw) ||
        e.aliases.some((a) => a.toLowerCase().includes(kw)) ||
        e.summary.toLowerCase().includes(kw) ||
        e.tags.some((t) => t.toLowerCase().includes(kw)) ||
        e.content.toLowerCase().includes(kw)
      );
    });
  }, [store.entries, activeCat, status, q]);

  const countIn = (catId: string) => store.entries.filter((e) => e.categoryId === catId).length;

  /* --------------------------- 批量打磨 --------------------------- */

  const [batch, setBatch] = useState(false);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [focus, setFocus] = useState<Set<PolishFocus>>(new Set(['detail']));
  const [extra, setExtra] = useState('');
  const [lastBatch, setLastBatch] = useState<PolishBatch | null>(null);

  /** 每条条目有几个关联。预先算成一张表 —— 列表里每行都算一遍是 O(n·m) */
  const relCounts = useMemo(() => {
    const m = new Map<string, number>();
    for (const r of store.relations) {
      m.set(r.fromEntryId, (m.get(r.fromEntryId) ?? 0) + 1);
      m.set(r.toEntryId, (m.get(r.toEntryId) ?? 0) + 1);
    }
    return m;
  }, [store.relations]);

  /**
   * 这条条目「值得打磨」的信号。
   *
   * 用规则而不是再叫一次模型，理由有两个：一是快，勾一下就有结果；
   * 二是**作者看得懂为什么被挑出来**（"正文偏短"），而模型的评分他只能选择信或不信。
   */
  const polishReasons = (e: Entry): string[] => {
    const reasons: string[] = [];
    const plain = e.content.replace(/[#*`>\s-]/g, '');
    if (plain.length < 160) reasons.push(t('entries.batch.reason.short'));
    if (!e.summary.trim()) reasons.push(t('entries.batch.reason.noSummary'));
    if (!e.tags.length) reasons.push(t('entries.batch.reason.noTags'));
    if (!(relCounts.get(e.id) ?? 0)) reasons.push(t('entries.batch.reason.noRelation'));
    if (e.status === 'draft') reasons.push(t('entries.batch.reason.draft'));
    return reasons;
  };

  const picked = useMemo(
    () => store.entries.filter((e) => selected.has(e.id)),
    [store.entries, selected],
  );

  /* ---------------------- 打磨：两处入口，一条队列 ----------------------
   *
   * 「批量打磨」面板适合挑一批一起过；行上那颗「AI 打磨」适合随手点几条。
   * 两条路**走的是同一套东西**：都排进右下角的任务队列，一件接一件地做，
   * 每件跑完把修订送进审查队列 —— 采纳与否仍然由作者定。
   *
   * 以前批量那一路是在页面里 inline 等着跑完的：进度条长在面板里，人得守着这一页
   * （至少也得切回来才看得见结果），一「退出批量」结果就没了。交给队列之后，
   * 「挑十条 → 加入队列 → 去干别的」是明确承诺的；顺带白拿了撤单、重试、
   * 以及「一件翻车不堵住后面那些」。
   */
  const jobs = useJobs();

  /**
   * 队列里的活儿是**过一会儿**才跑的，而闭包里的 `store` 是入队那一刻的 ——
   * 写回（推审查）要打在当下这份库上，否则会盖掉这期间别处的改动。
   * 读（条目、分类）仍然用入队时的快照：那是作者点下去那一刻的意图。
   */
  const liveStore = useRef(store);
  useEffect(() => {
    liveStore.current = store;
  });

  const togglePick = (id: string) =>
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  const smartPick = () => {
    const worth = store.entries.filter((e) => polishReasons(e).length > 0).map((e) => e.id);
    setSelected(new Set(worth));
    if (worth.length) toast.success(t('entries.batch.smartDone', { n: worth.length }));
    else toast.toast(t('entries.batch.smartNone'));
  };

  const exitBatch = () => {
    setBatch(false);
    setSelected(new Set());
  };

  /**
   * 造一件打磨活儿的跑法。
   *
   * **入队那一刻就把该用的东西全按下快照**（条目、分类、着力点、额外要求）。轮到它时
   * 世界可能已经被别处改过，而这一件该按「点下去那一刻」的样子来 —— 作者按下按钮时
   * 心里的参照就是那一刻的库。写回则相反，打在有 `liveStore` 的当下那份上。
   *
   * 批号可选：批量那一路带着它（审查页据此归组、并提供「采纳这一批」），
   * 单条不带 —— 那是「这条我看不顺眼，改一下」，各论各的。
   */
  const makePolishJob =
    (
      entry: Entry,
      world: World,
      opts: {
        settings: AISettings;
        entriesSnap: Entry[];
        catsSnap: Category[];
        focusList: PolishFocus[];
        instruction: string;
        i: number;
        total: number;
        batchId?: string;
      },
    ): JobRun =>
    async (signal) => {
      const items = await runPolish(
        opts.settings,
        world,
        entry,
        opts.entriesSnap,
        opts.catsSnap,
        { focus: opts.focusList, instruction: opts.instruction, i: opts.i, total: opts.total },
        { signal },
      );
      // 它看过，觉得没什么可改。这条就不摆进审查队列了 ——
      // 一批会连着摆十几张卡，多一张空 diff 就是让作者多读一遍。
      if (!items.length) return t('entries.polish.nothing');
      const tagged = opts.batchId ? items.map((it) => ({ ...it, batchId: opts.batchId })) : items;
      await liveStore.current.pushReview(tagged);
      return t('entries.polish.note', { n: items.length });
    };

  /** 把一批条目交给队列。返回真正排进去的件数（去重之后） */
  const enqueuePolish = (list: Entry[], batchId: string | undefined): number => {
    const world = store.activeWorld;
    if (!world) return 0;
    // 整批共用同一份「世界里已经有什么」，与单条一样在入队时就定住
    const snap = {
      settings: store.settings.ai,
      entriesSnap: store.entries,
      catsSnap: store.categories,
      focusList: POLISH_FOCUS.filter((f) => focus.has(f)),
      instruction: extra.trim(),
    };
    return enqueueJobs(
      list.map((entry, i) => ({
        label: t('entries.polish.label', { title: entry.title }),
        group: t('entries.polish.group'),
        dedupeKey: `${POLISH_DEDUPE_PREFIX}${entry.id}`,
        worldId: world.id,
        // 排上之后页面里就没有自己的进度条了，侧栏那一下转圈是唯一还能看出
        // 「这一支在干活」的地方。侧栏那一格现在叫 `wiki`（条目库并进了 Wiki）——
        // 写成旧名字 `entries` 的话，转圈会落在**不存在的一格**上，等于没有提示
        navKey: 'wiki',
        run: makePolishJob(entry, world, {
          ...snap,
          i: i + 1,
          total: list.length,
          batchId,
        }),
      })),
    );
  };

  /**
   * 「加入队列」：把勾中的一批排进右下角的任务队列。
   *
   * 与单条走同一条队列，所以「这条已经在队列里」的去重也是同一套 ——
   * 连点两下不会排出两件（那会让同一条目被两个活儿同时改）。
   */
  const enqueueBatch = () => {
    if (!picked.length) {
      toast.warn(t('entries.batch.pickFirst'));
      return;
    }
    // AI 配置先拦一道：不然右下角会挂一排红色失败，而作者要的是「去设置里填一下」
    const missing = aiGuardKey(store.settings.ai);
    if (missing) {
      toast.error(t(missing));
      return;
    }

    // 已经有待审修订的条目先放过：同一条目同时摆着两份修订，
    // 作者会不知道按哪份改，采纳顺序还会互相覆盖。
    const waiting = new Set(
      store.review
        .filter((r) => r.status === 'pending' && r.kind === 'update-entry' && r.targetEntryId)
        .map((r) => r.targetEntryId as string),
    );
    const heldBack = picked.filter((e) => waiting.has(e.id));
    const queue = picked.filter((e) => !waiting.has(e.id));
    if (!queue.length) {
      toast.warn(t('entries.batch.heldBack', { n: heldBack.length }));
      return;
    }

    const batchId = uid('bt');
    const added = enqueuePolish(queue, batchId);
    if (!added) {
      toast.toast(t('entries.batch.allQueued'));
      return;
    }
    // 记下这一批是谁：面板据此把它们的进度摘出来，审查页据此归组
    setLastBatch({ batchId, entryIds: queue.map((e) => e.id) });
    if (heldBack.length) toast.warn(t('entries.batch.heldBack', { n: heldBack.length }));
    toast.success(t('entries.batch.enqueued', { n: added }));
    setSelected(new Set());
  };

  /** 这一批交给队列的那些活儿。队列不认识「一批」，所以按条目 id 从里面拣 */
  const batchJobs = useMemo(() => {
    if (!lastBatch) return [];
    const ids = new Set(lastBatch.entryIds);
    return jobs.filter(
      (j) =>
        j.dedupeKey?.startsWith(POLISH_DEDUPE_PREFIX) &&
        ids.has(j.dedupeKey.slice(POLISH_DEDUPE_PREFIX.length)),
    );
  }, [jobs, lastBatch]);

  const tally: BatchTally = {
    running: batchJobs.filter((j) => j.status === 'running').length,
    queued: batchJobs.filter((j) => j.status === 'queued').length,
    done: batchJobs.filter((j) => j.status === 'done').length,
    failed: batchJobs.filter((j) => j.status === 'error').length,
  };
  const batchLive = tally.running + tally.queued;
  /**
   * 这一批已经送进审查的条数。
   *
   * 按批号从审查表里数，而不是拿每件活儿的回执去加 —— 回执是给人看的字符串，
   * 拿它算数早晚会因为改一个字的文案而悄悄少算。审查表是唯一的出处。
   */
  const batchSent = lastBatch
    ? store.review.filter((r) => r.batchId === lastBatch.batchId).length
    : 0;

  /** 停掉这一批（排队中的撤掉、正在做的那件掐断） */
  const stopBatch = () => {
    if (!lastBatch) return;
    const ids = new Set(lastBatch.entryIds);
    for (const j of jobsSnapshot()) {
      const key = j.dedupeKey ?? '';
      if (!key.startsWith(POLISH_DEDUPE_PREFIX)) continue;
      if (!ids.has(key.slice(POLISH_DEDUPE_PREFIX.length))) continue;
      cancelJob(j.id);
    }
  };

  /* ---------------------- 单条打磨（同一个队列） ----------------------
   *
   * 批量面板适合「挑一批一起过」；但更常见的是随手翻列表时觉得某几条写得薄 ——
   * 那就该点一下排一件、点五下排五件，人不用守在这个页面上等。
   *
   * 以前这类单发动作只能一次一件：同一个任务槽还跑着时 `run()` 直接返回 null，
   * 后按的那几下**静默消失**。交给队列之后，「点几条就做几条」是明确承诺的。
   */

  /** 哪些条目眼下正排在队里（排队中或正在做）—— 行上的转圈由它决定 */
  const queuedPolishIds = useMemo(() => {
    const set = new Set<string>();
    for (const j of jobs) {
      if (!j.dedupeKey?.startsWith(POLISH_DEDUPE_PREFIX)) continue;
      if (j.status !== 'queued' && j.status !== 'running') continue;
      set.add(j.dedupeKey.slice(POLISH_DEDUPE_PREFIX.length));
    }
    return set;
  }, [jobs]);

  const polishOne = (entry: Entry) => {
    const world = store.activeWorld;
    if (!world) return;

    // AI 配置先拦一道：不然右下角会挂一排红色失败，而作者要的是「去设置里填一下」
    const missing = aiGuardKey(store.settings.ai);
    if (missing) {
      toast.error(t(missing));
      return;
    }
    // 与批量打磨同一条纪律：同一条目上摆两份待审修订，作者会不知道按哪份改
    const waiting = store.review.some(
      (r) => r.status === 'pending' && r.kind === 'update-entry' && r.targetEntryId === entry.id,
    );
    if (waiting) {
      toast.warn(t('entries.polish.waiting'));
      return;
    }

    const added = enqueuePolish([entry], undefined);
    if (added) toast.success(t('entries.polish.queued', { n: liveJobCount() }));
    else toast.toast(t('entries.polish.exists'));
  };

  const createEntry = async (catId: string) => {
    const target = catId === 'all' ? store.categories[0] : store.categories.find((c) => c.id === catId);
    if (!target || !store.activeWorld) {
      toast.warn(t('entries.toast.needCategory'));
      return;
    }
    let e;
    try {
      e = await store.createEntry({
        worldId: store.activeWorld.id,
        categoryId: target.id,
        title: t('entries.default.newEntryTitle'),
        status: 'draft',
      });
    } catch (err) {
      toast.error((err as Error).message);
      return;
    }
    setCreating(false);
    onOpenEntry(e.id);
  };

  if (!store.activeWorld) return <Empty icon="🌍" title={t('entries.noWorld')} />;

  const actionButtons = (
    <>
      <button
        className={`btn sm ${batch ? 'primary' : ''}`}
        data-role="entries-batch-toggle"
        // 不再需要「跑着时锁住」：这一批是排进队列的，随时可以收起面板走人，
        // 右下角的队列会接着做（想停下就在那儿撤单，或面板里的「停掉这一批」）。
        disabled={!store.entries.length}
        onClick={() => (batch ? exitBatch() : setBatch(true))}
      >
        <IcSparkles size={14} />{' '}
        {batch ? t('entries.btn.batchOn') : t('entries.btn.batch')}
      </button>
      <button className="btn sm" onClick={() => setCatModal({ worldId: store.activeWorld!.id })}>
        <IcPlus size={14} /> {t('entries.btn.newCategory')}
      </button>
      <button className="btn primary sm" onClick={() => setCreating(true)}>
        <IcPlus size={14} /> {t('entries.btn.newEntry')}
      </button>
    </>
  );

  return (
    <>
      {embedded ? (
        <div className="wk-sub-actions" data-role="entries-actions">
          {actionButtons}
        </div>
      ) : (
        <div className="page-head">
          <div>
            <h1 className="page-title">{t('entries.title')}</h1>
            <p className="page-desc">
              {t('entries.desc')} <code>{t('entries.linkSyntax')}</code> {t('entries.descTail')}
            </p>
          </div>
          <div className="page-actions">{actionButtons}</div>
        </div>
      )}

      <div className="split">
        {/* 分类导航 */}
        <div className="cat-list">
          <button
            className={`cat-item ${activeCat === 'all' ? 'active' : ''}`}
            onClick={() => setActiveCat('all')}
          >
            <span>📚</span>
            <span>{t('entries.cat.all')}</span>
            <span className="cnt">{store.entries.length}</span>
          </button>
          {store.categories.map((c) => (
            <div key={c.id} style={{ position: 'relative' }}>
              <button
                className={`cat-item ${activeCat === c.id ? 'active' : ''}`}
                onClick={() => setActiveCat(c.id)}
                onContextMenu={(e) => {
                  e.preventDefault();
                  setCatModal(c);
                }}
              >
                <span>{c.icon}</span>
                <span
                  style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}
                >
                  {c.name}
                </span>
                <span className="cnt">{countIn(c.id)}</span>
              </button>
              {activeCat === c.id && (
                <div className="row" style={{ gap: 2, padding: '2px 8px 6px' }}>
                  <button className="btn xs ghost" onClick={() => setCatModal(c)}>
                    <IcEdit size={12} /> {t('common.edit')}
                  </button>
                </div>
              )}
            </div>
          ))}
          {!store.categories.length && (
            <div className="muted small" style={{ padding: '10px 9px' }}>
              {t('entries.cat.emptyHint')}
            </div>
          )}
        </div>

        {/* 列表 */}
        <div>
          <div className="toolbar">
            <div className="search-box">
              <IcSearch />
              <input
                className="input"
                placeholder={t('entries.placeholder.search')}
                value={q}
                onChange={(e) => setQ(e.target.value)}
              />
            </div>
            <div className="row" style={{ gap: 4 }}>
              {(['all', 'canon', 'pending', 'draft'] as const).map((s) => (
                <button
                  key={s}
                  className={`btn sm ${status === s ? 'primary' : 'ghost'}`}
                  onClick={() => setStatus(s)}
                >
                  {statusLabel[s]}
                </button>
              ))}
            </div>
            <span className="muted small" style={{ marginLeft: 'auto' }}>
              {t('entries.count', { n: filtered.length })}
            </span>
          </div>

          {batch && (
            <div className="card batch-panel" data-role="entries-batch">
              <div className="batch-head">
                <span className="bold small">
                  <IcSparkles size={14} /> {t('entries.btn.batch')}
                </span>
                <span className="pill tiny" data-role="batch-count">
                  {t('entries.batch.selected', { n: selected.size })}
                </span>
                <div className="grow" />
                <button
                  className="btn xs ghost"
                  data-role="batch-select-all"
                  onClick={() => setSelected(new Set(filtered.map((e) => e.id)))}
                >
                  {t('entries.batch.selectAll', { n: filtered.length })}
                </button>
                <button className="btn xs ghost" data-role="batch-smart" onClick={smartPick}>
                  {t('entries.batch.smart')}
                </button>
                <button
                  className="btn xs ghost"
                  data-role="batch-clear"
                  onClick={() => setSelected(new Set())}
                >
                  {t('entries.batch.clear')}
                </button>
              </div>

              <div className="small muted" style={{ marginTop: 6 }}>
                {t('entries.batch.desc')}
              </div>

              <div className="divider" />

              <label className="field-label">{t('entries.batch.focus')}</label>
              <div className="row wrap" style={{ gap: 6 }}>
                {POLISH_FOCUS.map((f) => (
                  <button
                    key={f}
                    data-role={`polish-focus-${f}`}
                    className={`btn sm ${focus.has(f) ? 'primary' : 'ghost'}`}
                    onClick={() =>
                      setFocus((prev) => {
                        const next = new Set(prev);
                        if (next.has(f)) next.delete(f);
                        else next.add(f);
                        return next;
                      })
                    }
                  >
                    {t(FOCUS_LABEL[f])}
                  </button>
                ))}
              </div>
              <div className="field-hint">{t('entries.batch.focusHint')}</div>

              <div className="field mt12">
                <label className="field-label">{t('entries.batch.instruction')}</label>
                <div className="row">
                  <input
                    className="input grow"
                    data-role="batch-instruction"
                    value={extra}
                    placeholder={t('entries.batch.instructionPlaceholder')}
                    onChange={(e) => setExtra(e.target.value)}
                  />
                  <button
                    className="btn primary sm"
                    data-role="batch-enqueue"
                    disabled={!selected.size}
                    onClick={enqueueBatch}
                  >
                    <IcSparkles size={14} /> {t('entries.batch.enqueue', { n: selected.size })}
                  </button>
                </div>
                <div className="field-hint">{t('entries.batch.cost', { n: selected.size })}</div>
              </div>

              {/*
                * 这一批的进度与收尾。
                *
                * 东西全在队列里和审查表里，这里只是把它们**摘出来**给作者看 ——
                * 面板上不另存一份状态（另存的那一份迟早会和队列说的不一样）。
                * 队列把活儿清空之后这里就自己消失了，不会留一条过期的「本批 5 件」。
                */}
              {lastBatch && batchJobs.length > 0 && (
                <div className="batch-result" data-role="batch-track">
                  <div className="row" style={{ gap: 8 }}>
                    {batchLive > 0 && <span className="spinner dark" />}
                    <span className="bold small" data-role="batch-track-text">
                      {batchLive > 0
                        ? t('entries.batch.queueLive', {
                            n: batchJobs.length,
                            running: tally.running,
                            queued: tally.queued,
                            sent: batchSent,
                          })
                        : tally.failed > 0
                          ? t('entries.batch.queueSettledFailed', {
                              n: batchJobs.length,
                              done: tally.done,
                              failed: tally.failed,
                              sent: batchSent,
                            })
                          : t('entries.batch.queueSettled', {
                              n: batchJobs.length,
                              done: tally.done,
                              sent: batchSent,
                            })}
                    </span>
                  </div>
                  <div className="row" style={{ gap: 8, marginTop: 10 }}>
                    {batchLive > 0 ? (
                      <button className="btn sm" data-role="batch-stop" onClick={stopBatch}>
                        <IcStop size={14} /> {t('entries.batch.stopBatch')}
                      </button>
                    ) : (
                      <button
                        className="btn primary sm"
                        data-role="batch-goto-review"
                        onClick={() => onNavigate('review')}
                      >
                        {t('entries.batch.goReview')}
                      </button>
                    )}
                    <button
                      className="btn sm"
                      data-role="batch-dismiss"
                      onClick={() => setLastBatch(null)}
                    >
                      {t('entries.batch.dismiss')}
                    </button>
                  </div>
                </div>
              )}
            </div>
          )}

          {filtered.length === 0 ? (
            <Empty
              icon="📄"
              title={q ? t('entries.empty.noMatch') : t('entries.empty.categoryEmpty')}
              desc={
                q
                  ? t('entries.empty.noMatchDesc')
                  : t('entries.empty.categoryEmptyDesc')
              }
              action={
                !q ? (
                  <button className="btn primary sm" onClick={() => setCreating(true)}>
                    <IcPlus size={14} /> {t('entries.btn.newEntry')}
                  </button>
                ) : undefined
              }
            />
          ) : (
            <div className="grid" style={{ gap: 9 }}>
              {filtered.map((e) => (
                <EntryRow
                  key={e.id}
                  entry={e}
                  catName={store.categories.find((c) => c.id === e.categoryId)?.name ?? t('entries.uncategorized')}
                  relCount={relCounts.get(e.id) ?? 0}
                  onOpen={() => onOpenEntry(e.id)}
                  selectable={batch}
                  checked={selected.has(e.id)}
                  onToggle={() => togglePick(e.id)}
                  reasons={batch ? polishReasons(e) : []}
                  // 批量模式下整行是「勾选」，单条打磨按钮就该让位（不然两种点击语义打架）
                  onPolish={batch ? undefined : () => polishOne(e)}
                  polishing={queuedPolishIds.has(e.id)}
                />
              ))}
            </div>
          )}
        </div>
      </div>

      {focusEntryId && (
        <EntryEditor entryId={focusEntryId} onClose={onCloseEntry} onOpenEntry={onOpenEntry} />
      )}

      {creating && (
        <Modal
          title={t('entries.btn.newEntry')}
          onClose={() => setCreating(false)}
          footer={
            <>
              <button className="btn sm" onClick={() => setCreating(false)}>
                {t('common.cancel')}
              </button>
            </>
          }
        >
          <div className="soft small" style={{ marginBottom: 12 }}>
            {t('entries.modal.chooseCategory')}
          </div>
          <div className="grid c2">
            {store.categories.map((c) => (
              <button
                key={c.id}
                className="btn"
                style={{ justifyContent: 'flex-start' }}
                onClick={() => createEntry(c.id)}
              >
                <span>{c.icon}</span> {c.name}
              </button>
            ))}
          </div>
          {!store.categories.length && (
            <div className="muted small">{t('entries.modal.noCategory')}</div>
          )}
        </Modal>
      )}

      {catModal && (
        <CategoryModal
          value={catModal}
          existing={store.categories}
          onClose={() => setCatModal(null)}
          onSave={async (data) => {
            if (data.id) await store.updateCategory(data.id, data);
            else await store.createCategory(data);
            setCatModal(null);
            toast.success(t('entries.toast.categorySaved'));
          }}
          onDelete={
            catModal.id
              ? async () => {
                  const n = countIn(catModal.id!);
                  if (
                    !confirm(
                      t('entries.confirm.deleteCategory', { name: catModal.name!, n }),
                    )
                  )
                    return;
                  await store.deleteCategory(catModal.id!);
                  setCatModal(null);
                  if (activeCat === catModal.id) setActiveCat('all');
                  toast.success(t('entries.toast.categoryDeleted'));
                }
              : undefined
          }
        />
      )}
    </>
  );
}

function EntryRow({
  entry,
  catName,
  relCount,
  onOpen,
  selectable,
  checked,
  onToggle,
  reasons,
  onPolish,
  polishing,
}: {
  entry: Entry;
  catName: string;
  relCount: number;
  onOpen: () => void;
  /** 批量模式下这一行是「可勾选的」，点行 = 切换勾选，而不是打开编辑器 */
  selectable?: boolean;
  checked?: boolean;
  onToggle?: () => void;
  /** 批量模式下标出它为什么值得打磨（空数组 = 看起来挺完整） */
  reasons?: string[];
  /** 单条排进任务队列。批量模式下传 undefined（那时整行归勾选） */
  onPolish?: () => void;
  /** 这件眼下正排在队列里 */
  polishing?: boolean;
}) {
  const t = useT();
  return (
    <div
      className={`entry-item ${selectable ? 'pickable' : ''} ${checked ? 'picked' : ''}`}
      data-role="entry-row"
      data-entry-id={entry.id}
      onClick={selectable ? onToggle : onOpen}
    >
      {selectable && (
        <span
          className={`pick-box ${checked ? 'on' : ''}`}
          data-role="batch-check"
          data-entry-id={entry.id}
          role="checkbox"
          aria-checked={!!checked}
        >
          {checked && <IcCheck size={12} />}
        </span>
      )}
      <div className="grow">
        <div className="entry-item-title">
          {entry.title}
          <StatusPill status={entry.status} />
          {entry.aliases.length > 0 && (
            <span className="muted tiny">
              {t('entries.row.alias', { names: entry.aliases.join(t('common.listSep')) })}
            </span>
          )}
        </div>
        {(entry.summary || entry.content) && (
          <div className="entry-item-sum">
            {entry.summary || entry.content.replace(/[#*`>\-]/g, '').slice(0, 150)}
          </div>
        )}
        <div className="entry-item-meta">
          <span className="pill tiny">{catName}</span>
          {relCount > 0 && <span className="pill tiny">{t('entries.row.relCount', { n: relCount })}</span>}
          {entry.sourceRefs.length > 0 && <span className="pill tiny">{t('entries.row.sources')}</span>}
          {entry.tags.slice(0, 4).map((tag) => (
            <span key={tag} className="tag">
              {tag}
            </span>
          ))}
          {reasons && reasons.length > 0 && (
            <span className="muted tiny" data-role="entry-reason">
              {reasons.join(t('common.listSep'))}
            </span>
          )}
          <span className="muted tiny" style={{ marginLeft: 'auto' }}>
            {formatRelative(entry.updatedAt)}
          </span>
        </div>
      </div>

      {onPolish && (
        <button
          className={`btn xs ghost entry-quick ${polishing ? 'on' : ''}`}
          data-role="entry-polish"
          data-entry-id={entry.id}
          title={t('entries.row.polishHint')}
          disabled={polishing}
          onClick={(e) => {
            // 行本身的点击是「打开编辑器」，这颗按钮不能顺带把它也触发了
            e.stopPropagation();
            onPolish();
          }}
        >
          {polishing ? <span className="spinner dark" /> : <IcSparkles size={13} />}
          {t('entries.row.polish')}
        </button>
      )}
    </div>
  );
}

function CategoryModal({
  value,
  existing,
  onClose,
  onSave,
  onDelete,
}: {
  value: Partial<Category>;
  existing: Category[];
  onClose: () => void;
  onSave: (data: Partial<Category>) => void;
  onDelete?: () => void;
}) {
  const t = useT();
  const [name, setName] = useState(value.name ?? '');
  const [icon, setIcon] = useState(value.icon ?? '📁');
  const [fields, setFields] = useState(
    (value.fieldDefs ?? []).map((f) => `${f.label}`).join(t('common.listSep')),
  );

  const ICONS = ['📁', '👤', '🗺️', '⚔️', '📜', '⚙️', '🔧', '🐉', '🌿', '💠', '🎭', '🔮', '🏛️', '📖'];

  return (
    <Modal
      title={value.id ? t('entries.catModal.edit') : t('entries.catModal.new')}
      onClose={onClose}
      footer={
        <>
          {onDelete && (
            <button className="btn danger sm" onClick={onDelete}>
              <IcTrash size={14} /> {t('entries.catModal.delete')}
            </button>
          )}
          <div className="grow" />
          <button className="btn sm" onClick={onClose}>
            {t('common.cancel')}
          </button>
          <button
            className="btn primary sm"
            disabled={!name.trim()}
            onClick={() =>
              onSave({
                ...value,
                name: name.trim(),
                icon,
                fieldDefs: fields
                  .split(/[,，、]/)
                  .map((s) => s.trim())
                  .filter(Boolean)
                  .map((label) => ({ key: label, label })),
              })
            }
          >
            {t('common.save')}
          </button>
        </>
      }
    >
      <div className="field">
        <label className="field-label">{t('entries.field.categoryName')}</label>
        <input
          className="input"
          value={name}
          placeholder={t('entries.placeholder.categoryName')}
          onChange={(e) => setName(e.target.value)}
        />
      </div>
      <div className="field">
        <label className="field-label">{t('entries.field.icon')}</label>
        <div className="row wrap" style={{ gap: 6 }}>
          {ICONS.map((i) => (
            <button
              key={i}
              className={`btn sm ${icon === i ? 'primary' : ''}`}
              style={{ padding: '5px 9px' }}
              onClick={() => setIcon(i)}
            >
              {i}
            </button>
          ))}
        </div>
      </div>
      <div className="field">
        <label className="field-label">{t('entries.field.fieldDefs')}</label>
        <input
          className="input"
          value={fields}
          placeholder={t('entries.placeholder.fieldDefs')}
          onChange={(e) => setFields(e.target.value)}
        />
        <div className="field-hint">{t('entries.field.fieldDefsHint')}</div>
      </div>
    </Modal>
  );
}
