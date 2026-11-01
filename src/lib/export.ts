import type { Category, Entry, Piece, Relation, World } from '../types';
import { formatTime } from './id';
import { currentLocale, localeMeta } from '../i18n/core';
import { tGlobal } from '../i18n/translate';
import { renderMarkdown } from './markdown';

export interface ExportOptions {
  includeDraft: boolean;
  includeRelations: boolean;
  includeInternalLinks: boolean;
  /**
   * 是否把「大事记」章节写进设定集。
   *
   * 内容不再是另一张表里的「事件」，而是**设了时间的条目** —— 所以它和条目正文
   * 说的是同一件事，不可能出现两处对不上的情况。
   */
  includeTimeline: boolean;
}

/**
 * 导出的设定集是给用户带走的产物，所以它的标题、字段名、状态名
 * 都跟随「导出时」的界面语言（用 tGlobal 取当前语言）。
 */
function statusLabel(s: Entry['status']) {
  return tGlobal(`kind.status.${s}`);
}

/* ------------------------------------------------------------------ */
/* 内链与锚点                                                          */
/*                                                                     */
/* 条目正文里的 `[[长安]]` 是**编辑器语法**，不是给人读的产物 —— 原样    */
/* 带进导出的 Markdown/HTML 里，别人打开只会看到一堆方括号。所以导出时    */
/* 把它折成真正的链接：`[长安](#长安)`（Markdown）/ `<a href="#长安">`    */
/* （HTML），同时每个条目标题挂一个同名的锚点，点下去真的跳得到。         */
/*                                                                     */
/* 锚点怎么定：同一份标题 → 同一个锚点，且要经得起「标题里有空格、标点、   */
/* 全角字符」的折腾。取标题小写、去掉空格与标点之外的字符、空白折成 `-`，   */
/* 与 GitHub / Typora / Obsidian 自动给标题生成的锚点规则一致 —— 于是     */
/* 在别处打开这份 Markdown，链接照样对得上标题。中文字符是字、照原样留。  */
/* ------------------------------------------------------------------ */

/** 标题 → 锚点（不带 `#`）。规则见上面那段说明 */
export function anchorOf(title: string): string {
  return (title ?? '')
    .trim()
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s_-]/gu, '')
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-+|-+$/g, '');
}

/**
 * 给一批条目建一张「标题 → 唯一锚点」的表。
 *
 * 理论上条目不重名，但批量导入/生成可能撞车 —— 撞了就在锚点后补 `-2`、`-3`，
 * 保证每个标题都指到唯一一个标题节点（否则点目录会跳到第一个同名条）。
 */
function buildAnchorMap(entries: Entry[]): Map<string, string> {
  const used = new Map<string, number>();
  const map = new Map<string, string>();
  for (const e of entries) {
    const base = anchorOf(e.title) || 'entry';
    const n = used.get(base) ?? 0;
    used.set(base, n + 1);
    map.set(e.title, n === 0 ? base : `${base}-${n + 1}`);
  }
  return map;
}

/**
 * 把一段正文里的 `[[条目]]` / `[[条目|显示]]` 折成真实链接。
 *
 * `md=true` 产出 Markdown 链接 `[显示](#锚点)`；否则产出 HTML `<a href="#锚点">显示</a>`。
 * 找不到锚点的（引了条不存在的条目）退化成纯文字 —— 不编一个会点空的链接。
 * `links` 为 false 时整段都不转（调用方另走「剥成纯文字」那一路）。
 */
function linkify(
  content: string,
  anchorMap: Map<string, string>,
  md: boolean,
  links: boolean,
): string {
  if (!links) return stripWikiLinks(content);
  const escape = md
    ? (s: string) => s
    : (s: string) =>
        s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  return content.replace(/\[\[([^\]|]+)(?:\|([^\]]+))?\]\]/g, (_m, name, label) => {
    const title = String(name).trim();
    const anchor = anchorMap.get(title);
    if (!anchor) return escape((label || title).trim());
    const shown = (label || title).trim();
    return md ? `[${shown}](#${anchor})` : `<a href="#${anchor}">${escape(shown)}</a>`;
  });
}

/** 内链关闭时：把 `[[条目]]` / `[[条目|显示]]` 折成纯文字 */
function stripWikiLinks(content: string): string {
  return content.replace(/\[\[([^\]|]+)(?:\|([^\]]+))?\]\]/g, (_m, a, b) => (b || a).trim());
}

/** 给一条条目标题生成 Markdown 里能用的「标题 + 锚点」：`### 标题`（锚点由渲染器自动给） */
function mdEntryHeading(e: Entry): string {
  return `### ${e.title}`;
}

/** 生成 Markdown 设定集 */
export function buildMarkdown(
  world: World,
  categories: Category[],
  entries: Entry[],
  relations: Relation[],
  timed: Entry[],
  opts: ExportOptions,
): string {
  const out: string[] = [];
  const listSep = tGlobal('lib.export.listSep');
  const sortedCats = [...categories].sort((a, b) => a.order - b.order);
  const pool = entries.filter((e) => opts.includeDraft || e.status !== 'draft');
  const anchorMap = buildAnchorMap(pool);
  const tlPool = opts.includeTimeline
    ? [...timed].sort(
        (a, b) => (a.time?.at ?? 0) - (b.time?.at ?? 0) || a.createdAt - b.createdAt,
      )
    : [];

  out.push(`# ${world.name}`);
  if (world.tagline) out.push(`> ${world.tagline}`);
  out.push('');
  if (world.genre)
    out.push(
      tGlobal('lib.export.field', {
        label: tGlobal('lib.export.genre'),
        value: world.genre,
      }),
    );
  if (world.tone)
    out.push(
      tGlobal('lib.export.field', { label: tGlobal('lib.export.tone'), value: world.tone }),
    );
  out.push(
    tGlobal('lib.export.field', {
      label: tGlobal('lib.export.entryTotal'),
      value: pool.length,
    }),
  );
  if (tlPool.length)
    out.push(
      tGlobal('lib.export.field', {
        label: tGlobal('lib.export.timelineTotal'),
        value: tlPool.length,
      }),
    );
  out.push(
    tGlobal('lib.export.field', {
      label: tGlobal('lib.export.exportedAt'),
      value: formatTime(Date.now()),
    }),
  );
  out.push('');
  if (world.summary) {
    out.push(`## ${tGlobal('lib.export.worldOverview')}`);
    out.push(world.summary);
    out.push('');
  }

  out.push(`## ${tGlobal('lib.export.toc')}`);
  if (tlPool.length)
    out.push(
      tGlobal('lib.export.tocItem', {
        name: tGlobal('lib.export.timeline'),
        count: tlPool.length,
      }),
    );
  for (const cat of sortedCats) {
    const list = pool.filter((e) => e.categoryId === cat.id);
    if (!list.length) continue;
    out.push(tGlobal('lib.export.tocItem', { name: cat.name, count: list.length }));
    for (const e of list)
      out.push(
        opts.includeInternalLinks
          ? `  - [${e.title}](#${anchorMap.get(e.title) ?? ''})`
          : `  - ${e.title}`,
      );
  }
  out.push('');

  if (tlPool.length) {
    out.push(`## ${tGlobal('lib.export.timeline')}`);
    out.push('');
    const titleOf = (id: string) =>
      pool.find((x) => x.id === id)?.title ?? tGlobal('lib.export.deleted');
    /**
     * 一条条目在正文里怎么写「什么时候」——三种形态各有一套写法。
     * 一篇设定集里光有三个数字在，读的人得自己拼，那不算写清楚了。
     */
    const whenOf = (e: Entry): string => {
      const tm = e.time!;
      const from = tm.from || tGlobal('lib.export.timelineNoDate');
      if (tm.kind === 'range')
        return tGlobal('lib.export.timelineRange', {
          from,
          to: tm.to || tGlobal('lib.export.timelineNoDate'),
        });
      if (tm.kind === 'ongoing') return tGlobal('lib.export.timelineOngoing', { from });
      return from;
    };
    // 只在纪元「换段」的位置开一个小节：同一段的连在一起读。
    // 注意不要为了把小节凑整齐而重新分组 —— 大事记首先是「按时间」的，
    // 重新分组会把历史顺序讲乱。
    let lastEra: string | null = null;
    for (const e of tlPool) {
      const era = (e.time?.era ?? '').trim();
      if (era !== lastEra) {
        out.push(`### ${era || tGlobal('lib.export.timelineNoEra')}`);
        out.push('');
        lastEra = era;
      }
      out.push(
        tGlobal('lib.export.timelineEvent', {
          date: whenOf(e),
          title: e.title,
        }),
      );
      if (e.summary) out.push(`  ${e.summary.replace(/\n+/g, ' ')}`);
      // 「这件事牵涉到谁」现在就是它自己的关系 —— 不用另存一份，也就不会过期
      const linked = relations
        .filter((r) => r.fromEntryId === e.id || r.toEntryId === e.id)
        .map((r) => (r.fromEntryId === e.id ? r.toEntryId : r.fromEntryId))
        .filter((id) => pool.some((x) => x.id === id));
      if (linked.length)
        out.push(
          tGlobal('lib.export.timelineLinked', {
            value: linked
              .map((id) => {
                const title = titleOf(id);
                const anchor = anchorMap.get(title);
                return opts.includeInternalLinks && anchor
                  ? `[${title}](#${anchor})`
                  : title;
              })
              .join(listSep),
          }),
        );
    }
    out.push('');
  }

  for (const cat of sortedCats) {
    const list = pool.filter((e) => e.categoryId === cat.id);
    if (!list.length) continue;
    out.push(`## ${cat.name}`);
    out.push('');
    for (const e of list) {
      out.push(`### ${e.title}`);
      const meta: string[] = [];
      if (e.aliases.length)
        meta.push(
          tGlobal('lib.export.metaItem', {
            label: tGlobal('lib.export.aliases'),
            value: e.aliases.join(listSep),
          }),
        );
      meta.push(
        tGlobal('lib.export.metaItem', {
          label: tGlobal('lib.export.status'),
          value: statusLabel(e.status),
        }),
      );
      if (e.tags.length)
        meta.push(
          tGlobal('lib.export.metaItem', {
            label: tGlobal('lib.export.tags'),
            value: e.tags.join(listSep),
          }),
        );
      out.push(`*${meta.join(tGlobal('lib.export.metaSep'))}*`);
      out.push('');
      if (e.summary && e.summary.trim() !== e.content.trim()) {
        out.push(tGlobal('lib.export.summaryLine', { value: e.summary }));
        out.push('');
      }
      const fieldKeys = Object.keys(e.fields ?? {}).filter((k) => e.fields[k]);
      if (fieldKeys.length) {
        for (const k of fieldKeys)
          out.push(tGlobal('lib.export.field', { label: k, value: e.fields[k] }));
        out.push('');
      }
      if (e.content) {
        out.push(linkify(e.content, anchorMap, true, opts.includeInternalLinks));
        out.push('');
      }
      if (opts.includeRelations) {
        const rels = relations.filter(
          (r) => (r.fromEntryId === e.id || r.toEntryId === e.id) && r.status === 'canon',
        );
        if (rels.length) {
          out.push(`**${tGlobal('lib.export.relations')}**`);
          const titleOf = (id: string) =>
            pool.find((x) => x.id === id)?.title ?? tGlobal('lib.export.deleted');
          for (const r of rels) {
            const otherTitle = titleOf(r.fromEntryId === e.id ? r.toEntryId : r.fromEntryId);
            const otherAnchor = anchorMap.get(otherTitle);
            const otherLink =
              opts.includeInternalLinks && otherAnchor
                ? `[${otherTitle}](#${otherAnchor})`
                : otherTitle;
            const line =
              r.fromEntryId === e.id
                ? tGlobal('lib.export.relOut', { type: r.type, title: otherLink })
                : tGlobal('lib.export.relIn', { type: r.type, title: otherLink });
            out.push(`- ${line}${r.note ? tGlobal('lib.export.note', { note: r.note }) : ''}`);
          }
          out.push('');
        }
      }
      out.push('---');
      out.push('');
    }
  }

  return out.join('\n');
}

/**
 * 生成可直接打印/另存为 Word 的 HTML 设定集。
 *
 * 与 Markdown 版**共用同一套锚点与内链规则**，所以目录、正文里的 `[[条目]]`、
 * 关系与大事记里的引用，点下去都跳得到对应条目的标题。
 *
 * 正文走 `renderMarkdown`（表格、粗斜体、代码块、媒体占位都照常渲染），
 * 再由 `linkify` 把内链折成 `<a href="#锚点">`；媒体引用 `asset:ID` 会按
 * `pieces` 把 Blob 内联成 dataURL —— 于是导出的 .html 里图片/音频/视频真的
 * 打得开，不依赖 WorldForge 本体的库。media 没有（或该条杂物没了）就如实标「已失效」。
 */
export async function buildHtml(
  world: World,
  categories: Category[],
  entries: Entry[],
  relations: Relation[],
  timed: Entry[],
  opts: ExportOptions,
  pieces: Piece[] = [],
): Promise<string> {
  const esc = (s: string) =>
    s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  const listSep = tGlobal('lib.export.listSep');
  const sortedCats = [...categories].sort((a, b) => a.order - b.order);
  const pool = entries.filter((e) => opts.includeDraft || e.status !== 'draft');
  const anchorMap = buildAnchorMap(pool);
  const tlPool = opts.includeTimeline
    ? [...timed].sort(
        (a, b) => (a.time?.at ?? 0) - (b.time?.at ?? 0) || a.createdAt - b.createdAt,
      )
    : [];

  /* 媒体：asset:ID → dataURL。先并行把用得到的 Blob 转成 dataURL 再渲染 */
  const mediaById = new Map<string, string>();
  for (const p of pieces) {
    if (!p.media?.blob) continue;
    try {
      mediaById.set(p.id, await blobToDataUrl(p.media.blob));
    } catch {
      /* 转不出来就让它落成「已失效」，不阻塞正文 */
    }
  }

  const body: string[] = [];

  /* -------- 页头 -------- */
  body.push(`<h1>${esc(world.name)}</h1>`);
  if (world.tagline) body.push(`<p class="tagline">${esc(world.tagline)}</p>`);
  const meta: string[] = [];
  if (world.genre)
    meta.push(tGlobal('lib.export.html.metaItem', { label: tGlobal('lib.export.genre'), value: esc(world.genre) }));
  if (world.tone)
    meta.push(tGlobal('lib.export.html.metaItem', { label: tGlobal('lib.export.tone'), value: esc(world.tone) }));
  meta.push(tGlobal('lib.export.html.metaItem', { label: tGlobal('lib.export.entryTotal'), value: String(pool.length) }));
  if (tlPool.length)
    meta.push(tGlobal('lib.export.html.metaItem', { label: tGlobal('lib.export.timelineTotal'), value: String(tlPool.length) }));
  meta.push(tGlobal('lib.export.html.metaItem', { label: tGlobal('lib.export.exportedAt'), value: esc(formatTime(Date.now())) }));
  body.push(`<p class="meta">${meta.join(tGlobal('lib.export.html.metaSep'))}</p>`);

  if (world.summary) {
    body.push(`<h2>${esc(tGlobal('lib.export.worldOverview'))}</h2>`);
    body.push(renderMarkdown(world.summary));
  }

  /* -------- 目录（每一项都是能点回去的链接） -------- */
  body.push(`<h2>${esc(tGlobal('lib.export.toc'))}</h2>`);
  body.push('<ul class="toc">');
  if (tlPool.length) {
    body.push(
      `<li><a href="#timeline">${esc(tGlobal('lib.export.timeline'))}</a>${tGlobal('lib.export.html.tocCount', { count: tlPool.length })}</li>`,
    );
  }
  for (const cat of sortedCats) {
    const list = pool.filter((e) => e.categoryId === cat.id);
    if (!list.length) continue;
    body.push(
      `<li><strong>${esc(cat.name)}</strong>${tGlobal('lib.export.html.tocCount', { count: list.length })}`,
    );
    body.push('<ul>');
    for (const e of list) {
      const anchor = anchorMap.get(e.title) ?? '';
      body.push(
        opts.includeInternalLinks && anchor
          ? `<li><a href="#${anchor}">${esc(e.title)}</a></li>`
          : `<li>${esc(e.title)}</li>`,
      );
    }
    body.push('</ul></li>');
  }
  body.push('</ul>');

  /* -------- 大事记 -------- */
  if (tlPool.length) {
    body.push(`<h2 id="timeline">${esc(tGlobal('lib.export.timeline'))}</h2>`);
    const titleOf = (id: string) =>
      pool.find((x) => x.id === id)?.title ?? tGlobal('lib.export.deleted');
    const whenOf = (e: Entry): string => {
      const tm = e.time!;
      const from = tm.from || tGlobal('lib.export.timelineNoDate');
      if (tm.kind === 'range')
        return tGlobal('lib.export.timelineRange', {
          from,
          to: tm.to || tGlobal('lib.export.timelineNoDate'),
        });
      if (tm.kind === 'ongoing') return tGlobal('lib.export.timelineOngoing', { from });
      return from;
    };
    let lastEra: string | null = null;
    for (const e of tlPool) {
      const era = (e.time?.era ?? '').trim();
      if (era !== lastEra) {
        body.push(`<h3>${esc(era || tGlobal('lib.export.timelineNoEra'))}</h3>`);
        lastEra = era;
      }
      body.push(
        `<p class="tlevent"><strong>${esc(whenOf(e))}</strong>${tGlobal('lib.export.html.colon')}${esc(e.title)}</p>`,
      );
      if (e.summary) body.push(`<p class="indent">${esc(e.summary.replace(/\n+/g, ' '))}</p>`);
      const linked = relations
        .filter((r) => r.fromEntryId === e.id || r.toEntryId === e.id)
        .map((r) => (r.fromEntryId === e.id ? r.toEntryId : r.fromEntryId))
        .filter((id) => pool.some((x) => x.id === id));
      if (linked.length) {
        const vals = linked
          .map((id) => {
            const title = titleOf(id);
            const anchor = anchorMap.get(title);
            return opts.includeInternalLinks && anchor
              ? `<a href="#${anchor}">${esc(title)}</a>`
              : esc(title);
          })
          .join(esc(listSep));
        body.push(
          `<p class="indent dim">${esc(tGlobal('lib.export.timelineLinked', { value: '' }))}${vals}</p>`,
        );
      }
    }
  }

  /* -------- 分类与条目 -------- */
  for (const cat of sortedCats) {
    const list = pool.filter((e) => e.categoryId === cat.id);
    if (!list.length) continue;
    body.push(`<h2>${esc(cat.name)}</h2>`);
    for (const e of list) {
      const anchor = anchorMap.get(e.title) ?? '';
      body.push(`<h3 id="${anchor}">${esc(e.title)}</h3>`);
      const metas: string[] = [];
      if (e.aliases.length)
        metas.push(
          tGlobal('lib.export.html.metaItem', {
            label: tGlobal('lib.export.aliases'),
            value: esc(e.aliases.join(listSep)),
          }),
        );
      metas.push(
        tGlobal('lib.export.html.metaItem', {
          label: tGlobal('lib.export.status'),
          value: esc(statusLabel(e.status)),
        }),
      );
      if (e.tags.length)
        metas.push(
          tGlobal('lib.export.html.metaItem', {
            label: tGlobal('lib.export.tags'),
            value: esc(e.tags.join(listSep)),
          }),
        );
      body.push(`<p class="meta small">${metas.join(esc(tGlobal('lib.export.metaSep')))}</p>`);
      if (e.summary && e.summary.trim() !== e.content.trim()) {
        body.push(
          `<p class="summary">${tGlobal('lib.export.html.metaItem', {
            label: `<strong>${esc(tGlobal('lib.export.summary'))}</strong>`,
            value: esc(e.summary),
          })}</p>`,
        );
      }
      const fieldKeys = Object.keys(e.fields ?? {}).filter((k) => e.fields[k]);
      if (fieldKeys.length) {
        body.push('<ul class="fields">');
        for (const k of fieldKeys)
          body.push(
            `<li>${tGlobal('lib.export.html.metaItem', {
              label: `<strong>${esc(k)}</strong>`,
              value: esc(e.fields[k]),
            })}</li>`,
          );
        body.push('</ul>');
      }
      if (e.content) {
        let html = renderMarkdown(e.content);
        // 内链：renderMarkdown 已把 [[x]] 折成 <span class="wl" data-wl="x">，这里换成真链接
        html = html.replace(
          /<span class="wl" data-wl="([^"]+)">([\s\S]*?)<\/span>/g,
          (_m, name, shown) => {
            const anchor = anchorMap.get(String(name));
            return anchor
              ? `<a href="#${anchor}" class="wl">${shown}</a>`
              : `<span class="wl missing">${shown}</span>`;
          },
        );
        // 媒体：asset:ID 占位 → 真 <img>/<audio>/<video>（dataURL）
        html = html.replace(
          /<span class="md-asset" data-asset="([^"]+)" data-alt="([^"]*)"><\/span>/g,
          (_m, id, alt) => {
            const dataUrl = mediaById.get(id);
            if (!dataUrl) {
              return `<span class="md-asset-missing">${
                alt ? esc(alt) : esc(tGlobal('media.missing'))
              }</span>`;
            }
            if (dataUrl.startsWith('data:image/'))
              return `<img class="md-img" src="${dataUrl}" alt="${esc(alt)}" loading="lazy" />`;
            if (dataUrl.startsWith('data:audio/'))
              return `<audio class="md-audio" controls src="${dataUrl}"></audio>`;
            if (dataUrl.startsWith('data:video/'))
              return `<video class="md-video" controls src="${dataUrl}"></video>`;
            return `<span class="md-asset-missing">${esc(tGlobal('media.unsupported'))}</span>`;
          },
        );
        body.push(`<div class="content">${html}</div>`);
      }
      if (opts.includeRelations) {
        const rels = relations.filter(
          (r) => (r.fromEntryId === e.id || r.toEntryId === e.id) && r.status === 'canon',
        );
        if (rels.length) {
          body.push(`<p class="rels"><strong>${esc(tGlobal('lib.export.relations'))}</strong></p>`);
          body.push('<ul>');
          const titleOf = (id: string) =>
            pool.find((x) => x.id === id)?.title ?? tGlobal('lib.export.deleted');
          for (const r of rels) {
            const otherTitle = titleOf(r.fromEntryId === e.id ? r.toEntryId : r.fromEntryId);
            const otherAnchor = anchorMap.get(otherTitle);
            const otherLink =
              opts.includeInternalLinks && otherAnchor
                ? `<a href="#${otherAnchor}">${esc(otherTitle)}</a>`
                : esc(otherTitle);
            const line =
              r.fromEntryId === e.id
                ? tGlobal('lib.export.relOut', { type: esc(r.type), title: otherLink })
                : tGlobal('lib.export.relIn', { type: esc(r.type), title: otherLink });
            body.push(`<li>${line}${r.note ? tGlobal('lib.export.note', { note: esc(r.note) }) : ''}</li>`);
          }
          body.push('</ul>');
        }
      }
      body.push('<hr/>');
    }
  }

  return `<!doctype html>
<html lang="${localeMeta(currentLocale()).htmlLang}"><head><meta charset="utf-8"/>
<meta name="viewport" content="width=device-width, initial-scale=1"/>
<title>${esc(tGlobal('lib.export.docTitle', { name: world.name }))}</title>
<style>
  :root{--ink:#22262e;--head:#1e3a5f;--sub:#33506e;--accent:#2f5d8f;--line:#d6dee8;--soft:#5c6b7a}
  body{font-family:"Songti SC","SimSun",Georgia,serif;line-height:1.85;max-width:820px;
       margin:48px auto;padding:0 28px;color:var(--ink);background:#fff}
  h1{font-size:30px;border-bottom:2px solid var(--accent);padding-bottom:12px;color:var(--head);margin-bottom:6px}
  h2{font-size:22px;margin-top:44px;color:var(--head);border-left:4px solid var(--accent);padding-left:10px}
  h3{font-size:17px;margin-top:28px;color:var(--sub)}
  a{color:var(--accent);text-decoration:none}
  a:hover{text-decoration:underline}
  .tagline{color:var(--soft);margin-top:0}
  .meta{color:var(--soft);font-size:14px}
  .meta.small{font-size:13px;color:var(--soft)}
  .toc,.fields,.rels{font-size:15px}
  .toc ul{list-style:none;padding-left:18px}
  blockquote{border-left:3px solid #c8d4e0;margin:0;padding:6px 14px;color:var(--soft);background:#f7f9fc}
  code{background:#f1f4f8;padding:1px 5px;border-radius:4px;font-size:13px}
  pre{background:#f6f8fb;padding:12px 14px;border-radius:6px;overflow:auto}
  pre code{background:none;padding:0}
  strong{color:#1a1f28}
  table{border-collapse:collapse;margin:14px 0;font-size:14px}
  th,td{border:1px solid var(--line);padding:6px 10px;text-align:left}
  th{background:#f3f6fa}
  hr{border:none;border-top:1px dashed var(--line);margin:26px 0}
  ul{padding-left:22px}
  p{margin:10px 0}
  .tlevent{margin:14px 0 4px}
  .indent{margin:2px 0 2px 1.5em;font-size:14.5px}
  .dim{color:var(--soft)}
  .summary{margin:10px 0}
  .content img.md-img{max-width:100%;height:auto;border-radius:6px;margin:8px 0;display:block}
  .content audio,.content video{max-width:100%;margin:8px 0}
  .wl.missing{color:#a33;text-decoration:line-through}
  .md-asset-missing{color:#a33;font-size:13px}
  @media print{ body{margin:0} h2{page-break-after:avoid} h3{page-break-after:avoid} }
</style></head>
<body>${body.join('\n')}</body></html>`;
}

/** Blob → dataURL（供 HTML 导出的媒体内联） */
function blobToDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const fr = new FileReader();
    fr.onload = () => resolve(String(fr.result));
    fr.onerror = () => reject(new Error('read failed'));
    fr.readAsDataURL(blob);
  });
}

export function download(filename: string, content: string, mime: string): void {
  const blob = new Blob([content], { type: `${mime};charset=utf-8` });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  setTimeout(() => URL.revokeObjectURL(url), 4000);
}

export function safeFilename(name: string): string {
  return name.replace(/[\\/:*?"<>|]/g, '_').slice(0, 60) || 'world';
}
