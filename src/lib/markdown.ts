/**
 * 轻量 Markdown 渲染器
 * 不引入外部依赖：先整体转义，再按行/内联替换生成受控 HTML。
 * 额外支持世界观内链语法：[[条目名]] 或 [[条目名|显示文本]]
 * 以及媒体引用：![说明](asset:杂物间ID) —— 图片/音频/视频都走这一条语法，
 * 具体渲染成 <img>/<audio>/<video> 由 MarkdownView 拿到 Blob 后按 MIME 决定。
 */

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/** 内联元素：粗体、斜体、行内代码、删除线、链接、内链、图片 */
function inline(src: string): string {
  let s = escapeHtml(src);

  // 行内代码优先占位，避免内部被其它规则改写
  const codes: string[] = [];
  s = s.replace(/`([^`]+)`/g, (_m, c) => {
    codes.push(c);
    return `\u0000CODE${codes.length - 1}\u0000`;
  });

  // 媒体引用占位：![说明](asset:ID)。ID 只认杂物间 id 的字符集（[\w-]），
  // 免得把「asset:foo bar」那种写歪的当成引用。真正能渲染成什么要等
  // MarkdownView 查到 Blob 才知道 —— 这里只留一个带 id 的空位。
  const media: { id: string; alt: string }[] = [];
  s = s.replace(/!\[([^\]]*)\]\(asset:([\w-]+)\)/g, (_m, alt: string, id: string) => {
    media.push({ id, alt });
    return `\u0000MEDIA${media.length - 1}\u0000`;
  });

  // 外链图片：![说明](https://…) 直接就是 <img>（src 已被转义，引号安全）
  s = s.replace(
    /!\[([^\]]*)\]\((https?:[^)\s]+)\)/g,
    '<img class="md-img" src="$2" alt="$1" loading="lazy" />',
  );

  // 内链 [[名称]] / [[名称|显示]]
  s = s.replace(/\[\[([^\]|]+)(?:\|([^\]]+))?\]\]/g, (_m, name, label) => {
    const shown = (label || name).trim();
    return `<span class="wl" data-wl="${name.trim()}">${shown}</span>`;
  });

  // 普通链接
  s = s.replace(
    /\[([^\]]+)\]\((https?:[^)\s]+)\)/g,
    '<a href="$2" target="_blank" rel="noreferrer noopener">$1</a>',
  );

  s = s.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
  s = s.replace(/(^|[^*])\*([^*\n]+)\*/g, '$1<em>$2</em>');
  s = s.replace(/~~([^~]+)~~/g, '<del>$1</del>');

  s = s.replace(/\u0000MEDIA(\d+)\u0000/g, (_m, i) => {
    const m = media[Number(i)];
    return `<span class="md-asset" data-asset="${m.id}" data-alt="${m.alt}"></span>`;
  });
  s = s.replace(/\u0000CODE(\d+)\u0000/g, (_m, i) => `<code>${codes[Number(i)]}</code>`);
  return s;
}

export function renderMarkdown(src: string): string {
  if (!src) return '';
  const lines = src.replace(/\r\n?/g, '\n').split('\n');
  const out: string[] = [];

  let i = 0;
  let listType: 'ul' | 'ol' | null = null;
  let inQuote = false;
  let inCode = false;
  let codeBuf: string[] = [];
  let tableBuf: string[] = [];

  const closeList = () => {
    if (listType) {
      out.push(`</${listType}>`);
      listType = null;
    }
  };
  const closeQuote = () => {
    if (inQuote) {
      out.push('</blockquote>');
      inQuote = false;
    }
  };
  const flushTable = () => {
    if (!tableBuf.length) return;
    const rows = tableBuf.map((r) =>
      r
        .replace(/^\||\|$/g, '')
        .split('|')
        .map((c) => c.trim()),
    );
    const head = rows[0];
    const body = rows.slice(1).filter((r) => !r.every((c) => /^:?-{2,}:?$/.test(c)));
    out.push('<table><thead><tr>');
    head.forEach((c) => out.push(`<th>${inline(c)}</th>`));
    out.push('</tr></thead><tbody>');
    body.forEach((r) => {
      out.push('<tr>');
      head.forEach((_h, idx) => out.push(`<td>${inline(r[idx] ?? '')}</td>`));
      out.push('</tr>');
    });
    out.push('</tbody></table>');
    tableBuf = [];
  };

  while (i < lines.length) {
    const line = lines[i];

    // 代码块
    if (line.trim().startsWith('```')) {
      if (inCode) {
        out.push(`<pre><code>${escapeHtml(codeBuf.join('\n'))}</code></pre>`);
        codeBuf = [];
        inCode = false;
      } else {
        closeList();
        closeQuote();
        flushTable();
        inCode = true;
      }
      i++;
      continue;
    }
    if (inCode) {
      codeBuf.push(line);
      i++;
      continue;
    }

    // 表格
    if (/^\s*\|.*\|\s*$/.test(line)) {
      closeList();
      closeQuote();
      tableBuf.push(line.trim());
      i++;
      continue;
    }
    flushTable();

    // 空行
    if (!line.trim()) {
      closeList();
      closeQuote();
      i++;
      continue;
    }

    // 分隔线
    if (/^\s*([-*_])\1{2,}\s*$/.test(line)) {
      closeList();
      closeQuote();
      out.push('<hr/>');
      i++;
      continue;
    }

    // 标题
    const h = line.match(/^(#{1,6})\s+(.*)$/);
    if (h) {
      closeList();
      closeQuote();
      // h1 留给页面标题；`######` 会算到 7，得夹住 —— 不然吐出个不存在的 <h7>，
      // 浏览器当成未知元素，那一行看着就成了没样式的纯文字
      const level = Math.min(h[1].length + 1, 6);
      out.push(`<h${level}>${inline(h[2])}</h${level}>`);
      i++;
      continue;
    }

    // 引用
    const q = line.match(/^\s*>\s?(.*)$/);
    if (q) {
      closeList();
      if (!inQuote) {
        out.push('<blockquote>');
        inQuote = true;
      }
      out.push(`<p>${inline(q[1])}</p>`);
      i++;
      continue;
    }
    closeQuote();

    // 列表
    const ul = line.match(/^\s*[-*+]\s+(.*)$/);
    const ol = line.match(/^\s*\d+[.)]\s+(.*)$/);
    if (ul || ol) {
      const want: 'ul' | 'ol' = ul ? 'ul' : 'ol';
      if (listType !== want) {
        closeList();
        out.push(`<${want}>`);
        listType = want;
      }
      out.push(`<li>${inline((ul ? ul[1] : ol![1]).trim())}</li>`);
      i++;
      continue;
    }
    closeList();

    out.push(`<p>${inline(line)}</p>`);
    i++;
  }

  if (inCode) out.push(`<pre><code>${escapeHtml(codeBuf.join('\n'))}</code></pre>`);
  closeList();
  closeQuote();
  flushTable();

  return out.join('\n');
}

/** 正文里的一条标题 */
export interface MdHeading {
  /** 原始层级（`#` 的个数，1–6）。注意渲染时会整体下沉一级（h1 留给页面标题） */
  level: number;
  /** 剥掉标记之后的标题文字 */
  text: string;
}

/**
 * 剥掉一**行**里的行内标记，留下人话。
 *
 * 与 `stripMarkdown` 的分工：它按行工作、不动换行与竖线 —— 大纲里的标题本身
 * 就是一行，拿 `stripMarkdown` 去处理会把「| 位于 | 港口 |」那种标题也揉平。
 * 也没有沿用 `stripMarkdown` 的 `[*_~>]` 全局删除（那会吃掉正文里本就该有的星号），
 * 只认成对的粗体/斜体/删除线。
 */
export function stripInline(src: string): string {
  if (!src) return '';
  return src
    .replace(/`([^`]+)`/g, '$1')
    .replace(/!\[[^\]]*\]\([^)]*\)/g, ' ')
    .replace(/\[\[([^\]|]+)(?:\|([^\]]+))?\]\]/g, (_m, a, b) => b || a)
    .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')
    .replace(/\*\*([^*]+)\*\*/g, '$1')
    .replace(/\*([^*\n]+)\*/g, '$1')
    .replace(/~~([^~]+)~~/g, '$1')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * 取出正文的标题大纲。
 *
 * 这就是「识别 md」落到界面上的地方：作者的正文本来就是按 `## 概览 / ## 历史`
 * 分段写的，那就把这几段如实摆出来 —— 阅读时右边那栏的「本文目录」一眼能看出
 * 这条讲了几节，也顺带成了页内导航。
 *
 * 两个刻意的取舍：
 *   - 只认 ATX 标题（`## 概览`），不认 setext（下一行划下划线那种）——
 *     本项目里 `---` 就是分隔线，认 setext 会把分隔线当成标题。
 *   - 代码块里的 `#` 不是标题，所以按行扫并跟着围栏状态走（``` 成对切换）。
 */
export function outlineOf(src: string): MdHeading[] {
  if (!src) return [];
  const out: MdHeading[] = [];
  let fenced = false;
  for (const raw of src.replace(/\r\n?/g, '\n').split('\n')) {
    const line = raw.trimEnd();
    if (line.trim().startsWith('```')) {
      fenced = !fenced;
      continue;
    }
    if (fenced) continue;
    // 允许闭式的 `## 标题 ##`
    const m = line.match(/^(#{1,6})\s+(.+?)\s*#*\s*$/);
    if (!m) continue;
    const text = stripInline(m[2]);
    if (text) out.push({ level: m[1].length, text });
  }
  return out;
}

/** 去掉 Markdown 标记，得到纯文本（用于检索、摘要、导出预览） */
export function stripMarkdown(src: string): string {
  if (!src) return '';
  return src
    .replace(/```[\s\S]*?```/g, ' ')
    .replace(/`([^`]+)`/g, '$1')
    .replace(/!\[[^\]]*\]\([^)]*\)/g, ' ')
    .replace(/\[\[([^\]|]+)(?:\|([^\]]+))?\]\]/g, (_m, a, b) => b || a)
    .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')
    .replace(/^\s{0,3}#{1,6}\s+/gm, '')
    .replace(/[*_~>]/g, '')
    .replace(/\|/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}
