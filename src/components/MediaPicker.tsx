import React, { useMemo, useRef, useState } from 'react';
import { useStore } from '../state/store';
import { Modal } from './Modal';
import { useT } from '../i18n';
import type { ID, Piece, PieceKind } from '../types';
import { prepareImage } from '../lib/images';

interface Props {
  /** 只列图片（封面场景）；不传则音频、视频一起列 */
  imageOnly?: boolean;
  /**
   * 正在编辑的条目 —— 「本条目的」这一个来源与「上传后自动关联」都靠它。
   * 不传（比如从别处调起）就只有「上传 / 世界的」两个来源。
   */
  entryId?: ID;
  onPick: (piece: Piece) => void;
  onClose: () => void;
}

function detectKind(file: File): PieceKind {
  if (file.type.startsWith('image/')) return 'image';
  if (file.type.startsWith('audio/')) return 'audio';
  if (file.type.startsWith('video/')) return 'video';
  return 'other';
}

/**
 * 媒体选择器：给「插入正文」与「选封面」共用的一个入口。
 *
 * 三个来源、一个动作：上传新的 / 本条目的 / 世界的，点一下就是选中 ——
 * 不做「先选中再确认」的第二步，挑图这件事本来一眼就能定。
 *
 * 上传走的是杂物间那一条老路（`createPiece`，进库、留痕、可撤销），
 * 所以选中的永远是一张**已经归档**的媒体：换个条目再来引用同一张，
 * 从「世界的」里挑就是 —— 同一份文件不会因为引用两次而存两份。
 */
export function MediaPicker({ imageOnly, entryId, onPick, onClose }: Props) {
  const store = useStore();
  const t = useT();
  const fileRef = useRef<HTMLInputElement>(null);
  /* 有本条目的媒体就从那儿开始挑；没有就从「世界的」开始（比空着的「上传」有用） */
  const [tab, setTab] = useState<'upload' | 'linked' | 'world'>(() =>
    entryId ? (linked.length ? 'linked' : 'world') : 'upload',
  );
  const [busy, setBusy] = useState(false);

  const mediaPieces = useMemo(() => {
    const q = imageOnly ? (p: Piece) => p.kind === 'image' : (p: Piece) => !!p.media;
    return store.pieces.filter((p) => p.worldId === store.activeWorld?.id && p.media && q(p));
  }, [store.pieces, store.activeWorld?.id, imageOnly]);

  const linked = useMemo(
    () => (entryId ? mediaPieces.filter((p) => p.linkedEntryIds.includes(entryId)) : []),
    [mediaPieces, entryId],
  );

  const active = tab;
  const list = active === 'linked' ? linked : mediaPieces;

  const handleFiles = async (files: FileList | null) => {
    if (!files?.length || !store.activeWorld) return;
    setBusy(true);
    let last: Piece | null = null;
    for (const file of Array.from(files)) {
      if (imageOnly && !file.type.startsWith('image/')) continue;
      const kind = detectKind(file);
      let thumb: string | undefined;
      if (kind === 'image') {
        const prepared = await prepareImage(file);
        thumb = prepared?.thumb;
      }
      const piece = await store.createPiece({
        worldId: store.activeWorld.id,
        kind,
        title: file.name.replace(/\.[^.]+$/, '') || file.name,
        content: '',
        media: { name: file.name, mime: file.type || 'application/octet-stream', size: file.size, blob: file },
        thumb,
        // 在条目里上传的，顺手把关联挂上 —— 下一次「本条目的」里就能看到它
        linkedEntryIds: entryId ? [entryId] : [],
        tags: [],
      });
      last = piece;
    }
    if (fileRef.current) fileRef.current.value = '';
    setBusy(false);
    // 上传完直接用（多张时用最后一张 —— 作者多半是把最想要的那张排在最后）
    if (last) {
      onPick(last);
      onClose();
    }
  };

  const item = (p: Piece) => (
    <button
      key={p.id}
      type="button"
      className="mp-item"
      data-role="mp-item"
      data-id={p.id}
      data-kind={p.kind}
      title={imageOnly ? t('media.picker.pick.cover') : t('media.picker.pick.hint')}
      onClick={() => {
        onPick(p);
        onClose();
      }}
    >
      <span className="mp-thumb">
        {p.thumb ? (
          <img src={p.thumb} alt={p.title} />
        ) : (
          <span className="mp-thumb-fallback">{p.kind === 'audio' ? '🎧' : p.kind === 'video' ? '🎞️' : '📦'}</span>
        )}
      </span>
      <span className="mp-name">{p.title}</span>
      <span className="mp-kind">
        {p.kind === 'audio' ? t('media.picker.audio') : p.kind === 'video' ? t('media.picker.video') : ''}
      </span>
    </button>
  );

  return (
    <Modal title={imageOnly ? t('media.picker.titleImage') : t('media.picker.title')} onClose={onClose} size="lg">
      <div className="mp">
        <div className="mp-tabs" data-role="mp-tabs">
          <button
            type="button"
            className={`chip ${active === 'upload' ? 'active' : ''}`}
            data-role="mp-tab-upload"
            onClick={() => setTab('upload')}
          >
            {t('media.picker.tab.upload')}
          </button>
          {entryId && (
            <button
              type="button"
              className={`chip ${active === 'linked' ? 'active' : ''}`}
              data-role="mp-tab-linked"
              onClick={() => setTab('linked')}
            >
              {t('media.picker.tab.linked')}
            </button>
          )}
          <button
            type="button"
            className={`chip ${active === 'world' ? 'active' : ''}`}
            data-role="mp-tab-world"
            onClick={() => setTab('world')}
          >
            {t('media.picker.tab.world')}
          </button>
          {imageOnly && <span className="mp-image-only">{t('media.picker.imageOnly')}</span>}
        </div>

        {active === 'upload' && (
          <div className="mp-upload" data-role="mp-upload">
            <p className="mp-hint">{entryId ? t('media.picker.upload.hint') : t('media.picker.upload.hintNoEntry')}</p>
            <input
              ref={fileRef}
              type="file"
              multiple
              data-role="mp-upload-input"
              accept={imageOnly ? 'image/*' : 'image/*,audio/*,video/*'}
              onChange={(e) => void handleFiles(e.target.files)}
            />
            <button type="button" className="btn" data-role="mp-upload-btn" onClick={() => fileRef.current?.click()}>
              {busy ? t('media.picker.uploading') : t('media.picker.upload.btn')}
            </button>
          </div>
        )}

        {active !== 'upload' && (
          <div className="mp-grid" data-role="mp-grid">
            {list.length ? (
              list.map(item)
            ) : (
              <div className="mp-empty" data-role="mp-empty">
                {active === 'linked' ? t('media.picker.empty.linked') : t('media.picker.empty.world')}
              </div>
            )}
          </div>
        )}
      </div>
    </Modal>
  );
}
