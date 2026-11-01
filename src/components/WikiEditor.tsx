import React, { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { useT } from '../i18n';
import type { MsgKey } from '../i18n';
import { MediaPicker } from './MediaPicker';
import {
  applyEdit,
  completeLink,
  continueList,
  highlightMarkdown,
  indentSelection,
  linkQueryAt,
  matchLinkTargets,
  PREFIX_MARK,
  splitSections,
  statsOf,
  tableSnippet,
  type EditResult,
  type EditSpec,
} from '../lib/wikitext';

/*
 * 正文编辑器。
 *
 * 目标是「像真 wiki 那样自由地写」，所以它不是把 `<textarea>` 换个皮，而是补上
 * 真 wiki 编辑区必备的四件事：**工具栏**（点了就在光标处套语法）、**语法上色**
 * （一眼看出哪段是链接、哪段是标题）、**内链自动补全**（打 `[[` 弹条目候选）、
 * **章节跳转**（长条目不用滚）。
 *
 * 两个关键实现选择，都会直接影响中文作者的手感：
 *
 * ① 底色仍然是**真的 `<textarea>`**，不是 contenteditable。
 *    换成 contenteditable 会把输入法、原生撤销栈（Ctrl+Z）、选区、拖拽选词、
 *    无障碍全丢掉 —— 中文输入法尤其容易炸。高亮只是盖在底下的一层彩色副本。
 *
 * ② 输入法组字期间**必须把高亮层藏起来**，把文字颜色还回去。
 *    平时文textarea 的文字是透明的（真文字由底下那层画），可组字中那串还没上屏的
 *    拼音/候选是浏览器直接画在 textarea 里的 —— 透明就等于「打字的时候看不见」。
 *    所以 compositionstart 时恢复文字颜色、隐藏色层，组字一结束再切回去。
 *    两层字体度量完全一致，切换时不会有任何跳动。
 */

export interface LinkTarget {
  id: string;
  title: string;
  aliases?: string[];
}

interface Props {
  value: string;
  onChange: (v: string) => void;
  /** 内链候选：当前世界里的条目 */
  linkTargets: LinkTarget[];
  /** 当前条目自己 —— 从候选里排掉，不该链到自己 */
  selfId?: string;
  minHeight?: number;
  autoFocus?: boolean;
}

/* ---------------------------- 工具栏图标 ---------------------------- */
/* 只写用得上的几个：列表、表格这类没有通用图标，用别处的只会更含糊 */

const g = { width: 15, height: 15, viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', strokeWidth: 1.8, strokeLinecap: 'round' as const, strokeLinejoin: 'round' as const };

const IcUl = () => (
  <svg {...g}>
    <path d="M9 6h11M9 12h11M9 18h11" />
    <circle cx="4.5" cy="6" r="1.2" fill="currentColor" stroke="none" />
    <circle cx="4.5" cy="12" r="1.2" fill="currentColor" stroke="none" />
    <circle cx="4.5" cy="18" r="1.2" fill="currentColor" stroke="none" />
  </svg>
);
const IcOl = () => (
  <svg {...g}>
    <path d="M10 6h10M10 12h10M10 18h10" />
    <path d="M4 4.6h1v3.2M3.6 11h1.8l-1.8 2.4h1.8M3.6 16.6h1.8v1.5H3.6v1.5h1.8" />
  </svg>
);
const IcQuote = () => (
  <svg {...g}>
    <path d="M4 5v14" />
    <path d="M9 8h11M9 12h11M9 16h7" />
  </svg>
);
const IcCodeBlock = () => (
  <svg {...g}>
    <rect x="3" y="4" width="18" height="16" rx="2" />
    <path d="M9.5 10l-2 2 2 2M14.5 10l2 2-2 2" />
  </svg>
);
const IcHr = () => (
  <svg {...g}>
    <path d="M4 12h16" />
    <path d="M7 7h10M7 17h10" opacity="0.35" />
  </svg>
);
const IcTable = () => (
  <svg {...g}>
    <rect x="3" y="4.5" width="18" height="15" rx="2" />
    <path d="M3 9.5h18M9.5 9.5V19.5M3 14.5h18" />
  </svg>
);
/* 媒体：一张图 + 底下的播放小点 —— 插的不只是图片，音频视频同走这一条语法 */
const IcMedia = () => (
  <svg {...g}>
    <rect x="3" y="5" width="18" height="14" rx="2" />
    <path d="M3 15.5l4.5-4.5 3.5 3.5 3-3 6 6" />
    <circle cx="9" cy="9" r="1.3" />
  </svg>
);

/* ---------------------------- 工具栏定义 ---------------------------- */

interface ToolDef {
  /** 同时用作 `data-role="wxe-tool-<key>"` 与文案后缀 */
  key: string;
  content: React.ReactNode;
  spec: EditSpec;
}

/**
 * 一个工具按钮要干的活。
 *
 * 只放**点了立刻有东西**的按钮 —— 工具栏上摆一个「暂时用不了」的按钮，
 * 比不摆更糟：作者会以为是自己点错了地方。
 */
function useTools(): { text: ToolDef[]; heading: ToolDef[]; link: ToolDef[]; block: ToolDef[] } {
  const t = useT();
  return useMemo(
    () => ({
      text: [
        { key: 'bold', content: <b>B</b>, spec: { kind: 'wrap', before: '**', after: '**', placeholder: t('editor.ph.bold') } },
        { key: 'italic', content: <i>I</i>, spec: { kind: 'wrap', before: '*', after: '*', placeholder: t('editor.ph.italic') } },
        { key: 'strike', content: <s>S</s>, spec: { kind: 'wrap', before: '~~', after: '~~', placeholder: t('editor.ph.strike') } },
        { key: 'code', content: <span className="wxe-mono">{'<>'}</span>, spec: { kind: 'wrap', before: '`', after: '`', placeholder: t('editor.ph.code') } },
      ],
      heading: [
        { key: 'h1', content: <span className="wxe-mono">H1</span>, spec: { kind: 'prefix', prefix: '# ', mark: PREFIX_MARK.heading } },
        { key: 'h2', content: <span className="wxe-mono">H2</span>, spec: { kind: 'prefix', prefix: '## ', mark: PREFIX_MARK.heading } },
        { key: 'h3', content: <span className="wxe-mono">H3</span>, spec: { kind: 'prefix', prefix: '### ', mark: PREFIX_MARK.heading } },
        // 「正文」= 把标题降回普通段落。少了这个，作者加错标题级别就得手工删井号
        { key: 'plain', content: <span className="wxe-mono">¶</span>, spec: { kind: 'prefix', prefix: '', mark: PREFIX_MARK.heading } },
      ],
      link: [
        { key: 'wikilink', content: <span className="wxe-mono">[[ ]]</span>, spec: { kind: 'wrap', before: '[[', after: ']]', placeholder: t('editor.ph.link') } },
        { key: 'link', content: <span className="wxe-mono">a↗</span>, spec: { kind: 'wrap', before: '[', after: `](${t('editor.ph.url')})`, placeholder: t('editor.ph.linkText') } },
        { key: 'image', content: <span className="wxe-mono">▣</span>, spec: { kind: 'wrap', before: '![', after: `](${t('editor.ph.url')})`, placeholder: t('editor.ph.imageAlt') } },
      ],
      block: [
        { key: 'ul', content: <IcUl />, spec: { kind: 'prefix', prefix: '- ', mark: PREFIX_MARK.list } },
        { key: 'ol', content: <IcOl />, spec: { kind: 'prefix', prefix: '1. ', mark: PREFIX_MARK.list } },
        { key: 'quote', content: <IcQuote />, spec: { kind: 'prefix', prefix: '> ', mark: PREFIX_MARK.quote } },
        { key: 'codeblock', content: <IcCodeBlock />, spec: { kind: 'insert', text: `\`\`\`\n${t('editor.ph.code')}\n\`\`\``, caretOffset: 4 } },
        { key: 'hr', content: <IcHr />, spec: { kind: 'insert', text: '---' } },
      ],
    }),
    [t],
  );
}

/* ---------------------------- 主体 ---------------------------- */

export function WikiEditor({ value, onChange, linkTargets, selfId, minHeight = 320, autoFocus }: Props) {
  const t = useT();
  const taRef = useRef<HTMLTextAreaElement>(null);
  const layerRef = useRef<HTMLDivElement>(null);
  const suggestRef = useRef<HTMLDivElement>(null);
  /**
   * 这次编辑之后光标该停在哪。
   *
   * 不能直接 `setSelectionRange` —— 那一刻 `value` 还是旧的，DOM 里的文本也没换，
   * 选区的坐标对不上新文本。得等父级把新值渲染下来（见下面那个 `useLayoutEffect`）。
   */
  const pendingSel = useRef<[number, number] | null>(null);

  const [composing, setComposing] = useState(false);
  const [pop, setPop] = useState<'table' | 'sections' | 'help' | null>(null);
  /* 媒体选择器：插入 ![说明](asset:ID)。不并进 pop —— 那几个是工具栏里的小浮层，
     媒体选择器是一整只对话框（Modal），层级与生命周期都不一样 */
  const [mediaOpen, setMediaOpen] = useState(false);
  const [tableRows, setTableRows] = useState(3);
  const [tableCols, setTableCols] = useState(3);
  const [suggest, setSuggest] = useState<{ start: number; prefix: string; ids: string[]; index: number } | null>(null);
  /*
   * 候选面板钉在编辑区**左下角**，不追着光标跑。
   *
   * 追光标得先量出光标的像素坐标：行位置能从副本那层拿（`[data-line]` 的 offsetTop），
   * 但同一行里第几个字的横坐标只能靠 canvas measureText 估 —— 而且 `onChange` 触发时
   * 副本那层还停在上一版文本上，量出来总是慢一帧，打字时会一跳一跳。
   * 摆在一个固定位置则完全没有这回事，代价只是离光标远一点。
   */

  const tools = useTools();
  const segs = useMemo(() => highlightMarkdown(value), [value]);
  const sections = useMemo(() => splitSections(value), [value]);
  const stats = useMemo(() => statsOf(value), [value]);

  const candidates = useMemo(
    () => (selfId ? linkTargets.filter((x) => x.id !== selfId) : linkTargets),
    [linkTargets, selfId],
  );

  const readCaret = () => {
    const ta = taRef.current;
    return ta ? { text: ta.value, start: ta.selectionStart, end: ta.selectionEnd } : null;
  };

  /**
   * 按 key 取工具，不按下标。
   *
   * 快捷键（Ctrl+B/I/E/K）与按钮必须是同一个动作 —— 用 `tools.text[0]` 这种写法，
   * 哪天有人把工具栏里两个按钮调个位置，快捷键就会**静默绑到别的工具上**，
   * 而界面上什么都看不出来。
   */
  const specOf = (key: string): EditSpec => {
    const all = [...tools.text, ...tools.heading, ...tools.link, ...tools.block];
    const hit = all.find((d) => d.key === key);
    if (!hit) throw new Error(`未知的工具按钮：${key}`); // i18n-allow（开发者错误）
    return hit.spec;
  };

  /** 把高亮层挪到跟输入框同一个滚动位置 */
  const syncScroll = useCallback(() => {
    const ta = taRef.current;
    const layer = layerRef.current;
    if (!ta || !layer) return;
    layer.style.transform = `translate(${-ta.scrollLeft}px, ${-ta.scrollTop}px)`;
  }, []);

  /**
   * 看看光标是不是停在某个没写完的 `[[` 后面，是就把候选列出来。
   * 一律读 `textarea.value` 而不是闭包里的 `value` —— 键盘事件里那个闭包常常慢一拍。
   */
  const refreshSuggest = useCallback(
    (keepIndex = false) => {
      const c = readCaret();
      const ta = taRef.current;
      if (!c || !ta || document.activeElement !== ta) {
        setSuggest(null);
        return;
      }
      const q = linkQueryAt(c.text, c.start);
      if (!q) {
        setSuggest(null);
        return;
      }
      const items = matchLinkTargets(q.prefix, candidates);
      setSuggest((prev) => {
        /*
         * 一个都没匹配上时，只要作者是在写具体的名字，就把「没有这个条目」明说。
         * 静默什么都不弹会让人以为补全坏了；而这在 wiki 里本来是条**有用**的信息 ——
         * 等于先埋一条待建的链接（阅读页对它也是会说话的，见 wiki.read.linkMissing）。
         * 只有「刚打完 [[，一个字还没写」时才不吭声：那会儿摆一句「没有匹配」纯属噪音。
         */
        if (!items.length && !q.prefix.trim()) return null;
        // 打字过程中尽量把选中项留在原来那个条目上，而不是每敲一个字就跳回第一项
        const keep = keepIndex ? (prev?.ids.findIndex((id) => items.some((x) => x.id === id)) ?? -1) : -1;
        return { start: q.start, prefix: q.prefix, ids: items.map((x) => x.id), index: keep >= 0 ? keep : 0 };
      });
    },
    [candidates],
  );

  /** 编辑之后把新值和光标一起交出去 */
  const commit = (r: EditResult) => {
    pendingSel.current = [r.selStart, r.selEnd];
    setSuggest(null);
    setPop(null);
    onChange(r.value);
  };

  const run = (spec: EditSpec) => {
    const c = readCaret();
    if (!c) return;
    commit(applyEdit(c.text, c.start, c.end, spec));
  };

  useLayoutEffect(() => {
    const ta = taRef.current;
    const sel = pendingSel.current;
    if (!ta) return;
    if (sel) {
      pendingSel.current = null;
      ta.focus({ preventScroll: true });
      ta.setSelectionRange(sel[0], sel[1]);
    }
    syncScroll();
  }, [value, syncScroll]);

  useEffect(() => {
    if (autoFocus) taRef.current?.focus();
  }, [autoFocus]);

  /**
   * 候选一冒头就把它滚进视野。
   *
   * 面板钉在编辑区左下角，而编辑区有 320 高 —— 在弹窗里（它自己也是一层滚动容器）
   * 这个位置常常正好落在**看不见的地方**。作者打 `[[` 会以为「什么都没弹」，
   * 而 DOM 里其实好好的，连断言「元素存在」都抓不住这种。
   *
   * 用 `block: 'nearest'`：已经看得见就一动不动，只有露不出来时才滚最小距离，
   * 于是逐字打字时不会跟输入抢滚动。
   */
  useEffect(() => {
    if (!suggest) return;
    suggestRef.current?.scrollIntoView({ block: 'nearest' });
  }, [suggest]);

  /** 点「章节」跳到正文那一段 —— 靠高亮层量出那一行的位置 */
  const jumpToSection = (line: number) => {
    const ta = taRef.current;
    const layer = layerRef.current;
    if (!ta || !layer) return;
    const sec = sections.find((s) => s.line === line);
    const node =
      layer.querySelector<HTMLElement>(`[data-line="${line}"]`) ??
      layer.querySelector<HTMLElement>(`[data-line="${line - 1}"]`);
    if (node) ta.scrollTop = Math.max(0, node.offsetTop - 56);
    if (sec) {
      ta.focus({ preventScroll: true });
      ta.setSelectionRange(sec.start, sec.start);
      pendingSel.current = null;
    }
    setPop(null);
    syncScroll();
  };

  const acceptSuggest = (id: string | null) => {
    const c = readCaret();
    const state = suggest;
    if (!c || !state) return;
    const target = id ?? state.ids[state.index];
    const item = candidates.find((x) => x.id === target);
    const q = linkQueryAt(c.text, c.start);
    if (!item || !q) return;
    commit(completeLink(c.text, q, item.title));
  };

  const onKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    const mod = e.ctrlKey || e.metaKey;
    const ta = e.currentTarget;

    // 候选面板开着的时候，上下键与回车先给它
    if (suggest) {
      if ((e.key === 'ArrowDown' || e.key === 'ArrowUp') && suggest.ids.length > 1) {
        e.preventDefault();
        const n = suggest.ids.length;
        const next = e.key === 'ArrowDown' ? (suggest.index + 1) % n : (suggest.index - 1 + n) % n;
        setSuggest({ ...suggest, index: next });
        return;
      }
      if ((e.key === 'Enter' || e.key === 'Tab') && suggest.ids.length > 0) {
        e.preventDefault();
        acceptSuggest(null);
        return;
      }
      if (e.key === 'Escape') {
        e.preventDefault();
        setSuggest(null);
        return;
      }
    }

    if (mod && !e.altKey) {
      const k = e.key.toLowerCase();
      const hit = (spec: EditSpec) => {
        e.preventDefault();
        run(spec);
      };
      if (k === 'b') return hit(specOf('bold'));
      if (k === 'i') return hit(specOf('italic'));
      if (k === 'e') return hit(specOf('code'));
      // Ctrl+K 在 wiki 里就是「插链接」——有选中就用选中的字当条目名
      if (k === 'k') {
        const c = readCaret();
        if (c && c.start !== c.end) {
          const picked = c.text.slice(c.start, c.end).trim();
          if (picked) {
            e.preventDefault();
            commit({
              value: `${c.text.slice(0, c.start)}[[${picked}]]${c.text.slice(c.end)}`,
              selStart: c.start + picked.length + 4,
              selEnd: c.start + picked.length + 4,
            });
            return;
          }
        }
        return hit(specOf('wikilink'));
      }
    }

    if (e.key === 'Tab') {
      e.preventDefault();
      commit(indentSelection(ta.value, ta.selectionStart, ta.selectionEnd, e.shiftKey));
      return;
    }

    if (e.key === 'Enter' && !e.shiftKey && !mod) {
      const r = continueList(ta.value, ta.selectionStart);
      if (r) {
        e.preventDefault();
        commit(r);
      }
    }
  };

  const insertTable = () => {
    const labels = Array.from({ length: tableCols }, (_, i) => t('editor.table.col', { n: i + 1 }));
    run({ kind: 'insert', text: tableSnippet(tableRows, tableCols, labels), caretOffset: 2 });
  };

  const toolBtn = (d: ToolDef) => (
    <button
      key={d.key}
      type="button"
      className="wxe-btn"
      data-role={`wxe-tool-${d.key}`}
      title={t(`editor.tool.${d.key}` as MsgKey)}
      aria-label={t(`editor.tool.${d.key}` as MsgKey)}
      // 别抢走输入框的焦点 —— 丢了焦点就丢选区，按钮点了也不知道往哪儿插
      onMouseDown={(e) => e.preventDefault()}
      onClick={() => run(d.spec)}
    >
      {d.content}
    </button>
  );

  return (
    <div className="wxe" data-role="wxe">
      {/* ---------------------------- 工具栏 ---------------------------- */}
      <div className="wxe-bar" data-role="wxe-bar">
        <div className="wxe-grp" data-role="wxe-grp-text">
          {tools.text.map(toolBtn)}
        </div>
        <span className="wxe-sep" />
        <div className="wxe-grp">{tools.heading.map(toolBtn)}</div>
        <span className="wxe-sep" />
        <div className="wxe-grp">
          {tools.link.map(toolBtn)}
          {/*
            媒体：与「插外链图」(▣) 是两件事 —— 那个插的是 `![alt](https://…)`，
            这个从杂物间/上传里挑，插的是 `![标题](asset:ID)`。本地库里的图
            走这一条，文件跟着世界走（备份/导出都带得走）。
          */}
          <button
            type="button"
            className="wxe-btn"
            data-role="wxe-tool-media"
            title={t('editor.tool.media')}
            aria-label={t('editor.tool.media')}
            onMouseDown={(e) => e.preventDefault()}
            onClick={() => setMediaOpen(true)}
          >
            <IcMedia />
          </button>
        </div>
        <span className="wxe-sep" />
        <div className="wxe-grp">
          {tools.block.map(toolBtn)}
          <button
            type="button"
            className="wxe-btn"
            data-role="wxe-tool-table"
            title={t('editor.tool.table')}
            aria-label={t('editor.tool.table')}
            onMouseDown={(e) => e.preventDefault()}
            onClick={() => setPop(pop === 'table' ? null : 'table')}
          >
            <IcTable />
          </button>
        </div>
        <div className="grow" />
        <button
          type="button"
          className={`wxe-btn ${pop === 'sections' ? 'on' : ''}`}
          data-role="wxe-tool-sections"
          title={t('editor.tool.sections')}
          onMouseDown={(e) => e.preventDefault()}
          onClick={() => setPop(pop === 'sections' ? null : 'sections')}
        >
          {t('editor.tool.sections')} <span className="wxe-count">{sections.length}</span>
        </button>
        <button
          type="button"
          className={`wxe-btn ${pop === 'help' ? 'on' : ''}`}
          data-role="wxe-tool-help"
          title={t('editor.tool.help')}
          onMouseDown={(e) => e.preventDefault()}
          onClick={() => setPop(pop === 'help' ? null : 'help')}
        >
          ?
        </button>
      </div>

      {pop === 'sections' && (
        <div className="wxe-pop" data-role="wxe-sections">
          {sections.length === 0 && <div className="wxe-pop-empty">{t('editor.sections.empty')}</div>}
          {sections.map((s, i) => (
            <button
              key={`${s.line}-${i}`}
              type="button"
              className="wxe-sec-item"
              data-role="wxe-section"
              data-line={s.line}
              style={{ paddingLeft: 10 + (s.level - 1) * 12 }}
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => jumpToSection(s.line)}
            >
              {s.text}
            </button>
          ))}
        </div>
      )}

      {pop === 'help' && (
        <div className="wxe-pop" data-role="wxe-help">
          {(['bold', 'italic', 'link', 'tab', 'enter'] as const).map((k) => (
            <div className="wxe-help-row" key={k}>
              <kbd>{t(`editor.help.key.${k}` as MsgKey)}</kbd>
              <span>{t(`editor.help.what.${k}` as MsgKey)}</span>
            </div>
          ))}
          <div className="wxe-help-note">{t('editor.help.note')}</div>
        </div>
      )}

      {pop === 'table' && (
        <div className="wxe-pop" data-role="wxe-table-pop">
          <div className="wxe-pop-title">{t('editor.table.title')}</div>
          <div className="row" style={{ gap: 8 }}>
            <label className="wxe-num">
              <span>{t('editor.table.rows')}</span>
              <input
                className="input"
                type="number"
                min={1}
                max={40}
                value={tableRows}
                data-role="wxe-table-rows"
                onChange={(e) => setTableRows(Math.max(1, Math.min(40, Number(e.target.value) || 1)))}
              />
            </label>
            <label className="wxe-num">
              <span>{t('editor.table.cols')}</span>
              <input
                className="input"
                type="number"
                min={1}
                max={12}
                value={tableCols}
                data-role="wxe-table-cols"
                onChange={(e) => setTableCols(Math.max(1, Math.min(12, Number(e.target.value) || 1)))}
              />
            </label>
          </div>
          <button className="btn primary sm mt12" data-role="wxe-table-insert" onClick={insertTable}>
            {t('editor.table.insert')}
          </button>
        </div>
      )}

      {/* ---------------------------- 编辑区 ---------------------------- */}
      <div className={`wxe-stage ${composing ? 'composing' : ''}`}>
        {/*
          彩色副本：不改字、只上色，文字由上面的输入框提供。
          内层那个 div 同时干两件事：承载滚动位移（transform）、给 span 当 offsetParent
          —— 所以「跳到第几行」量出来的 offsetTop 就是正文字符坐标，不必再换算。
        */}
        <div className="wxe-layer" aria-hidden="true">
          <div className="wxe-font wxe-layer-in" ref={layerRef}>
            {segs.map((s, i) => (
              <span key={i} className={s.cls ?? undefined} data-line={s.line}>
                {s.text}
              </span>
            ))}
          </div>
        </div>
        <textarea
          ref={taRef}
          className="textarea wxe-font wxe-input"
          data-role="wxe-input"
          style={{ minHeight }}
          value={value}
          spellCheck={false}
          placeholder={t('editor.placeholder')}
          onScroll={syncScroll}
          onChange={(e) => {
            pendingSel.current = null;
            onChange(e.target.value);
            // 输入法组字中不要弹候选：那会儿文本还没上屏，前缀算出来是半截
            if (!composing) refreshSuggest(true);
          }}
          onKeyDown={onKeyDown}
          onSelect={() => refreshSuggest()}
          onClick={() => refreshSuggest()}
          onFocus={() => refreshSuggest()}
          onBlur={() => setSuggest(null)}
          onCompositionStart={() => setComposing(true)}
          onCompositionEnd={() => {
            setComposing(false);
            refreshSuggest();
          }}
        />

        {/* ---------------------------- 内链候选 ---------------------------- */}
        {suggest && (suggest.ids.length > 0 || suggest.prefix.trim()) && (
          <div className="wxe-suggest" data-role="wxe-suggest" ref={suggestRef}>
            <div className="wxe-suggest-head">
              {t('editor.suggest.title')}
              {suggest.prefix && <> {t('editor.suggest.for', { q: suggest.prefix })}</>}
            </div>
            {suggest.ids.length === 0 ? (
              <div className="wxe-suggest-none" data-role="wxe-suggest-none">
                {t('editor.suggest.none', { q: suggest.prefix })}
              </div>
            ) : (
              suggest.ids.map((id, i) => {
                const item = candidates.find((x) => x.id === id)!;
                return (
                  <button
                    key={id}
                    type="button"
                    className={`wxe-suggest-item ${i === suggest.index ? 'on' : ''}`}
                    data-role="wxe-suggest-item"
                    data-entry-id={id}
                    // mousedown 而不是 click：click 会先让输入框失焦，候选就先没了
                    onMouseDown={(e) => {
                      e.preventDefault();
                      acceptSuggest(id);
                    }}
                  >
                    <span className="wxe-suggest-title">{item.title}</span>
                    {item.aliases?.length ? (
                      <span className="wxe-suggest-alias">{item.aliases.join(t('common.listSep'))}</span>
                    ) : null}
                  </button>
                );
              })
            )}
            <div className="wxe-suggest-foot">{t('editor.suggest.hint')}</div>
          </div>
        )}
      </div>

      {/* ---------------------------- 状态条 ---------------------------- */}
      <div className="wxe-foot" data-role="wxe-stats">
        <span>{t('editor.stats.chars', { n: stats.chars })}</span>
        <span className="wxe-dot" />
        <span>{t('editor.stats.sections', { n: stats.sections })}</span>
        <span className="wxe-dot" />
        <span>{t('editor.stats.links', { n: stats.links })}</span>
        {stats.urls > 0 && (
          <>
            <span className="wxe-dot" />
            <span>{t('editor.stats.urls', { n: stats.urls })}</span>
          </>
        )}
        <div className="grow" />
        <span className="wxe-hint">{t('editor.footHint')}</span>
      </div>

      {/* 媒体选择器：挑中即插入 `![标题](asset:ID)`，光标落在整段末尾 */}
      {mediaOpen && (
        <MediaPicker
          entryId={selfId}
          onClose={() => setMediaOpen(false)}
          onPick={(p) =>
            run({ kind: 'insert', text: `![${p.title}](asset:${p.id})`, caretOffset: 0 })
          }
        />
      )}
    </div>
  );
}
