/**
 * 杂物间：条目库之外的一切（文字类杂物与媒体文件）。
 * 命名空间约定：`pieces.*`；二级为区域（list / editor / media / filter）。
 */
export default {
  'pieces.title': '杂物间',
  'pieces.desc':
    '条目的正文收的是「设定」，这里收的是设定之外的一切：长文短文、碎片念头、对某个事物的描述、个人剧情，还有图片、音频、视频。文字类杂物会自动成为「世界问答」的参考素材。',

  /* ---------------- 列表 ---------------- */
  'pieces.list.noWorld': '请先创建一个世界',
  'pieces.list.btn.upload': '传图片/音频/视频',
  'pieces.list.btn.new': '记一篇',
  'pieces.list.quick.placeholder': '随手记一句——一个念头、一段对话、半句设定，回车就存',
  'pieces.list.quick.btn': '存下',
  'pieces.list.quick.saved': '已收进杂物间',
  'pieces.list.upload.done': '已收入 {n} 件杂物，点击可补充说明',
  'pieces.list.search.placeholder': '搜索标题/正文/标签',
  'pieces.list.empty.title': '杂物间还是空的',
  'pieces.list.empty.desc':
    '什么都收：旧文、碎句、人物小传、参考图、一段配乐。它们不需要完整，先扔进来就好。',
  'pieces.list.pinned': '已置顶',
  'pieces.list.btn.pin': '置顶',
  'pieces.list.btn.unpin': '取消置顶',
  'pieces.list.confirm.delete': '删除「{title}」？媒体文件会一并删除。',
  'pieces.list.toast.deleted': '已删除',
  'pieces.list.meta.createdAt': '收于 {time}',
  'pieces.list.noContent': '（没有正文，点「编辑」补一段）',
  'pieces.list.linked': '相关条目',

  /* ---------------- 媒体 ---------------- */
  'pieces.media.loading': '媒体加载中…',
  'pieces.media.download': '⬇ 下载 {name}（{size}）',
  'pieces.media.drop.idle': '图片 / 音频 / 视频可以直接拖到这里',
  'pieces.media.drop.active': '松手，把这些杂物收进来',
  'pieces.media.attach': '附件：{name}（{size}），说明写在下面。',

  /* ---------------- 筛选 ---------------- */
  'pieces.filter.all': '全部 {n}',

  /* ---------------- 编辑器 ---------------- */
  'pieces.editor.title.new': '记一篇',
  'pieces.editor.title.edit': '编辑藏品',
  'pieces.editor.warn.empty': '总得写点什么，或者先取消',
  'pieces.editor.untitled': '未命名藏品',
  'pieces.editor.label.kind': '类型',
  'pieces.editor.kind.mediaNote': '（媒体藏品，类型由文件决定）',
  'pieces.editor.label.title': '标题',
  'pieces.editor.placeholder.title': '（可不填，默认取正文第一句）',
  'pieces.editor.label.content': '正文（支持 Markdown）',
  'pieces.editor.placeholder.content': '写什么都行——这是你的杂物间，没有人审查。',
  'pieces.editor.label.note': '备注 / 说明',
  'pieces.editor.placeholder.note': '这段媒体是什么？给未来的自己和 AI 一句话说明。',
  'pieces.editor.label.tags': '标签（逗号分隔）',
  'pieces.editor.placeholder.tags': '如：灵感, 未用上, 北境',
  'pieces.editor.label.linked': '相关条目（这条杂物讲的是谁，可选）',
  'pieces.editor.placeholder.entrySearch': '搜索条目…',
  'pieces.editor.empty.entries': '（这个世界还没有条目）',
} as const;
