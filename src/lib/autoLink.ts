import type { Entry } from '../types';

/**
 * 把文本里出现的条目标题/别名自动包成 `[[标题]]` 内链，让作者在对话里
 * 点一下就能预览条目。
 *
 * 为什么需要这层兜底：系统提示词已经要求 agent 提到条目时用 `[[标题]]`，
 * 但模型不一定每次都听话 —— 它可能直接写「张三是李四的师父」而不带括号。
 * 这里扫一遍正文，把能对上号的标题补成链接，保证「说到就能点」。
 *
 * 设计要点：
 *   · **保护代码块/行内代码/已有 `[[...]]`/图片/外链**：这些地方的文字不该被改，
 *     先用占位符替掉，处理完再换回来。
 *   · **长标题优先**：库里同时有「张三」和「张三丰」时，先匹配「张三丰」，
 *     不然「张三丰」会被切成「[[张三]]丰」。靠正则 alternation 的先后顺序保证。
 *   · **别名显示别名、链向标题**：正文写的是别名「老张」，链接要指向「张三」，
 *     所以输出 `[[张三|老张]]`。
 *   · **只认长度 ≥ 2 的名字**：单字标题（比如「风」「火」）到处都是，硬链会把
 *     正文切成碎片，反而读不了。
 */

/** 转义正则里的特殊字符 */
function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

export function autoLinkEntries(text: string, entries: Entry[]): string {
  if (!text || !entries.length) return text;

  // 收集所有可匹配的名字：标题 + 别名。value 是对应的规范标题（链向它）。
  const names: { label: string; title: string }[] = [];
  const seen = new Set<string>();
  for (const e of entries) {
    if (e.title.length >= 2 && !seen.has(e.title)) {
      names.push({ label: e.title, title: e.title });
      seen.add(e.title);
    }
    for (const a of e.aliases) {
      if (a.length >= 2 && !seen.has(a)) {
        names.push({ label: a, title: e.title });
        seen.add(a);
      }
    }
  }
  if (!names.length) return text;

  // 长的先匹配，避免短标题吃掉长标题的前缀
  names.sort((a, b) => b.label.length - a.label.length);

  // ---- 1. 保护不该被改写的片段 ----
  const protectedSegments: string[] = [];
  const protect = (m: string) => {
    protectedSegments.push(m);
    return `\u0000P${protectedSegments.length - 1}\u0000`;
  };
  let s = text
    // 代码块 ```...```
    .replace(/```[\s\S]*?```/g, protect)
    // 行内代码 `...`
    .replace(/`[^`]+`/g, protect)
    // 已有内链 [[...]]
    .replace(/\[\[[^\]]+\]\]/g, protect)
    // 图片 ![...](...)
    .replace(/!\[[^\]]*\]\([^)]*\)/g, protect)
    // 外链 [...](url)
    .replace(/\[[^\]]+\]\([^)]*\)/g, protect);

  // ---- 2. 在纯文本区域匹配标题 ----
  const pattern = new RegExp(names.map((n) => escapeRegExp(n.label)).join('|'), 'g');
  const labelToTitle = new Map(names.map((n) => [n.label, n.title]));
  s = s.replace(pattern, (matched) => {
    const title = labelToTitle.get(matched);
    if (!title) return matched;
    // 写的是别名 → 用 [[标题|别名]] 让链接指向标题、显示的还是作者写的那个词
    return matched === title ? `[[${title}]]` : `[[${title}|${matched}]]`;
  });

  // ---- 3. 还原被保护的片段 ----
  s = s.replace(/\u0000P(\d+)\u0000/g, (_m, i) => protectedSegments[Number(i)] ?? '');

  return s;
}
