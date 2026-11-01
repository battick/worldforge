import React, { useEffect, useMemo, useRef, useState } from 'react';
import { useStore } from '../state/store';
import { useToast } from '../components/Toast';
import { Empty, Modal } from '../components/Modal';
import { MarkdownView } from '../components/MarkdownView';
import { IcEdit, IcPlus, IcSearch, IcTrash, IcUpload } from '../components/icons';
import {
  PIECE_KINDS,
  pieceKindMeta,
  TEXT_PIECE_KINDS,
  type Piece,
  type PieceKind,
} from '../types';
import { createMediaUrl, isTextPiece } from '../lib/pieces';
import { humanSize } from '../lib/files';
import { prepareImage } from '../lib/images';
import { formatRelative } from '../lib/id';
import { useT } from '../i18n';

interface Props {
  onOpenEntry: (id: string) => void;
  /**
   * 嵌进 Wiki（当它的「杂物间」子页）时为 true。
   *
   * 只影响页头那一段：不再重复渲染页标题（Wiki 那一层已经有了），而是只留
   * 操作按钮，并把原来那句「这里收什么」的说明挪成一行小字 —— 那句话是这一页
   * 最容易被误解的地方（作者常以为它和条目库是一回事），不能因为并进 Wiki 就丢。
   *
   * 其余 DOM（速记条、拖拽区、筛选、卡片网格）**一律不动**：e2e 与巡检靠它们选元素。
   */
  embedded?: boolean;
}

function detectKind(file: File): PieceKind {
  if (file.type.startsWith('image/')) return 'image';
  if (file.type.startsWith('audio/')) return 'audio';
  if (file.type.startsWith('video/')) return 'video';
  return 'other';
}

/** 媒体展示/播放：对象 URL 生命周期跟随挂载 */
function MediaBlock({ piece }: { piece: Piece }) {
  const t = useT();
  const [url, setUrl] = useState<string | null>(null);

  useEffect(() => {
    const u = createMediaUrl(piece);
    setUrl(u);
    return () => {
      if (u) URL.revokeObjectURL(u);
    };
  }, [piece]);

  if (!piece.media) return null;
  if (!url) return <div className="muted small">{t('pieces.media.loading')}</div>;

  if (piece.kind === 'image') {
    return (
      <img
        src={url}
        alt={piece.title}
        style={{ maxWidth: '100%', borderRadius: 8, display: 'block', margin: '0 auto' }}
      />
    );
  }
  if (piece.kind === 'audio') {
    return <audio src={url} controls style={{ width: '100%' }} />;
  }
  if (piece.kind === 'video') {
    return <video src={url} controls style={{ width: '100%', borderRadius: 8 }} />;
  }
  return (
    <a className="btn sm" href={url} download={piece.media.name}>
      {t('pieces.media.download', { name: piece.media.name, size: humanSize(piece.media.size) })}
    </a>
  );
}

export function PiecesPage({ onOpenEntry, embedded }: Props) {
  const store = useStore();
  const toast = useToast();
  const t = useT();
  const fileRef = useRef<HTMLInputElement>(null);

  const [filter, setFilter] = useState<PieceKind | 'all'>('all');
  const [q, setQ] = useState('');
  const [quick, setQuick] = useState('');
  const [dragging, setDragging] = useState(false);
  const [viewing, setViewing] = useState<Piece | null>(null);
  /** 编辑中的藏品（新建或修改） */
  const [editing, setEditing] = useState<Partial<Piece> | null>(null);
  const [entrySearch, setEntrySearch] = useState('');

  const pieces = store.pieces;

  const filtered = useMemo(() => {
    const kw = q.trim().toLowerCase();
    return pieces.filter((p) => {
      if (filter !== 'all' && p.kind !== filter) return false;
      if (!kw) return true;
      return (
        p.title.toLowerCase().includes(kw) ||
        p.content.toLowerCase().includes(kw) ||
        p.tags.some((t) => t.toLowerCase().includes(kw))
      );
    });
  }, [pieces, filter, q]);

  const kindCounts = useMemo(() => {
    const m = new Map<PieceKind, number>();
    for (const p of pieces) m.set(p.kind, (m.get(p.kind) ?? 0) + 1);
    return m;
  }, [pieces]);

  if (!store.activeWorld) return <Empty icon="🌍" title={t('pieces.list.noWorld')} />;

  const addQuick = async () => {
    const text = quick.trim();
    if (!text) return;
    setQuick('');
    const firstLine = text.split('\n')[0].slice(0, 24);
    await store.createPiece({
      worldId: store.activeWorld!.id,
      kind: 'fragment',
      title: firstLine,
      content: text,
    });
    toast.success(t('pieces.list.quick.saved'));
  };

  const handleFiles = async (files: FileList | null) => {
    if (!files?.length) return;
    let ok = 0;
    for (const file of Array.from(files)) {
      const kind = detectKind(file);
      let thumb: string | undefined;
      if (kind === 'image') {
        const prepared = await prepareImage(file);
        thumb = prepared?.thumb;
      }
      await store.createPiece({
        worldId: store.activeWorld!.id,
        kind,
        title: file.name.replace(/\.[^.]+$/, '') || file.name,
        content: '',
        media: { name: file.name, mime: file.type || 'application/octet-stream', size: file.size, blob: file },
        thumb,
        tags: [],
      });
      ok++;
    }
    if (fileRef.current) fileRef.current.value = '';
    if (ok) toast.success(t('pieces.list.upload.done', { n: ok }));
  };

  const toggleLink = (draft: Partial<Piece>, entryId: string): string[] => {
    const cur = draft.linkedEntryIds ?? [];
    return cur.includes(entryId) ? cur.filter((x) => x !== entryId) : [...cur, entryId];
  };

  const viewingLive = viewing ? store.pieces.find((p) => p.id === viewing.id) ?? viewing : null;

  const actionButtons = (
    <>
      <button className="btn sm" onClick={() => fileRef.current?.click()}>
        <IcUpload size={14} /> {t('pieces.list.btn.upload')}
      </button>
      <button
        className="btn primary sm"
        onClick={() =>
          setEditing({
            worldId: store.activeWorld!.id,
            kind: 'long',
            title: '',
            content: '',
            tags: [],
            linkedEntryIds: [],
          })
        }
      >
        <IcPlus size={14} /> {t('pieces.list.btn.new')}
      </button>
    </>
  );

  return (
    <>
      {embedded ? (
        <>
          <div className="wk-sub-actions" data-role="pieces-actions">
            {actionButtons}
          </div>
          <p className="wk-sub-hint">{t('pieces.desc')}</p>
        </>
      ) : (
        <div className="page-head">
          <div>
            <h1 className="page-title">{t('pieces.title')}</h1>
            <p className="page-desc">{t('pieces.desc')}</p>
          </div>
          <div className="page-actions">{actionButtons}</div>
        </div>
      )}

      <input
        ref={fileRef}
        type="file"
        multiple
        accept="image/*,audio/*,video/*,*"
        style={{ display: 'none' }}
        onChange={(e) => handleFiles(e.target.files)}
      />

      {/* 碎片速记：一句话也能入库 */}
      <div className="pz-quick">
        <span className="pz-quick-ico">🧩</span>
        <input
          className="input grow"
          placeholder={t('pieces.list.quick.placeholder')}
          value={quick}
          onChange={(e) => setQuick(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.nativeEvent.isComposing) addQuick();
          }}
        />
        <button className="btn sm" disabled={!quick.trim()} onClick={addQuick}>
          {t('pieces.list.quick.btn')}
        </button>
      </div>

      {/* 拖拽投放区 */}
      <div
        className={`pz-drop ${dragging ? 'drag' : ''}`}
        onDragOver={(e) => {
          e.preventDefault();
          setDragging(true);
        }}
        onDragLeave={() => setDragging(false)}
        onDrop={(e) => {
          e.preventDefault();
          setDragging(false);
          handleFiles(e.dataTransfer.files);
        }}
      >
        {dragging ? t('pieces.media.drop.active') : t('pieces.media.drop.idle')}
      </div>

      {/* 筛选 + 搜索 */}
      <div className="row wrap mt16" style={{ gap: 8 }}>
        <button
          className={`chip ${filter === 'all' ? 'active' : ''}`}
          onClick={() => setFilter('all')}
        >
          {t('pieces.filter.all', { n: pieces.length })}
        </button>
        {PIECE_KINDS.map((k) => {
          const n = kindCounts.get(k.key) ?? 0;
          if (!n && filter !== k.key) return null;
          return (
            <button
              key={k.key}
              className={`chip ${filter === k.key ? 'active' : ''}`}
              onClick={() => setFilter(k.key)}
            >
              {k.icon} {t(k.labelKey)} {n}
            </button>
          );
        })}
        <div className="row" style={{ gap: 6, marginLeft: 'auto' }}>
          <IcSearch size={14} />
          <input
            className="input"
            style={{ width: 180 }}
            placeholder={t('pieces.list.search.placeholder')}
            value={q}
            onChange={(e) => setQ(e.target.value)}
          />
        </div>
      </div>

      {/* 藏品列表 */}
      {filtered.length === 0 ? (
        <Empty
          icon="🧺"
          title={t('pieces.list.empty.title')}
          desc={t('pieces.list.empty.desc')}
        />
      ) : (
        /*
         * 瀑布流：CSS 多列（`column-width`）而不是 grid。
         *
         * 卡片的命根子是**内容**：长文碎片有几行正文、一句话碎片只有一个标题、
         * 图片卡片要看图片自己的高矮 —— 它们天生就不该一样高。grid 会把同一行的
         * 卡片拉齐、矮的那张底下留一片空白；多列是「一列填满再填下一列」，
         * 高矮各随各的，看着才像一面攒出来的杂物墙。
         */
        <div className="pz-grid" data-role="pz-grid">
          {filtered.map((p) => {
            const meta = pieceKindMeta(p.kind);
            const text = p.content.trim();
            return (
              <div key={p.id} className="pz-card" onClick={() => setViewing(p)}>
                {p.thumb ? (
                  // 用 <img> 而不是背景图：图片自己撑高，竖图卡片就比横图高一截，
                  // 这正是瀑布流要的参差（`max-height` 兜住极端的竖图）
                  <img className="pz-thumb-img" src={p.thumb} alt="" loading="lazy" />
                ) : (
                  <div className="pz-thumb pz-thumb-ico">{meta.icon}</div>
                )}
                <div className="pz-card-body">
                  <div className="pz-card-title">
                    {p.pinned && <span title={t('pieces.list.pinned')}>📌</span>}
                    {p.title}
                  </div>
                  <div className="muted tiny">
                    {t(meta.labelKey)}
                    {p.media ? ` · ${humanSize(p.media.size)}` : text ? ` · ${t('common.charCount', { n: p.content.length })}` : ''}
                    {' · '}
                    {formatRelative(p.updatedAt)}
                  </div>
                  {/* 正文预览：卡片高矮因此真的参差不齐，也省得每条都点开才知道写的是什么 */}
                  {text && <p className="pz-card-text">{text}</p>}
                  {p.tags.length > 0 && (
                    <div className="pz-tags">
                      {p.tags.slice(0, 4).map((tag) => (
                        <span key={tag} className="pill tiny">
                          {tag}
                        </span>
                      ))}
                    </div>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* 查看藏品 */}
      {viewingLive && (
        <Modal
          title={viewingLive.title}
          size="lg"
          onClose={() => setViewing(null)}
          footer={
            <div className="row" style={{ gap: 8 }}>
              <button
                className="btn sm"
                onClick={() =>
                  store.updatePiece(viewingLive.id, { pinned: !viewingLive.pinned })
                }
              >
                {viewingLive.pinned ? t('pieces.list.btn.unpin') : t('pieces.list.btn.pin')}
              </button>
              <button className="btn sm" onClick={() => setEditing(viewingLive)}>
                <IcEdit size={13} /> {t('common.edit')}
              </button>
              <button
                className="btn sm ghost"
                onClick={async () => {
                  if (!confirm(t('pieces.list.confirm.delete', { title: viewingLive.title }))) return;
                  await store.deletePiece(viewingLive.id);
                  setViewing(null);
                  toast.success(t('pieces.list.toast.deleted'));
                }}
              >
                <IcTrash size={13} /> {t('common.delete')}
              </button>
            </div>
          }
        >
          <div className="row wrap" style={{ gap: 6, marginBottom: 10 }}>
            <span className="pill">
              {pieceKindMeta(viewingLive.kind).icon} {t(pieceKindMeta(viewingLive.kind).labelKey)}
            </span>
            {viewingLive.tags.map((t) => (
              <span key={t} className="pill tiny">
                {t}
              </span>
            ))}
            <span className="muted tiny" style={{ marginLeft: 'auto' }}>
              {t('pieces.list.meta.createdAt', { time: formatRelative(viewingLive.createdAt) })}
            </span>
          </div>

          {viewingLive.media && (
            <div style={{ marginBottom: 14 }}>
              <MediaBlock piece={viewingLive} />
            </div>
          )}

          {viewingLive.content ? (
            <MarkdownView content={viewingLive.content} />
          ) : (
            !viewingLive.media && <div className="muted small">{t('pieces.list.noContent')}</div>
          )}

          {viewingLive.linkedEntryIds.length > 0 && (
            <div style={{ marginTop: 16, borderTop: '1px solid var(--border)', paddingTop: 12 }}>
              <div className="field-label">{t('pieces.list.linked')}</div>
              <div className="row wrap" style={{ gap: 6 }}>
                {viewingLive.linkedEntryIds.map((id) => {
                  const e = store.entries.find((x) => x.id === id);
                  if (!e) return null;
                  return (
                    <button
                      key={id}
                      className="btn xs"
                      onClick={() => {
                        setViewing(null);
                        onOpenEntry(id);
                      }}
                    >
                      {e.title}
                    </button>
                  );
                })}
              </div>
            </div>
          )}
        </Modal>
      )}

      {/* 新建 / 编辑藏品 */}
      {editing && (
        <Modal
          title={editing.id ? t('pieces.editor.title.edit') : t('pieces.editor.title.new')}
          size="lg"
          onClose={() => setEditing(null)}
          footer={
            <div className="row" style={{ gap: 8 }}>
              <button
                className="btn primary sm"
                onClick={async () => {
                  const data = editing;
                  if (!data.title?.trim() && !data.content?.trim() && !data.media) {
                    toast.warn(t('pieces.editor.warn.empty'));
                    return;
                  }
                  if (data.id) {
                    await store.updatePiece(data.id, {
                      kind: data.kind,
                      title: data.title?.trim() || t('pieces.editor.untitled'),
                      content: data.content ?? '',
                      tags: data.tags ?? [],
                      linkedEntryIds: data.linkedEntryIds ?? [],
                    });
                    // 保存后回到查看视图，直接看到改完的样子（含新关联的条目）
                    setViewing({ ...(data as Piece) });
                  } else {
                    await store.createPiece({
                      worldId: store.activeWorld!.id,
                      kind: data.kind ?? 'long',
                      title: data.title?.trim() || data.content?.split('\n')[0].slice(0, 24) || t('pieces.editor.untitled'),
                      content: data.content ?? '',
                      tags: data.tags ?? [],
                      linkedEntryIds: data.linkedEntryIds ?? [],
                    });
                  }
                  setEditing(null);
                  toast.success(t('common.saved'));
                }}
              >
                {t('common.save')}
              </button>
              <button className="btn ghost sm" onClick={() => setEditing(null)}>
                {t('common.cancel')}
              </button>
            </div>
          }
        >
          <div className="field-label">{t('pieces.editor.label.kind')}</div>
          <div className="row wrap" style={{ gap: 6, marginBottom: 12 }}>
            {PIECE_KINDS.filter((k) => TEXT_PIECE_KINDS.includes(k.key)).map((k) => (
              <button
                key={k.key}
                className={`chip ${editing.kind === k.key ? 'active' : ''}`}
                title={t(k.hintKey)}
                onClick={() => setEditing({ ...editing, kind: k.key })}
              >
                {k.icon} {t(k.labelKey)}
              </button>
            ))}
            {editing.kind && !TEXT_PIECE_KINDS.includes(editing.kind) && (
              <span className="pill">{pieceKindMeta(editing.kind).icon} {t(pieceKindMeta(editing.kind).labelKey)}{t('pieces.editor.kind.mediaNote')}</span>
            )}
          </div>

          <div className="field-label">{t('pieces.editor.label.title')}</div>
          <input
            className="input"
            style={{ marginBottom: 12 }}
            placeholder={t('pieces.editor.placeholder.title')}
            value={editing.title ?? ''}
            onChange={(e) => setEditing({ ...editing, title: e.target.value })}
          />

          {(!editing.kind || isTextPiece(editing.kind)) && (
            <>
              <div className="field-label">{t('pieces.editor.label.content')}</div>
              <textarea
                className="textarea"
                style={{ minHeight: 200, marginBottom: 12 }}
                placeholder={t('pieces.editor.placeholder.content')}
                value={editing.content ?? ''}
                onChange={(e) => setEditing({ ...editing, content: e.target.value })}
              />
            </>
          )}
          {editing.media && (
            <div className="banner info" style={{ marginBottom: 12 }}>
              {t('pieces.media.attach', { name: editing.media.name, size: humanSize(editing.media.size) })}
            </div>
          )}
          {editing.id && editing.kind && !isTextPiece(editing.kind) && (
            <>
              <div className="field-label">{t('pieces.editor.label.note')}</div>
              <textarea
                className="textarea"
                style={{ minHeight: 80, marginBottom: 12 }}
                placeholder={t('pieces.editor.placeholder.note')}
                value={editing.content ?? ''}
                onChange={(e) => setEditing({ ...editing, content: e.target.value })}
              />
            </>
          )}

          <div className="field-label">{t('pieces.editor.label.tags')}</div>
          <input
            className="input"
            style={{ marginBottom: 12 }}
            placeholder={t('pieces.editor.placeholder.tags')}
            value={(editing.tags ?? []).join(', ')}
            onChange={(e) =>
              setEditing({
                ...editing,
                tags: e.target.value
                  .split(/[,，]/)
                  .map((t) => t.trim())
                  .filter(Boolean),
              })
            }
          />

          <div className="field-label">{t('pieces.editor.label.linked')}</div>
          <input
            className="input"
            style={{ marginBottom: 8 }}
            placeholder={t('pieces.editor.placeholder.entrySearch')}
            value={entrySearch}
            onChange={(e) => setEntrySearch(e.target.value)}
          />
          <div className="pz-entry-pick">
            {store.entries
              .filter((e) =>
                entrySearch.trim()
                  ? (e.title + e.tags.join('')).toLowerCase().includes(entrySearch.trim().toLowerCase())
                  : true,
              )
              .slice(0, 60)
              .map((e) => {
                const checked = (editing.linkedEntryIds ?? []).includes(e.id);
                return (
                  <label key={e.id} className="row small" style={{ gap: 8, cursor: 'pointer' }}>
                    <input
                      type="checkbox"
                      checked={checked}
                      onChange={() =>
                        setEditing({ ...editing, linkedEntryIds: toggleLink(editing, e.id) })
                      }
                    />
                    {e.title}
                    <span className="muted tiny">
                      {store.categories.find((c) => c.id === e.categoryId)?.name}
                    </span>
                  </label>
                );
              })}
            {store.entries.length === 0 && (
              <div className="muted tiny">{t('pieces.editor.empty.entries')}</div>
            )}
          </div>
        </Modal>
      )}
    </>
  );
}
