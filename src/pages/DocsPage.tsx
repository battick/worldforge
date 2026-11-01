import React, { useEffect, useMemo, useRef, useState } from 'react';
import { useStore } from '../state/store';
import { useToast } from '../components/Toast';
import { Empty, Modal } from '../components/Modal';
import { IcCheck, IcEdit, IcFile, IcSparkles, IcStop, IcTrash, IcUpload } from '../components/icons';
import { useAITask } from '../state/aiTasks';
import { runDocExtract } from '../ai/tasks';
import { ACCEPT_ATTR, chunkText, extractText, humanSize, SUPPORTED_EXTS } from '../lib/files';
import { formatRelative } from '../lib/id';
import type { ReviewItem, SourceDoc } from '../types';
import { useT } from '../i18n';

interface Props {
  onNavigate: (route: string) => void;
}

/**
 * 一批抽取结果 + 作者勾了哪几条。
 *
 * 两者必须**一起**活过页面卸载：结果存全局、勾选留页面的话，切页回来会看到
 * 「结果全在、勾全没了」—— 作者很容易直接点发送，把一整批没复核过的候选送进审查。
 */
interface ExtractBatch {
  items: ReviewItem[];
  skipped: string;
  docId: string;
  picked: string[];
}

export function DocsPage({ onNavigate }: Props) {
  const store = useStore();
  const toast = useToast();
  // 抽取任务的状态活在全局任务表里：切页不会中断，回来结果还在
  const ai = useAITask<ExtractBatch>('docs.extract', 'docs');
  const t = useT();
  const inputRef = useRef<HTMLInputElement>(null);

  const [dragging, setDragging] = useState(false);
  const [busy, setBusy] = useState(false);
  const [preview, setPreview] = useState<SourceDoc | null>(null);
  const [targetCat, setTargetCat] = useState(store.categories[0]?.id ?? '');

  // 结果与勾选一起从任务槽里读（见 ExtractBatch 的注释）
  const result = ai.result;
  const picked = useMemo(() => new Set(result?.picked ?? []), [result]);
  const setPicked = (next: Set<string>) =>
    ai.setResult(result ? { ...result, picked: [...next] } : null);
  /** 在线输入的资料草稿；null 表示弹窗关闭 */
  const [composer, setComposer] = useState<{ name: string; text: string } | null>(null);

  /**
   * 在页面空白处直接 Ctrl+V 一段长文本时，就当作「在线录入一份资料」。
   * 三种情况不接管：焦点在输入框/可编辑区（那是用户自己的粘贴）、录入弹窗已打开、剪贴板内容太短（多半不是一份资料）。
   */
  useEffect(() => {
    const onPaste = (e: ClipboardEvent) => {
      const el = document.activeElement as HTMLElement | null;
      if (el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.isContentEditable)) return;
      if (document.querySelector('[data-role=docs-compose-body]')) return;
      const text = e.clipboardData?.getData('text/plain') ?? '';
      if (text.trim().length < 40) return;
      e.preventDefault();
      setComposer({ name: '', text: text.trim() });
    };
    window.addEventListener('paste', onPaste);
    return () => window.removeEventListener('paste', onPaste);
  }, []);

  if (!store.activeWorld) return <Empty icon="🌍" title={t('docs.noWorld')} />;

  const handleFiles = async (files: FileList | null) => {
    if (!files || !files.length) return;
    setBusy(true);
    let ok = 0;
    for (const file of Array.from(files)) {
      try {
        const { text, warning } = await extractText(file);
        if (warning) toast.warn(t('docs.toast.fileWarning', { name: file.name, warning }));
        if (!text.trim()) {
          toast.error(t('docs.toast.noText', { name: file.name }));
          continue;
        }
        await store.addDoc({
          worldId: store.activeWorld!.id,
          name: file.name,
          ext: file.name.split('.').pop()?.toLowerCase() ?? '',
          size: file.size,
          text,
          parsed: false,
          addedAt: Date.now(),
        });
        ok++;
      } catch (e) {
        toast.error(t('docs.toast.parseFailed', { name: file.name, msg: (e as Error).message }));
      }
    }
    setBusy(false);
    if (ok) toast.success(t('docs.toast.imported', { n: ok }));
    if (inputRef.current) inputRef.current.value = '';
  };

  /** 在线输入的资料与上传的文件走同一条入库路径，之后同样可以抽取条目 */
  const saveComposed = async () => {
    if (!composer) return;
    const body = composer.text.trim();
    if (!body) {
      toast.warn(t('docs.compose.warn.empty'));
      return;
    }
    const world = store.activeWorld;
    if (!world) return;
    const name =
      composer.name.trim() ||
      body.split('\n')[0].trim().slice(0, 24) ||
      t('docs.compose.defaultName');
    await store.addDoc({
      worldId: world.id,
      name,
      ext: 'txt',
      size: new TextEncoder().encode(body).length,
      text: body,
      parsed: false,
      addedAt: Date.now(),
    });
    setComposer(null);
    toast.success(t('docs.compose.toast.saved', { name }));
  };

  const extractFrom = async (doc: SourceDoc) => {
    const cat = store.categories.find((c) => c.id === targetCat) ?? store.categories[0];
    if (!cat) {
      toast.warn(t('docs.toast.needCategory'));
      return;
    }
    ai.reset();

    // 超长资料分批处理，最后合并。
    // 分批这件事整体放进**一次** run 里，而不是每块调一次：任务表是按 key 记状态的，
    // 每块都 start/finish 一次会让侧栏那格「转一下、停一下」闪个不停，
    // 而作者看到的明明是一件事还没做完。
    const batch = await ai.run(async (opts) => {
      const chunks = chunkText(doc.text, 12000);
      const allItems: ReviewItem[] = [];
      const skippedNotes: string[] = [];
      for (let i = 0; i < chunks.length; i++) {
        const items = await runDocExtract(
          store.settings.ai,
          store.activeWorld!,
          chunks.length > 1
            ? t('docs.chunk.name', { name: doc.name, i: i + 1, total: chunks.length })
            : doc.name,
          chunks[i],
          store.entries,
          store.categories,
          cat,
          opts,
        );
        if (!items) return null;
        allItems.push(...items.items);
        if (items.skipped) skippedNotes.push(items.skipped);
      }
      return { items: allItems, skipped: skippedNotes.join(t('common.semicolonSep')) };
    });

    if (!batch) return;
    if (!batch.items.length) {
      toast.warn(t('docs.toast.noExtract'));
      return;
    }
    ai.setResult({
      items: batch.items,
      skipped: batch.skipped,
      docId: doc.id,
      picked: batch.items.map((i) => i.id),
    });
    await store.updateDoc(doc.id, { parsed: true });
    toast.success(t('docs.toast.extracted', { n: batch.items.length }));
  };

  return (
    <>
      <div className="page-head">
        <div>
          <h1 className="page-title">{t('docs.title')}</h1>
          <p className="page-desc">{t('docs.desc')}</p>
        </div>
      </div>

      <input
        ref={inputRef}
        type="file"
        multiple
        accept={ACCEPT_ATTR}
        style={{ display: 'none' }}
        onChange={(e) => handleFiles(e.target.files)}
      />

      <div
        className="card"
        style={{
          textAlign: 'center',
          borderStyle: 'dashed',
          borderColor: dragging ? 'var(--primary)' : 'var(--border-strong)',
          background: dragging ? 'var(--primary-soft)' : 'var(--panel)',
          cursor: 'pointer',
          padding: '32px 20px',
        }}
        onClick={() => inputRef.current?.click()}
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
        <div style={{ fontSize: 30, marginBottom: 8 }}>{busy ? '⏳' : '📥'}</div>
        <div className="bold">{busy ? t('docs.drop.busy') : t('docs.drop.idle')}</div>
        <div className="soft small mt8">
          {t('docs.drop.formats', { exts: SUPPORTED_EXTS.map((e) => `.${e}`).join(' / ') })}
        </div>
        <div className="muted tiny mt8">{t('docs.drop.privacy')}</div>
        <div
          className="row mt12"
          style={{ gap: 8, justifyContent: 'center', alignItems: 'center' }}
        >
          <span className="muted small">{t('docs.compose.orType')}</span>
          <button
            className="btn sm"
            data-role="docs-compose-open"
            title={t('docs.compose.pasteTip')}
            onClick={(e) => {
              // 卡片本身是「选文件」，这里要挡住冒泡
              e.stopPropagation();
              setComposer({ name: '', text: '' });
            }}
          >
            <IcEdit size={13} /> {t('docs.compose.open')}
          </button>
        </div>
      </div>

      <div className="row wrap mt16" style={{ alignItems: 'flex-end', gap: 10 }}>
        <div style={{ minWidth: 220 }}>
          <label className="field-label">{t('docs.field.category')}</label>
          <select
            className="select"
            value={targetCat}
            onChange={(e) => setTargetCat(e.target.value)}
          >
            {store.categories.map((c) => (
              <option key={c.id} value={c.id}>
                {c.icon} {c.name}
              </option>
            ))}
          </select>
        </div>
        <div className="field-hint" style={{ flex: 1, minWidth: 200 }}>
          {t('docs.hint.extract')}
        </div>
      </div>

      <div className="divider" />

      <h3 className="card-title" style={{ marginBottom: 12 }}>
        {t('docs.list.title', { n: store.docs.length })}
      </h3>

      {store.docs.length === 0 ? (
        <Empty icon="🗂️" title={t('docs.empty.title')} desc={t('docs.empty.desc')} />
      ) : (
        <div className="grid" style={{ gap: 9 }}>
          {store.docs.map((doc) => (
            <div key={doc.id} className="review-item" data-role="docs-item" style={{ marginBottom: 0 }}>
              <div className="row" style={{ alignItems: 'center', gap: 10 }}>
                <IcFile size={17} />
                <div className="grow">
                  <div className="review-title">{doc.name}</div>
                  <div className="muted tiny mt8">
                    {humanSize(doc.size)}
                    {t('common.metaSep')}
                    {t('common.charCount', { n: doc.text.length.toLocaleString() })}
                    {t('common.metaSep')}
                    {t('docs.meta.importedAt', { time: formatRelative(doc.addedAt) })}
                    {doc.parsed && t('docs.meta.parsed')}
                  </div>
                </div>
                <button className="btn xs" onClick={() => setPreview(doc)}>
                  {t('docs.btn.viewText')}
                </button>
                <button
                  className="btn primary sm"
                  data-role="docs-extract"
                  disabled={ai.loading}
                  onClick={() => extractFrom(doc)}
                >
                  {ai.loading ? <span className="spinner" /> : <IcSparkles size={14} />}
                  {t('docs.btn.extract')}
                </button>
                {ai.loading && (
                  <button className="btn sm" onClick={ai.abort}>
                    <IcStop size={14} />
                  </button>
                )}
                <button
                  className="btn xs ghost"
                  onClick={async () => {
                    if (!confirm(t('docs.confirm.delete', { name: doc.name }))) return;
                    await store.deleteDoc(doc.id);
                    toast.success(t('docs.toast.deleted'));
                  }}
                >
                  <IcTrash size={13} />
                </button>
              </div>
            </div>
          ))}
        </div>
      )}

      {ai.loading && ai.stream && (
        <div className="stream-box mt16">{ai.stream.slice(-3000)}</div>
      )}

      {result && (
        <div className="card mt16" data-role="docs-result">
          <div className="card-head">
            <h3 className="card-title">{t('docs.result.title')}</h3>
            <span className="pill">{t('docs.result.count', { n: result.items.length })}</span>
            <div className="page-actions">
              <button
                className="btn xs"
                onClick={() =>
                  setPicked(
                    picked.size === result.items.length
                      ? new Set()
                      : new Set(result.items.map((i) => i.id)),
                  )
                }
              >
                {picked.size === result.items.length
                  ? t('docs.result.deselectAll')
                  : t('common.selectAll')}
              </button>
              <button
                className="btn primary sm"
                onClick={async () => {
                  const chosen = result.items.filter((i) => picked.has(i.id));
                  if (!chosen.length) return;
                  await store.pushReview(chosen);
                  toast.success(t('docs.toast.queued', { n: chosen.length }));
                  ai.reset();
                  onNavigate('review');
                }}
              >
                <IcCheck size={14} /> {t('docs.result.push', { n: picked.size })}
              </button>
            </div>
          </div>
          {result.skipped && (
            <div className="banner warn" style={{ marginBottom: 12 }}>
              <div>
                <span className="bold">{t('docs.result.skipped')}</span>
                {result.skipped}
              </div>
            </div>
          )}
          {result.items.map((item) => (
            <div
              key={item.id}
              className="row"
              style={{
                padding: '9px 0',
                borderBottom: '1px solid var(--border)',
                alignItems: 'flex-start',
                opacity: picked.has(item.id) ? 1 : 0.5,
              }}
            >
              <input
                type="checkbox"
                style={{ marginTop: 4 }}
                checked={picked.has(item.id)}
                onChange={(e) => {
                  const next = new Set(picked);
                  e.target.checked ? next.add(item.id) : next.delete(item.id);
                  setPicked(next);
                }}
              />
              <div className="grow">
                <div className="bold" style={{ fontSize: 13.5 }}>
                  {item.entryDraft?.title}
                  <span className="pill tiny" style={{ marginLeft: 8 }}>
                    {store.categories.find((c) => c.id === item.entryDraft?.categoryId)?.name}
                  </span>
                </div>
                <div className="soft small mt8">{item.entryDraft?.summary}</div>
                <div className="muted tiny mt8">{item.rationale}</div>
              </div>
            </div>
          ))}
        </div>
      )}

      {preview && (
        <Modal title={preview.name} size="lg" onClose={() => setPreview(null)}>
          <div
            className="textarea mono"
            style={{
              maxHeight: 460,
              overflowY: 'auto',
              whiteSpace: 'pre-wrap',
              background: 'var(--panel-alt)',
              padding: 14,
              borderRadius: 8,
              fontSize: 12.5,
            }}
          >
            {preview.text.slice(0, 30000)}
            {preview.text.length > 30000 && t('docs.preview.truncated')}
          </div>
        </Modal>
      )}

      {composer && (
        <Modal
          title={t('docs.compose.title')}
          size="lg"
          onClose={() => setComposer(null)}
          footer={
            <div className="row" style={{ gap: 8 }}>
              <button
                className="btn primary sm"
                data-role="docs-compose-save"
                disabled={!composer.text.trim()}
                onClick={saveComposed}
              >
                <IcCheck size={14} /> {t('docs.compose.save')}
              </button>
              <button className="btn ghost sm" onClick={() => setComposer(null)}>
                {t('common.cancel')}
              </button>
            </div>
          }
        >
          <div className="field-label">{t('docs.compose.nameLabel')}</div>
          <input
            className="input"
            data-role="docs-compose-name"
            style={{ marginBottom: 12 }}
            placeholder={t('docs.compose.namePlaceholder')}
            value={composer.name}
            onChange={(e) => setComposer({ ...composer, name: e.target.value })}
          />

          <div className="field-label">{t('docs.compose.bodyLabel')}</div>
          <textarea
            className="textarea"
            data-role="docs-compose-body"
            autoFocus
            style={{ minHeight: 320, fontSize: 13 }}
            placeholder={t('docs.compose.bodyPlaceholder')}
            value={composer.text}
            onChange={(e) => setComposer({ ...composer, text: e.target.value })}
          />
          <div className="row mt8" style={{ alignItems: 'center', gap: 8 }}>
            <span className="muted tiny">{t('common.charCount', { n: composer.text.length })}</span>
            <div className="grow" />
            <span className="muted tiny">{t('docs.compose.hint')}</span>
          </div>
        </Modal>
      )}
    </>
  );
}
