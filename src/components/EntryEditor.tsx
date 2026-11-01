import React, { useEffect, useMemo, useState } from 'react';
import { useStore } from '../state/store';
import { useToast } from './Toast';
import { Modal, StatusPill } from './Modal';
import { MarkdownView } from './MarkdownView';
import { WikiEditor } from './WikiEditor';
import { MediaPicker } from './MediaPicker';
import { IcPlus, IcSparkles, IcTrash, IcClock } from './icons';
import { useAITask } from '../state/aiTasks';
import { runExpand } from '../ai/tasks';
import { mergeMutualOf } from '../lib/relations';
import { useT } from '../i18n';
import type { Entry, EntryStatus, TimeWeight } from '../types';
import { TIME_WEIGHTS } from '../types';

interface Props {
  entryId: string;
  onClose: () => void;
  onOpenEntry: (id: string) => void;
}

/* ---------------------------- 未保存草稿 ---------------------------- */
/*
 * 改到一半切走、关掉、刷新 —— 都不能丢。
 *
 * 存 localStorage 而不是库里：它是**临时**的（保存成功就该消失），
 * 进库反而会在备份/导出里留下一堆半成品。按条目分键，互不干扰。
 *
 * 打开时**不自动应用**，而是摆一条「上次还有没存的改动 · 恢复 / 丢弃」。
 * 自动套上去的话，作者会以为库里本来就是那样 —— 那是静默改数据，
 * 比丢掉草稿更难查。
 */
interface StoredDraft {
  content: string;
  title: string;
  at: number;
}
const draftKey = (id: string) => `wf.wkedit.${id}`;

function readDraft(id: string): StoredDraft | null {
  try {
    const raw = localStorage.getItem(draftKey(id));
    if (!raw) return null;
    const d = JSON.parse(raw) as StoredDraft;
    return typeof d?.content === 'string' ? d : null;
  } catch {
    // 存不下/读不出都只是「没有草稿」，不该挡住编辑
    return null;
  }
}
function writeDraft(id: string, d: StoredDraft) {
  try {
    localStorage.setItem(draftKey(id), JSON.stringify(d));
  } catch {
    /* 容量满了也不报错 —— 草稿是锦上添花，不能因为它挡住保存 */
  }
}
function clearDraft(id: string) {
  try {
    localStorage.removeItem(draftKey(id));
  } catch {
    /* 同上 */
  }
}

/** 三种看法：只编辑 / 并排 / 只看成品。记住上次的选择 */
type EditMode = 'edit' | 'split' | 'preview';
const MODE_KEY = 'wf.wkedit.mode';
function readMode(): EditMode {
  try {
    const v = localStorage.getItem(MODE_KEY);
    return v === 'edit' || v === 'preview' || v === 'split' ? v : 'split';
  } catch {
    return 'split';
  }
}

export function EntryEditor({ entryId, onClose, onOpenEntry }: Props) {
  const store = useStore();
  const toast = useToast();
  // 扩写结果直接进审查队列，任务槽只用来记「正在跑」与流式预览
  const ai = useAITask('entries.expand', 'entries');
  const t = useT();

  const relTypes = [
    t('kind.relType.membership'),
    t('kind.relType.allegiance'),
    t('kind.relType.hostility'),
    t('kind.relType.location'),
    t('kind.relType.kinship'),
    t('kind.relType.mentorship'),
    t('kind.relType.possession'),
    t('kind.relType.causality'),
    t('kind.relType.related'),
  ];
  const defaultRelType = t('kind.relType.related');

  const entry = store.entries.find((e) => e.id === entryId);
  const [draft, setDraft] = useState<Entry | null>(entry ?? null);
  const [tab, setTab] = useState<'content' | 'fields' | 'relations' | 'time'>('content');
  /**
   * 两个数值位置（起点 / 区间终点）单独用文本存。
   *
   * 直接绑 `number` 的话，「-」这种打了一半的输入会被 `Number()` 化成 NaN，
   * 于是刚敲的负号立刻被抹掉 —— 数字框里做不了「先打符号再打数字」。
   */
  const [atText, setAtText] = useState('');
  const [toAtText, setToAtText] = useState('');
  const [mode, setMode] = useState<EditMode>(readMode);
  /**
   * 编辑摘要 —— 与 `draft.summary`（那是条目自己的「概述」字段）是两回事，
   * 所以名字里必须带 edit，不然早晚会有人把这两栏接反。
   */
  const [editSummary, setEditSummary] = useState('');
  const [draftFound, setDraftFound] = useState<StoredDraft | null>(null);
  const [aiInstruction, setAiInstruction] = useState('');
  const [newRel, setNewRel] = useState({ toEntryId: '', type: defaultRelType, note: '' });
  const [newFieldKey, setNewFieldKey] = useState('');
  const [dirty, setDirty] = useState(false);
  /* 封面选择器（只挑图片）；选完只改 draft，跟着其它字段一起保存 */
  const [coverOpen, setCoverOpen] = useState(false);

  useEffect(() => {
    setDraft(entry ?? null);
    setDirty(false);
    setAtText(entry?.time?.at !== undefined ? String(entry.time.at) : '');
    setToAtText(entry?.time?.toAt !== undefined ? String(entry.time.toAt) : '');
    setAiInstruction('');
    setEditSummary('');
    // 草稿跟库里那份一模一样就不必提了 —— 那只是上一次保存后残留的空壳
    const d = readDraft(entryId);
    setDraftFound(d && entry && d.content !== entry.content ? d : null);
  }, [entryId]); // eslint-disable-line react-hooks/exhaustive-deps

  /**
   * 改到一半自动落一份草稿。
   *
   * 防抖 700ms：逐字写 localStorage 在大条目上会让打字发涩。
   * 只在 `dirty` 时写 —— 打开看一眼又切走，不该平白多出一份「未保存的改动」。
   */
  useEffect(() => {
    if (!draft || !dirty) return;
    const h = window.setTimeout(() => {
      writeDraft(entryId, { content: draft.content, title: draft.title, at: Date.now() });
    }, 700);
    return () => window.clearTimeout(h);
  }, [draft, dirty, entryId]);

  const cats = store.categories;
  const cat = cats.find((c) => c.id === draft?.categoryId);

  /** 内链自动补全的候选：当前世界里的全部条目 */
  const linkTargets = useMemo(
    () => store.entries.map((e) => ({ id: e.id, title: e.title, aliases: e.aliases })),
    [store.entries],
  );

  /** 世界上出现过的纪元名，给「纪元」输入框做候选（不强制，作者写新的也行） */
  const knownEras = useMemo(() => {
    const seen: string[] = [];
    for (const e of store.timedEntries) {
      const era = (e.time?.era ?? '').trim();
      if (era && !seen.includes(era)) seen.push(era);
    }
    return seen;
  }, [store.timedEntries]);

  const myRelations = useMemo(
    () =>
      store.relations.filter((r) => r.fromEntryId === entryId || r.toEntryId === entryId),
    [store.relations, entryId],
  );

  /** 封面图对应的杂物（拿缩略图来预览）；引用失效时它找不到，界面如实显示「未设置」之外的状态 */
  const coverPiece = useMemo(
    () => (draft?.cover ? store.pieces.find((p) => p.id === draft.cover) : undefined),
    [draft?.cover, store.pieces],
  );

  if (!draft) {
    return (
      <Modal title={t('entries.editor.missing')} onClose={onClose}>
        <div className="muted">{t('entries.editor.missingDesc')}</div>
      </Modal>
    );
  }

  const patch = (p: Partial<Entry>) => {
    setDraft({ ...draft, ...p });
    setDirty(true);
  };

  const save = async () => {
    try {
      await store.updateEntry(
        entryId,
        {
          title: draft.title.trim() || t('entries.default.untitled'),
          aliases: draft.aliases,
          summary: draft.summary,
          content: draft.content,
          tags: draft.tags,
          fields: draft.fields,
          status: draft.status,
          categoryId: draft.categoryId,
          cover: draft.cover,
        },
        editSummary.trim() || undefined,
      );
    } catch (e) {
      toast.error((e as Error).message);
      return;
    }
    // 存进去了，那份临时草稿就该消失 —— 否则下次打开还会问「要不要恢复上一份」
    clearDraft(entryId);
    setDraftFound(null);
    setEditSummary('');
    setDirty(false);
    toast.success(t('common.saved'));
  };

  /**
   * 关掉之前问一句。
   *
   * 措辞里必须写清「取消 = 草稿留着」—— 草稿是自动存的，所以取消并不丢东西。
   * 只喊一句「还有没保存的改动！」，作者会以为两条路都危险，只能二选一硬猜。
   */
  const attemptClose = () => {
    if (!dirty) {
      onClose();
      return;
    }
    if (window.confirm(t('editor.leave.confirm'))) {
      void save().then(onClose);
      return;
    }
    onClose();
  };

  const restoreDraft = () => {
    if (!draftFound) return;
    setDraft((d) => (d ? { ...d, content: draftFound.content, title: draftFound.title } : d));
    setDirty(true);
    setDraftFound(null);
  };

  /**
   * 时间不走 `updateEntry`，而走 `setEntryTime`。
   *
   * 两件事只有那里会做：补上缺失的「轴上的位置」，以及按形态规整终结时间。
   * 直接 `updateEntry({ time })` 写进去的话，作者刚设的时间在轴上会落在 0 号位
   * （排在所有条目前面），而界面上看不出任何异常 —— 又一个静默的错。
   * 所以只有**真的变了**才调它：每按一次保存都写一条日志，日志页会变成噪音。
   */
  const saveTime = async () => {
    const before = JSON.stringify(entry?.time ?? null);
    const after = JSON.stringify(draft.time ?? null);
    if (before === after) return;
    const saved = await store.setEntryTime(entryId, draft.time ?? null);
    // 位置可能是 store 自动补的（作者没填）—— 把补出来的值显示回输入框，
    // 而不是留着一个空框让作者猜它到底排到哪儿了
    setDraft((d) => (d ? { ...d, time: saved } : d));
    setAtText(saved?.at !== undefined ? String(saved.at) : '');
    setToAtText(saved?.toAt !== undefined ? String(saved.toAt) : '');
  };

  const doExpand = async () => {
    const result = await ai.run((opts) =>
      runExpand(
        store.settings.ai,
        store.activeWorld!,
        draft,
        store.entries,
        cats,
        aiInstruction,
        opts,
      ),
    );
    if (!result) return;
    await store.pushReview([result]);
    toast.success(t('entries.toast.aiQueued'));
    setAiInstruction('');
  };

  const fieldDefs = cat?.fieldDefs ?? [];
  const fieldKeys = [
    ...fieldDefs.map((f) => f.key),
    ...Object.keys(draft.fields ?? {}).filter((k) => !fieldDefs.some((f) => f.key === k)),
  ];

  return (
    <Modal
      title={draft.title || t('entries.default.untitled')}
      size="xl"
      onClose={attemptClose}
      footer={
        <>
          <button
            className="btn danger sm"
            onClick={async () => {
              if (!confirm(t('entries.confirm.deleteEntry', { title: draft.title }))) return;
              await store.deleteEntry(entryId);
              // 条目都没了，那份草稿也随之作废
              clearDraft(entryId);
              toast.success(t('entries.toast.deleted'));
              onClose();
            }}
          >
            <IcTrash size={14} /> {t('common.delete')}
          </button>
          <div className="grow" />
          <button className="btn sm" data-role="entry-close" onClick={attemptClose}>
            {t('common.close')}
          </button>
          <button
            className="btn primary sm"
            data-role="entry-save"
            onClick={async () => {
              await save();
              await saveTime();
            }}
            disabled={!dirty}
          >
            {dirty ? t('entries.btn.saveChanges') : t('common.saved')}
          </button>
        </>
      }
    >
      {/* 元信息行 */}
      <div className="row wrap" style={{ gap: 10 }}>
        <div className="col" style={{ minWidth: 220 }}>
          <label className="field-label">{t('entries.field.title')}</label>
          <input
            className="input"
            data-role="entry-title"
            value={draft.title}
            onChange={(e) => patch({ title: e.target.value })}
          />
        </div>
        <div style={{ width: 148 }}>
          <label className="field-label">{t('entries.field.category')}</label>
          <select
            className="select"
            value={draft.categoryId}
            onChange={(e) => patch({ categoryId: e.target.value })}
          >
            {cats.map((c) => (
              <option key={c.id} value={c.id}>
                {c.icon} {c.name}
              </option>
            ))}
          </select>
        </div>
        <div style={{ width: 118 }}>
          <label className="field-label">{t('entries.field.status')}</label>
          <select
            className="select"
            value={draft.status}
            onChange={(e) => patch({ status: e.target.value as EntryStatus })}
          >
            <option value="draft">{t('kind.status.draft')}</option>
            <option value="pending">{t('kind.status.pending')}</option>
            <option value="canon">{t('kind.status.canon')}</option>
          </select>
        </div>
      </div>

      <div className="row wrap mt12" style={{ gap: 10 }}>
        <div className="col" style={{ minWidth: 200 }}>
          <label className="field-label">{t('entries.field.aliases')}</label>
          <input
            className="input"
            value={draft.aliases.join(t('common.listSep'))}
            placeholder={t('entries.placeholder.aliases')}
            onChange={(e) =>
              patch({
                aliases: e.target.value
                  .split(/[,，、]/)
                  .map((s) => s.trim())
                  .filter(Boolean),
              })
            }
          />
        </div>
        <div className="col" style={{ minWidth: 200 }}>
          <label className="field-label">{t('entries.field.tags')}</label>
          <input
            className="input"
            value={draft.tags.join(t('common.listSep'))}
            placeholder={t('entries.placeholder.tags')}
            onChange={(e) =>
              patch({
                tags: e.target.value
                  .split(/[,，、]/)
                  .map((s) => s.trim())
                  .filter(Boolean),
              })
            }
          />
        </div>
      </div>

      <div className="mt12">
        <label className="field-label">{t('entries.field.summary')}</label>
        <input
          className="input"
          value={draft.summary}
          placeholder={t('entries.placeholder.summary')}
          onChange={(e) => patch({ summary: e.target.value })}
        />
      </div>

      {/*
        封面：一张图（杂物间的引用），用在编年卡片与阅读页的顶上。
        与其它字段一样是「改完一起保存」—— 这里只动 draft，保存时才落库。
        挑图走的还是 MediaPicker（上传的新图会顺手挂上这一条的关联）。
      */}
      <div className="mt12 entry-cover-row" data-role="entry-cover-row">
        <div className="entry-cover-thumb" data-role="entry-cover-thumb">
          {coverPiece?.thumb ? (
            <img src={coverPiece.thumb} alt={coverPiece.title} />
          ) : (
            <span className="entry-cover-none">{t('media.cover.none')}</span>
          )}
        </div>
        <div className="col" style={{ gap: 6, minWidth: 0 }}>
          <label className="field-label">{t('media.cover.label')}</label>
          <div className="row" style={{ gap: 8, flexWrap: 'wrap' }}>
            <button
              type="button"
              className="btn sm"
              data-role="entry-cover-choose"
              onClick={() => setCoverOpen(true)}
            >
              {draft.cover ? t('media.cover.change') : t('media.cover.choose')}
            </button>
            {draft.cover && (
              <button
                type="button"
                className="btn sm ghost"
                data-role="entry-cover-clear"
                onClick={() => patch({ cover: undefined })}
              >
                {t('media.cover.clear')}
              </button>
            )}
          </div>
          <div className="field-hint">{t('media.cover.hint')}</div>
        </div>
      </div>
      {coverOpen && (
        <MediaPicker
          imageOnly
          entryId={entryId}
          onClose={() => setCoverOpen(false)}
          onPick={(p) => patch({ cover: p.id })}
        />
      )}

      {/* Tab */}
      <div className="row mt16" style={{ gap: 4 }}>
        {(
          [
            ['content', t('entries.tab.content')],
            [
              'fields',
              fieldKeys.length
                ? t('entries.tab.fieldsCount', { n: fieldKeys.length })
                : t('entries.tab.fields'),
            ],
            ['relations', t('entries.tab.relationsCount', { n: myRelations.length })],
            ['time', draft.time ? `${t('time.edit.tab')} ●` : t('time.edit.tab')],
          ] as const
        ).map(([key, label]) => (
          <button
            key={key}
            className={`btn sm ${tab === key ? 'primary' : 'ghost'}`}
            data-role={`entry-tab-${key}`}
            onClick={() => setTab(key as any)}
          >
            {label}
          </button>
        ))}
        <div className="grow" />
        {tab === 'content' && (
          <div className="row" style={{ gap: 3 }} data-role="entry-mode">
            {(['edit', 'split', 'preview'] as const).map((m) => (
              <button
                key={m}
                className={`btn xs ${mode === m ? 'primary' : 'ghost'}`}
                data-role={`entry-mode-${m}`}
                onClick={() => {
                  setMode(m);
                  try {
                    localStorage.setItem(MODE_KEY, m);
                  } catch {
                    /* 记不住就记不住，不影响这次编辑 */
                  }
                }}
              >
                {t(`editor.mode.${m}`)}
              </button>
            ))}
          </div>
        )}
      </div>

      <div className="divider" />

      {tab === 'content' && (
        <>
          {/* 上次没存完的那一份：摆出来问一句，不自动套上去 */}
          {draftFound && (
            <div className="wxe-draft" data-role="entry-draft">
              <span>{t('editor.draft.found')}</span>
              <div className="grow" />
              <button className="btn xs" data-role="entry-draft-restore" onClick={restoreDraft}>
                {t('editor.draft.restore')}
              </button>
              <button
                className="btn xs ghost"
                data-role="entry-draft-discard"
                onClick={() => {
                  clearDraft(entryId);
                  setDraftFound(null);
                }}
              >
                {t('editor.draft.discard')}
              </button>
            </div>
          )}

          <div className={`wxe-shell ${mode === 'split' ? '' : 'single'}`} data-role="entry-shell">
            {mode !== 'preview' && (
              <div className="wxe-pane">
                <WikiEditor
                  value={draft.content}
                  onChange={(v) => patch({ content: v })}
                  linkTargets={linkTargets}
                  selfId={entryId}
                />
              </div>
            )}
            {mode !== 'edit' && (
              <div className="wxe-pane">
                <div className="wxe-preview" data-role="entry-preview">
                  {/* 用阅读页那一套排版（`md wiki`）—— 预览跟成品长得一样才叫预览 */}
                  <MarkdownView
                    className="wiki"
                    content={draft.content || t('entries.editor.noContent')}
                    onInternalLink={(name) => {
                      const target = store.entries.find((e) => e.title === name);
                      if (target) onOpenEntry(target.id);
                    }}
                  />
                </div>
                <div className="wxe-note">{t('editor.previewHint')}</div>
              </div>
            )}
          </div>

          {/* 编辑摘要 —— 存进活动日志，日后翻得到「当时为什么改」 */}
          <div className="wxe-summary">
            <label htmlFor="entry-edit-summary">{t('editor.summary.label')}</label>
            <input
              id="entry-edit-summary"
              className="input"
              data-role="entry-summary"
              value={editSummary}
              placeholder={t('editor.summary.placeholder')}
              onChange={(e) => setEditSummary(e.target.value)}
            />
          </div>
          <div className="field-hint">{t('editor.summary.hint')}</div>

          <div className="card mt16" style={{ padding: 14, background: 'var(--panel-alt)' }}>
            <div className="bold small" style={{ marginBottom: 8 }}>
              <IcSparkles size={14} /> {t('entries.ai.title')}
            </div>
            <div className="row">
              <input
                className="input grow"
                placeholder={t('entries.placeholder.aiInstruction')}
                value={aiInstruction}
                onChange={(e) => setAiInstruction(e.target.value)}
                disabled={ai.loading}
              />
              <button className="btn primary" onClick={doExpand} disabled={ai.loading}>
                {ai.loading ? <span className="spinner" /> : t('entries.ai.generate')}
              </button>
            </div>
            <div className="field-hint">{t('entries.ai.hint')}</div>
            {ai.loading && ai.stream && <div className="stream-box mt12">{ai.stream}</div>}
          </div>
        </>
      )}

      {tab === 'fields' && (
        <>
          {fieldKeys.length === 0 && (
            <div className="muted small">{t('entries.fieldEditor.empty')}</div>
          )}
          {fieldKeys.map((key) => {
            const def = fieldDefs.find((f) => f.key === key);
            return (
              <div className="row" key={key} style={{ marginBottom: 9, alignItems: 'center' }}>
                <div style={{ width: 130 }} className="soft small">
                  {def?.label ?? key}
                </div>
                <input
                  className="input grow"
                  value={draft.fields?.[key] ?? ''}
                  placeholder={def?.placeholder}
                  onChange={(e) =>
                    patch({ fields: { ...draft.fields, [key]: e.target.value } })
                  }
                />
                {!def && (
                  <button
                    className="btn xs ghost"
                    title={t('entries.fieldEditor.removeCustom')}
                    onClick={() => {
                      const next = { ...draft.fields };
                      delete next[key];
                      patch({ fields: next });
                    }}
                  >
                    <IcTrash size={13} />
                  </button>
                )}
              </div>
            );
          })}
          <div className="row mt12">
            <input
              className="input grow"
              placeholder={t('entries.placeholder.newField')}
              value={newFieldKey}
              onChange={(e) => setNewFieldKey(e.target.value)}
            />
            <button
              className="btn"
              onClick={() => {
                const k = newFieldKey.trim();
                if (!k) return;
                patch({ fields: { ...draft.fields, [k]: draft.fields?.[k] ?? '' } });
                setNewFieldKey('');
              }}
            >
              <IcPlus size={14} /> {t('entries.fieldEditor.add')}
            </button>
          </div>
        </>
      )}

      {tab === 'relations' && (
        <>
          {myRelations.length === 0 && (
            <div className="muted small">{t('entries.rel.empty')}</div>
          )}
          {mergeMutualOf(entryId, myRelations).map((m) => {
            const r = m.rels[0];
            const isFrom = r.fromEntryId === entryId;
            const otherId = isFrom ? r.toEntryId : r.fromEntryId;
            const other = store.entries.find((e) => e.id === otherId);
            // 双向时 rels[0] 是从「本条目」出发那条，rels[1] 是从对端回来那条
            const back = m.mutual ? m.rels[1] : null;
            return (
              <div
                key={r.id}
                className="row"
                data-mutual={m.mutual ? 'true' : undefined}
                style={{
                  padding: '8px 10px',
                  border: '1px solid var(--border)',
                  borderRadius: 8,
                  marginBottom: 7,
                  alignItems: 'center',
                }}
              >
                <span className="pill tiny">{r.type}</span>
                <span className="soft tiny nowrap">
                  {m.mutual
                    ? t('entries.rel.mutual')
                    : isFrom
                      ? t('entries.rel.outgoing')
                      : t('entries.rel.incoming')}
                </span>
                <span
                  className="grow bold pointer"
                  style={{ fontSize: 13, color: 'var(--primary)' }}
                  onClick={() => other && onOpenEntry(other.id)}
                >
                  {other?.title ?? t('entries.rel.deleted')}
                </span>
                {/* 双向：把「回来」那条的类型也摆出来，两个方向各说各的 */}
                {back && (
                  <span className="pill tiny" title={t('entries.rel.mutual')}>
                    {back.type}
                  </span>
                )}
                {r.note && <span className="muted tiny">{r.note}</span>}
                <button
                  className="btn xs ghost"
                  onClick={() => {
                    for (const rr of m.rels) void store.deleteRelation(rr.id);
                  }}
                  title={t('entries.rel.delete')}
                >
                  <IcTrash size={13} />
                </button>
              </div>
            );
          })}

          <div className="divider" />
          <div className="row wrap" style={{ gap: 8, alignItems: 'flex-end' }}>
            <div className="col" style={{ minWidth: 180 }}>
              <label className="field-label">{t('entries.rel.to')}</label>
              <select
                className="select"
                value={newRel.toEntryId}
                onChange={(e) => setNewRel({ ...newRel, toEntryId: e.target.value })}
              >
                <option value="">{t('entries.placeholder.selectEntry')}</option>
                {store.entries
                  .filter((e) => e.id !== entryId)
                  .map((e) => (
                    <option key={e.id} value={e.id}>
                      {e.title}
                    </option>
                  ))}
              </select>
            </div>
            <div style={{ width: 130 }}>
              <label className="field-label">{t('entries.field.relType')}</label>
              <input
                className="input"
                list="rel-types"
                value={newRel.type}
                onChange={(e) => setNewRel({ ...newRel, type: e.target.value })}
              />
              <datalist id="rel-types">
                {relTypes.map((rt) => (
                  <option key={rt} value={rt} />
                ))}
              </datalist>
            </div>
            <div className="col" style={{ minWidth: 140 }}>
              <label className="field-label">{t('entries.field.note')}</label>
              <input
                className="input"
                value={newRel.note}
                onChange={(e) => setNewRel({ ...newRel, note: e.target.value })}
              />
            </div>
            <button
              className="btn"
              disabled={!newRel.toEntryId}
              onClick={async () => {
                await store.createRelation({
                  worldId: draft.worldId,
                  fromEntryId: entryId,
                  toEntryId: newRel.toEntryId,
                  type: newRel.type || defaultRelType,
                  note: newRel.note,
                  status: 'canon',
                });
                setNewRel({ toEntryId: '', type: defaultRelType, note: '' });
                toast.success(t('entries.toast.relationCreated'));
              }}
            >
              <IcPlus size={14} /> {t('entries.rel.create')}
            </button>
          </div>
        </>
      )}

      {/* ---------------- 时间：这条在世界里的什么时候 ---------------- */}
      {tab === 'time' && (
        <div data-role="entry-time">
          <div className="row" style={{ gap: 8, alignItems: 'center' }}>
            <span className="muted small">{t('time.edit.heading')}</span>
            <div className="grow" />
            {draft.time ? (
              <button
                className="btn sm ghost"
                data-role="entry-time-unset"
                onClick={() => patch({ time: undefined })}
              >
                <IcTrash size={13} /> {t('time.edit.unset')}
              </button>
            ) : (
              <button
                className="btn sm"
                data-role="entry-time-set"
                onClick={() =>
                  patch({
                    time: { kind: 'point', from: '', to: '', era: '', weight: 'normal' },
                  })
                }
              >
                <IcClock size={13} /> {t('time.edit.set')}
              </button>
            )}
          </div>

          {!draft.time ? (
            <p className="muted small" style={{ marginTop: 12 }} data-role="entry-time-none">
              {t('time.edit.none')} —— {t('time.edit.noneHint')}
            </p>
          ) : (
            <>
              {/*
                形态做成显式三选一，而不是「看终结时间空不空」去猜：
                作者填过终结、后来又删掉，那份空白既可能是「至今」也可能是「就是个时间点」——
                猜错会让轴上凭空多出一段跨度。
              */}
              <div
                className="row wrap"
                style={{ gap: 6, marginTop: 12 }}
                data-role="entry-time-kind"
              >
                {(['point', 'range', 'ongoing'] as const).map((k) => (
                  <button
                    key={k}
                    className={`chip ${draft.time!.kind === k ? 'active' : ''}`}
                    data-role={`entry-time-kind-${k}`}
                    title={t(`time.kind.hint.${k}`)}
                    onClick={() => patch({ time: { ...draft.time!, kind: k } })}
                  >
                    {t(`time.kind.${k}`)}
                  </button>
                ))}
              </div>
              <p className="muted tiny" style={{ marginTop: 6 }}>
                {t(`time.kind.hint.${draft.time.kind}`)}
              </p>

              <div className="row wrap" style={{ gap: 10, marginTop: 12 }}>
                <div className="col" style={{ minWidth: 210 }}>
                  <label className="field-label">{t('time.edit.from')}</label>
                  <input
                    className="input"
                    data-role="entry-time-from"
                    value={draft.time.from}
                    placeholder={t('time.edit.fromPlaceholder')}
                    onChange={(e) => patch({ time: { ...draft.time!, from: e.target.value } })}
                  />
                </div>
                {draft.time.kind === 'range' && (
                  <div className="col" style={{ minWidth: 210 }}>
                    <label className="field-label">{t('time.edit.to')}</label>
                    <input
                      className="input"
                      data-role="entry-time-to"
                      value={draft.time.to}
                      placeholder={t('time.edit.toPlaceholder')}
                      onChange={(e) => patch({ time: { ...draft.time!, to: e.target.value } })}
                    />
                  </div>
                )}
              </div>

              <div className="row wrap" style={{ gap: 10, marginTop: 10, alignItems: 'flex-end' }}>
                <div style={{ width: 140 }}>
                  <label className="field-label">{t('time.edit.at')}</label>
                  <input
                    className="input"
                    data-role="entry-time-at"
                    inputMode="numeric"
                    value={atText}
                    placeholder="—"
                    onChange={(e) => {
                      setAtText(e.target.value);
                      const n = Number(e.target.value);
                      patch({
                        time: {
                          ...draft.time!,
                          at: e.target.value.trim() !== '' && Number.isFinite(n) ? n : undefined,
                        },
                      });
                    }}
                  />
                </div>
                {draft.time.kind === 'range' && (
                  <div style={{ width: 140 }}>
                    <label className="field-label">{t('time.edit.toAt')}</label>
                    <input
                      className="input"
                      data-role="entry-time-toat"
                      inputMode="numeric"
                      value={toAtText}
                      placeholder="—"
                      onChange={(e) => {
                        setToAtText(e.target.value);
                        const n = Number(e.target.value);
                        patch({
                          time: {
                            ...draft.time!,
                            toAt:
                              e.target.value.trim() !== '' && Number.isFinite(n) ? n : undefined,
                          },
                        });
                      }}
                    />
                  </div>
                )}
                <div style={{ width: 180 }}>
                  <label className="field-label">{t('time.edit.era')}</label>
                  <input
                    className="input"
                    data-role="entry-time-era"
                    list="era-suggest"
                    value={draft.time.era}
                    placeholder={t('time.edit.eraPlaceholder')}
                    onChange={(e) => patch({ time: { ...draft.time!, era: e.target.value } })}
                  />
                  <datalist id="era-suggest">
                    {knownEras.map((era) => (
                      <option key={era} value={era} />
                    ))}
                  </datalist>
                </div>
                <div className="col" style={{ minWidth: 130 }}>
                  <label className="field-label">{t('time.edit.weight')}</label>
                  <select
                    className="select"
                    data-role="entry-time-weight"
                    value={draft.time.weight}
                    onChange={(e) =>
                      patch({ time: { ...draft.time!, weight: e.target.value as TimeWeight } })
                    }
                  >
                    {TIME_WEIGHTS.map((w) => (
                      <option key={w} value={w}>
                        {t(`time.weight.${w}`)}
                      </option>
                    ))}
                  </select>
                </div>
              </div>

              <p className="muted tiny" style={{ marginTop: 10 }}>
                {t('time.edit.atHint')}
              </p>
              {draft.time.kind === 'range' && (
                <p className="muted tiny" style={{ marginTop: 4 }}>
                  {t('time.edit.toAtHint')}
                </p>
              )}
              <p className="muted tiny" style={{ marginTop: 4 }}>
                {t('time.edit.linkHint')}
              </p>
            </>
          )}
        </div>
      )}

      <div className="divider" />
      <div className="row wrap small muted" style={{ gap: 14 }}>
        <span>{t('entries.editor.id', { id: draft.id })}</span>
        <span>{t('entries.editor.statusLabel')}</span>
        <StatusPill status={draft.status} />
        {draft.sourceRefs.length > 0 && (
          <span>{t('entries.editor.sources', { n: draft.sourceRefs.length })}</span>
        )}
      </div>
    </Modal>
  );
}
