import React, { useRef, useState } from 'react';
import { useStore } from '../state/store';
import { useToast } from '../components/Toast';
import { Empty, StatusPill } from '../components/Modal';
import { IcCheck, IcSparkles, IcStop, IcUpload } from '../components/icons';
import { useAITask } from '../state/aiTasks';
import { runArticleReview, runGenerate, type ArticleReviewResult } from '../ai/tasks';
import { ACCEPT_ATTR, extractText } from '../lib/files';
import { pt } from '../ai/promptText';
import { useT } from '../i18n';

interface Props {
  onOpenEntry: (id: string) => void;
  onNavigate: (route: string) => void;
}

export function ArticlePage({ onOpenEntry, onNavigate }: Props) {
  const store = useStore();
  const toast = useToast();
  /*
   * 两个任务键，不是图省事合成一个。
   *
   * 「审校」的结果要留在页面上给作者读，「据此建条目」的结果是直接进审查队列的 ——
   * 共用一条任务槽的话，第二次调用 `startTask` 会把审校结果清空，
   * 作者刚读完的评审意见就凭空消失了（而按钮上还写着「已生成 N 条」）。
   * 两者的 navKey 都是 article，侧栏那一格照样只转一个圈。
   */
  const ai = useAITask<ArticleReviewResult>('article.review', 'article');
  const makeAi = useAITask('article.makeEntries', 'article');
  const t = useT();
  const fileRef = useRef<HTMLInputElement>(null);

  const [text, setText] = useState('');
  const result = ai.result;

  if (!store.activeWorld) return <Empty icon="🌍" title={t('article.noWorld')} />;

  const review = async () => {
    if (text.trim().length < 40) {
      toast.warn(t('article.toast.tooShort'));
      return;
    }
    ai.reset();
    const res = await ai.run((opts) =>
      runArticleReview(
        store.settings.ai,
        store.activeWorld!,
        text,
        store.entries,
        store.categories,
        opts,
      ),
    );
    if (res) ai.setResult(res);
  };

  const makeEntries = async () => {
    if (!result?.newEntityCandidates.length) return;
    const titles = result.newEntityCandidates.map((c) => c.title);
    const cat = store.categories[0];
    if (!cat) {
      toast.warn(t('article.toast.needCategory'));
      return;
    }
    const items = await makeAi.run((opts) =>
      runGenerate(
        store.settings.ai,
        store.activeWorld!,
        store.entries,
        store.categories,
        cat,
        {
          instruction: pt('articleMakeEntries', { excerpt: text.slice(0, 2500) }),
          count: titles.length,
          keywords: titles.join(pt('listSep')),
          allowRelations: true,
        },
        opts,
      ),
    );
    if (!items) return;
    await store.pushReview(items);
    toast.success(t('article.toast.generated', { n: items.length }));
    onNavigate('review');
  };

  const scoreColor = (s: number) => (s >= 80 ? 'var(--success)' : s >= 55 ? 'var(--warn)' : 'var(--danger)');

  return (
    <>
      <div className="page-head">
        <div>
          <h1 className="page-title">{t('article.title')}</h1>
          <p className="page-desc">{t('article.desc')}</p>
        </div>
      </div>

      <div className="split" style={{ gridTemplateColumns: 'minmax(0,1fr) minmax(0,1fr)' }}>
        <div className="card">
          <div className="card-head">
            <h3 className="card-title">{t('article.input.title')}</h3>
            <div className="page-actions">
              <button className="btn xs" onClick={() => setText(t('article.input.sample'))}>
                {t('article.input.btn.loadSample')}
              </button>
              <button className="btn xs" onClick={() => fileRef.current?.click()}>
                <IcUpload size={13} /> {t('article.input.btn.import')}
              </button>
            </div>
          </div>
          <input
            ref={fileRef}
            type="file"
            accept={ACCEPT_ATTR}
            style={{ display: 'none' }}
            onChange={async (e) => {
              const f = e.target.files?.[0];
              if (!f) return;
              const { text: content, warning } = await extractText(f);
              if (warning) toast.warn(warning);
              if (content) {
                setText(content.slice(0, 20000));
                toast.success(t('article.toast.loaded', { name: f.name }));
              }
              if (fileRef.current) fileRef.current.value = '';
            }}
          />
          <textarea
            className="textarea"
            style={{ minHeight: 420 }}
            placeholder={t('article.input.placeholder')}
            value={text}
            onChange={(e) => setText(e.target.value)}
          />
          <div className="row mt12" style={{ alignItems: 'center' }}>
            <span className="muted small">{t('common.charCount', { n: text.length })}</span>
            <div className="grow" />
            {ai.loading && (
              <button className="btn sm" onClick={ai.abort}>
                <IcStop size={14} /> {t('article.input.btn.abort')}
              </button>
            )}
            <button className="btn primary" onClick={review} disabled={ai.loading}>
              {ai.loading ? <span className="spinner" /> : <IcSparkles size={15} />}
              {ai.loading ? t('article.input.btn.running') : t('article.input.btn.run')}
            </button>
          </div>
          {ai.loading && ai.stream && <div className="stream-box mt12">{ai.stream.slice(-2500)}</div>}
        </div>

        <div>
          {!result ? (
            <div className="card">
              <Empty
                icon="🔍"
                title={t('article.result.empty.title')}
                desc={t('article.result.empty.desc')}
              />
            </div>
          ) : (
            <>
              <div className="card">
                <div className="card-head">
                  <h3 className="card-title">{t('article.result.overallTitle')}</h3>
                  <div style={{ marginLeft: 'auto', textAlign: 'right' }}>
                    <div
                      style={{
                        fontSize: 26,
                        fontWeight: 700,
                        lineHeight: 1,
                        color: scoreColor(result.consistencyScore),
                      }}
                    >
                      {result.consistencyScore}
                    </div>
                    <div className="muted tiny">{t('article.result.scoreLabel')}</div>
                  </div>
                </div>
                <div className="small" style={{ lineHeight: 1.8 }}>
                  {result.verdict}
                </div>
                {result.usedEntries.length > 0 && (
                  <>
                    <div className="divider" />
                    <div className="muted tiny" style={{ marginBottom: 7 }}>
                      {t('article.result.usedEntries')}
                    </div>
                    <div className="row wrap" style={{ gap: 6 }}>
                      {result.usedEntries.map((e) => (
                        <button
                          key={e.id}
                          className="pill pointer"
                          style={{ border: 'none', cursor: 'pointer' }}
                          onClick={() => onOpenEntry(e.id)}
                        >
                          {e.title}
                        </button>
                      ))}
                    </div>
                  </>
                )}
              </div>

              <div className="card">
                <div className="card-head">
                  <h3 className="card-title">
                    {t('article.result.suggestions.title', { n: result.suggestions.length })}
                  </h3>
                </div>
                {result.suggestions.length === 0 && (
                  <div className="soft small">{t('article.result.suggestions.empty')}</div>
                )}
                {result.suggestions.map((s, i) => (
                  <div
                    key={i}
                    style={{
                      borderLeft: `3px solid ${
                        s.severity === 'high'
                          ? 'var(--danger)'
                          : s.severity === 'medium'
                            ? 'var(--warn)'
                            : 'var(--primary)'
                      }`,
                      paddingLeft: 12,
                      marginBottom: 16,
                    }}
                  >
                    <div className="row" style={{ alignItems: 'center', gap: 8 }}>
                      <StatusPill status={s.severity} />
                      <span className="muted tiny">
                        {t('article.result.suggestions.ordinalPrefix')}
                        {text.indexOf(s.quote.slice(0, 12)) >= 0
                          ? t('article.result.suggestions.locatable')
                          : ''}
                      </span>
                    </div>
                    {s.quote && (
                      <div
                        style={{
                          marginTop: 7,
                          padding: '6px 10px',
                          background: 'var(--panel-alt)',
                          borderRadius: 6,
                          fontSize: 12.8,
                          fontStyle: 'italic',
                          color: 'var(--text-soft)',
                        }}
                      >
                        {t('common.quote', { text: s.quote })}
                      </div>
                    )}
                    <div className="small mt8">
                      <span className="bold">{t('article.result.suggestions.issue')}</span>
                      {s.issue}
                    </div>
                    <div className="small mt8" style={{ color: 'var(--success)' }}>
                      <span className="bold">{t('article.result.suggestions.fix')}</span>
                      {s.fix}
                    </div>
                  </div>
                ))}
              </div>

              {result.newEntityCandidates.length > 0 && (
                <div className="card">
                  <div className="card-head">
                    <h3 className="card-title">{t('article.result.newConcepts.title')}</h3>
                    <button
                      className="btn primary sm"
                      style={{ marginLeft: 'auto' }}
                      disabled={makeAi.loading}
                      onClick={makeEntries}
                    >
                      {makeAi.loading ? <span className="spinner" /> : <IcCheck size={14} />}
                      {t('article.result.newConcepts.btn')}
                    </button>
                  </div>
                  <div className="soft small" style={{ marginBottom: 10 }}>
                    {t('article.result.newConcepts.desc')}
                  </div>
                  {result.newEntityCandidates.map((c, i) => (
                    <div key={i} style={{ padding: '7px 0', borderTop: '1px solid var(--border)' }}>
                      <span className="bold" style={{ fontSize: 13 }}>
                        {c.title}
                      </span>
                      <span className="muted small"> — {c.reason}</span>
                    </div>
                  ))}
                </div>
              )}
            </>
          )}
        </div>
      </div>
    </>
  );
}
