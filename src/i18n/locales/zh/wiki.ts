/**
 * Wiki —— 「这个世界里有什么」的三种看法。
 *
 * 命名空间约定：`wiki.*`；二级为区域（tab / nav / read / sort / empty）。
 *
 * 这一页是「条目库」和「杂物间」并过来的：读在 `display`、改在 `entries`、
 * 杂物在 `pieces`。所以这里的页签名与 `entries.*` / `pieces.*` 里的措辞要能对上，
 * 别一个叫「编辑」另一个叫「整理」—— 作者会以为那是两个地方。
 */
export default {
  'wiki.title': 'Wiki',
  'wiki.desc':
    '这个世界的知识库：左边按分类列着所有条目，右边摊开正文。点一条换一篇，正文里的链接点一下就顺着读下去 —— 想改再进「编辑」。',
  'wiki.noWorld': '请先创建一个世界',

  /* ---------------- 三个子页 ---------------- */
  'wiki.tab.display': '阅读',
  'wiki.tab.entries': '编辑',
  'wiki.tab.pieces': '杂物间',
  'wiki.tab.displayHint': '像读百科那样翻这个世界',
  'wiki.tab.entriesHint': '原来的条目库：新建条目与分类、改字段、批量打磨',
  'wiki.tab.piecesHint': '碎片、随记与图片音视频',

  /* ---------------- 目录（左栏）：筛选与排序 ---------------- */
  'wiki.search.placeholder': '搜索标题、别名、标签、正文…',
  'wiki.sort.label': '排序',
  'wiki.sort.updated': '最近更新',
  'wiki.sort.title': '按名字',
  'wiki.sort.links': '关联最多',
  'wiki.count': '共 {n} 条',
  'wiki.nav.empty': '没有符合条件的条目',

  /* ---------------- 空状态 ---------------- */
  'wiki.empty.noMatch': '没有匹配的条目',
  'wiki.empty.noMatchDesc': '换个关键词试试，或者清空搜索框。',
  'wiki.empty.none': '这个世界还没有条目',
  'wiki.empty.noneDesc': '先建一个分类，再往里写条目 —— 这里就是它们的知识库。',
  'wiki.empty.goEdit': '去建条目',

  /* ---------------- 阅读 ---------------- */
  'wiki.read.back': '返回',
  'wiki.read.edit': '编辑这条',
  'wiki.read.noContent': '这条还没有正文。',
  'wiki.read.outline': '本文目录',
  'wiki.read.related': '关联条目（{n}）',
  'wiki.read.this': '本条目',
  'wiki.read.mutual': '互相',
  'wiki.read.mutualSep': ' ⇄ ',
  'wiki.read.fields': '字段',
  'wiki.read.sources': '来源资料（{n}）',
  'wiki.read.meta': '关于这条',
  'wiki.read.updated': '更新于 {time}',
  'wiki.read.linkMissing': '没有叫「{name}」的条目 —— 这条内链指向的条目还没建',
};
