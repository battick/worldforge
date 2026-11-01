import React, { useMemo, useState } from 'react';
import { useStore } from '../state/store';
import { useToast } from '../components/Toast';
import { Empty, Modal, StatusPill } from '../components/Modal';
import { MarkdownView } from '../components/MarkdownView';
import { IcCheck, IcClose, IcEdit, IcSparkles, IcTrash } from '../components/icons';
import { kindLabel } from './Dashboard';
import { formatRelative } from '../lib/id';
import { diffText, type DiffSeg } from '../lib/diff';
import { rerunBySource } from '../ai/tasks';
import type { AgentPageView } from '../ai/agent/tools';
import { useT } from '../i18n';
import type { MsgKey, TFunc } from '../i18n';
import type { Entry, EntryTime, ReviewItem, TimeLayoutItem } from '../types';

/**
 * 这条关系牵着的条目必须都已经落地。一端还停在审查队列里（或提议被撤了）就采纳，
 * 会在图谱上留下一条指向空条目的断头线 —— 比少一条关系难查得多。
 *
 * store 里另有一道同样的守卫兜底；这里挡在前面，只是别让作者点了才发现。
 */
function missingEndCount(item: ReviewItem, entries: Entry[]): number {
  if (item.kind !== 'relation' || !item.relationDraft) return 0;
  return [item.relationDraft.fromEntryId, item.relationDraft.toEntryId].filter(
    (id) => !entries.some((e) => e.id === id),
  ).length;
}

interface Props {
  onOpenEntry: (id: string) => void;
  /** 第二参是给「时间与关系」用的：要那一支的**编年**视图时落到 graph + 'chronicle' */
  onNavigate: (route: string, view?: AgentPageView) => void;
}

const KIND_FILTERS: { key: 'all' | ReviewItem['kind']; labelKey: MsgKey }[] = [
  { key: 'all', labelKey: 'review.filter.all' },
  { key: 'create-entry', labelKey: 'kind.review.create-entry' },
  { key: 'update-entry', labelKey: 'kind.review.update-entry' },
  { key: 'delete-entry', labelKey: 'kind.review.delete-entry' },
  { key: 'relation', labelKey: 'kind.review.relation' },
  { key: 'update-relation', labelKey: 'kind.review.update-relation' },
  { key: 'delete-relation', labelKey: 'kind.review.delete-relation' },
  { key: 'consistency', labelKey: 'kind.review.consistency' },
  { key: 'timeline-layout', labelKey: 'kind.review.timeline-layout' },
  { key: 'timeline-guess', labelKey: 'kind.review.timeline-guess' },
];

export function ReviewPage({ onOpenEntry, onNavigate }: Props) {
  const store = useStore();
  const toast = useToast();
  const t = useT();
  const [statusFilter, setStatusFilter] = useState<'pending' | 'accepted' | 'rejected'>('pending');
  const [kindFilter, setKindFilter] = useState<'all' | ReviewItem['kind']>('all');
  const [editing, setEditing] = useState<ReviewItem | null>(null);
  /** 正在「再生成」的那条：弹窗里补提示词，确定后重跑 */
  const [rerunTarget, setRerunTarget] = useState<ReviewItem | null>(null);
  const [rerunText, setRerunText] = useState('');
  const [rerunning, setRerunning] = useState(false);

  const list = useMemo(
    () =>
      store.review.filter(
        (r) =>
          r.status === statusFilter && (kindFilter === 'all' || r.kind === kindFilter),
      ),
    [store.review, statusFilter, kindFilter],
  );

  const pending = store.pendingReview;

  /** 被阻塞的（关联另一端还没落地）挑出来：它们点不动，混在计数里只会让人以为出了错 */
  const blockedIn = (items: ReviewItem[]) => items.filter((r) => missingEndCount(r, store.entries) > 0);

  const acceptAll = async () => {
    const ok = list.filter((r) => missingEndCount(r, store.entries) === 0);
    const blocked = blockedIn(list);
    if (!ok.length) {
      if (blocked.length) toast.warn(t('review.batch.allBlocked'));
      return;
    }
    if (!confirm(t('review.confirm.acceptAll', { n: ok.length }))) return;
    let accepted = 0;
    for (const item of ok) {
      try {
        await store.acceptReview(item.id);
        accepted++;
      } catch (e) {
        toast.error((e as Error).message);
      }
    }
    if (blocked.length) toast.toast(t('review.toast.skippedEnds', { n: blocked.length }));
    if (accepted) toast.success(t('review.toast.accepted', { n: accepted }));
  };

  /** 采纳一整批（同一个 batchId）。批量打磨一次产出十几条，一条条点太折磨 */
  const acceptBatch = async (batchId: string) => {
    const group = list.filter((r) => r.batchId === batchId);
    const ok = group.filter((r) => missingEndCount(r, store.entries) === 0);
    const blocked = blockedIn(group);
    if (!ok.length) {
      toast.warn(t('review.batch.allBlocked'));
      return;
    }
    if (!confirm(t('review.batch.confirm', { n: ok.length }))) return;
    let accepted = 0;
    for (const item of ok) {
      try {
        await store.acceptReview(item.id);
        accepted++;
      } catch (e) {
        toast.error((e as Error).message);
      }
    }
    if (blocked.length) toast.toast(t('review.batch.skippedEnds', { n: blocked.length }));
    if (accepted) toast.success(t('review.toast.accepted', { n: accepted }));
  };

  const rejectBatch = async (batchId: string) => {
    const group = list.filter((r) => r.batchId === batchId);
    for (const item of group) await store.rejectReview(item.id);
    toast.toast(t('review.toast.rejected'));
  };

  /**
   * 「再一次生成」：照这条提议当初的来源重跑，用新结果**替换**这一条，
   * 旧结果整份塞进 `superseded`，供「撤回」恢复。
   *
   * 单卡任务（打磨 / 排版 / 猜测）天然 1:1 替换；批量任务（生成 / 关系 / 一致性）
   * 重跑会产出一批 —— 取第一条同 kind 的替换当前卡，其余照常追加进队列，不丢。
   */
  const runRerun = async () => {
    const item = rerunTarget;
    if (!item || !item.source) return;
    const world = store.activeWorld;
    if (!world) return;
    setRerunning(true);
    try {
      const items = await rerunBySource(
        store.settings.ai,
        world,
        store.entries,
        store.categories,
        item.source,
        rerunText.trim(),
      );
      if (!items.length) {
        toast.toast(t('review.rerun.nothing'));
        setRerunTarget(null);
        setRerunText('');
        return;
      }
      // 取第一条同 kind 的替换当前卡；找不到就退而用第一条（kind 漂移时至少不丢结果）
      const first = items.find((it) => it.kind === item.kind) ?? items[0];
      const rest = items.filter((it) => it !== first);

      // 替换：保住旧 id / worldId / origin / sessionId / batchId，旧内容进 superseded
      const replacement: ReviewItem = {
        ...first,
        id: item.id,
        worldId: item.worldId,
        status: 'pending',
        createdAt: Date.now(),
        origin: item.origin,
        sessionId: item.sessionId,
        batchId: item.batchId,
        superseded: item,
      };
      await store.updateReview(item.id, replacement);
      if (rest.length) await store.pushReview(rest);
      toast.success(t('review.rerun.done'));
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setRerunning(false);
      setRerunTarget(null);
      setRerunText('');
    }
  };

  /** 撤回「再生成」：把旧结果（superseded）放回这条 */
  const revertRerun = async (item: ReviewItem) => {
    if (!item.superseded) return;
    await store.updateReview(item.id, { ...item.superseded, status: 'pending' });
    toast.toast(t('review.rerun.reverted'));
  };

  return (
    <>
      <div className="page-head">
        <div>
          <h1 className="page-title">{t('review.title')}</h1>
          <p className="page-desc">{t('review.desc')}</p>
        </div>
        <div className="page-actions">
          <button className="btn sm" onClick={() => store.clearReview('rejected')}>
            <IcTrash size={14} /> {t('review.btn.clearRejected')}
          </button>
          {statusFilter === 'pending' && list.length > 0 && (
            <button className="btn primary sm" onClick={acceptAll}>
              <IcCheck size={14} /> {t('review.btn.acceptAll')}
            </button>
          )}
        </div>
      </div>

      <div className="grid c4">
        <div className={`stat ${pending.length ? 'warn' : 'success'}`}>
          <div className="stat-num">{pending.length}</div>
          <div className="stat-label">{t('review.stat.pending')}</div>
        </div>
        <div className="stat">
          <div className="stat-num">{store.review.filter((r) => r.status === 'accepted').length}</div>
          <div className="stat-label">{t('kind.status.accepted')}</div>
        </div>
        <div className="stat">
          <div className="stat-num">{store.review.filter((r) => r.status === 'rejected').length}</div>
          <div className="stat-label">{t('kind.status.rejected')}</div>
        </div>
        <div className="stat">
          <div className="stat-num">
            {store.review.filter((r) => r.kind === 'consistency' && r.status === 'pending').length}
          </div>
          <div className="stat-label">{t('review.stat.conflicts')}</div>
        </div>
      </div>

      <div className="toolbar mt16">
        <div className="row" style={{ gap: 4 }}>
          {(
            [
              ['pending', 'kind.status.pendingReview'],
              ['accepted', 'kind.status.accepted'],
              ['rejected', 'kind.status.rejected'],
            ] as const
          ).map(([k, labelKey]) => (
            <button
              key={k}
              className={`btn sm ${statusFilter === k ? 'primary' : 'ghost'}`}
              onClick={() => setStatusFilter(k)}
            >
              {t(labelKey)}
            </button>
          ))}
        </div>
        <select
          className="select"
          style={{ width: 150 }}
          value={kindFilter}
          onChange={(e) => setKindFilter(e.target.value as any)}
        >
          {KIND_FILTERS.map((k) => (
            <option key={k.key} value={k.key}>
              {t(k.labelKey)}
            </option>
          ))}
        </select>
        <span className="muted small" style={{ marginLeft: 'auto' }}>
          {t('review.list.count', { n: list.length })}
        </span>
      </div>

      {list.length === 0 ? (
        <Empty
          icon={statusFilter === 'pending' ? '✅' : '📭'}
          title={
            statusFilter === 'pending'
              ? t('review.empty.pending.title')
              : t('review.empty.other.title')
          }
          desc={statusFilter === 'pending' ? t('review.empty.pending.desc') : undefined}
          action={
            statusFilter === 'pending' ? (
              <div className="row" style={{ justifyContent: 'center' }}>
                <button className="btn primary sm" onClick={() => onNavigate('studio')}>
                  <IcSparkles size={14} /> {t('review.empty.goStudio')}
                </button>
                <button className="btn sm" onClick={() => onNavigate('docs')}>
                  {t('review.empty.goDocs')}
                </button>
              </div>
            ) : undefined
          }
        />
      ) : (
        list.map((item, idx) => (
          <React.Fragment key={item.id}>
            {/*
              同一批的开头插一条批头。批量打磨一次能摆出十几张卡，
              没有它作者就得自己从队列里认出「哪些是刚才那批」。
            */}
            {item.batchId && item.batchId !== list[idx - 1]?.batchId && (
              <BatchHead
                count={list.filter((r) => r.batchId === item.batchId).length}
                canAct={statusFilter === 'pending'}
                onAccept={() => acceptBatch(item.batchId!)}
                onReject={() => rejectBatch(item.batchId!)}
              />
            )}
            <ReviewCard
              item={item}
              onAccept={async (override) => {
                try {
                  await store.acceptReview(item.id, override);
                  toast.success(t('review.toast.acceptedOne'));
                } catch (e) {
                  toast.error((e as Error).message);
                }
              }}
              onReject={async () => {
                await store.rejectReview(item.id);
                toast.toast(t('review.toast.rejected'));
              }}
              onEdit={() => setEditing(item)}
              onRerun={() => {
                setRerunTarget(item);
                setRerunText('');
              }}
              onRevert={() => revertRerun(item)}
              onOpenEntry={onOpenEntry}
              onNavigate={onNavigate}
            />
          </React.Fragment>
        ))
      )}

      {editing &&
        (editing.kind === 'timeline-layout' || editing.kind === 'timeline-guess' ? (
          <EditLayout
            item={editing}
            onClose={() => setEditing(null)}
            onSave={(rows) => {
              // 排版改 `layoutDraft`，猜测改 `guessDraft` —— 两份草稿长得一样，但落库时各有各的去处
              store.updateReview(
                editing.id,
                editing.kind === 'timeline-guess' ? { guessDraft: rows } : { layoutDraft: rows },
              );
              setEditing(null);
              toast.success(t('review.toast.updated'));
            }}
          />
        ) : (
          <EditProposal
            item={editing}
            onClose={() => setEditing(null)}
            onSave={(patch) => {
              store.updateReview(editing.id, patch);
              setEditing(null);
              toast.success(t('review.toast.updated'));
            }}
          />
        ))}

      {rerunTarget && (
        <Modal
          title={t('review.rerun.title', { title: rerunTarget.title })}
          size="md"
          onClose={() => {
            if (!rerunning) {
              setRerunTarget(null);
              setRerunText('');
            }
          }}
          footer={
            <>
              <button
                className="btn sm"
                disabled={rerunning}
                onClick={() => {
                  setRerunTarget(null);
                  setRerunText('');
                }}
              >
                {t('common.cancel')}
              </button>
              <button
                className="btn primary sm"
                data-role="review-rerun-confirm"
                disabled={rerunning}
                onClick={runRerun}
              >
                {rerunning ? t('review.rerun.running') : t('review.rerun.confirm')}
              </button>
            </>
          }
        >
          <div className="field-hint">{t('review.rerun.hint')}</div>
          <textarea
            className="input"
            data-role="review-rerun-text"
            style={{ width: '100%', minHeight: 96, marginTop: 10, resize: 'vertical' }}
            placeholder={t('review.rerun.placeholder')}
            value={rerunText}
            disabled={rerunning}
            onChange={(e) => setRerunText(e.target.value)}
          />
        </Modal>
      )}
    </>
  );
}

/** 同一批提议的分隔条：说明这批有多少条，并提供整批的处理入口 */
function BatchHead({
  count,
  canAct,
  onAccept,
  onReject,
}: {
  count: number;
  canAct: boolean;
  onAccept: () => void;
  onReject: () => void;
}) {
  const t = useT();
  return (
    <div className="batch-group" data-role="review-batch">
      <span className="bold small">
        <IcSparkles size={14} />{' '}
        <span data-role="review-batch-count">{t('review.batch.title', { n: count })}</span>
      </span>
      <div className="grow" />
      {canAct && (
        <>
          <button className="btn xs" data-role="review-batch-accept" onClick={onAccept}>
            <IcCheck size={12} /> {t('review.batch.accept')}
          </button>
          <button className="btn xs ghost" data-role="review-batch-reject" onClick={onReject}>
            <IcClose size={12} /> {t('review.batch.reject')}
          </button>
        </>
      )}
    </div>
  );
}

function ReviewCard({
  item,
  onAccept,
  onReject,
  onEdit,
  onRerun,
  onRevert,
  onOpenEntry,
  onNavigate,
}: {
  item: ReviewItem;
  onAccept: (override?: Partial<ReviewItem>) => void;
  onReject: () => void;
  onEdit: () => void;
  onRerun: () => void;
  onRevert: () => void;
  onOpenEntry: (id: string) => void;
  onNavigate: (route: string, view?: AgentPageView) => void;
}) {
  const store = useStore();
  const t = useT();
  const [open, setOpen] = useState(false);
  const catName = (id?: string) =>
    store.categories.find((c) => c.id === id)?.name ?? t('review.uncategorized');

  const isPending = item.status === 'pending';
  const missingEnd = missingEndCount(item, store.entries);

  return (
    <div className="review-item">
      <div className="review-head">
        <span className="pill">{kindLabel(item.kind)}</span>
        {item.severity && <StatusPill status={item.severity} />}
        {/*
          来源徽标只在「工作台 agent 提的」上出现。
          抽取/批量生成那几条老路径不标 —— 那是这个产品的默认行为，标了只是噪音。
          agent 不一样：它可能自己想出了一条库里原本没有的东西，作者有权知道
          自己审的是「照文档抄」还是「它联想的」。
        */}
        {item.origin === 'agent' && (
          <span className="pill tiny" data-role="review-origin-agent">
            {t('review.origin.agent')}
          </span>
        )}
        <span className="review-title" data-role="review-title">
          {item.title}
        </span>
        <StatusPill status={item.status} />
        {item.kind === 'create-entry' && item.entryDraft?.categoryId && (
          <span className="muted tiny">→ {catName(item.entryDraft.categoryId)}</span>
        )}
        <span className="muted tiny" style={{ marginLeft: 'auto' }}>
          {formatRelative(item.createdAt)}
        </span>
      </div>

      {/* 内容概览 */}
      {item.kind === 'create-entry' && item.entryDraft && (
        <>
          {item.entryDraft.time && (
            <div className="row wrap mt8" style={{ gap: 6, alignItems: 'center' }} data-role="rv-time">
              {/* 时间用的是世界内的纪年，作者怎么写就怎么显示 —— 这里不做任何换算 */}
              <span className="pill" data-role="rv-time-when">
                {whenLabel(item.entryDraft.time, t)}
              </span>
              {!!item.entryDraft.time.era?.trim() && (
                <span className="pill tiny">{item.entryDraft.time.era}</span>
              )}
              <span className="pill tiny">
                {t(`time.weight.${item.entryDraft.time.weight}` as MsgKey)}
              </span>
            </div>
          )}
          {/* 带了时间就得说清它落在哪、去哪儿改位置 —— 编年在「时间与关系」里是第一入口 */}
          {item.entryDraft.time && isPending && (
            <div className="row mt8" style={{ gap: 10, alignItems: 'center' }}>
              <span className="muted tiny">
                {t('review.time.landsAt', { when: whenLabel(item.entryDraft.time, t) })}
              </span>
              <button className="btn xs ghost" onClick={() => onNavigate('graph', 'chronicle')}>
                {t('review.time.goThere')}
              </button>
            </div>
          )}
          {item.entryDraft.summary && (
            <div className="soft small mt8">{item.entryDraft.summary}</div>
          )}
          <div className="row wrap mt8" style={{ gap: 5 }}>
            {item.entryDraft.tags?.map((tag) => (
              <span key={tag} className="tag">
                {tag}
              </span>
            ))}
            {item.entryDraft.aliases && item.entryDraft.aliases.length > 0 && (
              <span className="pill tiny">
                {t('review.detail.aliases', { names: item.entryDraft.aliases.join(t('common.listSep')) })}
              </span>
            )}
          </div>
          <button className="btn xs ghost mt8" onClick={() => setOpen((o) => !o)}>
            {open ? t('review.detail.collapseBody') : t('review.detail.expandBody')}
          </button>
          {open && (
            <div
              style={{
                marginTop: 10,
                borderTop: '1px dashed var(--border)',
                paddingTop: 10,
                maxHeight: 340,
                overflowY: 'auto',
              }}
            >
              <MarkdownView content={item.entryDraft.content ?? ''} compact />
            </div>
          )}
        </>
      )}

      {item.kind === 'update-entry' && (
        <>
          <div className="mt8 row" style={{ gap: 8, alignItems: 'center' }}>
            <span className="pill tiny">{t('review.detail.targetEntry')}</span>
            <span
              className="pointer bold"
              style={{ fontSize: 13, color: 'var(--primary)' }}
              onClick={() => item.targetEntryId && onOpenEntry(item.targetEntryId)}
            >
              {store.entries.find((e) => e.id === item.targetEntryId)?.title ?? t('review.deleted')}
            </span>
          </div>
          {item.changes && item.changes.length > 0 && (
            <div className="mt12">
              {item.changes.map((c) => {
                const long = LONG_FIELDS.has(c.field);
                const diff = diffText(c.before ?? '', c.after ?? '');
                return (
                  <div key={c.field} style={{ marginBottom: 12 }}>
                    <div className="bold tiny soft" style={{ marginBottom: 6 }}>
                      {fieldLabel(c.field, t)}
                    </div>
                    <div className="compare">
                      <div className="compare-pane">
                        <div className="compare-head">{t('review.diff.before')}</div>
                        <div className="compare-body">
                          <DiffSegments segs={diff.before} long={long} />
                        </div>
                      </div>
                      <div className="compare-pane">
                        <div className="compare-head" style={{ color: 'var(--success)' }}>
                          {t('review.diff.after')}
                        </div>
                        <div className="compare-body">
                          <DiffSegments segs={diff.after} long={long} />
                        </div>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </>
      )}

      {/*
        「删除条目」：这是不可逆操作，卡片要把后果说清楚 —— 哪条、它现在长什么样、
        删了会带走什么（它的关系）。作者点「采纳」之前得知道自己在批什么。
      */}
      {item.kind === 'delete-entry' && item.targetEntryId && (
        <>
          <div className="mt8 row" style={{ gap: 8, alignItems: 'center' }}>
            <span className="pill tiny">{t('review.detail.targetEntry')}</span>
            {(() => {
              const target = store.entries.find((e) => e.id === item.targetEntryId);
              return target ? (
                <span
                  className="pointer bold"
                  style={{ fontSize: 13, color: 'var(--primary)' }}
                  onClick={() => onOpenEntry(item.targetEntryId!)}
                >
                  {target.title}
                </span>
              ) : (
                <span className="muted">{t('review.deleted')}</span>
              );
            })()}
          </div>
          {(() => {
            const target = store.entries.find((e) => e.id === item.targetEntryId);
            if (!target) return null;
            const relCount = store.relations.filter(
              (r) => r.fromEntryId === target.id || r.toEntryId === target.id,
            ).length;
            return (
              <div
                style={{
                  marginTop: 10,
                  padding: '10px 12px',
                  background: 'var(--danger-soft, rgba(220,53,69,0.08))',
                  border: '1px solid var(--danger, rgba(220,53,69,0.3))',
                  borderRadius: 8,
                  fontSize: 12.8,
                  lineHeight: 1.7,
                  color: 'var(--danger-dark, #b02a37)',
                }}
              >
                <div className="bold" style={{ marginBottom: 4 }}>
                  {t('review.detail.deleteWarn')}
                </div>
                {target.summary && (
                  <div style={{ marginBottom: 4 }}>
                    <span className="bold tiny soft">{t('review.detail.summary')}：</span> {/* i18n-allow 全角冒号作为标签分隔符，中英文通用 */}
                    {target.summary}
                  </div>
                )}
                <div>
                  {t('review.detail.deleteRelCount', { n: relCount })}
                </div>
              </div>
            );
          })()}
        </>
      )}

      {/*
        一次「AI 自动排版」或「AI 猜测时间」。两者给的都是**一张表**而不是一串卡片：
        这套方案讲的正是「这几条之间的先后」（猜测还多一栏「定成什么时候」），
        拆成 N 张卡，每张只说「12 变成 30」，那层意思就丢了。
      */}
      {(item.kind === 'timeline-layout' || item.kind === 'timeline-guess') &&
        (() => {
          const rows = item.kind === 'timeline-guess' ? item.guessDraft : item.layoutDraft;
          if (!rows?.length) return null;
          const isGuess = item.kind === 'timeline-guess';
          return (
            <>
              <div className="layout-table" data-role={isGuess ? 'rv-guess' : 'rv-layout'}>
                <div className="layout-row layout-head">
                  <span>{t('review.layout.colEntry')}</span>
                  {isGuess ? (
                    <span>{t('review.layout.colWhen')}</span>
                  ) : (
                    <span>{t('review.layout.colPos')}</span>
                  )}
                  <span>{t('review.layout.colOther')}</span>
                </div>
                {rows.map((row) => {
                  const cur = store.entries.find((e) => e.id === row.entryId);
                  return (
                    <div
                      className="layout-row"
                      key={row.entryId}
                      data-role={isGuess ? 'rv-guess-row' : 'rv-layout-row'}
                      data-id={row.entryId}
                      data-at={row.at}
                      data-from={row.fromAt === null ? '' : row.fromAt}
                    >
                      <span className="layout-title">
                        {cur?.title ?? row.title}
                        {!cur && <span className="muted tiny"> · {t('review.layout.gone')}</span>}
                      </span>
                      {isGuess ? (
                        <span className="layout-pos">
                          <b data-role="rv-guess-from">{row.from}</b>
                        </span>
                      ) : (
                        <span className="layout-pos">
                          <span className={row.fromAt === null ? 'muted' : ''}>
                            {row.fromAt === null ? t('review.layout.notPlaced') : row.fromAt}
                          </span>
                          <span className="muted"> → </span>
                          <b data-role="rv-layout-at">{row.at}</b>
                          {row.from && (
                            <span className="muted tiny" data-role="rv-layout-from">
                              {' '}
                              · {t('review.layout.toWhen', { from: row.from })}
                            </span>
                          )}
                        </span>
                      )}
                      <span className="row" style={{ gap: 5, flexWrap: 'wrap' }}>
                        {row.era && (
                          <span className="pill tiny">{t('review.layout.eraTo', { era: row.era })}</span>
                        )}
                        {row.weight && (
                          <span className="pill tiny">{t(`time.weight.${row.weight}` as MsgKey)}</span>
                        )}
                        {typeof row.toAt === 'number' && (
                          <span className="pill tiny">{t('review.layout.toAt', { n: row.toAt })}</span>
                        )}
                      </span>
                      {/*
                        依据挂在整行下面（不是 tooltip）：它是作者判断「这一条该不该按」的唯一凭据，
                        藏在悬停里等于没给 —— 触屏上根本看不到。
                      */}
                      {row.reason && (
                        <span className="layout-reason" data-role="rv-layout-reason">
                          {row.reason}
                        </span>
                      )}
                    </div>
                  );
                })}
              </div>
              <div className="field-hint" style={{ marginTop: 8 }} data-role="rv-layout-hint">
                {isGuess ? t('review.layout.guessHint') : t('review.layout.hint')}
              </div>
            </>
          );
        })()}

      {item.kind === 'relation' && item.relationDraft && (
        <div className="row mt8" style={{ gap: 8, alignItems: 'center', fontSize: 13 }}>
          <span className="bold">
            {store.entries.find((e) => e.id === item.relationDraft!.fromEntryId)?.title ??
              t('review.newEntry')}
          </span>
          <span className="pill">{item.relationDraft.type}</span>
          <span className="bold">
            {store.entries.find((e) => e.id === item.relationDraft!.toEntryId)?.title ??
              t('review.deleted')}
          </span>
          {item.relationDraft.note && <span className="muted small">— {item.relationDraft.note}</span>}
        </div>
      )}

      {item.kind === 'update-relation' && item.relationDraft && (
        <>
          <div className="row mt8" style={{ gap: 8, alignItems: 'center', fontSize: 13 }}>
            <span className="bold">
              {store.entries.find((e) => e.id === item.relationDraft!.fromEntryId)?.title ??
                t('review.deleted')}
            </span>
            <span className="pill">{item.relationDraft.type}</span>
            <span className="bold">
              {store.entries.find((e) => e.id === item.relationDraft!.toEntryId)?.title ??
                t('review.deleted')}
            </span>
          </div>
          {item.changes && item.changes.length > 0 && (
            <div className="mt12">
              {item.changes.map((c) => {
                const diff = diffText(c.before ?? '', c.after ?? '');
                return (
                  <div key={c.field} style={{ marginBottom: 12 }}>
                    <div className="bold tiny soft" style={{ marginBottom: 6 }}>
                      {fieldLabel(c.field, t)}
                    </div>
                    <div className="compare">
                      <div className="compare-pane">
                        <div className="compare-head">{t('review.diff.before')}</div>
                        <div className="compare-body">
                          <DiffSegments segs={diff.before} long={false} />
                        </div>
                      </div>
                      <div className="compare-pane">
                        <div className="compare-head" style={{ color: 'var(--success)' }}>
                          {t('review.diff.after')}
                        </div>
                        <div className="compare-body">
                          <DiffSegments segs={diff.after} long={false} />
                        </div>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </>
      )}

      {item.kind === 'delete-relation' && item.relationDraft && (
        <>
          <div className="row mt8" style={{ gap: 8, alignItems: 'center', fontSize: 13 }}>
            <span className="bold">
              {store.entries.find((e) => e.id === item.relationDraft!.fromEntryId)?.title ??
                t('review.deleted')}
            </span>
            <span className="pill">{item.relationDraft.type}</span>
            <span className="bold">
              {store.entries.find((e) => e.id === item.relationDraft!.toEntryId)?.title ??
                t('review.deleted')}
            </span>
          </div>
          <div
            style={{
              marginTop: 10,
              padding: '10px 12px',
              background: 'var(--danger-soft, rgba(220,53,69,0.08))',
              border: '1px solid var(--danger, rgba(220,53,69,0.3))',
              borderRadius: 8,
              fontSize: 12.8,
              lineHeight: 1.7,
              color: 'var(--danger-dark, #b02a37)',
            }}
          >
            <div className="bold">{t('review.detail.deleteRelationWarn')}</div>
          </div>
        </>
      )}

      {item.kind === 'consistency' && (
        <>
          {item.note && (
            <div className="row wrap mt8" style={{ gap: 5 }}>
              {item.relatedEntryIds?.map((id) => (
                <button
                  key={id}
                  className="pill pointer"
                  style={{ border: 'none', cursor: 'pointer' }}
                  onClick={() => onOpenEntry(id)}
                >
                  {store.entries.find((e) => e.id === id)?.title ?? t('review.deleted')}
                </button>
              ))}
            </div>
          )}
          {item.suggestion && (
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
              <span className="bold">{t('review.detail.suggestion')}</span>
              {item.suggestion}
            </div>
          )}
        </>
      )}

      {item.note && item.kind !== 'consistency' && (
        <div className="small" style={{ marginTop: 8, color: 'var(--warn)' }}>
          ⚠ {item.note}
        </div>
      )}

      {item.rationale && (
        <div className="review-rationale">
          <span className="bold tiny">{t('review.detail.rationale')}</span> {item.rationale}
        </div>
      )}

      {isPending && (
        <div className="review-actions">
          <button
            className="btn success sm"
            data-role="review-accept"
            disabled={missingEnd > 0}
            title={missingEnd > 0 ? t('review.blocked.relationDraft') : undefined}
            onClick={() => onAccept()}
          >
            <IcCheck size={14} />
            {item.kind === 'consistency' ? t('review.btn.markHandled') : t('review.btn.accept')}
          </button>
          {/* 删除提议没有可编辑的正文（要删的就是它本身），所以不摆「改一改再采纳」 */}
          {item.kind !== 'delete-entry' && item.kind !== 'delete-relation' && (
            <button className="btn sm" data-role="review-edit" onClick={onEdit}>
              <IcEdit size={14} /> {t('review.btn.editAccept')}
            </button>
          )}
          <button className="btn danger sm" data-role="review-reject" onClick={onReject}>
            <IcClose size={14} /> {t('review.btn.reject')}
          </button>
          {/* 再生成：有可重跑来源的提议才摆。它重跑当初那条任务，用新结果替换这一条 */}
          {item.source && (
            <button className="btn sm" data-role="review-rerun" onClick={onRerun}>
              <IcSparkles size={14} /> {t('review.btn.rerun')}
            </button>
          )}
          {/* 被「再生成」替换过的提议：摆一个「撤回」，点一下回到旧结果 */}
          {item.superseded && (
            <button
              className="btn sm ghost"
              data-role="review-rerun-revert"
              title={t('review.rerun.revertHint')}
              onClick={onRevert}
            >
              <IcEdit size={14} /> {t('review.btn.revert')}
            </button>
          )}
          {missingEnd > 0 && (
            <span className="muted tiny" data-role="review-blocked">
              {t('review.blocked.relationDraft')}
            </span>
          )}
        </div>
      )}
    </div>
  );
}

/**
 * 把一份条目时间写成一行人话（提案卡上用的）。
 *
 * 三种形态各写各的：光甩三个数字在卡片上，作者得自己拼「这到底是几几年到几几年」，
 * 那就不叫把话说清楚了。
 */
function whenLabel(tm: EntryTime, t: TFunc): string {
  const from = tm.from.trim() || t('time.list.noFrom');
  if (tm.kind === 'range') {
    return t('time.label.range', { from, to: tm.to.trim() || t('time.label.unknown') });
  }
  if (tm.kind === 'ongoing') {
    return t('time.label.ongoing', { from, until: t('time.axis.ongoingArrow') });
  }
  return from;
}

function fieldLabel(f: string, t: TFunc): string {
  switch (f) {
    case 'title':
      return t('review.field.title');
    case 'summary':
      return t('review.field.summary');
    case 'content':
      return t('review.field.content');
    case 'tags':
      return t('review.field.tags');
    case 'aliases':
      return t('review.field.aliases');
    default:
      return f;
  }
}

/** 正文/概述这种长文本要保留换行；短字段（标题、标签等）走普通流式排版 */
const LONG_FIELDS = new Set(['content', 'summary']);

/**
 * 把 diffText 产出的片段序列渲染成带高亮的文本。
 *   · equal —— 原样显示（没改动的部分）
 *   · del   —— 红底 + 删除线（修改前独有，即被删掉的内容）
 *   · add   —— 绿底（修改后独有，即新增的内容）
 */
function DiffSegments({ segs, long }: { segs: DiffSeg[]; long: boolean }) {
  if (!segs.length) return <span className="muted">—</span>;
  return (
    <span className={long ? 'diff-long' : undefined}>
      {segs.map((s, i) => {
        if (s.type === 'equal') return <span key={i}>{s.value}</span>;
        if (s.type === 'del')
          return (
            <span key={i} className="diff-seg del">
              {s.value}
            </span>
          );
        return (
          <span key={i} className="diff-seg add">
            {s.value}
          </span>
        );
      })}
    </span>
  );
}

/**
 * 「改一改再采纳」的排版版。
 *
 * 排版（timeline-layout）和猜测（timeline-guess）都走这里 —— 两者给的都是同一张
 * `TimeLayoutItem[]` 表，差别只在猜测**连时间文本一起定**，所以猜测多摆一栏「时间」。
 *
 * 存在两个理由，都是别的入口替代不了的：
 *   · **逐条挑**：AI 排的十条里，作者常常只想按其中六条 —— 不勾的那几条就不改，
 *     比「先整批采纳、再去轴上一条条拖回来」省事得多；
 *   · **逐条调**：位置是个数字，AI 给的整数只是个提议，作者想拉开就拉开。
 *
 * 它只改**这条提议**（`layoutDraft` / `guessDraft`），一个字都不落库 —— 落库仍然只发生在按「采纳」之后。
 */
function EditLayout({
  item,
  onClose,
  onSave,
}: {
  item: ReviewItem;
  onClose: () => void;
  onSave: (rows: TimeLayoutItem[]) => void;
}) {
  const store = useStore();
  const t = useT();
  const isGuess = item.kind === 'timeline-guess';
  const rows = isGuess ? (item.guessDraft ?? []) : (item.layoutDraft ?? []);
  /** 每行一份草稿：勾没勾、位置改成多少（终点只在原来就有的时候才摆出来）；猜测还多一栏时间文本 */
  const [draft, setDraft] = useState(() =>
    rows.map((r) => ({
      on: true,
      at: String(r.at),
      toAt: r.toAt === undefined ? '' : String(r.toAt),
      from: r.from ?? '',
    })),
  );

  const patch = (i: number, p: Partial<(typeof draft)[number]>) =>
    setDraft((d) => d.map((row, k) => (k === i ? { ...row, ...p } : row)));

  /** 数字框里的字是「正在打的字」，落库时才解析 —— 解析不出来就退回原值，别写个 NaN 进去 */
  const num = (v: string, fallback: number) => {
    const n = Number(v.trim());
    return v.trim() !== '' && Number.isFinite(n) ? n : fallback;
  };

  const save = () => {
    const next: TimeLayoutItem[] = [];
    rows.forEach((r, i) => {
      const d = draft[i];
      if (!d?.on) return;
      const at = num(d.at, r.at);
      const toAt = d.toAt.trim() === '' ? undefined : num(d.toAt, r.toAt ?? at);
      next.push({
        ...r,
        at,
        // 终点必须晚于起点 —— 否则轴上会画出一根倒着走的横杠。说不通就干脆不带它
        toAt: typeof toAt === 'number' && toAt > at ? toAt : undefined,
        // 猜测行允许作者改时间文本；排版行不碰它（锁定条目才需要，但那是 AI 排版时顺带重写的）
        ...(isGuess ? { from: d.from.trim() || r.from } : {}),
      });
    });
    onSave(next);
  };

  const kept = draft.filter((d) => d.on).length;

  return (
    <Modal
      title={isGuess ? t('review.guess.editTitle') : t('review.layout.editTitle')}
      size="lg"
      onClose={onClose}
      footer={
        <>
          <button className="btn sm" onClick={onClose}>
            {t('common.cancel')}
          </button>
          <button className="btn primary sm" data-role="rv-layout-edit-save" disabled={!kept} onClick={save}>
            {t('review.btn.saveChanges')}
          </button>
        </>
      }
    >
      <div className="field-hint">{isGuess ? t('review.guess.editHint') : t('review.layout.editHint')}</div>
      <div className="mt12">
        {rows.map((r, i) => {
          const d = draft[i];
          const cur = store.entries.find((e) => e.id === r.entryId);
          return (
            <div className="layout-edit-row" key={r.entryId} data-role="rv-layout-edit-row">
              <label className="row" style={{ gap: 6, alignItems: 'center', minWidth: 0 }}>
                <input
                  type="checkbox"
                  data-role="rv-layout-edit-on"
                  checked={d.on}
                  onChange={(e) => patch(i, { on: e.target.checked })}
                />
                <span className="layout-title">{cur?.title ?? r.title}</span>
              </label>
              {isGuess && (
                <label className="row small" style={{ gap: 5, alignItems: 'center' }}>
                  <span className="muted tiny">{t('review.guess.editWhen')}</span>
                  <input
                    className="input"
                    style={{ width: 108 }}
                    data-role="rv-layout-edit-from"
                    value={d.from}
                    disabled={!d.on}
                    onChange={(e) => patch(i, { from: e.target.value })}
                  />
                </label>
              )}
              <label className="row small" style={{ gap: 5, alignItems: 'center' }}>
                <span className="muted tiny">{t('review.layout.editPos')}</span>
                <input
                  className="input"
                  style={{ width: 84 }}
                  inputMode="numeric"
                  data-role="rv-layout-edit-at"
                  value={d.at}
                  disabled={!d.on}
                  onChange={(e) => patch(i, { at: e.target.value })}
                />
              </label>
              {r.toAt !== undefined && (
                <label className="row small" style={{ gap: 5, alignItems: 'center' }}>
                  <span className="muted tiny">{t('review.layout.editEnd')}</span>
                  <input
                    className="input"
                    style={{ width: 84 }}
                    inputMode="numeric"
                    data-role="rv-layout-edit-toat"
                    value={d.toAt}
                    disabled={!d.on}
                    onChange={(e) => patch(i, { toAt: e.target.value })}
                  />
                </label>
              )}
              {r.reason && <div className="layout-reason">{r.reason}</div>}
            </div>
          );
        })}
        {!kept && <div className="field-hint mt12">{t('review.layout.editNone')}</div>}
      </div>
    </Modal>
  );
}

/** 采纳前的轻量编辑：只改关键字段，正文用纯文本框 */
function EditProposal({
  item,
  onClose,
  onSave,
}: {
  item: ReviewItem;
  onClose: () => void;
  onSave: (patch: Partial<ReviewItem>) => void;
}) {
  const store = useStore();
  const t = useT();
  const [title, setTitle] = useState(item.entryDraft?.title ?? item.title);
  const [summary, setSummary] = useState(item.entryDraft?.summary ?? '');
  const [content, setContent] = useState(item.entryDraft?.content ?? '');
  const [categoryId, setCategoryId] = useState(
    item.entryDraft?.categoryId ?? store.categories[0]?.id ?? '',
  );
  const [tags, setTags] = useState((item.entryDraft?.tags ?? []).join(t('common.listSep')));

  return (
    <Modal
      title={t('review.btn.editAccept')}
      size="lg"
      onClose={onClose}
      footer={
        <>
          <button className="btn sm" onClick={onClose}>
            {t('common.cancel')}
          </button>
          <button
            className="btn primary sm"
            onClick={() =>
              onSave({
                title: title.trim(),
                entryDraft: {
                  ...item.entryDraft,
                  title: title.trim(),
                  summary,
                  content,
                  categoryId,
                  tags: tags
                    .split(/[,，、]/)
                    .map((s) => s.trim())
                    .filter(Boolean),
                },
              })
            }
          >
            {t('review.btn.saveChanges')}
          </button>
        </>
      }
    >
      <div className="row wrap" style={{ gap: 10 }}>
        <div className="col" style={{ minWidth: 200 }}>
          <label className="field-label">{t('review.field.title')}</label>
          <input className="input" value={title} onChange={(e) => setTitle(e.target.value)} />
        </div>
        <div style={{ width: 180 }}>
          <label className="field-label">{t('review.field.category')}</label>
          <select
            className="select"
            value={categoryId}
            onChange={(e) => setCategoryId(e.target.value)}
          >
            {store.categories.map((c) => (
              <option key={c.id} value={c.id}>
                {c.icon} {c.name}
              </option>
            ))}
          </select>
        </div>
      </div>
      <div className="field mt12">
        <label className="field-label">{t('review.field.summary')}</label>
        <input className="input" value={summary} onChange={(e) => setSummary(e.target.value)} />
      </div>
      <div className="field">
        <label className="field-label">{t('review.field.tags')}</label>
        <input className="input" value={tags} onChange={(e) => setTags(e.target.value)} />
      </div>
      <div className="field">
        <label className="field-label">{t('review.field.contentMd')}</label>
        <textarea
          className="textarea"
          style={{ minHeight: 280 }}
          value={content}
          onChange={(e) => setContent(e.target.value)}
        />
      </div>
    </Modal>
  );
}
