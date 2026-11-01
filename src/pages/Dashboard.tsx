import React from 'react';
import { useStore } from '../state/store';
import { Empty } from '../components/Modal';
import { MarkdownView } from '../components/MarkdownView';
import { IcPlus, IcSparkles, IcWarn } from '../components/icons';
import { formatRelative } from '../lib/id';
import { stripMarkdown } from '../lib/markdown';
import { useT, tGlobal } from '../i18n';
import type { AgentPageView } from '../ai/agent/tools';

interface Props {
  /**
   * 第二参是「落在哪一支」：Wiki 的三个子页（`entries` / `pieces`）与关系图的两支。
   * 「条目库」已经不是一页了，它是 Wiki 的编辑子页 —— 所以跳条目相关的地方
   * 都要说清是去**哪一支**，否则作者会落在「阅读」上，还得自己再切一下。
   */
  onNavigate: (route: string, view?: AgentPageView) => void;
  onOpenEntry: (id: string) => void;
  onEditWorld: () => void;
  onNewWorld: () => void;
}

export function Dashboard({ onNavigate, onOpenEntry, onEditWorld, onNewWorld }: Props) {
  const { activeWorld, categories, entries, relations, stats, settings, pendingReview, db } =
    useStore();
  const t = useT();

  if (!activeWorld) {
    return (
      <Empty
        icon="🌍"
        title={db.worlds.length ? t('dash.empty.noSelect.title') : t('dash.empty.none.title')}
        desc={t('dash.empty.desc')}
        action={
          <button className="btn primary" onClick={onNewWorld}>
            <IcPlus size={15} /> {t('dash.btn.newWorld')}
          </button>
        }
      />
    );
  }

  const recent = entries.slice(0, 6);
  const aiReady = !!settings.ai.apiKey || /localhost|127\.0\.0\.1/.test(settings.ai.baseUrl);

  // 结构性缺口：条目极少的分类
  const gaps = categories
    .map((c) => ({ cat: c, count: entries.filter((e) => e.categoryId === c.id).length }))
    .filter((x) => x.count <= 1);

  const isolated = entries.filter(
    (e) => !relations.some((r) => r.fromEntryId === e.id || r.toEntryId === e.id),
  );

  return (
    <>
      <div className="card" style={{ borderLeft: `4px solid ${activeWorld.themeColor}` }}>
        <div className="row" style={{ alignItems: 'flex-start' }}>
          <div className="col">
            <h1 className="page-title">{activeWorld.name}</h1>
            {activeWorld.tagline && (
              <p className="soft" style={{ margin: '6px 0 0', fontStyle: 'italic' }}>
                {activeWorld.tagline}
              </p>
            )}
            <div className="row wrap mt12" style={{ gap: 7 }}>
              {activeWorld.genre && <span className="pill">{activeWorld.genre}</span>}
              <span className="pill">{t('dash.pill.categories', { n: categories.length })}</span>
              <span className="pill">{t('common.entryCount', { n: stats.entries })}</span>
            </div>
          </div>
          <div className="page-actions" style={{ marginLeft: 0 }}>
            <button className="btn sm" onClick={onEditWorld}>
              {t('dash.btn.editWorld')}
            </button>
            <button className="btn sm" onClick={onNewWorld}>
              <IcPlus size={14} /> {t('dash.btn.newWorld')}
            </button>
          </div>
        </div>

        {activeWorld.summary && (
          <div className="mt16" style={{ paddingTop: 14, borderTop: '1px solid var(--border)' }}>
            <MarkdownView content={activeWorld.summary} compact />
          </div>
        )}

        {activeWorld.tone && (
          <div className="banner info mt12" style={{ marginTop: 14 }}>
            <IcSparkles size={16} />
            <div>
              <span className="bold">{t('dash.rule.title')}</span>
              <div className="mt8">{activeWorld.tone}</div>
            </div>
          </div>
        )}
      </div>

      <div className="grid c5 mt16">
        <div className="stat primary">
          <div className="stat-num">{stats.entries}</div>
          <div className="stat-label">{t('dash.stat.entries')}</div>
        </div>
        <div className="stat success">
          <div className="stat-num">{stats.canon}</div>
          <div className="stat-label">{t('dash.stat.canon')}</div>
        </div>
        <div className="stat">
          <div className="stat-num">{stats.relations}</div>
          <div className="stat-label">{t('dash.stat.relations')}</div>
        </div>
        <div
          className="stat"
          style={{ cursor: 'pointer' }}
          title={t('dash.stat.piecesTitle')}
          onClick={() => onNavigate('wiki', 'pieces')}
        >
          <div className="stat-num">{stats.pieces}</div>
          <div className="stat-label">{t('dash.stat.pieces')}</div>
        </div>
        <div className={`stat ${stats.reviewPending ? 'warn' : ''}`}>
          <div className="stat-num">{stats.reviewPending}</div>
          <div className="stat-label">{t('dash.stat.reviewPending')}</div>
        </div>
      </div>

      {!aiReady && (
        <div className="banner warn mt16">
          <IcWarn size={16} />
          <div>
            <span className="bold">{t('dash.aiOff.title')}</span>
            <div className="mt8">{t('dash.aiOff.desc')}</div>
            <button className="btn sm mt8" onClick={() => onNavigate('settings')}>
              {t('common.goSettings')}
            </button>
          </div>
        </div>
      )}

      {pendingReview.length > 0 && (
        <div className="card mt16">
          <div className="card-head">
            <h3 className="card-title">{t('dash.pending.title')}</h3>
            <span className="pill pending">{t('dash.pending.count', { n: pendingReview.length })}</span>
            <button
              className="btn sm primary"
              style={{ marginLeft: 'auto' }}
              onClick={() => onNavigate('review')}
            >
              {t('dash.pending.goto')}
            </button>
          </div>
          <div style={{ fontSize: 13 }}>
            {pendingReview.slice(0, 4).map((r) => (
              <div
                key={r.id}
                className="row"
                style={{ padding: '6px 0', borderBottom: '1px solid var(--border)' }}
              >
                <span className="pill">{kindLabel(r.kind)}</span>
                <span className="grow">{r.title}</span>
                <span className="muted small nowrap">{formatRelative(r.createdAt)}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      <div className="grid c2 mt16">
        <div className="card">
          <div className="card-head">
            <h3 className="card-title">{t('dash.recent.title')}</h3>
            <button
              className="btn xs ghost"
              style={{ marginLeft: 'auto' }}
              onClick={() => onNavigate('wiki', 'entries')}
            >
              {t('dash.recent.allEntries')}
            </button>
          </div>
          {recent.length ? (
            recent.map((e) => (
              <div
                key={e.id}
                className="row pointer"
                style={{ padding: '8px 0', borderBottom: '1px solid var(--border)', alignItems: 'center' }}
                onClick={() => onOpenEntry(e.id)}
              >
                <span className="grow bold" style={{ fontSize: 13.5 }}>
                  {e.title}
                </span>
                <span className="pill tiny">
                  {categories.find((c) => c.id === e.categoryId)?.name ?? t('dash.uncategorized')}
                </span>
                <span className="muted tiny nowrap">{formatRelative(e.updatedAt)}</span>
              </div>
            ))
          ) : (
            <div className="muted small">{t('dash.recent.empty')}</div>
          )}
        </div>

        <div className="card">
          <div className="card-head">
            <h3 className="card-title">{t('dash.health.title')}</h3>
          </div>
          <div style={{ fontSize: 13, lineHeight: 1.8 }}>
            <div>
              <span className="bold">{entries.length}</span>
              {t('dash.health.entryMid')}
              <span className="bold">{isolated.length}</span>
              {t('dash.health.isolatedMid')}
            </div>
            {gaps.length > 0 ? (
              <>
                <div className="mt8 soft">{t('dash.health.gapsHint')}</div>
                <div className="row wrap mt8" style={{ gap: 6 }}>
                  {gaps.map((g) => (
                    <span key={g.cat.id} className="pill">
                      {g.cat.icon} {g.cat.name} · {g.count}
                    </span>
                  ))}
                </div>
                <button
                  className="btn sm mt12"
                  onClick={() => onNavigate('studio')}
                >
                  <IcSparkles size={14} /> {t('dash.health.fillGaps')}
                </button>
              </>
            ) : (
              <div className="mt8 soft">{t('dash.health.allGood')}</div>
            )}
          </div>
        </div>
      </div>

      <div className="card mt16">
        <div className="card-head">
          <h3 className="card-title">{t('dash.quick.title')}</h3>
        </div>
        <div className="grid c2">
          <QuickCard
            title={t('dash.quick.entry.title')}
            desc={t('dash.quick.entry.desc')}
            action={t('dash.quick.entry.action')}
            onClick={() => onNavigate('wiki', 'entries')}
          />
          <QuickCard
            title={t('dash.quick.docs.title')}
            desc={t('dash.quick.docs.desc')}
            action={t('dash.quick.docs.action')}
            onClick={() => onNavigate('docs')}
          />
          <QuickCard
            title={t('dash.quick.studio.title')}
            desc={t('dash.quick.studio.desc')}
            action={t('dash.quick.studio.action')}
            onClick={() => onNavigate('studio')}
          />
          <QuickCard
            title={t('dash.quick.article.title')}
            desc={t('dash.quick.article.desc')}
            action={t('dash.quick.article.action')}
            onClick={() => onNavigate('article')}
          />
        </div>
      </div>
    </>
  );
}

function QuickCard({
  title,
  desc,
  action,
  onClick,
}: {
  title: string;
  desc: string;
  action: string;
  onClick: () => void;
}) {
  return (
    <div
      style={{
        border: '1px solid var(--border)',
        borderRadius: 10,
        padding: 14,
        background: 'var(--panel-alt)',
      }}
    >
      <div className="bold" style={{ fontSize: 13.5 }}>
        {title}
      </div>
      <div className="soft small mt8" style={{ lineHeight: 1.7 }}>
        {desc}
      </div>
      <button className="btn sm mt12" onClick={onClick}>
        {action}
      </button>
    </div>
  );
}

export function kindLabel(kind: string): string {
  const map: Record<string, string> = {
    'create-entry': 'kind.review.create-entry',
    'update-entry': 'kind.review.update-entry',
    relation: 'kind.review.relation',
    consistency: 'kind.review.consistency',
    'timeline-layout': 'kind.review.timeline-layout',
    'timeline-guess': 'kind.review.timeline-guess',
  };
  const key = map[kind];
  return key ? tGlobal(key) : kind;
}

export function previewOf(text: string, len = 120): string {
  return stripMarkdown(text).slice(0, len);
}
