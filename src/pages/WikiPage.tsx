import React, { useMemo, useState } from 'react';
import { useStore } from '../state/store';
import { useToast } from '../components/Toast';
import { Empty, StatusPill } from '../components/Modal';
import { MarkdownView } from '../components/MarkdownView';
import { EntriesPage } from './EntriesPage';
import { PiecesPage } from './PiecesPage';
import { IcBook, IcBox, IcEdit, IcSearch } from '../components/icons';
import { outlineOf } from '../lib/markdown';
import {
  excerptOf,
  filterEntries,
  findByTitle,
  linkCounts,
  relatedTo,
  sortEntries,
  sourceDocs,
  WIKI_SORTS,
  type RelatedEntry,
  type WikiSort,
} from '../lib/wiki';
import { formatRelative } from '../lib/id';
import { useT, type MsgKey, type TFunc } from '../i18n';
import {
  WIKI_VIEWS,
  type Category,
  type Entry,
  type EntryStatus,
  type SourceDoc,
  type WikiView,
} from '../types';

/* ------------------------------------------------------------------ */
/* Wiki —— 「这个世界里有什么」的三种看法                                */
/*                                                                     */
/* 条目库原来的样子是**编辑器**：左边分类、右边一列行，点开改。作者想「读一  */
/* 读自己写过的东西」时其实没有地方可去 —— 那份界面从头到尾都在邀请他改动。   */
/*                                                                     */
/* 所以这一页的主角是「阅读」，而且读的方式要像**百科**：左边是按分类列开的   */
/* 目录，右边直接摊着正文 ——  点目录换一篇，正文里的 [[内链]] 点一下就顺着   */
/* 跳过去，还能退回来。原来的条目库和杂物间没有消失，它们退成了这一页的两个   */
/* 子页 —— 想改的时候再进去。                                           */
/*                                                                     */
/* 注意：**不要**把这里做成卡片墙。卡片是「一屏扫过去」的陈列方式，适合杂物   */
/* 间那种没头没尾的碎片；而条目是**文章**，文章需要一个能从头读到尾的地方。   */
/* 一条条目已经在正文里把自己讲清楚了，再把它压成一张 300px 宽的卡片，        */
/* 等于让作者隔着针眼看自己写的东西。                                    */
/* ------------------------------------------------------------------ */

/** 内链一路点下去最多记这么多步脚印 —— 再多「返回上一条」就成了体力活 */
const TRAIL_MAX = 30;

interface Props {
  view: WikiView;
  onViewChange: (v: WikiView) => void;
  focusEntryId?: string | null;
  /** 打开条目**编辑器**（走的是条目库那一套，不是这里的阅读视图） */
  onOpenEntry: (id: string) => void;
  onCloseEntry: () => void;
  onNavigate: (route: string) => void;
}

const TAB_LABEL: Record<WikiView, MsgKey> = {
  display: 'wiki.tab.display',
  entries: 'wiki.tab.entries',
  pieces: 'wiki.tab.pieces',
};

const TAB_HINT: Record<WikiView, MsgKey> = {
  display: 'wiki.tab.displayHint',
  entries: 'wiki.tab.entriesHint',
  pieces: 'wiki.tab.piecesHint',
};

const TAB_ICON: Record<WikiView, React.ReactNode> = {
  display: <IcBook size={14} />,
  entries: <IcEdit size={14} />,
  pieces: <IcBox size={14} />,
};

const SORT_LABEL: Record<WikiSort, MsgKey> = {
  updated: 'wiki.sort.updated',
  title: 'wiki.sort.title',
  links: 'wiki.sort.links',
};

const STATUS_LABEL: Record<EntryStatus | 'all', MsgKey> = {
  all: 'common.all',
  canon: 'kind.status.canon',
  pending: 'kind.status.pending',
  draft: 'kind.status.draft',
};

export function WikiPage({
  view,
  onViewChange,
  focusEntryId,
  onOpenEntry,
  onCloseEntry,
  onNavigate,
}: Props) {
  const store = useStore();
  const t = useT();

  if (!store.activeWorld) return <Empty icon="🌍" title={t('wiki.noWorld')} />;

  return (
    <>
      <div className="page-head">
        <div>
          <h1 className="page-title">{t('wiki.title')}</h1>
          <p className="page-desc">{t('wiki.desc')}</p>
        </div>
        <div className="page-actions">
          <div className="wk-tabs" data-role="wiki-tabs" role="tablist">
            {WIKI_VIEWS.map((v) => (
              <button
                key={v}
                role="tab"
                aria-selected={view === v}
                className={`wk-tab ${view === v ? 'active' : ''}`}
                data-role={`wiki-tab-${v}`}
                title={t(TAB_HINT[v])}
                onClick={() => onViewChange(v)}
              >
                {TAB_ICON[v]} {t(TAB_LABEL[v])}
              </button>
            ))}
          </div>
        </div>
      </div>

      {view === 'display' && (
        <WikiDisplay
          onGoEdit={() => onViewChange('entries')}
          onEditEntry={(id) => {
            // 「编辑这一条」= 切到编辑子页 + 打开它。两件事一起做，
            // 否则作者会落在编辑列表上、还得自己再找一遍那条。
            onViewChange('entries');
            onOpenEntry(id);
          }}
        />
      )}

      {view === 'entries' && (
        <EntriesPage
          embedded
          focusEntryId={focusEntryId}
          onOpenEntry={onOpenEntry}
          onCloseEntry={onCloseEntry}
          onNavigate={onNavigate}
        />
      )}

      {view === 'pieces' && <PiecesPage embedded onOpenEntry={onOpenEntry} />}
    </>
  );
}

/* ------------------------------------------------------------------ */
/* 阅读：左目录 + 右正文                                                 */
/* ------------------------------------------------------------------ */

/** 左导航里的一个分类分组。`__none__` 是分类已被删的落单条目 */
interface NavGroup {
  key: string;
  icon: string;
  name: string;
  items: Entry[];
}

const NONE_KEY = '__none__';

function WikiDisplay({
  onEditEntry,
  onGoEdit,
}: {
  onEditEntry: (id: string) => void;
  onGoEdit: () => void;
}) {
  const store = useStore();
  const toast = useToast();
  const t = useT();

  const [q, setQ] = useState('');
  const [status, setStatus] = useState<EntryStatus | 'all'>('all');
  const [sort, setSort] = useState<WikiSort>('updated');

  /** 正在读的那一条。`null` = 还没挑过，默认摊开目录里的第一条 */
  const [reading, setReading] = useState<string | null>(null);
  /**
   * 一路点下来的脚印。
   *
   * 正文里的 `[[内链]]` 只是**换掉右边那一栏**，屏幕上看不出「换了一层」——
   * 没有这个栈的话，作者点进第三层就是一口深井，只能自己重新在目录里找回来。
   */
  const [trail, setTrail] = useState<string[]>([]);

  const counts = useMemo(() => linkCounts(store.relations), [store.relations]);

  const list = useMemo(
    () => sortEntries(filterEntries(store.entries, { q, status }), sort, counts),
    [store.entries, q, status, sort, counts],
  );

  const catById = useMemo(
    () => new Map(store.categories.map((c) => [c.id, c])),
    [store.categories],
  );

  /**
   * 目录按分类分组。
   *
   * 顺序照 `store.categories` —— 作者在编辑页里排过的分类顺序就是这个顺序，
   * 目录自己再排一遍等于把他的话当耳旁风。分组后的组内顺序沿用 `list`
   * （已经按作者选的排序方式排过了）。
   */
  const groups = useMemo<NavGroup[]>(() => {
    const bucket = new Map<string, Entry[]>();
    for (const e of list) {
      const k = catById.has(e.categoryId) ? e.categoryId : NONE_KEY;
      const arr = bucket.get(k);
      if (arr) arr.push(e);
      else bucket.set(k, [e]);
    }
    const out: NavGroup[] = [];
    for (const c of store.categories) {
      const items = bucket.get(c.id);
      if (items?.length) out.push({ key: c.id, icon: c.icon, name: c.name, items });
    }
    // 分类被删掉之后留下的条目也得有个去处，不能从目录里凭空消失
    const none = bucket.get(NONE_KEY);
    if (none?.length) {
      out.push({ key: NONE_KEY, icon: '·', name: t('entries.uncategorized'), items: none });
    }
    return out;
  }, [list, catById, store.categories, t]);

  const alive = useMemo(() => new Set(store.entries.map((e) => e.id)), [store.entries]);

  /**
   * 右边到底摊哪一条。
   *
   * 作者挑过就以他挑的为准 —— 哪怕搜索/筛选把它从目录里滤掉了也照样摊着，
   * 不能因为作者在搜索框里敲了两个字，正在读的文章就自己跑掉。
   * 没挑过（`reading === null`）时默认摊第一条，一进来就有东西可读。
   */
  const shownId = reading && alive.has(reading) ? reading : list[0]?.id ?? null;

  const current = shownId ? store.entries.find((e) => e.id === shownId) ?? null : null;

  /** 换一篇读。`from` 是「从哪一条跳过来的」—— 左目录点进来时没有来处 */
  const pick = (id: string, from: string | null) => {
    if (id === shownId) return;
    setTrail((prev) => (from ? [...prev, from].slice(-TRAIL_MAX) : prev));
    setReading(id);
  };

  const goBack = () => {
    if (!trail.length) return;
    setReading(trail[trail.length - 1]);
    setTrail(trail.slice(0, -1));
  };

  /**
   * 正文里点了一个 `[[名字]]`。
   *
   * 找不着的时候**要说话**：编辑器里那一版是静默忽略的，可在阅读视图里，
   * 作者点了一下什么都没发生，他会以为是自己点偏了 —— 其实是那条内链写歪了。
   */
  const follow = (name: string) => {
    const hit = findByTitle(store.entries, name);
    if (!hit) {
      toast.warn(t('wiki.read.linkMissing', { name }));
      return;
    }
    pick(hit.id, shownId);
  };

  if (store.entries.length === 0) {
    return (
      <Empty
        icon="📖"
        title={t('wiki.empty.none')}
        desc={t('wiki.empty.noneDesc')}
        action={
          <button className="btn primary sm" onClick={onGoEdit}>
            {t('wiki.empty.goEdit')}
          </button>
        }
      />
    );
  }

  const backTo =
    trail.length > 0 ? store.entries.find((e) => e.id === trail[trail.length - 1]) ?? null : null;

  return (
    <div className="wk-layout" data-role="wiki-layout">
      {/* --------------------------- 左：目录 --------------------------- */}
      <nav className="wk-nav" data-role="wiki-nav">
        <div className="wk-nav-search">
          <IcSearch size={14} />
          <input
            className="input"
            data-role="wiki-search"
            placeholder={t('wiki.search.placeholder')}
            value={q}
            onChange={(e) => setQ(e.target.value)}
          />
        </div>

        <div className="wk-nav-seg" data-role="wiki-status">
          {(['all', 'canon', 'pending', 'draft'] as const).map((s) => (
            <button
              key={s}
              className={`chip ${status === s ? 'active' : ''}`}
              data-role={`wiki-status-${s}`}
              onClick={() => setStatus(s)}
            >
              {t(STATUS_LABEL[s])}
            </button>
          ))}
        </div>

        <div className="wk-nav-seg" data-role="wiki-sort">
          <span className="wk-nav-seg-label">{t('wiki.sort.label')}</span>
          {WIKI_SORTS.map((s) => (
            <button
              key={s}
              className={`chip ${sort === s ? 'active' : ''}`}
              data-role={`wiki-sort-${s}`}
              onClick={() => setSort(s)}
            >
              {t(SORT_LABEL[s])}
            </button>
          ))}
        </div>

        <div className="wk-nav-count" data-role="wiki-count">
          {t('wiki.count', { n: list.length })}
        </div>

        <div className="wk-nav-groups" data-role="wiki-nav-groups">
          {groups.length === 0 ? (
            <div className="wk-nav-empty">
              {q ? t('wiki.empty.noMatch') : t('wiki.empty.noMatchDesc')}
            </div>
          ) : (
            groups.map((g) => (
              <section className="wk-nav-group" key={g.key} data-role="wiki-nav-group">
                <div className="wk-nav-group-head">
                  <span className="wk-nav-group-name">
                    {g.icon} {g.name}
                  </span>
                  <span className="wk-nav-group-n">{g.items.length}</span>
                </div>
                <ul className="wk-nav-list">
                  {g.items.map((e) => (
                    <li key={e.id}>
                      <button
                        className={`wk-nav-item ${shownId === e.id ? 'active' : ''}`}
                        data-role="wiki-nav-item"
                        data-entry-id={e.id}
                        data-status={e.status}
                        aria-current={shownId === e.id ? 'page' : undefined}
                        /* 悬停预览：目录里只有标题，想看这条讲什么得先点进去。
                           把摘录挂在 title 上，扫目录时不用离开当前位置 */
                        title={excerptOf(e)}
                        onClick={() => pick(e.id, shownId)}
                      >
                        <span className="wk-nav-item-title" data-role="wiki-nav-item-title">
                          {e.title}
                        </span>
                        {e.aliases.length > 0 && (
                          <span className="wk-nav-item-alias">
                            {e.aliases.join(t('common.listSep'))}
                          </span>
                        )}
                      </button>
                    </li>
                  ))}
                </ul>
              </section>
            ))
          )}
        </div>
      </nav>

      {/* --------------------------- 中：正文 --------------------------- */}
      <main className="wk-main" data-role="wiki-main">
        {current ? (
          <WikiArticle
            entry={current}
            category={catById.get(current.categoryId)}
            backTo={backTo}
            onBack={goBack}
            onFollow={follow}
            onEdit={() => onEditEntry(current.id)}
          />
        ) : (
          <Empty icon="📖" title={t('wiki.empty.noMatch')} desc={t('wiki.empty.noMatchDesc')} />
        )}
      </main>

      {/* -------------------------- 右：信息栏 -------------------------- */}
      <aside className="wk-infobox" data-role="wiki-infobox">
        {current && (
          <WikiInfobox
            entry={current}
            category={catById.get(current.categoryId)}
            related={relatedTo(current.id, store.entries, store.relations)}
            sources={sourceDocs(current, store.docs)}
            onGoEntry={(id) => pick(id, shownId)}
          />
        )}
      </aside>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* 正文                                                                */
/* ------------------------------------------------------------------ */

function WikiArticle({
  entry,
  category,
  backTo,
  onBack,
  onFollow,
  onEdit,
}: {
  entry: Entry;
  category?: Category;
  /** 有脚印时，「返回上一条」要指名道姓说回哪去 */
  backTo: Entry | null;
  onBack: () => void;
  onFollow: (name: string) => void;
  onEdit: () => void;
}) {
  const t = useT();
  /* 封面缩略图从杂物间取 —— 阅读页只需要小图，不必解码原始文件 */
  const store = useStore();

  return (
    /* `key` 让换条目时整棵正文重新挂载 —— 否则表格/代码块这类内部带了状态的
       渲染会留着上一条的尾巴 */
    <article className="wk-art" data-role="wiki-article" data-entry-id={entry.id} key={entry.id}>
      {backTo && (
        <button className="wk-back" data-role="wiki-read-back" onClick={onBack}>
          ← {t('wiki.read.back')}
          <span className="wk-back-title">{backTo.title}</span>
        </button>
      )}

      <h2 className="wk-art-title" data-role="wiki-art-title">
        {entry.title}
      </h2>

      {/*
        封面：有就铺在标题下、正文前（像一册书的扉页图）。
        引用失效（那张图从杂物间删掉了）就整块不出现 —— 比「裂图图标」体面，
        正文内容一点不受影响。
      */}
      {(() => {
        const p = entry.cover ? store.pieces.find((x) => x.id === entry.cover) : undefined;
        const url = p?.thumb ?? null;
        return url ? (
          <div className="wk-cover" data-role="wiki-cover">
            <img src={url} alt={p?.title ?? entry.title} />
          </div>
        ) : null;
      })()}

      <div className="wk-art-meta">
        <span className="pill" data-role="wiki-read-cat">
          {category ? `${category.icon} ${category.name}` : t('entries.uncategorized')}
        </span>
        <StatusPill status={entry.status} />
        {entry.time && <span className="pill tiny">{whenLabel(entry.time, t)}</span>}
        {entry.aliases.length > 0 && (
          <span className="muted tiny">
            {t('entries.row.alias', { names: entry.aliases.join(t('common.listSep')) })}
          </span>
        )}
      </div>

      {entry.summary.trim() && (
        <p className="wk-lead" data-role="wiki-lead">
          {entry.summary.trim()}
        </p>
      )}

      {entry.content.trim() ? (
        // `className="wiki"` 给正文挂上知识库那一套排版（见 styles.css 的 `.md.wiki`）——
        // 同一份 Markdown，在编辑器预览里是「草稿的样子」，在这里是「读过校的样子」
        <MarkdownView content={entry.content} className="wiki" onInternalLink={onFollow} />
      ) : (
        <div className="muted small">{t('wiki.read.noContent')}</div>
      )}

      <div className="wk-art-foot">
        <button className="btn sm" data-role="wiki-read-edit" onClick={onEdit}>
          <IcEdit size={13} /> {t('wiki.read.edit')}
        </button>
      </div>
    </article>
  );
}

/* ------------------------------------------------------------------ */
/* 信息栏                                                              */
/* ------------------------------------------------------------------ */

function WikiInfobox({
  entry,
  category,
  related,
  sources,
  onGoEntry,
}: {
  entry: Entry;
  category?: Category;
  related: RelatedEntry[];
  sources: SourceDoc[];
  onGoEntry: (id: string) => void;
}) {
  const t = useT();
  const headings = useMemo(() => outlineOf(entry.content), [entry.content]);
  const fieldRows = fieldRowList(entry, category);

  return (
    <>
      {headings.length > 0 && (
        <div className="wk-side-block" data-role="wiki-outline">
          <div className="wk-side-title">{t('wiki.read.outline')}</div>
          <ul className="wk-outline">
            {headings.map((h, i) => (
              <li key={`${h.text}-${i}`} data-level={Math.min(h.level, 4)}>
                {h.text}
              </li>
            ))}
          </ul>
        </div>
      )}

      {related.length > 0 && (
        <div className="wk-side-block" data-role="wiki-related">
          <div className="wk-side-title">{t('wiki.read.related', { n: related.length })}</div>
          <div className="wk-rel-list">
            {related.map((r, i) => (
              <button
                key={`${r.other.id}-${i}`}
                className="wk-rel"
                data-role="wiki-related-item"
                data-dir={r.dir}
                data-mutual={r.mutual ? 'true' : undefined}
                onClick={() => onGoEntry(r.other.id)}
              >
                <span className="wk-rel-line">
                  {/* 方向写进句子里，而不是拿个箭头让人猜：「A 效忠 B」和
                      「B 效忠 A」是两句不同的话，箭头指哪边全靠猜 */}
                  {r.dir === 'out' ? (
                    <>
                      <span className="wk-rel-self">{t('wiki.read.this')}</span>
                      <span className="wk-rel-type">{r.type}</span>
                      {r.mutual && (
                        <span className="wk-rel-mutual">
                          {t('wiki.read.mutualSep')}
                          {r.mutual.type}
                        </span>
                      )}
                      <span className="wk-rel-title">{r.other.title}</span>
                    </>
                  ) : (
                    <>
                      <span className="wk-rel-title">{r.other.title}</span>
                      <span className="wk-rel-type">{r.type}</span>
                      {r.mutual && (
                        <span className="wk-rel-mutual">
                          {t('wiki.read.mutualSep')}
                          {r.mutual.type}
                        </span>
                      )}
                      <span className="wk-rel-self">{t('wiki.read.this')}</span>
                    </>
                  )}
                </span>
                {r.note && <span className="wk-rel-note">{r.note}</span>}
              </button>
            ))}
          </div>
        </div>
      )}

      {fieldRows.length > 0 && (
        <div className="wk-side-block">
          <div className="wk-side-title">{t('wiki.read.fields')}</div>
          <dl className="wk-fields">
            {fieldRows.map(([label, value]) => (
              <React.Fragment key={label}>
                <dt>{label}</dt>
                <dd>{value}</dd>
              </React.Fragment>
            ))}
          </dl>
        </div>
      )}

      {sources.length > 0 && (
        <div className="wk-side-block" data-role="wiki-sources">
          <div className="wk-side-title">{t('wiki.read.sources', { n: sources.length })}</div>
          <ul className="wk-src">
            {sources.map((d) => (
              <li key={d.id} title={d.name}>
                {d.name}
              </li>
            ))}
          </ul>
        </div>
      )}

      <div className="wk-side-block">
        <div className="wk-side-title">{t('wiki.read.meta')}</div>
        <div className="wk-meta-line">
          {t('wiki.read.updated', { time: formatRelative(entry.updatedAt) })}
        </div>
        <div className="wk-meta-line">{t('common.charCount', { n: entry.content.length })}</div>
      </div>
    </>
  );
}

/**
 * 结构化字段摊成一张表。
 *
 * 分类里定义过字段（年龄 / 阵营 / 所在地），但作者也可能在旧版本里留过
 * 分类定义之外的键 —— 那些也照摆，label 就用键名本身。丢掉的话，
 * 作者会以为「我填的东西不见了」。
 */
function fieldRowList(entry: Entry, category?: Category): [string, string][] {
  const rows: [string, string][] = [];
  const seen = new Set<string>();
  for (const def of category?.fieldDefs ?? []) {
    seen.add(def.key);
    const v = (entry.fields?.[def.key] ?? '').trim();
    if (v) rows.push([def.label || def.key, v]);
  }
  for (const [k, raw] of Object.entries(entry.fields ?? {})) {
    if (seen.has(k)) continue;
    const v = (raw ?? '').trim();
    if (v) rows.push([k, v]);
  }
  return rows;
}

/**
 * 把一份条目时间写成一行人话。
 *
 * 与审查页那一份同一个口径：三种形态各写各的 —— 光甩几个数字在正文顶上，
 * 作者得自己拼「这到底是几几年到几几年」，那就不叫把话说清楚了。
 */
function whenLabel(tm: NonNullable<Entry['time']>, t: TFunc): string {
  const from = tm.from.trim() || t('time.list.noFrom');
  if (tm.kind === 'range') {
    return t('time.label.range', { from, to: tm.to.trim() || t('time.label.unknown') });
  }
  if (tm.kind === 'ongoing') {
    return t('time.label.ongoing', { from, until: t('time.axis.ongoingArrow') });
  }
  return from;
}
