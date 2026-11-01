/**
 * 资料库（DocsPage）页面的文案。
 * 命名空间约定：`docs.*`
 */
export default {
  /* ---------------- 页面头部 ---------------- */
  'docs.title': '资料库',
  'docs.desc':
    '把散落的旧文档、设定笔记、剧本草稿丢进来。AI 会读完并拆成结构化条目， 你只需要在审查队列里点头或摇头。',
  'docs.noWorld': '请先创建一个世界',

  /* ---------------- 拖放区 ---------------- */
  'docs.drop.busy': '正在解析文件…',
  'docs.drop.idle': '点击选择文件，或把文件拖到这里',
  'docs.drop.formats': '支持 {exts}',
  'docs.drop.privacy': 'Word 与 PDF 在浏览器本地解析，文件不会被上传到任何服务器。',

  /* ---------------- 直接输入 ---------------- */
  'docs.compose.orType': '不想传文件？',
  'docs.compose.open': '直接输入 / 粘贴文本',
  'docs.compose.title': '直接输入文本',
  'docs.compose.nameLabel': '资料名称',
  'docs.compose.namePlaceholder': '给这份资料起个名字（留空则取正文首行）',
  'docs.compose.bodyLabel': '正文',
  'docs.compose.bodyPlaceholder': '在这里粘贴或直接输入文本…',
  'docs.compose.hint': '保存后与上传的文件完全等效，内容只存在你自己的浏览器里。',
  'docs.compose.pasteTip': '也可以直接在本页按 Ctrl+V，把剪贴板里的文本存成资料',
  'docs.compose.save': '保存为资料',
  'docs.compose.warn.empty': '还没有输入任何内容',
  'docs.compose.toast.saved': '已保存「{name}」',
  'docs.compose.defaultName': '在线文稿',

  /* ---------------- 抽取设置 ---------------- */
  'docs.field.category': '抽取的条目默认归入分类',
  'docs.hint.extract':
    'AI 抽取时会与已有条目比对，已存在的不会被重复抽取；不确定的内容会标注为待核对。',

  /* ---------------- 资料列表 ---------------- */
  'docs.list.title': '已导入资料（{n}）',
  'docs.empty.title': '还没有资料',
  'docs.empty.desc': '导入一份旧设定文档，体验 AI 自动成条目的过程。',
  'docs.meta.importedAt': '导入于 {time}',
  'docs.meta.parsed': ' ｜ 已抽取过',
  'docs.btn.viewText': '查看文本',
  'docs.btn.extract': '抽取条目',
  'docs.confirm.delete': '删除资料「{name}」？',
  'docs.toast.deleted': '已删除',

  /* ---------------- toast ---------------- */
  'docs.toast.noText': '{name}：没有读出任何文字内容',
  'docs.toast.fileWarning': '{name}：{warning}',
  'docs.toast.parseFailed': '{name} 解析失败：{msg}',
  'docs.toast.imported': '已导入 {n} 份资料',
  'docs.toast.needCategory': '请先创建一个分类，AI 需要知道把条目放进哪里',
  'docs.toast.noExtract': '这份资料里没有抽取出可入库的条目',
  'docs.toast.extracted': '抽取到 {n} 个候选条目',
  'docs.toast.queued': '已把 {n} 条送入审查队列',
  'docs.chunk.name': '{name}（第 {i}/{total} 部分）',

  /* ---------------- 抽取结果 ---------------- */
  'docs.result.title': '抽取结果',
  'docs.result.count': '{n} 个候选条目',
  'docs.result.deselectAll': '全不选',
  'docs.result.push': '送入审查队列（{n}）',
  'docs.result.skipped': '跳过的内容：',

  /* ---------------- 文本预览弹窗 ---------------- */
  'docs.preview.truncated': '\n\n…（仅显示前 30000 字）',
} as const;
