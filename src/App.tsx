import React, { useEffect, useState } from 'react';
import { StoreProvider, useStore } from './state/store';
import { ToastProvider, useToast } from './components/Toast';
import { I18nProvider, useT, type MsgKey } from './i18n';
import { EntryEditor } from './components/EntryEditor';
import { WorldEditor } from './components/WorldEditor';
import { WorldOnboarding } from './components/WorldOnboarding';
import { TaskDock } from './components/TaskDock';
import { Dashboard } from './pages/Dashboard';
import { StartPage } from './pages/StartPage';
import { WikiPage } from './pages/WikiPage';
import { StudioPage } from './pages/StudioPage';
import { ReviewPage } from './pages/ReviewPage';
import { DocsPage } from './pages/DocsPage';
import { GraphPage, type GraphView } from './pages/GraphPage';
import { ConsistencyPage } from './pages/ConsistencyPage';
import { AskPage } from './pages/AskPage';
import { ActivityLogPage } from './pages/ActivityLogPage';
import { ArticlePage } from './pages/ArticlePage';
import { ExportPage } from './pages/ExportPage';
import { SettingsPage } from './pages/SettingsPage';
import { AgentRunnerProvider } from './state/agentRunner';
import { useRunningNavKeys } from './state/aiTasks';
import { useLiveJobNavs } from './state/jobQueue';
import { getDiagReport } from './lib/diagLog';
import { isWikiView, type WikiView } from './types';
import {
  IcBook,
  IcChat,
  IcChevron,
  IcDashboard,
  IcDownload,
  IcGlobe,
  IcGraph,
  IcHistory,
  IcInbox,
  IcPlus,
  IcSettings,
  IcShield,
  IcSparkles,
  IcUpload,
  IcEdit,
} from './components/icons';

type Route =
  | 'dashboard'
  | 'wiki'
  | 'studio'
  | 'review'
  | 'docs'
  | 'graph'
  | 'consistency'
  | 'ask'
  | 'log'
  | 'article'
  | 'export'
  | 'settings';

/**
 * 侧栏。**「条目库」与「杂物间」并成了「Wiki」这一项** —— 它们本来讲的就是
 * 同一件事（这个世界里有什么），只是从前一个长着编辑器的样子、另一个是收杂物的
 * 篮子。现在合成一页，读在「阅读」子页、改在「编辑」子页、杂物在「杂物间」子页。
 */
const NAV: { group: MsgKey; items: { key: Route; label: MsgKey; icon: React.ReactNode }[] }[] = [
  {
    group: 'app.navGroup.overview',
    items: [
      { key: 'dashboard', label: 'app.nav.dashboard', icon: <IcDashboard /> },
      { key: 'wiki', label: 'app.nav.wiki', icon: <IcBook /> },
      { key: 'graph', label: 'app.nav.graph', icon: <IcGraph /> },
    ],
  },
  {
    group: 'app.navGroup.ai',
    items: [
      { key: 'studio', label: 'app.nav.studio', icon: <IcSparkles /> },
      { key: 'review', label: 'app.nav.review', icon: <IcInbox /> },
      { key: 'docs', label: 'app.nav.docs', icon: <IcUpload /> },
      { key: 'consistency', label: 'app.nav.consistency', icon: <IcShield /> },
      { key: 'ask', label: 'app.nav.ask', icon: <IcChat /> },
      { key: 'log', label: 'app.nav.log', icon: <IcHistory /> },
      { key: 'article', label: 'app.nav.article', icon: <IcEdit /> },
    ],
  },
  {
    group: 'app.navGroup.output',
    items: [
      { key: 'export', label: 'app.nav.export', icon: <IcDownload /> },
      { key: 'settings', label: 'app.nav.settings', icon: <IcSettings /> },
    ],
  },
];

const NAV_KEYS: string[] = NAV.flatMap((g) => g.items.map((i) => i.key));

/**
 * 旧路由名 → Wiki 的子页。
 *
 * `#entries` / `#pieces` 是老链接、老书签，也是**模型记住的旧页面名**
 * （提示词里叫过这两个名字，见 ai/agent/tools.ts 的 resolveAgentPage）。
 * 认下来比让作者（和它）撞一个空白页强 —— 与「时间线落到关系与时间的时间分支」
 * 是同一个道理。
 */
const WIKI_ALIAS: Record<string, WikiView> = { entries: 'entries', pieces: 'pieces' };

/**
 * 读一次地址栏，问出「该落在哪一页、哪一支」。
 *
 * 首屏与 hashchange 共用它：两处各写一遍的话，一边改了另一边不改，
 * 就会出现「前进后退到的位置和直接刷新到的不一样」。
 */
function readHash(): { route: Route; wikiView: WikiView | null } {
  const hash = window.location.hash.replace('#', '');
  if (WIKI_ALIAS[hash]) return { route: 'wiki', wikiView: WIKI_ALIAS[hash] };
  if (NAV_KEYS.includes(hash)) return { route: hash as Route, wikiView: null };
  return { route: 'dashboard', wikiView: null };
}

/**
 * 反过来：当前这一页该写成什么地址。
 *
 * Wiki 的三个子页**各有各的地址**（`#wiki` / `#entries` / `#pieces`），
 * 所以刷新之后还停在原来那一支、也能直接收藏某一支。
 * 「关系与时间」那两支没有这么做 —— 它们是同一张网的两个看法，
 * 而 Wiki 这三支是三块不同的地方（读的地方 / 改的地方 / 放杂物的地方）。
 */
function hashOf(route: Route, wikiView: WikiView): string {
  if (route !== 'wiki') return route;
  return wikiView === 'display' ? 'wiki' : wikiView;
}

function Shell() {
  const store = useStore();
  const toast = useToast();
  const t = useT();
  // 哪些页面正在跑 AI 任务 —— 切到别的页面也照样转，所以这层提示是「还能找到它」的唯一线索
  const workingNavs = useRunningNavKeys();
  // 队列里的活儿也算：批量打磨这类是排进队列的，页面里已经没有自己的进度条了，
  // 那点「这一页在干活」的提示就只能靠侧栏（右下角的队列在讲进度，这里讲是**哪一页**）
  const jobNavs = useLiveJobNavs();
  // 首屏就同步读一次 hash：避免「先渲染 dashboard → 再改写 hash」把深链冲掉
  const [route, setRoute] = useState<Route>(() => readHash().route);
  const [openEntryId, setOpenEntryId] = useState<string | null>(null);
  /**
   * Wiki 落在哪一支。
   *
   * 与 graphView 同一个理由放在这一层：agent 说「去杂物间」时，落点是
   * `wiki` + `view: 'pieces'`（见 ai/agent/tools.ts 的 resolveAgentPage）——
   * 页面自己的 useState 收不到这个请求。
   */
  const [wikiView, setWikiView] = useState<WikiView>(() => readHash().wikiView ?? 'display');
  /**
   * 「时间与关系」落在哪一支。
   *
   * 放在这里而不是页面里，是为了让 agent 能点名要那一支：它说「去时间轴看看」时，
   * 落点是 `graph` + `view: 'chronicle'`（见 tools.ts 的 resolveAgentPage）——
   * 页面自己的 useState 收不到这个请求。
   *
   * 默认落在**编年**：它已经接管了从前「时间」那一支的位置（作者点名的）。
   */
  const [graphView, setGraphView] = useState<GraphView>('chronicle');
  const [worldMenu, setWorldMenu] = useState(false);
  const [onboarding, setOnboarding] = useState(false);
  const [worldEditor, setWorldEditor] = useState<{ open: boolean; id: string | null }>({
    open: false,
    id: null,
  });

  // 路由切换时关闭世界菜单
  useEffect(() => setWorldMenu(false), [route]);

  // 跟随浏览器前进/后退
  useEffect(() => {
    const onHashChange = () => {
      const next = readHash();
      setRoute((cur) => (cur === next.route ? cur : next.route));
      // 只有地址栏明确说了要哪一支时才改视图 —— 否则在子页里切来切去，
      // 每次 hash 回写都会把人弹回「阅读」
      if (next.wikiView) setWikiView(next.wikiView);
    };
    window.addEventListener('hashchange', onHashChange);
    return () => window.removeEventListener('hashchange', onHashChange);
  }, []);

  /**
   * agent 的回执里可能带着「落在哪一支」：关系图的两支，或 Wiki 的三个子页。
   * `view` 是一份共用词汇，具体落到哪一页的哪一支由 `route` 决定。
   */
  const applyView = (r: string, view: string) => {
    if (r === 'graph' && (view === 'relations' || view === 'time' || view === 'chronicle'))
      setGraphView(view);
    else if (r === 'wiki' && isWikiView(view)) setWikiView(view);
  };

  useEffect(() => {
    const want = hashOf(route, wikiView);
    if (window.location.hash.replace('#', '') !== want) window.location.hash = want;
  }, [route, wikiView]);

  const copyDiag = async (okMessage: string) => {
    const report = getDiagReport();
    try {
      await navigator.clipboard.writeText(report);
      toast.success(okMessage);
    } catch {
      window.prompt(t('app.copyFallbackPrompt'), report);
    }
  };

  if (!store.ready) {
    return (
      <div
        style={{
          height: '100%',
          display: 'grid',
          placeItems: 'center',
          color: 'var(--text-dim)',
        }}
      >
        {store.initError ? (
          <div className="card" style={{ maxWidth: 660 }}>
            {store.initDiagnosis?.kind === 'starved-queue' ? (
              <>
                <h2 className="page-title" style={{ fontSize: 18 }}>
                  {t('app.db.starvedTitle')}
                </h2>
                <div className="banner danger mt12">
                  <div style={{ lineHeight: 1.7 }}>
                    {t('app.db.starvedBody', {
                      dbInfo: store.initDiagnosis.dbVersion
                        ? t('app.db.starvedDbInfo', { version: store.initDiagnosis.dbVersion })
                        : '',
                    })}
                  </div>
                </div>
                <div className="soft small mt16" style={{ lineHeight: 1.9 }}>
                  {t('app.db.starvedSteps')}
                  <ol style={{ paddingLeft: 20, margin: '8px 0' }}>
                    <li>{t('app.db.step1CloseAll')}</li>
                    {isEdge ? <li>{t('app.db.step2Edge')}</li> : null}
                    <li>
                      {t('app.db.step2Kill', {
                        browser: isEdge ? 'Microsoft Edge' : 'Google Chrome',
                      })}
                    </li>
                    <li>{t('app.db.step3Reopen')}</li>
                  </ol>
                </div>
              </>
            ) : store.initDiagnosis?.kind === 'db-missing' ? (
              <>
                <h2 className="page-title" style={{ fontSize: 18 }}>
                  {t('app.db.openFailed')}
                </h2>
                <div className="banner danger mt12">
                  <div style={{ wordBreak: 'break-all' }}>{store.initError}</div>
                </div>
                <div className="soft small mt16" style={{ lineHeight: 1.8 }}>
                  {t('app.db.missingBody')}
                  <ul style={{ paddingLeft: 20, margin: '8px 0' }}>
                    <li>{t('app.db.missingIncognito')}</li>
                    <li>{t('app.db.missingBlocked')}</li>
                  </ul>
                </div>
              </>
            ) : (
              <>
                <h2 className="page-title" style={{ fontSize: 18 }}>
                  {t('app.db.openFailed')}
                </h2>
                <div className="banner danger mt12">
                  <div style={{ wordBreak: 'break-all' }}>{store.initError}</div>
                </div>
                <div className="soft small mt16" style={{ lineHeight: 1.8 }}>
                  {t('app.db.commonCauses')}
                  <ul style={{ paddingLeft: 20, margin: '8px 0' }}>
                    <li>{t('app.db.causeOtherTabs')}</li>
                    <li>{t('app.db.causeBackground')}</li>
                    <li>{t('app.db.causeIncognito')}</li>
                    <li>{t('app.db.causeBlocked')}</li>
                  </ul>
                  {t('app.db.fixThenRetry')}
                </div>
              </>
            )}
            <div className="row mt12" style={{ gap: 8 }}>
              <button className="btn primary" onClick={store.retryInit}>
                {store.initDiagnosis?.kind === 'starved-queue'
                  ? t('app.db.retryAfterRestart')
                  : t('app.db.retryAfterClose')}
              </button>
              <button className="btn ghost" onClick={() => window.location.reload()}>
                {t('app.db.reload')}
              </button>
              <button className="btn ghost" onClick={() => copyDiag(t('app.diagCopied'))}>
                {t('app.db.copyLog')}
              </button>
            </div>
            <details style={{ marginTop: 12 }}>
              <summary className="muted small" style={{ cursor: 'pointer' }}>
                {t('app.db.expandLog')}
              </summary>
              <pre
                className="mono"
                style={{
                  maxHeight: 220,
                  overflow: 'auto',
                  fontSize: 11.5,
                  lineHeight: 1.6,
                  background: 'var(--panel-alt)',
                  padding: 12,
                  borderRadius: 8,
                  whiteSpace: 'pre-wrap',
                  wordBreak: 'break-all',
                }}
              >
                {getDiagReport()}
              </pre>
            </details>
          </div>
        ) : (
          <div className="center">
            <div className="spinner dark" style={{ margin: '0 auto 14px' }} />
            {t('app.boot.loading')}
          </div>
        )}
      </div>
    );
  }

  // 数据库升级等待中：数据已在内存里，但连接被其他标签页占着 —— 给出明确指引
  if (store.dbUpgrading || store.dbUpgradeError) {
    return (
      <div style={{ height: '100%', display: 'grid', placeItems: 'center' }}>
        <div className="card" style={{ maxWidth: 560 }}>
          <h2 className="page-title" style={{ fontSize: 18 }}>
            {store.dbUpgradeError ? t('app.upgrade.timeoutTitle') : t('app.upgrade.title')}
          </h2>
          {store.dbUpgradeError ? (
            <div className="banner danger mt12">
              <div style={{ wordBreak: 'break-all' }}>{store.dbUpgradeError}</div>
            </div>
          ) : (
            <>
              <div className="row mt12" style={{ gap: 10, alignItems: 'center' }}>
                <div className="spinner dark" />
                <div className="soft small">{t('app.upgrade.waiting')}</div>
              </div>
              <div className="soft small mt16" style={{ lineHeight: 1.8 }}>
                {t('app.upgrade.body')}
              </div>
            </>
          )}
          <button className="btn ghost mt12" onClick={() => window.location.reload()}>
            {t('app.upgrade.reload')}
          </button>
          <button
            className="btn ghost mt12"
            style={{ marginLeft: 8 }}
            onClick={() => copyDiag(t('app.diagCopiedShort'))}
          >
            {t('app.db.copyLog')}
          </button>
        </div>
      </div>
    );
  }

  const editingWorld = worldEditor.id
    ? store.db.worlds.find((w) => w.id === worldEditor.id) ?? null
    : null;

  // 还没有世界时，除「设置」外的所有页面都让位给引导页
  const noWorld = !store.activeWorld;

  return (
    <div className="app">
      <aside className="sidebar">
        <div className="brand">
          <div className="brand-row">
            <div className="brand-mark">W</div>
            <div className="brand-text">
              <div className="brand-name">{t('app.brandName')}</div>
              <div className="brand-sub">{t('app.brandSub')}</div>
            </div>
          </div>
        </div>

        <div className="world-switch">
          <button className="world-switch-btn" onClick={() => setWorldMenu((v) => !v)}>
            <span
              className="world-dot"
              style={{ background: store.activeWorld?.themeColor ?? '#c8d3e0' }}
            />
            <span className="world-switch-name">
              {store.activeWorld?.name ?? t('app.noWorld')}
            </span>
            <IcChevron size={14} />
          </button>

          {worldMenu && (
            <div className="world-menu">
              {store.db.worlds.map((w) => (
                <div
                  key={w.id}
                  className={`world-menu-item ${w.id === store.settings.activeWorldId ? 'active' : ''}`}
                  onClick={() => {
                    store.setActiveWorld(w.id);
                    setWorldMenu(false);
                  }}
                >
                  <span className="world-dot" style={{ background: w.themeColor }} />
                  <span className="grow">{w.name}</span>
                  <span className="muted tiny">
                    {store.db.entries.filter((e) => e.worldId === w.id).length}
                  </span>
                </div>
              ))}
              <div className="world-menu-sep" />
              <div
                className="world-menu-item"
                onClick={() => {
                  setOnboarding(true);
                  setWorldMenu(false);
                }}
              >
                <IcPlus size={14} />{' '}
                {store.db.worlds.length ? t('app.newAnotherWorld') : t('app.newWorld')}
              </div>
              {store.activeWorld && (
                <div
                  className="world-menu-item"
                  onClick={() => {
                    setWorldEditor({ open: true, id: store.activeWorld!.id });
                    setWorldMenu(false);
                  }}
                >
                  <IcEdit size={14} /> {t('app.editCurrentWorld')}
                </div>
              )}
            </div>
          )}
        </div>

        <nav className="nav">
          {NAV.map((g) => (
            <div key={g.group}>
              <div className="nav-group-title">{t(g.group)}</div>
              {g.items.map((it) => {
                // 还没有世界时，除了设置之外的页面都无从谈起
                const locked = noWorld && it.key !== 'settings';
                // 这一页的 AI 还在跑。动画只是「它还在那儿干活」的信号，
                // 真正让它不停的理由在 state/aiTasks.ts：任务状态活在组件外面。
                const working = workingNavs.has(it.key) || jobNavs.has(it.key);
                return (
                  <button
                    key={it.key}
                    className={`nav-item ${route === it.key ? 'active' : ''}`}
                    data-role={`nav-${it.key}`}
                    disabled={locked}
                    title={locked ? t('app.lockedHint') : working ? t('app.navWorking') : undefined}
                    onClick={() => setRoute(it.key)}
                  >
                    <span className="nav-ico">{it.icon}</span>
                    <span>{t(it.label)}</span>
                    {working && (
                      <span className="nav-working" data-role="nav-working" aria-hidden="true" />
                    )}
                    {it.key === 'review' && store.stats.reviewPending > 0 && (
                      <span className="nav-badge">{store.stats.reviewPending}</span>
                    )}
                  </button>
                );
              })}
            </div>
          ))}
        </nav>

        <div className="sidebar-foot">
          {store.storage.kind === 'local' ? t('app.modeLocal') : t('app.modeCloud')}
          <br />
          {t('app.footStats', { entries: store.stats.entries, relations: store.stats.relations })}
        </div>
      </aside>

      <main className="main">
        {/* Wiki 与「时间与关系」都按宽版走：一个要摆得下三栏（目录 / 正文 / 信息栏），一个要摆得下一面墙 */}
        <div className={`page ${route === 'graph' || route === 'wiki' ? 'wide' : ''}`}>
          {noWorld && route !== 'settings' ? (
            <StartPage
              onStart={() => setOnboarding(true)}
              onContinue={() => setOnboarding(true)}
              onGoSettings={() => setRoute('settings')}
            />
          ) : (
            <>
              {route === 'dashboard' && (
                <Dashboard
                  onNavigate={(r, view) => {
                    if (view) applyView(r, view);
                    setRoute(r as Route);
                  }}
                  onOpenEntry={setOpenEntryId}
                  onEditWorld={() =>
                    store.activeWorld
                      ? setWorldEditor({ open: true, id: store.activeWorld.id })
                      : setOnboarding(true)
                  }
                  onNewWorld={() => setOnboarding(true)}
                />
              )}
              {route === 'wiki' && (
                <WikiPage
                  view={wikiView}
                  onViewChange={setWikiView}
                  focusEntryId={openEntryId}
                  onOpenEntry={setOpenEntryId}
                  onCloseEntry={() => setOpenEntryId(null)}
                  onNavigate={(r) => setRoute(r as Route)}
                />
              )}
              {route === 'studio' && (
                <StudioPage
                  // agent 说「去时间轴看看」/「去杂物间」时，落点都带着要哪一支
                  onNavigate={(r, view) => {
                    if (view) applyView(r, view);
                    setRoute(r as Route);
                  }}
                  onOpenEntry={setOpenEntryId}
                />
              )}
              {route === 'review' && (
                <ReviewPage
                  onOpenEntry={setOpenEntryId}
                  // 「去时间轴看看」要真的落到那一支上
                  onNavigate={(r, view) => {
                    if (view) applyView(r, view);
                    setRoute(r as Route);
                  }}
                />
              )}
              {route === 'docs' && <DocsPage onNavigate={(r) => setRoute(r as Route)} />}
              {route === 'graph' && (
                <GraphPage
                  view={graphView}
                  onViewChange={setGraphView}
                  onOpenEntry={setOpenEntryId}
                  onGoReview={() => setRoute('review')}
                />
              )}
              {route === 'consistency' && (
                <ConsistencyPage
                  onOpenEntry={setOpenEntryId}
                  onNavigate={(r) => setRoute(r as Route)}
                />
              )}
              {route === 'ask' && (
                <AskPage onOpenEntry={setOpenEntryId} onNavigate={(r) => setRoute(r as Route)} />
              )}
              {route === 'log' && (
                <ActivityLogPage
                  onOpenEntry={setOpenEntryId}
                  onNavigate={(r) => setRoute(r as Route)}
                />
              )}
              {route === 'article' && (
                <ArticlePage onOpenEntry={setOpenEntryId} onNavigate={(r) => setRoute(r as Route)} />
              )}
              {route === 'export' && <ExportPage />}
              {route === 'settings' && (
                <SettingsPage
                  onEditWorld={() =>
                    store.activeWorld
                      ? setWorldEditor({ open: true, id: store.activeWorld.id })
                      : setOnboarding(true)
                  }
                  onNewWorld={() => setOnboarding(true)}
                />
              )}
            </>
          )}
        </div>
      </main>

      {/* 条目编辑器由 Wiki 那一页自己渲染（它要按子页决定开不开），这里只兜别的页 */}
      {openEntryId && route !== 'wiki' && (
        <EntryEditor
          entryId={openEntryId}
          onClose={() => setOpenEntryId(null)}
          onOpenEntry={setOpenEntryId}
        />
      )}

      {worldEditor.open && editingWorld && (
        <WorldEditor
          world={editingWorld}
          onClose={() => setWorldEditor({ open: false, id: null })}
        />
      )}

      {onboarding && (
        <WorldOnboarding
          onGoSettings={() => {
            setOnboarding(false);
            setRoute('settings');
          }}
          onClose={(created) => {
            setOnboarding(false);
            if (created) {
              setRoute('dashboard');
              toast.success(t('app.toast.worldCreated', { name: created.name }));
            }
          }}
        />
      )}

      {/*
        右下角的任务队列提示。挂在这一层（不是页面里）：
        作者常常是「在这页排一堆、然后切去别处等」，它得跟着人走。
      */}
      <TaskDock />
    </div>
  );
}

/** Edge 的 UA 里同时含 Chrome 和 Edg/；用 Edg/ 区分，排障提示才能给出 Edge 专属设置路径 */
const isEdge = /Edg\//.test(navigator.userAgent);

export default function App() {
  return (
    <I18nProvider>
      <StoreProvider>
        <ToastProvider>
          {/*
            运行器挂在这一层（不是页面里）：路由切换只卸载页面，Shell 一直活着，
            所以 AI 干活期间切页不会打断它。详见 state/agentRunner.tsx。
          */}
          <AgentRunnerProvider>
            <Shell />
          </AgentRunnerProvider>
        </ToastProvider>
      </StoreProvider>
    </I18nProvider>
  );
}
