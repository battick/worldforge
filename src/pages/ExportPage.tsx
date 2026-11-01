import React, { useMemo, useState } from 'react';
import { useStore } from '../state/store';
import { useToast } from '../components/Toast';
import { Empty } from '../components/Modal';
import { IcDownload, IcFile } from '../components/icons';
import { buildHtml, buildMarkdown, download, safeFilename, type ExportOptions } from '../lib/export';
import { piecesForExport } from '../lib/pieces';
import { useT } from '../i18n';

export function ExportPage() {
  const store = useStore();
  const toast = useToast();
  const t = useT();
  const [opts, setOpts] = useState<ExportOptions>({
    includeDraft: true,
    includeRelations: true,
    includeInternalLinks: true,
    includeTimeline: true,
  });
  const [onlyCanon, setOnlyCanon] = useState(false);

  const srcEntries = useMemo(
    () => (onlyCanon ? store.entries.filter((e) => e.status === 'canon') : store.entries),
    [store.entries, onlyCanon],
  );

  const markdown = useMemo(() => {
    if (!store.activeWorld) return '';
    return buildMarkdown(
      store.activeWorld,
      store.categories,
      srcEntries,
      store.relations,
      store.timedEntries,
      opts,
    );
  }, [
    store.activeWorld,
    store.categories,
    srcEntries,
    store.relations,
    store.timedEntries,
    opts,
  ]);

  if (!store.activeWorld) return <Empty icon="🌍" title={t('exp.noWorld')} />;

  const base = safeFilename(store.activeWorld.name);

  return (
    <>
      <div className="page-head">
        <div>
          <h1 className="page-title">{t('exp.title')}</h1>
          <p className="page-desc">{t('exp.desc')}</p>
        </div>
        <div className="page-actions">
          <button
            className="btn sm"
            onClick={() => {
              download(t('exp.file.mdName', { base }), markdown, 'text/markdown');
              toast.success(t('exp.toast.markdownDone'));
            }}
          >
            <IcDownload size={14} /> {t('exp.btn.exportMarkdown')}
          </button>
          <button
            className="btn primary sm"
            onClick={async () => {
              const html = await buildHtml(
                store.activeWorld!,
                store.categories,
                srcEntries,
                store.relations,
                store.timedEntries,
                opts,
                store.pieces,
              );
              download(t('exp.file.htmlName', { base }), html, 'text/html');
              toast.success(t('exp.toast.htmlDone'));
            }}
          >
            <IcDownload size={14} /> {t('exp.btn.exportHtml')}
          </button>
        </div>
      </div>

      <div className="row wrap" style={{ gap: 18, alignItems: 'flex-start' }}>
        <div style={{ width: 268, flexShrink: 0 }}>
          <div className="card">
            <div className="card-head">
              <h3 className="card-title">{t('exp.scope.title')}</h3>
            </div>

            <label className="row small mb0" style={{ gap: 8, alignItems: 'center', marginBottom: 10 }}>
              <input
                type="checkbox"
                checked={onlyCanon}
                onChange={(e) => setOnlyCanon(e.target.checked)}
              />
              {t('exp.scope.onlyCanon', { status: t('kind.status.canon') })}
            </label>
            <div className="field-hint" style={{ marginTop: 0, marginBottom: 14 }}>
              {t('exp.scope.countHint', { kept: srcEntries.length, total: store.entries.length })}
            </div>

            <label className="row small mb0" style={{ gap: 8, alignItems: 'center', marginBottom: 10 }}>
              <input
                type="checkbox"
                checked={opts.includeDraft}
                onChange={(e) => setOpts({ ...opts, includeDraft: e.target.checked })}
              />
              {t('exp.scope.includeDraft', { status: t('kind.status.draft') })}
            </label>

            <label className="row small mb0" style={{ gap: 8, alignItems: 'center', marginBottom: 10 }}>
              <input
                type="checkbox"
                checked={opts.includeRelations}
                onChange={(e) => setOpts({ ...opts, includeRelations: e.target.checked })}
              />
              {t('exp.scope.includeRelations')}
            </label>

            <label className="row small mb0" style={{ gap: 8, alignItems: 'center', marginBottom: 10 }}>
              <input
                type="checkbox"
                data-role="exp-include-timeline"
                checked={opts.includeTimeline}
                onChange={(e) => setOpts({ ...opts, includeTimeline: e.target.checked })}
              />
              {t('exp.scope.includeTimeline')}
            </label>

            <label className="row small mb0" style={{ gap: 8, alignItems: 'center' }}>
              <input
                type="checkbox"
                checked={opts.includeInternalLinks}
                onChange={(e) => setOpts({ ...opts, includeInternalLinks: e.target.checked })}
              />
              {t('exp.scope.keepLinks')}
            </label>
            <div className="field-hint">{t('exp.scope.keepLinksHint')}</div>
          </div>

          <div className="card">
            <div className="card-head">
              <h3 className="card-title">{t('exp.backup.title')}</h3>
            </div>
            <div className="field-hint" style={{ marginTop: 0 }}>
              {t('exp.backup.desc')}
            </div>
            <button
              className="btn sm mt12"
              style={{ width: '100%' }}
              onClick={async () => {
                // 杂物间的媒体是 Blob，无法直接 JSON 序列化，导出前转成 dataUrl
                const pieces = await piecesForExport(store.pieces);
                const payload = {
                  version: 1,
                  exportedAt: new Date().toISOString(),
                  ...store.db,
                  pieces,
                };
                download(
                  `worldforge_backup_${new Date().toISOString().slice(0, 10)}.json`,
                  JSON.stringify(payload, null, 2),
                  'application/json',
                );
                toast.success(t('exp.toast.backupDone'));
              }}
            >
              <IcDownload size={14} /> {t('exp.backup.btn')}
            </button>
          </div>
        </div>

        <div style={{ flex: 1, minWidth: 0 }}>
          <div className="card" style={{ padding: 0, overflow: 'hidden' }}>
            <div
              className="row"
              style={{
                padding: '10px 16px',
                borderBottom: '1px solid var(--border)',
                background: 'var(--panel-alt)',
                alignItems: 'center',
              }}
            >
              <IcFile size={15} />
              <span className="bold small">{t('exp.file.mdName', { base })}</span>
              <span className="muted tiny" style={{ marginLeft: 'auto' }}>
                {t('exp.preview.charCount', { n: markdown.length.toLocaleString() })}
              </span>
              <button
                className="btn xs"
                onClick={async () => {
                  try {
                    await navigator.clipboard.writeText(markdown);
                    toast.success(t('exp.toast.copied'));
                  } catch {
                    toast.error(t('exp.toast.copyFailed'));
                  }
                }}
              >
                {t('common.copy')}
              </button>
            </div>
            <pre
              data-role="exp-preview"
              style={{
                margin: 0,
                padding: '16px 20px',
                maxHeight: 'calc(100vh - 280px)',
                overflow: 'auto',
                fontSize: 12.5,
                lineHeight: 1.75,
                fontFamily: 'var(--mono)',
                whiteSpace: 'pre-wrap',
                wordBreak: 'break-word',
                color: 'var(--text-soft)',
              }}
            >
              {markdown || t('exp.preview.empty')}
            </pre>
          </div>
        </div>
      </div>
    </>
  );
}
