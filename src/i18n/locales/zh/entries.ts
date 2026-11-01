/**
 * 条目库页面与条目编辑器的文案。
 * 命名空间约定：`entries.*`
 */
export default {
  /* ---------------- 页面头部 ---------------- */
  'entries.title': '条目库',
  'entries.desc':
    '世界观的最小单元。每个条目是一页：人物、地点、势力、事件、体系都可以。用',
  'entries.linkSyntax': '[[条目名]]',
  'entries.descTail': '在正文里互相引用。',
  'entries.noWorld': '请先创建一个世界',

  /* ---------------- 按钮 ---------------- */
  'entries.btn.newCategory': '新建分类',
  'entries.btn.newEntry': '新建条目',
  'entries.btn.saveChanges': '保存修改',

  /* ---------------- 分类导航 ---------------- */
  'entries.cat.all': '全部条目',
  'entries.cat.emptyHint': '还没有分类，先建一个「人物」试试。',
  'entries.catModal.edit': '编辑分类',
  'entries.catModal.new': '新建分类',
  'entries.catModal.delete': '删除分类',

  /* ---------------- 占位符 ---------------- */
  'entries.placeholder.search': '搜索标题、别名、标签、正文…',
  'entries.placeholder.categoryName': '例：地理 / 人物 / 势力 / 历史 / 力量体系',
  'entries.placeholder.fieldDefs': '例：年龄、阵营、所在地',
  'entries.placeholder.aliases': '例：灰袍、教团',
  'entries.placeholder.tags': '例：关键人物、谜团',
  'entries.placeholder.summary': '供 AI 快速理解这条设定，也会出现在列表和导出里',
  'entries.placeholder.aiInstruction': '例如：补充它与其他势力的历史纠葛，并统一纪年说法',
  'entries.placeholder.newField': '新增自定义字段名，例如：军事实力',
  'entries.placeholder.selectEntry': '选择条目…',

  /* ---------------- 空状态 ---------------- */
  'entries.empty.noMatch': '没有匹配的条目',
  'entries.empty.noMatchDesc': '换个关键词试试，或者清空搜索框。',
  'entries.empty.categoryEmpty': '这个分类还是空的',
  'entries.empty.categoryEmptyDesc':
    '可以手动新建条目，也可以去 AI 工作台让 AI 批量生成候选设定。',

  /* ---------------- 列表条目 ---------------- */
  'entries.row.alias': '又名 {names}',
  'entries.row.relCount': '关联 {n}',
  'entries.row.sources': '资料来源',
  'entries.row.polish': 'AI 打磨',
  'entries.row.polishHint': '排进右下角的任务队列，挨个来做 —— 连点好几条会一起排队',

  /* ---------------- 单条打磨（走任务队列） ----------------
   * 与批量打磨同一套提示词，区别只在「一次几条」：点一下排一件，点五下排五件。
   * 队列是通用设施，它不认识「打磨」，所以名字与回执由这里给。 */
  'entries.polish.group': '条目打磨',
  'entries.polish.label': '打磨《{title}》',
  'entries.polish.queued': '已排上 {n} 件，按顺序一件件做',
  'entries.polish.exists': '这条已经在队列里了',
  'entries.polish.waiting': '这条已经有待审的修订了 —— 先把手上那份处理掉再来',
  'entries.polish.note': '已送审 {n} 条修订',
  'entries.polish.nothing': '看过了，这条没什么可改',
  'entries.uncategorized': '未分类',
  'entries.count': '共 {n} 条',

  /* ---------------- 弹窗 ---------------- */
  'entries.modal.chooseCategory': '选择要放入的分类：',
  'entries.modal.noCategory': '还没有分类，请先在左侧创建分类。',

  /* ---------------- 提示（toast） ---------------- */
  'entries.toast.needCategory': '请先创建一个分类',
  'entries.toast.categorySaved': '分类已保存',
  'entries.toast.categoryDeleted': '分类已删除',
  'entries.toast.deleted': '已删除',
  'entries.toast.relationCreated': '关联已建立',
  'entries.toast.aiQueued': 'AI 修订建议已进入审查队列，去那里逐字段确认。',

  /* ---------------- 批量打磨 ---------------- */
  'entries.btn.batch': '批量打磨',
  'entries.btn.batchOn': '退出批量',
  'entries.batch.desc':
    '勾一批、选好着力点，点「加入队列」—— 它们会排进右下角的任务队列，一件接一件地打磨，改好的修订自动送进审查队列；采纳与否仍然由你定，它不会直接改库。',
  'entries.batch.selected': '已选 {n} 条',
  'entries.batch.selectAll': '全选这 {n} 条',
  'entries.batch.clear': '清空选择',
  'entries.batch.smart': '挑出待打磨的',
  'entries.batch.smartDone': '挑出 {n} 条值得打磨的',
  'entries.batch.smartNone': '这批条目看起来都挺完整，没挑出需要打磨的。',
  'entries.batch.focus': '打磨着力点',
  'entries.batch.focusHint': '一个都不选也行 —— 那样 AI 只做必要的顺句与纠错，尽量少动',
  'entries.batch.focus.detail': '补全细节',
  'entries.batch.focus.style': '统一文风',
  'entries.batch.focus.trim': '精简去水',
  'entries.batch.focus.links': '补关联',
  'entries.batch.focus.conflict': '核对冲突',
  'entries.batch.instruction': '额外要求（可选）',
  'entries.batch.instructionPlaceholder': '例如：纪年统一用「涨潮纪」，不要再出现「潮历」',
  'entries.batch.cost':
    '会依次调用 {n} 次模型，一件接一件；排上之后可以切到别的页面，右下角的队列会接着做。',
  'entries.batch.enqueue': '加入队列（{n} 条）',
  'entries.batch.enqueued': '已排上 {n} 件，右下角的队列会一件件做 —— 可以切到别的页面等',
  'entries.batch.allQueued': '这批条目都已经在队列里了',
  'entries.batch.queueLive':
    '本批 {n} 件：正在做 {running} 件、还排着 {queued} 件 · 已送审 {sent} 条',
  'entries.batch.queueSettled': '本批 {n} 件都跑完了：{done} 件做完 · 共送审 {sent} 条',
  'entries.batch.queueSettledFailed':
    '本批 {n} 件都跑完了：{done} 件做完、{failed} 件没做成 · 共送审 {sent} 条',
  'entries.batch.stopBatch': '停掉这一批',
  'entries.batch.heldBack': '{n} 条已有待审的修订，这次先跳过',
  'entries.batch.goReview': '去审查',
  'entries.batch.dismiss': '收起',
  'entries.batch.pickFirst': '先勾选要打磨的条目',
  'entries.batch.reason.short': '正文偏短',
  'entries.batch.reason.noSummary': '缺概述',
  'entries.batch.reason.noTags': '缺标签',
  'entries.batch.reason.noRelation': '无关联',
  'entries.batch.reason.draft': '还是草稿',

  /* ---------------- 确认框 ---------------- */
  'entries.confirm.deleteCategory': '删除分类「{name}」？其下 {n} 个条目也会一并删除。',
  'entries.confirm.deleteEntry': '删除条目「{title}」？相关关系也会一并删除。',

  /* ---------------- 默认值（会写入数据库） ---------------- */
  'entries.default.newEntryTitle': '新条目',
  'entries.default.untitled': '未命名条目',

  /* ---------------- 字段标签 ---------------- */
  'entries.field.categoryName': '分类名称',
  'entries.field.icon': '图标',
  'entries.field.fieldDefs': '结构化字段（逗号分隔，可留空）',
  'entries.field.fieldDefsHint':
    '定义后，该分类的条目会出现对应的填空框，方便结构化检索与 AI 引用。',
  'entries.field.title': '标题',
  'entries.field.category': '分类',
  'entries.field.status': '状态',
  'entries.field.aliases': '别名（逗号分隔，用于检索与一致性检查）',
  'entries.field.tags': '标签（逗号分隔）',
  'entries.field.summary': '一句话概述',
  'entries.field.relType': '关系类型',
  'entries.field.note': '说明',

  /* ---------------- 编辑器标签页 ---------------- */
  'entries.tab.content': '正文',
  'entries.tab.fields': '结构化字段',
  'entries.tab.fieldsCount': '结构化字段 ({n})',
  'entries.tab.relationsCount': '关联 ({n})',

  /* ---------------- 编辑器 ---------------- */
  'entries.editor.missing': '条目不存在',
  'entries.editor.missingDesc': '这条记录可能已被删除。',
  'entries.editor.noContent': '*（还没有正文）*',
  'entries.editor.id': 'ID：{id}',
  'entries.editor.statusLabel': '状态：',
  'entries.editor.sources': '来源资料：{n} 份',

  /* ---------------- AI 打磨 ---------------- */
  'entries.ai.title': '让 AI 打磨这条设定',
  'entries.ai.generate': '生成修订建议',
  'entries.ai.hint':
    'AI 不会直接改你的条目——它会生成一份修订建议进入审查队列，由你逐字段决定是否采纳。',

  /* ---------------- 结构化字段编辑 ---------------- */
  'entries.fieldEditor.empty':
    '该分类还没有定义字段。可以在下方添加自定义字段，例如「年龄」「首都」。',
  'entries.fieldEditor.removeCustom': '移除自定义字段',
  'entries.fieldEditor.add': '添加字段',

  /* ---------------- 关联 ---------------- */
  'entries.rel.empty': '还没有关联。可以在下方手动添加，或到图谱页让 AI 批量推荐。',
  'entries.rel.outgoing': '指向',
  'entries.rel.incoming': '来自',
  'entries.rel.mutual': '互相',
  'entries.rel.mutualSep': ' ⇄ ',
  'entries.rel.deleted': '（已删除）',
  'entries.rel.delete': '删除关系',
  'entries.rel.to': '关联到',
  'entries.rel.create': '建立关联',

  /* ---------------- 关系类型 ---------------- */
} as const;
