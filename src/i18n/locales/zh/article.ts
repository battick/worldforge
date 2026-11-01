/**
 * 文章审校页面的文案。
 * 命名空间约定：`article.*`；二级为区域（input / result / toast）。
 */
export default {
  /* ---------------- 页面头部 ---------------- */
  'article.title': '文章审校',
  'article.desc':
    '把你写好的段落、章节或剧本片段发进来。AI 会对照世界观库，指出与设定冲突的地方、逻辑漏洞，并给出具体改法。这是「写作 → 设定」双向校对的入口。',
  'article.noWorld': '请先创建一个世界',

  /* ---------------- 待审文本 ---------------- */
  'article.input.title': '待审文本',
  'article.input.btn.loadSample': '载入示例',
  'article.input.btn.import': '导入文件',
  'article.input.placeholder': '粘贴你写的正文片段…',
  'article.input.btn.abort': '中止',
  'article.input.btn.run': '对照设定审校',
  'article.input.btn.running': '审校中…',
  'article.input.sample':
    '伊兰站在灰港的栈桥上，看着南方来的货船卸下第三批烬石。\n\n「今年的品位比去年差了不少。」多恩从她身后走来，手里攥着一块深灰色的矿石，\n「你们的司祭把它称作神血，但我只看到一堆越来越差的石头。」\n\n伊兰没有回头。「你带了多少人？」\n\n「三百。」多恩说，「灰线已经推到北岸了。再不动手，明年这个时候我们就是在水里捞灰。」\n\n她终于转过身。这位二十九岁的首席司炽在灰光下看起来比实际年龄更轻，\n但此刻她开口时，声音里有一种接近疲惫的确定性：\n\n「我可以给你祝福。但远征队里必须有拾烬人，每一个时辰祈祷一次。\n还有——蒸汽机不能进灰原。」\n\n多恩笑了，那是一种矿工才会有的、带着灰的笑。「你怕教会的人说你亵渎。」\n\n「我怕的是，」伊兰说，「他们回来以后，会告诉我钟声到底是什么。」',

  /* ---------------- 审校结果 ---------------- */
  'article.result.empty.title': '还没有审校结果',
  'article.result.empty.desc':
    '左侧粘贴正文后点「对照设定审校」。AI 会自动检索与这段文字相关的世界设定作为对照依据。',
  'article.result.overallTitle': '总体评价',
  'article.result.scoreLabel': '设定一致度',
  'article.result.usedEntries': '对照了以下设定：',
  'article.result.suggestions.title': '修改建议（{n}）',
  'article.result.suggestions.empty': '这一段与现有设定没有发现冲突。',
  /* 「第 」原文就带一个尾随空格，后面接「（可定位）」，不要删掉 */
  'article.result.suggestions.ordinalPrefix': '第 ',
  'article.result.suggestions.locatable': '（可定位）',
  'article.result.suggestions.issue': '问题：',
  'article.result.suggestions.fix': '改法：',
  'article.result.newConcepts.title': '文中新概念',
  'article.result.newConcepts.btn': '生成候选条目',
  'article.result.newConcepts.desc':
    '这些专有名词在文章里出现了，但世界观库中还没有。可以把它们补进库里，下次写作时 AI 就能照着这些设定校对了。',

  /* ---------------- 提示（toast） ---------------- */
  'article.toast.tooShort': '内容太短了，至少给一段完整的文字',
  'article.toast.needCategory': '请先创建一个分类',
  'article.toast.generated': '已生成 {n} 条候选设定，请到审查队列确认',
  'article.toast.loaded': '已载入 {name}',
} as const;
