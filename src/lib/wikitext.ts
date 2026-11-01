/**
 * 正文的「编辑层」：工具栏往光标处套什么语法、语法怎么上色、`[[` 后面该补哪个条目名。
 *
 * 全是纯函数，抽出来的理由跟 `lib/wiki.ts` 一样 —— **抽出来才测得到**。
 * 工具栏最容易出的错是两类，而它们在界面上都长得像「没反应」：
 *   ① 点了按钮把选中的字吃掉一半（包裹的边界算错）；
 *   ② 高亮层跟输入框错开一行（两边字体度量或换行规则对不上）。
 * 摆进组件里这两类就只能靠手点肉眼比，一有零头就看不出来。放这儿一行断言钉死。
 *
 * 不 import React、不 import 语言包。
 */
import { stripInline } from './markdown';

/* ================================================================== */
/* 一、工具栏动作                                                      */
/* ================================================================== */

/** 一次编辑的结果：新的全文，以及编辑之后光标/选区该停在哪 */
export interface EditResult {
  value: string;
  selStart: number;
  selEnd: number;
}

/**
 * 一个工具按钮要干的事。
 *
 * 分成三类而不是给每个按钮写一个函数，是因为「套上 / 脱掉」这套逻辑
 * 对同类按钮完全一样 —— 粗体和斜体只差一对标记，标题 1/2/3 只差井号个数。
 * 照着类型套用，就不会出现「粗体能反切换、斜体不能」这种莫名其妙的落差。
 */
export type EditSpec =
  /** 包在选中内容外面：`**粗体**`、`*斜体*`、`` `代码` ``、`~~删除~~` */
  | { kind: 'wrap'; before: string; after: string; placeholder: string }
  /**
   * 行前缀：标题、列表、引用。
   * `mark` 是「这一族的前缀」，用来判断该套上还是该脱掉 ——
   * 从二级标题点三级标题时应当**替换**井号而不是叠成 `##### 标题`。
   */
  | { kind: 'prefix'; prefix: string; mark: RegExp }
  /** 在光标处另起一段插进去：表格、代码块、分隔线 */
  | { kind: 'insert'; text: string; caretOffset?: number };

/**
 * 行前缀的「族」。
 *
 * 取消与切换都以**族**为单位，所以这些正则必须由这里统一给出 ——
 * 让调用方各写各的，就会出现「无序列表按钮认不出有序列表、于是叠成 `1. - x`」
 * 这种只有手工点才发现得了的错。
 */
export const PREFIX_MARK = {
  heading: /^#{1,6}\s+/,
  /** 有序与无序算同一族：点另一种就是把这一族换成另一种写法 */
  list: /^([-*+]|\d+[.)])\s+/,
  quote: /^>\s?/,
} as const;

/** 选区扩到整行 —— 行前缀类操作的作用范围永远是「整行」 */
function linesOf(src: string, selStart: number, selEnd: number) {
  const start = selStart <= 0 ? 0 : src.lastIndexOf('\n', selStart - 1) + 1;
  const found = src.indexOf('\n', Math.max(selEnd, start));
  const end = found < 0 ? src.length : found;
  return { start, end, lines: src.slice(start, end).split('\n') };
}

function applyWrap(src: string, selStart: number, selEnd: number, spec: Extract<EditSpec, { kind: 'wrap' }>): EditResult {
  const { before, after } = spec;
  const selected = src.slice(selStart, selEnd);

  // ① 选中的内容自带这对标记（先套过再点一次）→ 脱掉
  if (selected.length >= before.length + after.length && selected.startsWith(before) && selected.endsWith(after)) {
    const inner = selected.slice(before.length, selected.length - after.length);
    return {
      value: src.slice(0, selStart) + inner + src.slice(selEnd),
      selStart,
      selEnd: selStart + inner.length,
    };
  }

  // ② 标记在选区外面（点按钮套上之后没动光标，又点了一次）→ 脱掉
  const outerStart = selStart - before.length;
  if (
    outerStart >= 0 &&
    src.slice(outerStart, selStart) === before &&
    src.slice(selEnd, selEnd + after.length) === after
  ) {
    return {
      value: src.slice(0, outerStart) + selected + src.slice(selEnd + after.length),
      selStart: outerStart,
      selEnd: outerStart + selected.length,
    };
  }

  // ③ 有选中 → 包起来，并把内层继续选中（接着打字就是替换内容）
  if (selected) {
    return {
      value: src.slice(0, selStart) + before + selected + after + src.slice(selEnd),
      selStart: selStart + before.length,
      selEnd: selEnd + before.length,
    };
  }

  // ④ 没选中 → 插占位符并选中它，接着打字直接覆盖
  const caret = selStart;
  return {
    value: src.slice(0, caret) + before + spec.placeholder + after + src.slice(caret),
    selStart: caret + before.length,
    selEnd: caret + before.length + spec.placeholder.length,
  };
}

function applyPrefix(src: string, selStart: number, selEnd: number, spec: Extract<EditSpec, { kind: 'prefix' }>): EditResult {
  const { start, end, lines } = linesOf(src, selStart, selEnd);

  /*
   * 缩进单独拿出来算：前缀一律加在缩进**之后**（`  - x` 才是「一层嵌套」），
   * 脱掉时再把缩进原样还回去。
   * 把缩进揉进前缀里（比如传 `'  - '`）会连带出一个更难发现的毛病：
   * 「取消列表」会把作者的嵌套层级一起吃掉 —— `　　- 子项` 变成一个顶格的 `子项`。
   */
  const parts = lines.map((l) => {
    const indent = l.match(/^\s*/)![0];
    return { indent, body: l.slice(indent.length), blank: !l.trim() };
  });

  const real = parts.filter((p) => !p.blank);
  const allMarked = real.length > 0 && real.every((p) => spec.mark.test(p.body));
  const allSame = real.length > 0 && real.every((p) => p.body.startsWith(spec.prefix));

  const next = parts.map((p) => {
    // 空行不加前缀 —— 否则列表里会冒出一个孤零零的 `- `，还得作者自己删
    if (p.blank) return p.indent;
    const bare = p.body.replace(spec.mark, '');
    return allMarked && allSame ? p.indent + bare : p.indent + spec.prefix + bare;
  });

  const block = next.join('\n');
  return {
    value: src.slice(0, start) + block + src.slice(end),
    // 整块继续选中：连点两下「三级标题」时第二下才打得到它自己
    selStart: start,
    selEnd: start + block.length,
  };
}

function applyInsert(src: string, selStart: number, selEnd: number, spec: Extract<EditSpec, { kind: 'insert' }>): EditResult {
  const caret = selEnd;
  // 块级内容要自己占整段：前面没断行就补一个，后面跟内容也补一个
  const lead = selStart > 0 && src[selStart - 1] !== '\n' ? '\n' : '';
  const trail = caret < src.length && src[caret] !== '\n' ? '\n' : '';
  const block = lead + spec.text + trail;
  const at = selStart + lead.length;
  const offset = spec.caretOffset ?? spec.text.length;
  return {
    value: src.slice(0, selStart) + block + src.slice(caret),
    selStart: at + offset,
    selEnd: at + offset,
  };
}

/**
 * 把「按了某个工具按钮」翻译成「文本变成什么、光标停在哪」。
 *
 * 传入的选区按 `[selStart, selEnd)` 理解，跟 `textarea.selectionStart/End` 一致。
 */
export function applyEdit(src: string, selStart: number, selEnd: number, spec: EditSpec): EditResult {
  const a = Math.max(0, Math.min(selStart, selEnd));
  const b = Math.max(selStart, selEnd);
  const from = Math.max(0, Math.min(a, src.length));
  const to = Math.max(0, Math.min(b, src.length));
  switch (spec.kind) {
    case 'wrap':
      return applyWrap(src, from, to, spec);
    case 'prefix':
      return applyPrefix(src, from, to, spec);
    case 'insert':
      return applyInsert(src, from, to, spec);
  }
}

/** 缩进作用的那几行 —— 缩进的区域永远按整行算 */
function expandLines(src: string, selStart: number, selEnd: number) {
  const start = selStart <= 0 ? 0 : src.lastIndexOf('\n', selStart - 1) + 1;
  const found = src.indexOf('\n', Math.max(selEnd, start));
  return { start, end: found < 0 ? src.length : found };
}

export const INDENT = '  ';

/**
 * Tab / Shift+Tab。
 *
 * 缩进后**把整块继续选中**，这样连按 Tab 就是往里推、按 Shift+Tab 就是往外拉 ——
 * 若把光标缩回原处，第二次 Tab 只会给同一个位置再加两个空格，看起来像没反应。
 */
export function indentSelection(src: string, selStart: number, selEnd: number, outdent: boolean): EditResult {
  const { start, end } = expandLines(src, selStart, selEnd);
  const lines = src.slice(start, end).split('\n');
  const next = lines.map((l) => {
    if (outdent) return l.startsWith(INDENT) ? l.slice(INDENT.length) : l.replace(/^\t/, '');
    return INDENT + l;
  });
  const block = next.join('\n');
  return { value: src.slice(0, start) + block + src.slice(end), selStart: start, selEnd: start + block.length };
}

/** 生成一张 Markdown 表格。`rows` 是不含表头的数据行数 */
export function tableSnippet(rows: number, cols: number, labels: string[]): string {
  const n = Math.max(1, Math.min(cols, 12));
  const head = Array.from({ length: n }, (_, i) => labels[i] ?? '');
  return [
    `| ${head.join(' | ')} |`,
    `| ${head.map(() => '---').join(' | ')} |`,
    ...Array.from({ length: Math.max(1, Math.min(rows, 40)) }, () => `| ${head.map(() => '   ').join(' | ')} |`),
  ].join('\n');
}

/**
 * 在列表项末尾敲回车 —— 接着下一个符号，而不是把列表打断。
 *
 * 返回 `null` 表示「这次不归我管」，让输入框走默认行为。
 * 两种情形必须交还给默认行为，否则会很难用：
 *   - 光标不在行尾：那是在**拆行**，不是要开新项；
 *   - 当前行根本不是列表项。
 *
 * 在**空的**列表项上回车则是「收尾」：把那个孤零零的符号删掉，
 * 光标退回行首 —— 不然作者想结束列表就只能自己去删那个 `- `。
 */
export function continueList(src: string, caret: number): EditResult | null {
  const lineStart = caret <= 0 ? 0 : src.lastIndexOf('\n', caret - 1) + 1;
  const line = src.slice(lineStart, caret);
  const m = line.match(/^(\s*)([-*+]|\d+[.)])(\s+)(.*)$/);
  if (!m) return null;
  if (caret !== lineStart + line.length) return null;

  const indent = m[1];
  const marker = m[2];
  const rest = m[4];
  if (!rest.trim()) {
    return { value: src.slice(0, lineStart) + src.slice(caret), selStart: lineStart, selEnd: lineStart };
  }

  // 数字列表接着数下去；`*` / `+` 原样沿用，别的都用最常见的 `- `
  const next = /^\d/.test(marker)
    ? `${parseInt(marker, 10) + 1}${marker.endsWith(')') ? ')' : '.'} `
    : marker === '*' || marker === '+'
      ? `${marker} `
      : '- ';
  const insert = '\n' + indent + next;
  return {
    value: src.slice(0, caret) + insert + src.slice(caret),
    selStart: caret + insert.length,
    selEnd: caret + insert.length,
  };
}

/* ================================================================== */
/* 二、语法高亮                                                        */
/* ================================================================== */

export interface HlSeg {
  text: string;
  /** null = 普通文字 */
  cls: string | null;
  /** 这段落在第几行（0 基）。大纲跳转靠它定位 */
  line: number;
}

/**
 * 把正文切成带类名的片段，用于在输入框底下铺一层彩色副本。
 *
 * **唯一的硬约束：`segs.map(s => s.text).join('')` 必须一字不差地等于原文。**
 * 少了、多了、换行被吞掉一个，下面那层就跟输入框错位，越往下越偏。
 * 所以这里从头到尾是「按位置推进、每次吐出等长的文字」，没有任何「重组」动作。
 *
 * 还有一个不能省的前提：这一层的字号、行高、字距、内边距、换行规则必须跟
 * textarea **完全一致** —— 见 styles.css 里 `.wxe-layer` 那一段的说明。
 */
export function highlightMarkdown(src: string): HlSeg[] {
  const segs: HlSeg[] = [];
  if (!src) return segs;
  let line = 0;

  /**
   * 吐一段。同类同一行的相邻片段直接并进上一段 ——
   * 一段长正文里几百上千个 `<span>` 会让这层明显变重，而合并之后渲染结果完全一样。
   */
  const push = (text: string, cls: string | null) => {
    if (!text) return;
    const last = segs[segs.length - 1];
    if (last && last.cls === cls && last.line === line) {
      last.text += text;
      return;
    }
    segs.push({ text, cls, line });
  };

  // 保留行尾换行符一起切，才能做到逐字符守恒
  const rows = src.split('\n');
  let fenced = false;

  for (let r = 0; r < rows.length; r++) {
    const body = rows[r];
    const nl = r < rows.length - 1 ? '\n' : '';

    if (/^\s*(```|~~~)/.test(body)) {
      push(body, 'wxe-fence');
      push(nl, null);
      fenced = !fenced;
      line = r + 1;
      continue;
    }
    if (fenced) {
      push(body, 'wxe-code');
      push(nl, null);
      line = r + 1;
      continue;
    }

    // 分隔线
    if (/^\s*([-*_])\1{2,}\s*$/.test(body)) {
      push(body, 'wxe-hr');
      push(nl, null);
      line = r + 1;
      continue;
    }

    // 标题：井号是标记，标题文字单独一类
    const h = body.match(/^(\s*)(#{1,6})(\s+)([\s\S]*)$/);
    if (h) {
      push(h[1], null);
      push(h[2], 'wxe-mark');
      push(h[3], null);
      pushInline(h[4], 'wxe-h', push, line);
      push(nl, null);
      line = r + 1;
      continue;
    }

    // 引用
    const q = body.match(/^(\s*)(>+)(\s?)([\s\S]*)$/);
    if (q) {
      push(q[1], null);
      push(q[2], 'wxe-mark');
      push(q[3], null);
      pushInline(q[4], 'wxe-quote', push, line);
      push(nl, null);
      line = r + 1;
      continue;
    }

    // 列表
    const li = body.match(/^(\s*)([-*+]|\d+[.)])(\s+)([\s\S]*)$/);
    if (li) {
      push(li[1], null);
      push(li[2], 'wxe-mark');
      push(li[3], null);
      pushInline(li[4], null, push, line);
      push(nl, null);
      line = r + 1;
      continue;
    }

    // 表格行：竖线是标记，格子内容照常做行内高亮
    if (/^\s*\|/.test(body)) {
      let rest = body;
      while (rest) {
        const bar = rest.indexOf('|');
        if (bar < 0) {
          pushInline(rest, null, push, line);
          break;
        }
        if (bar > 0) pushInline(rest.slice(0, bar), null, push, line);
        push('|', 'wxe-mark');
        rest = rest.slice(bar + 1);
      }
      push(nl, null);
      line = r + 1;
      continue;
    }

    pushInline(body, null, push, line);
    push(nl, null);
    line = r + 1;
  }

  return segs;
}

/**
 * 行内标记的扫描器。
 *
 * 用粘性正则（`y`）在**当前这一格**上试，试到就吐一段、没试到就把普通字符往前挪一格
 * —— 全程只往前、不回退、不重组，于是天然满足「逐字符守恒」。
 * 换成 `.replace()` 链就会把已经吐出去的文字再揉一遍，那种写法对不上原文。
 *
 * 没匹配时不能直接收工：`这是**粗体**` 的第一个字符就不是任何标记的开头，
 * 一收工整行就都成了纯文本，粗体永远高亮不出来。
 * 所以没匹配时先跳到下一个**可能的起始字符**，中间那截一次性当普通文字吐掉。
 */
const INLINE_RE =
  /(\*\*(?:[^*\n]|\*(?!\*))+?\*\*)|(~~[^~\n]+?~~)|(`[^`\n]+?`)|(\[\[[^\]|\n]+?(?:\|[^\]\n]+?)?\]\])|(!?\[[^\]\n]*?\]\([^)\s]+\))|(\*[^*\n]+?\*)|(_[^_\n]+?_)/y;

/** 行内标记可能的起始字符。用不到全部，宁可多试一次也别漏 */
const INLINE_START = /[*~`[_]/;

function pushInline(
  src: string,
  base: string | null,
  push: (text: string, cls: string | null) => void,
  line: number,
): void {
  if (!src) return;
  void line;
  let at = 0;
  while (at < src.length) {
    const found = src.slice(at).search(INLINE_START);
    if (found < 0) {
      push(src.slice(at), base);
      return;
    }
    const next = at + found;
    if (next > at) push(src.slice(at, next), base);
    at = next;

    INLINE_RE.lastIndex = at;
    const m = INLINE_RE.exec(src);
    if (!m) {
      // 这个星号/下划线不是标记的开头（比如「3*4」里的那个）——就当普通字吐掉
      push(src[at], base);
      at++;
      continue;
    }
    const tok = m[0];
    const [bold, del, code, wikilink, link, em, ul] = m.slice(1);
    if (bold) emitWrapped(tok, '**', 'wxe-b', push, base);
    else if (em) emitWrapped(tok, '*', 'wxe-i', push, base);
    else if (ul) emitWrapped(tok, '_', 'wxe-i', push, base);
    else if (del) emitWrapped(tok, '~~', 'wxe-del', push, base);
    else if (code) push(tok, 'wxe-code-inline');
    else if (wikilink) {
      // [[名|显示]]：方括号与竖线是标记，名与显示文字是链接
      push('[[', 'wxe-mark');
      const inner = tok.slice(2, -2);
      const bar = inner.indexOf('|');
      if (bar < 0) push(inner, 'wxe-link');
      else {
        push(inner.slice(0, bar), 'wxe-link');
        push('|', 'wxe-mark');
        push(inner.slice(bar + 1), 'wxe-link');
      }
      push(']]', 'wxe-mark');
    } else if (link) {
      const img = tok.startsWith('!');
      const open = img ? 2 : 1;
      const close = tok.lastIndexOf('](');
      push(tok.slice(0, open), 'wxe-mark');
      push(tok.slice(open, close), img ? 'wxe-img' : 'wxe-link');
      push('](', 'wxe-mark');
      push(tok.slice(close + 2, -1), 'wxe-url');
      push(')', 'wxe-mark');
    } else {
      push(tok, base);
    }
    at += tok.length;
  }
}

/** 吐「标记 + 内容 + 标记」，标记跟内容用不同的类名 */
function emitWrapped(
  tok: string,
  marker: string,
  contentCls: string,
  push: (text: string, cls: string | null) => void,
  base: string | null,
): void {
  push(marker, 'wxe-mark');
  push(tok.slice(marker.length, tok.length - marker.length), contentCls ?? base);
  push(marker, 'wxe-mark');
}

/* ================================================================== */
/* 三、内链自动补全                                                    */
/* ================================================================== */

export interface LinkQuery {
  /** `[[` 里第一个方括号的位置 */
  start: number;
  /** 已经打出来的那截名字 */
  prefix: string;
}

/**
 * 光标是不是正停在某个没写完的 `[[` 后面？
 *
 * 往回找最近的一个 `[[`，中间只要出现 `]`、`|` 或换行就说明那个 `[[` 已经用完了，
 * 当前不是在写内链。往回最多看 200 个字符 —— 不设上限的话，长正文里每敲一个字
 * 都要扫全文，而结果永远是没有。
 */
export function linkQueryAt(src: string, caret: number): LinkQuery | null {
  const from = Math.max(0, caret - 200);
  const head = src.slice(from, caret);
  const open = head.lastIndexOf('[[');
  if (open < 0) return null;
  const between = head.slice(open + 2);
  if (/[\]\n|[]/.test(between)) return null;
  return { start: from + open, prefix: between };
}

/** 按已打出的那截前缀过滤候选（标题与别名都参与匹配） */
export function matchLinkTargets(
  q: string,
  targets: { id: string; title: string; aliases?: string[] }[],
  limit = 8,
): { id: string; title: string; aliases?: string[] }[] {
  const key = q.trim().toLowerCase();
  const hit = key
    ? targets.filter(
        (t) =>
          t.title.toLowerCase().includes(key) ||
          (t.aliases ?? []).some((a) => a.toLowerCase().includes(key)),
      )
    : targets;
  return hit.slice(0, limit);
}

/** 把 `[[前` 补成 `[[完整标题]]`，光标停在两个右方括号前 */
export function completeLink(src: string, query: LinkQuery, title: string): EditResult {
  const end = query.start + 2 + query.prefix.length;
  return {
    value: `${src.slice(0, query.start)}[[${title}]]${src.slice(end)}`,
    selStart: query.start + title.length + 4,
    selEnd: query.start + title.length + 4,
  };
}

/* ================================================================== */
/* 四、章节与统计                                                      */
/* ================================================================== */

export interface Section {
  level: number;
  text: string;
  /** 标题所在行（0 基） */
  line: number;
  /** 标题行的起始偏移 */
  start: number;
  /** 到下一个标题为止（最后一个标题则到全文末尾） */
  end: number;
}

/**
 * 按标题把正文切成一节一节。
 *
 * 用途是「点大纲跳到那一段」和编辑器底部报「共几节」。跟 `outlineOf` 的分工：
 * 那个只给阅读视图摆标题名，这个还要给出**位置**。两者的识别规则必须一样
 * （都只认 ATX、都跳过围栏代码块），否则会出现「目录里有、点了没反应」。
 */
export function splitSections(src: string): Section[] {
  if (!src) return [];
  const out: Section[] = [];
  const rows = src.replace(/\r\n?/g, '\n').split('\n');
  let offset = 0;
  let fenced = false;
  for (let i = 0; i < rows.length; i++) {
    const line = rows[i];
    const lineStart = offset;
    offset += line.length + (i < rows.length - 1 ? 1 : 0);

    if (/^\s*(```|~~~)/.test(line)) {
      fenced = !fenced;
      continue;
    }
    if (fenced) continue;
    const m = line.match(/^(#{1,6})\s+(.+?)\s*#*\s*$/);
    if (!m) continue;
    const text = stripInline(m[2]);
    if (!text) continue;
    if (out.length) out[out.length - 1].end = lineStart;
    out.push({ level: m[1].length, text, line: i, start: lineStart, end: src.length });
  }
  return out;
}

export interface TextStats {
  /** 与 `common.charCount` 同一个口径：就是正文字符数 */
  chars: number;
  lines: number;
  sections: number;
  /** `[[内链]]` 条数 */
  links: number;
  /** `[文字](链接)` 条数 */
  urls: number;
}

export function statsOf(src: string): TextStats {
  const links = src.match(/\[\[[^\]\n]+?\]\]/g)?.length ?? 0;
  const urls = src.match(/\[[^\]\n]*?\]\([^)\s]+\)/g)?.length ?? 0;
  return {
    chars: src.length,
    lines: src ? src.replace(/\r\n?/g, '\n').split('\n').length : 0,
    sections: splitSections(src).length,
    links,
    urls,
  };
}
