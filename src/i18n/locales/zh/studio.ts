/**
 * AI 工作台页面的文案。
 * 命名空间约定：`studio.*`
 */
export default {
  /* ---------------- 页面头部 ---------------- */
  'studio.title': 'AI 工作台',
  'studio.desc':
    '用一句话把活儿交给 AI：它读得懂你的知识库，也改得动它。查设定、补条目、连关系、记灵感都行 —— 每一步都留下记录，随时可以撤销。',
  'studio.noWorld': '请先创建一个世界',
  'studio.btn.article': '文章审校',
  'studio.btn.reviewQueue': '审查队列',
  'studio.btn.reviewQueueCount': '审查队列 ({n})',

  /* ---------------- agent 对话 ---------------- */
  'studio.agent.title': '和 AI 说话',
  'studio.agent.placeholder':
    '交代一件事…（Enter 发送，Shift+Enter 换行）\n例：把资料库里那篇旧笔记拆成条目；给北境三城之间补上贸易关系；记一下我想到的一个设定',
  'studio.agent.send': '交给它',
  'studio.agent.abort': '停下',
  'studio.agent.thinking': '正在读你的知识库并想下一步…',
  'studio.agent.empty': '交代点什么吧',
  'studio.agent.emptyDesc':
    '它是能动手的那种：说「帮我把 X 补上」「把 Y 和 Z 连起来」，它会先查清楚再改，并把每一步回执给你看。',
  'studio.agent.clear': '清空对话',
  'studio.agent.threads': '历史会话',
  'studio.agent.newThread': '新对话',
  'studio.agent.threadUntitled': '未命名会话',

  /* ---------------- 计划确认卡 ---------------- */
  'studio.agent.plan.title': '它想这么做',
  'studio.agent.plan.note': '这些动作会真正改动你的知识库（新建的条目会先进审查队列，等你拍板）。',
  'studio.agent.plan.run': '执行',
  'studio.agent.plan.skip': '跳过',
  'studio.agent.plan.count': '{n} 个动作',
  /**
   * 计划卡还在、但已经点不动的批次。只有「刷新 / 离开页面」这一种情况 ——
   * 那时运行态丢了，批次的 args 虽然在，可没有上下文能接着往下走。
   * 措辞必须说实话：它没被跳过，只是作废了。
   * （原先这里写的是「这批动作被你跳过了」，但跳过时 pending 会被清空，
   *  那个分支根本走不到 —— 它 100% 只会用来描述「没跳过」的情况。）
   */
  'studio.agent.plan.stale': '这批动作没有执行 —— 离开这个页面后它就作废了，重新交代一次就行。',

  /* ---------------- 单步回执 ---------------- */
  'studio.agent.step.why': '为什么：{why}',
  'studio.agent.step.pending': '排队中',
  'studio.agent.step.done': '已完成',
  'studio.agent.step.failed': '失败',
  'studio.agent.step.skipped': '已跳过',
  'studio.agent.step.noArgs': '（无参数）',
  'studio.agent.step.undo': '撤销这步',
  'studio.agent.step.undone': '已撤销',
  'studio.agent.step.log': '日志',
  'studio.agent.step.jump': '去看看',
  /** 提议类动作（新建条目 / 连关系）的回执后面挂的入口 */
  'studio.agent.step.review': '去审查',

  /* ---------------- 它在问你 ---------------- */
  'studio.agent.ask.title': '它在等你回答',
  /** 点了就交给它 —— 候选**答案**点下去就是要这么答，再让作者按一次回车是多余的 */
  'studio.agent.ask.pick': '点一下就交给它',
  'studio.agent.ask.answer': '回它',

  /* ---------------- 它给的「下一步」（贴在那句话下面） ---------------- */
  'studio.agent.next.label': '接下来可以让我：',

  /* ---------------- 建议问题（提示泡） ---------------- */
  'studio.suggest.empty': '不妨先让它：',
  'studio.suggest.followUp': '接着可以让它：',
  'studio.suggest.generating': '正在照着你的知识库想…',
  'studio.suggest.refresh': '换一批',
  'studio.suggest.run': '点一下就交给它，让它开始做',
  /** 兜底示例：没配 AI，或库里还空着时用 */
  'studio.preset.1': '这个世界的货币体系是怎么运作的？',
  'studio.preset.2': '把资料库里那篇旧笔记拆成条目',
  'studio.preset.3': '有哪些设定之间可能存在矛盾？',
  'studio.preset.4': '帮我想三个还没被写到的、但世界逻辑上应该存在的地带',
  'studio.preset.5': '记一下我想到的一个新设定',

  /* ---------------- 手动工具（可折叠） ---------------- */
  'studio.manual.title': '手动工具',
  'studio.manual.desc': '不想让它自己决定的时候，这里可以一步步来。',

  /* ---------------- 生成表单 ---------------- */
  'studio.card.generate': '批量生成候选条目',
  'studio.field.category': '生成到哪个分类',
  'studio.field.count': '数量',
  'studio.option.count': '{n} 条',
  'studio.field.relation': '关联',
  'studio.option.suggestRelations': '同时建议与已有条目的关系',
  'studio.field.instruction': '创作方向',
  'studio.placeholder.instruction':
    '例如：补三个盆地北缘的小城邦，要有各自的生存策略，其中一个已经在灰线内了。',
  'studio.field.keywords': '必须覆盖的概念（可选，逗号分隔）',
  'studio.placeholder.keywords': '例：盐税、断桥、双面间谍',
  'studio.btn.generate': '开始生成',
  'studio.btn.generating': '生成中…',
  'studio.btn.abort': '中止',
  'studio.hint.context':
    '每次生成都会自动带上「世界基调 + 已有设定索引」，因此 AI 不会重复已有条目，也会尽量沿用你的命名风格。',
  'studio.stream.thinking': '正在读取世界观上下文并构思候选设定…',

  /* ---------------- 生成结果 ---------------- */
  'studio.result.title': '生成结果',
  'studio.result.entryPill': '{n} 个条目',
  'studio.result.relPill': '{n} 条关系',
  'studio.btn.selectNone': '全不选',
  'studio.btn.sendToReview': '送入审查队列（{n}）',
  'studio.result.relationsHeading': '附带的关系建议',

  /* ---------------- 其它 AI 能力 ---------------- */
  'studio.cap.title': '其它 AI 能力',
  'studio.cap.extract.title': '从资料抽取条目',
  'studio.cap.extract.desc': '上传旧文档、设定笔记，AI 读完拆成结构化条目。',
  'studio.cap.extract.action': '去资料库',
  'studio.cap.relations.title': '批量推荐关系',
  'studio.cap.relations.desc': '让 AI 梳理人物、势力、地理之间的关联网。',
  'studio.cap.relations.action': '去关系图谱',
  'studio.cap.consistency.title': '一致性审计',
  'studio.cap.consistency.desc': '扫描全部条目，找出前后矛盾的设定并给出改法。',
  'studio.cap.consistency.action': '去一致性检查',
  'studio.cap.ask.title': '回看问过的',
  'studio.cap.ask.desc': '过去追问过什么、每条回答引用了哪些条目，都在存档里（追问在页面上方）。',
  'studio.cap.ask.action': '去问答存档',

  /* ---------------- 上下文成本提示 ---------------- */
  'studio.context.title': '关于上下文成本',
  'studio.context.desc':
    '当前有 {count} 个条目，每次生成默认最多送入 {limit} 个条目的摘要作为参考。条目很多时，可以在「设置」里调低这个数值来控制开销。',

  /* ---------------- 提示（toast） ---------------- */
  'studio.toast.needCategory': '请先创建一个分类',
  'studio.toast.noItems': 'AI 没有返回可用条目，可以换个说法再试。',
  'studio.toast.generated': '生成了 {n} 个候选条目',
  'studio.toast.needPick': '至少勾选一条',
  'studio.toast.sentToReview': '已把 {n} 条提议送入审查队列',
} as const;
