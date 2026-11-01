/**
 * 世界总览（Dashboard）页面的文案。
 * 命名空间约定：`dash.*`
 */
export default {
  /* ---------------- 空状态（没有激活世界） ---------------- */
  'dash.empty.noSelect.title': '还没有选中世界',
  'dash.empty.none.title': '还没有任何世界',
  'dash.empty.desc':
    '世界观是你所有设定的容器。从一个想法开始也行 —— 把旧稿、图片、零散念头交进来，AI 会帮你读、帮你问、帮你统筹成一份设定草案。',

  /* ---------------- 按钮 ---------------- */
  'dash.btn.newWorld': '新建世界',
  'dash.btn.editWorld': '编辑世界信息',

  /* ---------------- 世界信息卡 ---------------- */
  'dash.pill.categories': '{n} 个分类',
  'dash.rule.title': '创作纪律（会注入每次 AI 生成）',

  /* ---------------- 统计卡片 ---------------- */
  'dash.stat.entries': '条目总数',
  'dash.stat.canon': '已定稿',
  'dash.stat.relations': '关系连线',
  'dash.stat.pieces': '杂物间藏品',
  'dash.stat.piecesTitle': '打开杂物间',
  'dash.stat.reviewPending': '待审提议',

  /* ---------------- AI 未接入横幅 ---------------- */
  'dash.aiOff.title': 'AI 尚未接入',
  'dash.aiOff.desc':
    '世界观库本身已经可以正常使用（条目、关系、导出、备份都可用）。 接入 AI 后，才能使用生成、扩写、一致性检查与文章审校。 请到「设置 → AI 模型」填入你自己的 API Key。',

  /* ---------------- 待审提议 ---------------- */
  'dash.pending.title': '待审提议',
  'dash.pending.count': '{n} 条',
  'dash.pending.goto': '进入审查队列',

  /* ---------------- 最近更新 ---------------- */
  'dash.recent.title': '最近更新',
  'dash.recent.allEntries': '全部条目',
  'dash.recent.empty': '还没有条目。可以去 AI 工作台生成第一批，或手动新建。',
  'dash.uncategorized': '未分类',

  /* ---------------- 结构体检 ---------------- */
  'dash.health.title': '结构体检',
  'dash.health.entryMid': ' 个条目中，',
  'dash.health.isolatedMid': ' 个还没有任何关联。',
  'dash.health.gapsHint': '以下分类内容单薄，通常是世界观的骨架缺口：',
  'dash.health.fillGaps': '让 AI 补齐缺口',
  'dash.health.allGood': '各分类均有内容，可以试试一致性检查找深层的逻辑冲突。',

  /* ---------------- 快速开始 ---------------- */
  'dash.quick.title': '快速开始',
  'dash.quick.entry.title': '录入你已有的设定',
  'dash.quick.entry.desc': '把脑中的设定、旧文档、零散笔记整理成条目，这是知识库的地基。',
  'dash.quick.entry.action': '去整理条目',
  'dash.quick.docs.title': '上传资料让 AI 抽取',
  'dash.quick.docs.desc': '支持 txt / md / docx / pdf，AI 会读完后拆成结构化条目等你审。',
  'dash.quick.docs.action': '去资料库',
  'dash.quick.studio.title': '让 AI 生成候选设定',
  'dash.quick.studio.desc': '指定分类与方向批量产出，全部进入审查队列，你逐条决定收不收。',
  'dash.quick.studio.action': '去 AI 工作台',
  'dash.quick.article.title': '审校你的文章',
  'dash.quick.article.desc': '把写好的段落发进去，AI 对照设定指出冲突并给改法。',
  'dash.quick.article.action': '去文章审校',
} as const;
