/**
 * 操作日志页（src/pages/ActivityLogPage.tsx）。
 *
 * 库里存的是结构化事实（谁、对哪种东西、做什么、对象叫什么），
 * 这里按当前语言把它们拼成人话 —— 所以切换语言后历史记录也跟着换语言。
 *
 * 命名空间约定：`log.*`
 */
export default {
  /* ---------------- 页面头部 ---------------- */
  'log.title': '操作日志',
  'log.desc':
    '库里每一次写入都会留下一条记录，不管是你在别处点的，还是 AI 工作台替你做的。每一步都带撤销快照。',
  'log.noWorld': '请先创建一个世界',

  /* ---------------- 空态 ---------------- */
  'log.empty': '还没有任何操作',
  'log.emptyDesc': '等你或 AI 工作台动过数据之后，这里会一条条记下来。',

  /* ---------------- 一条记录的说法 ---------------- */
  'log.action.create': '新建',
  'log.action.update': '修改',
  'log.action.delete': '删除',
  'log.action.note': '记录',
  'log.action.view': '打开',
  /** agent 只提议、不落地：条目要等作者在审查页采纳 */
  'log.action.propose': '提议新增',
  'log.actor.user': '我',
  'log.actor.agent': 'AI',
  'log.entity.world': '世界',
  'log.entity.category': '分类',
  'log.entity.entry': '条目',
  'log.entity.relation': '关系',
  'log.entity.doc': '资料',
  'log.entity.piece': '藏品',
  'log.entity.note': '记录',
  'log.entity.settings': '设置',
  /** 「{actor}{action}了{entity}「{target}」」 */
  'log.line': '{actor}{action}了{entity}',
  'log.lineWithTarget': '{actor}{action}了{entity}「{target}」',
  /** 纯记录型：没有对象名，用正文 */
  'log.noteLine': '{actor}记下了：{detail}',
  'log.global': '全局',

  /* ---------------- 元信息 ---------------- */
  'log.fields': '改动字段：{fields}',
  /** agent 当时给的理由（存在 detail 里），日志里也让人看见 —— 否则只能看到一个结论 */
  'log.detail': '理由：{detail}',
  'log.count': '共 {n} 条',
  'log.undone': '已撤销',
  'log.undoneHint': '这一步已经退回去了',

  /* ---------------- 撤销 ---------------- */
  'log.undo': '撤销',
  'log.undoTip': '把这一步原样退回去',
  'log.undone.toast': '已撤销：{what}',
  'log.undoUnavailable': '这一步没有可用的撤销信息',
  'log.undoFailed': '撤销失败：{message}',

  /* ---------------- 筛选 ---------------- */
  'log.filter.actor': '发起者',
  'log.filter.entity': '类型',
  'log.filter.all': '全部',
  'log.filter.worldOnly': '只看当前世界',
  'log.filter.worldOnlyOn': '只看当前世界',

  /* ---------------- 清空 ---------------- */
  'log.clear': '清空日志',
  'log.clearConfirm': '清空操作日志？记录会消失，但世界数据不受影响。',
  'log.cleared': '操作日志已清空',

  /* ---------------- 跳转 ---------------- */
  'log.open': '打开',
  'log.openTip': '打开它',
  'log.jump': '查看操作日志',
} as const;
