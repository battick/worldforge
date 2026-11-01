/**
 * 一致性检查（ConsistencyPage）页面的文案。
 * 命名空间约定：`consist.*`
 * 注：冲突严重度（高/中/低）的显示由 StatusPill 组件负责，走 `kind.severity.*`。
 */
export default {
  /* ---------------- 页面头部 ---------------- */
  'consist.title': '一致性检查',
  'consist.desc':
    'AI 扮演考据员，通读你所有条目，找出前后矛盾、时间线错乱、力量尺度漂移等问题。 发现的问题会进入审查队列，每条都可以一键生成修订方案。',
  'consist.noWorld': '请先创建一个世界',

  /* ---------------- 按钮 ---------------- */
  'consist.btn.audit': '开始审计',
  'consist.btn.auditing': '审计中…',
  'consist.btn.abort': '中止',
  'consist.btn.generateFix': '让 AI 生成修订方案',
  'consist.btn.fixAll': '全部生成修订方案（{n} 条）',
  'consist.btn.fixAllRunning': '正在逐条生成…',
  'consist.btn.markHandled': '标记已处理',
  'consist.btn.ignore': '忽略',

  /* ---------------- 统计卡片 ---------------- */
  'consist.stat.high': '高优先级冲突',
  'consist.stat.medium': '需澄清',
  'consist.stat.low': '优化建议',
  'consist.stat.handled': '已处理',

  /* ---------------- 审计范围横幅 ----------------
   * 这段话必须**说实话**：索引其实有上限、正文其实是按预算平分的。
   * 早先这里写的是「送入全部条目的索引与正文摘要」，而代码里索引一直卡在 80 条 ——
   * 作者照着提示去调设置，调的是个根本没生效的数。 */
  'consist.scope.title': '审计范围',
  'consist.scope.desc':
    '送入 {n} 个条目：索引最多列 {limit} 条（可在「设置 → 送入条目的数量上限」里调）， 正文按总预算平分、每条约 900 字上下。条目越多，每条分到的越少。',
  'consist.scope.ledger': '另有 {n} 条已审记录作为账本一并送去 —— 模型只报新的。',
  'consist.scope.ledgerEmpty': '这次是首次审计，还没有账本 —— 报出来的都会是新的。',

  /* ---------------- 列表筛选 ----------------
   * 已判定（已处理 / 已忽略）的问题原先一直混在列表里，跟待处理的长得一样。
   * 「怎么老这几条」有一半是这么来的：它们本来就不该再出现在待办列表里。 */
  'consist.filter.pending': '待处理 {n}',
  'consist.filter.all': '全部 {n}',

  /* ---------------- 空状态 ---------------- */
  'consist.empty.title': '还没有审计记录',
  'consist.empty.desc':
    '点击右上角「开始审计」，AI 会对全部条目做一次交叉检查。这是发现深层逻辑漏洞最有效的方式。',
  'consist.empty.cleared': '待处理的问题清空了。',
  'consist.empty.clearedDesc': '已判定过的那些还留着 —— 切到「全部」可以回看。',

  /* ---------------- 本轮审计的结果 ----------------
   * 光弹一句 toast 说不清「为什么只有这几条」：模型可能又报了一遍旧账（被拦下了），
   * 也可能真的没挖出新的。这两种都要如实交代，否则作者只会觉得「怎么又是这几个」。 */
  'consist.audit.newTitle': '本轮新增 {n} 条问题',
  'consist.audit.cleanTitle': '本轮没有新问题',
  'consist.audit.desc': '这些只是线索，还没有写进设定库 —— 处理或忽略之后，下一轮才轮得到别的地方。',
  'consist.audit.skipped': '{n} 条是已经报过的老问题（模型又报了一遍，已按账本拦下）：{titles}',
  'consist.audit.ledger':
    '这轮带去的账本有 {n} 条：待处理 {open} · 已判定 {settled} · 可重看 {revisit}',
  'consist.audit.ledgerMore': '；另有 {n} 条较早的没列进去（它们同样不再重复报）',
  'consist.audit.cleanNote':
    '账本上那 {n} 条还压着 —— 待处理的去处理，判过要改的得真去改条目。下一轮若还是「没有新问题」，多半不是检查失灵， 而是你看的和上一轮是同一批东西。',

  /* ---------------- 问题条目 ---------------- */
  'consist.related': '涉及条目：',
  'consist.related.deleted': '（已删除）',
  'consist.suggestion': '建议改法：',
  'consist.gotoReview': '到审查队列统一处理（{n} 条待办）',

  /* ---------------- 全部生成修订方案 ---------------- */
  'consist.fixAll.title': '{n} 条问题可以一并生成修订方案',
  'consist.fixAll.desc':
    '按「涉及条目」分组：同一个条目上的多条问题会合并成一条修订，各条修订之间互不重叠（已有待审修订的条目这次先放过）。生成的结果统一进审查队列，由你一次拍板。',
  'consist.fixAll.someHeld': '另有 {n} 条问题的目标条目已有待审修订，这次先放过。',
  'consist.fixAll.progress': '{done}/{total} · {label}',
  'consist.fixAll.resultTitle': '已生成 {n} 条修订方案',
  'consist.fixAll.resultDesc': '这些是提议，还没有写进你的设定库 —— 到审查队列确认后才会生效。',
  'consist.fixAll.merged': '{n} 条问题和别的问题盯上了同一个条目，已并进同一条修订',
  'consist.fixAll.heldBack': '{n} 条问题的目标条目已有待审修订，先放过了',
  'consist.fixAll.orphan': '{n} 条问题在库里找不到可改的条目，生成不了修订',
  'consist.fixAll.failed': '{n} 条没生成成功，可以单独再试一次',
  'consist.fixAll.goReview': '去审查队列确认（{n} 条待办）',
  'consist.fixAll.dismiss': '收起',

  /* ---------------- toast ---------------- */
  'consist.toast.needEntries': '至少需要 2 个条目才能做一致性检查',
  'consist.toast.noIssues': '没有发现明显的设定冲突，继续写下去吧。',
  /* 账本非空时的「没有新问题」。不能沿用上面那句 —— 「没有发现冲突」是**一次判断**，
     而这里的实情是「该报的都报过了」，两件事说成一句会让作者以为设定已经干净了。 */
  'consist.toast.foundNothingNew':
    '没有新问题 —— 报过的 {n} 条都记在账本上，不会换着说法再念一遍',
  'consist.toast.foundNew': '发现 {n} 处新问题，已进入审查队列',
  'consist.toast.foundAllDup': '没有新问题 —— {n} 条是报过的老账，已按账本拦下',
  'consist.toast.fixGenerated': '已为「{title}」生成修订建议，请到审查队列确认',
  'consist.toast.fixAllDone': '已生成 {n} 条修订方案，请到审查队列确认',
  'consist.toast.fixAllHeld': '这些问题盯着的条目都已有待审修订 —— 先把手上那几条处理掉再来',
  'consist.toast.fixAllNothing': '一条都没生成成功，稍后可以再试',
  'consist.toast.handled': '已标记为处理完成',
  'consist.toast.ignored': '已忽略该问题',

  /* ---------------- 单条修订的排队 ----------------
   * 「让 AI 生成修订方案」走的是右下角的任务队列：连着点好几条会排队，一件件做。
   * 名字（`label`）与回执（`note`）由这里给 —— 队列本身不认识「一致性」，只负责排队。 */
  'consist.queue.group': '一致性修订',
  'consist.queue.label': '为《{title}》生成修订方案',
  'consist.queue.note': '已生成修订方案',
  'consist.queue.queued': '已排上 {n} 件，按顺序一件件做',
  'consist.queue.exists': '这一条已经在队列里了',
  'consist.queue.sameTarget':
    '《{title}》的修订正在队列里做着 —— 同一条条目一次只改一份，不然作者会不知道按哪份改。这条问题想一起处理，用上面的「全部生成修订方案」。',
  'consist.queue.hasPending':
    '《{title}》已经有待审的修订了 —— 先把手上那份处理掉再来。',
} as const;
