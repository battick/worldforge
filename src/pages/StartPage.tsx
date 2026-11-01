import React from 'react';
import { useStore } from '../state/store';
import { useT } from '../i18n';
import { IcSparkles, IcWarn } from '../components/icons';
import { formatRelative } from '../lib/id';

/**
 * 还没有世界时的落地页。
 *
 * 它要回答的是「我该从哪儿开始」——所以不摆功能菜单，
 * 只讲清楚一件事：不用先想明白，把东西丢进来就行。
 */
export function StartPage({
  onStart,
  onContinue,
  onGoSettings,
}: {
  onStart: () => void;
  onContinue: () => void;
  onGoSettings: () => void;
}) {
  const store = useStore();
  const t = useT();
  const draft = store.draft;
  const ai = store.settings.ai;
  const aiReady = !!ai.baseUrl && !!ai.model && (!!ai.apiKey || /localhost|127\.0\.0\.1/.test(ai.baseUrl));

  const draftMaterials = draft?.materials.length ?? 0;

  return (
    <>
      <div className="ob-hello" style={{ marginBottom: 16 }}>
        <h1 className="page-title" style={{ fontSize: 26 }}>
          {t('start.title')}
        </h1>
        <p className="soft" style={{ maxWidth: 720, marginTop: 10, fontSize: 13.6, lineHeight: 1.85 }}>
          {t('start.desc')}
          <span className="bold">{t('start.descStrong')}</span>
        </p>

        <div className="row wrap mt16" style={{ gap: 9 }}>
          <button className="btn primary" onClick={onStart}>
            <IcSparkles size={15} /> {t('start.btn.start')}
          </button>
          {draft && draftMaterials > 0 && (
            <button className="btn" onClick={onContinue}>
              {t('start.btn.continue', {
                n: draftMaterials,
                time: formatRelative(draft.updatedAt),
              })}
            </button>
          )}
        </div>
      </div>

      {!aiReady && (
        <div className="banner warn" style={{ marginBottom: 16 }}>
          <IcWarn size={16} />
          <div>
            <span className="bold">{t('start.aiOff.title')}</span>
            <div className="mt8">
              {t('start.aiOff.desc')}
            </div>
            <button className="btn sm mt8" onClick={onGoSettings}>
              {t('start.aiOff.btn')}
            </button>
          </div>
        </div>
      )}

      <div className="grid c2">
        <StepCard
          n="1"
          title={t('start.step1.title')}
          desc={t('start.step1.desc')}
        />
        <StepCard
          n="2"
          title={t('start.step2.title')}
          desc={t('start.step2.desc')}
        />
        <StepCard
          n="3"
          title={t('start.step3.title')}
          desc={t('start.step3.desc')}
        />
        <StepCard
          n="4"
          title={t('start.step4.title')}
          desc={t('start.step4.desc')}
        />
      </div>

      <div className="card mt16">
        <div className="card-head">
          <h3 className="card-title">{t('start.features.title')}</h3>
        </div>
        <div className="soft small" style={{ lineHeight: 1.9 }}>
          {t('start.features.desc')}
        </div>
        <div className="muted tiny mt12">
          {t('start.features.foot')}
        </div>
      </div>
    </>
  );
}

function StepCard({ n, title, desc }: { n: string; title: string; desc: string }) {
  return (
    <div
      style={{
        border: '1px solid var(--border)',
        borderRadius: 10,
        padding: 15,
        background: 'var(--panel)',
      }}
    >
      <div className="row" style={{ gap: 9, alignItems: 'center' }}>
        <span
          style={{
            width: 22,
            height: 22,
            borderRadius: 7,
            background: 'var(--primary-soft)',
            color: 'var(--primary-dark)',
            display: 'grid',
            placeItems: 'center',
            fontSize: 12,
            fontWeight: 700,
            flexShrink: 0,
          }}
        >
          {n}
        </span>
        <div className="bold" style={{ fontSize: 13.5 }}>
          {title}
        </div>
      </div>
      <div className="soft small mt8" style={{ lineHeight: 1.75 }}>
        {desc}
      </div>
    </div>
  );
}
