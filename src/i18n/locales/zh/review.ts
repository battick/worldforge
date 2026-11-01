/**
 * 审查队列页面的文案。
 * 命名空间约定：`review.*`
 */
export default {
  /* ---------------- 页面头部 ---------------- */
  'review.title': '审查队列',
  'review.desc':
    'AI 产出的所有内容都会先停在这里。采纳即写入正式设定库，驳回则丢弃。你也可以先改再采纳。',
  'review.btn.clearRejected': '清空已驳回',
  'review.btn.acceptAll': '全部采纳',

  /* ---------------- 统计 ---------------- */
  'review.stat.pending': '待你决定',
  'review.stat.conflicts': '待处理冲突',

  /* ---------------- 筛选 ---------------- */
  'review.filter.all': '全部类型',

  /* ---------------- 列表 ---------------- */
  'review.list.count': '{n} 条',
  'review.uncategorized': '未分类',
  'review.deleted': '（已删除）',
  'review.newEntry': '（新条目）',

  /* ---------------- 空状态 ---------------- */
  'review.empty.pending.title': '队列是空的',
  'review.empty.other.title': '这里还没有记录',
  'review.empty.pending.desc':
    '去 AI 工作台生成候选设定，或上传资料让 AI 抽取条目，产生的内容会出现在这里。',
  'review.empty.goStudio': '去 AI 工作台',
  'review.empty.goDocs': '去资料库',

  /* ---------------- 提议详情 ---------------- */
  'review.detail.aliases': '别名：{names}',
  'review.detail.collapseBody': '收起正文',
  'review.detail.expandBody': '展开正文',
  'review.detail.targetEntry': '目标条目',
  'review.detail.suggestion': '建议改法：',
  'review.detail.summary': '概述',
  'review.detail.deleteWarn': '采纳后将永久删除这条条目及其所有关系（可在操作日志里撤销）。',
  'review.detail.deleteRelationWarn': '采纳后将断开这条关系（可在操作日志里撤销）。',
  'review.detail.deleteRelCount': '它当前连带着 {n} 条关系，会一并删除。',
  /* 带时间的提议：先把它落在哪、怎么改位置说清楚 */
  'review.time.landsAt':
    '它带着时间「{when}」—— 采纳后落在时间轴末尾，位置可以在「时间与关系」里拖',
  'review.time.goThere': '去时间轴看看',
  'review.detail.rationale': 'AI 依据：',
  /**
   * 提议的来源。默认那几条老路径（按资料抽取 / 批量生成）不标 —— 标了反而噪音；
   * 只有工作台里的 agent 提议才标出来：它可能自己联想了一条库里原本没有的东西，
   * 作者有权知道自己在审的是「照文档抄」还是「它自己想出来的」。
   */
  'review.origin.agent': '工作台 agent 提议',
  /** 关系提议的一端还没落地：先采纳那条，否则会在图谱上留一条断头线 */
  'review.blocked.relationDraft': '它牵着的条目还在审查队列里 —— 先采纳那一条，它才能落地',

  /* ---------------- 时间轴排版方案 ---------------- */
  'review.layout.colEntry': '条目',
  'review.layout.colPos': '轴上的位置',
  'review.layout.colWhen': '定成什么时候',
  'review.layout.colOther': '另外改动',
  'review.layout.notPlaced': '未排进轴',
  'review.layout.eraTo': '纪元 → {era}',
  'review.layout.toAt': '终点 {n}',
  'review.layout.toWhen': '时间改成「{from}」',
  'review.layout.gone': '（这期间已经删掉了 —— 采纳时会跳过它）',
  'review.layout.hint':
    '数值越小越靠前，数值的差就是轴上的距离。采纳只改位置：你写的「涨潮纪十二年」这些说法原样不动。',
  'review.layout.guessHint':
    '这是 AI 替你猜的时间，采纳后会把条目的时间和轴位置一起定下来。拿不准的别急着采纳，逐条看依据。',
  /** 每行鼠标悬停时露出的那句「它凭哪句话这么排」 */
  'review.layout.reasonTip': 'AI 的依据：{reason}',
  'review.layout.editTitle': '改一改这份排版',
  'review.layout.editHint':
    '不勾的那几条就不改；位置可以逐条调。改完保存，再按「采纳」才真的写入。',
  'review.guess.editTitle': '改一改这份猜测',
  'review.guess.editHint':
    '不勾的那几条就不定；时间和位置都能逐条调。改完保存，再按「采纳」才真的写入。',
  'review.guess.editWhen': '时间',
  'review.layout.editPick': '采纳这一条',
  'review.layout.editPos': '位置',
  'review.layout.editEnd': '终点',
  'review.layout.editNone': '一条都没留下 —— 这份方案就不必采纳了。',

  /* ---------------- 对比视图 ---------------- */
  'review.diff.before': '修改前',
  'review.diff.after': '修改后',
  'review.diff.empty': '*（空）*',

  /* ---------------- 字段标签 ---------------- */
  'review.field.title': '标题',
  'review.field.summary': '概述',
  'review.field.content': '正文',
  'review.field.tags': '标签',
  'review.field.aliases': '别名',
  'review.field.category': '分类',
  'review.field.contentMd': '正文（Markdown）',

  /* ---------------- 操作按钮 ---------------- */
  'review.btn.markHandled': '标记已处理',
  'review.btn.accept': '采纳',
  'review.btn.editAccept': '改一改再采纳',
  'review.btn.reject': '驳回',
  'review.btn.saveChanges': '保存修改',
  'review.btn.rerun': '再生成',
  'review.btn.revert': '撤回',

  /* ---------------- 确认框 ---------------- */
  'review.confirm.acceptAll': '确定采纳当前列表中的 {n} 条提议？这会直接写入你的设定库。',
  'review.batch.confirm': '采纳这一批的 {n} 条修改？这会直接写入你的设定库。',

  /* ---------------- 同一批（批量打磨/批量生成） ---------------- */
  'review.batch.title': '同一批 · {n} 条',
  'review.batch.accept': '采纳这一批',
  'review.batch.reject': '驳回这一批',
  'review.batch.skippedEnds': '{n} 条关联的另一端还没落地，已跳过',
  'review.batch.allBlocked': '这一批都还要等关联的另一端先落地，暂时采纳不了',

  /* ---------------- 提示（toast） ---------------- */
  'review.toast.accepted': '已采纳 {n} 条',
  'review.toast.acceptedOne': '已采纳并写入设定库',
  'review.toast.rejected': '已驳回',
  'review.toast.updated': '已更新提议内容，确认无误后可采纳',
  'review.toast.skippedEnds': '跳过 {n} 条：它们关联的另一端还没落地',

  /* ---------------- 再一次生成 ---------------- */
  'review.rerun.title': '重新生成「{title}」',
  'review.rerun.hint':
    '会照当初那条任务重新跑一遍，用新结果替换这一条。可以在下面补一句，让结果更贴合你的想法（留空则按原样重来）。',
  'review.rerun.placeholder': '（可选）补充要求，例如：主角的名字再硬朗一点、时间定在建国前…',
  'review.rerun.confirm': '重新生成',
  'review.rerun.running': '正在重新生成…',
  'review.rerun.done': '已重新生成，新结果替换了这一条',
  'review.rerun.nothing': '这次没有产出可替换的新结果，原提议保持不变',
  'review.rerun.reverted': '已撤回，恢复成重新生成前的结果',
  'review.rerun.revertHint': '回到重新生成前的那一版',
} as const;
