/**
 * 新建世界向导（WorldOnboarding）与编辑世界信息（WorldEditor）的文案。
 * 命名空间约定：`world.*`
 */
export default {
  /* ---- 向导步骤标题 ---- */
  'world.step.understanding': 'AI 的理解',
  'world.step.questions': '第 {n} 轮 · 需要你定的几件事',
  'world.step.told': '不针对问题，我就是想说',
  'world.step.proposal': '设定草案',
  'world.step.revise': '还想改点什么？',

  /* ---- 头部 ---- */
  'world.head.title': '新建世界',
  'world.head.sub':
    '把手上有的东西都丢进来，AI 读完会来问你几个问题，然后写出一份设定草案 —— 不满意就继续聊，直到你说「确认」它才会真正建好。',

  /* ---- 左栏：素材 ---- */
  'world.left.title': '你手上的东西',
  'world.left.count': '{text} 份文字 · {img} 张图',
  'world.left.empty':
    '这里还空着。其实你不用准备什么 —— 哪怕只是「我想写一个关于灯塔的故事」，也足够开始了。',

  'world.drop.title': '拖文件进来，或点这里选',
  'world.drop.formats': '文章 / 笔记 / 设定稿 / 大纲：txt md docx pdf html csv json',
  'world.drop.images': '还有图片：png jpg webp（AI 会自己看图）',

  'world.composer.text': '写点什么',
  'world.composer.rule': '定一条规则',
  'world.composer.textPlaceholder':
    '随手写一段也行，不用有条理。例如：我想写一个海面每年上涨三尺的世界。',
  'world.composer.rulePlaceholder':
    '直接给这个世界立规矩，例如：力量必须有代价，用完要付寿命；不要出现现代科技术语。',

  /* ---- 素材条目 ---- */
  'world.material.imageLabel': '图片',
  'world.material.sizeSuffix': ' · {size}',
  'world.material.noteSuffix': ' · 有备注',
  'world.material.ruleName': '规则 · {text}',
  'world.material.noteName': '随手写的 · {text}',
  'world.material.addNote': '加一句说明',
  'world.material.noteImagePlaceholder': '这张图画的是什么？例如：主角的服饰设计',
  'world.material.notePlaceholder': '补充说明（可选）',

  /* ---- 横幅 ---- */
  'world.banner.aiOff.title': '还没有接通 AI',
  'world.banner.aiOff.desc':
    '新建世界需要 AI 来读你的材料。素材可以先放进来、进度会自动保存，接好模型之后回来接着走就行。',
  'world.banner.aiOff.btn': '去设置 AI 模型',
  'world.banner.upgrade.title': '数据库正在后台升级，草稿暂存暂时不可用',
  'world.banner.upgrade.desc':
    '如果这里长时间停留，说明有其他 WorldForge 标签页占着数据库 —— 关掉它们升级会自动完成。中途退出可能丢失本次进度。',

  /* ---- 初始引导 ---- */
  'world.hello.ready': '素材已经就位',
  'world.hello.wait': '先别急着想清楚',
  'world.hello.leftBefore': '左边这 ',
  'world.hello.leftMid': ' 份东西就是你的起点了。点右下角让 AI 读一遍 —— 它会先告诉你',
  'world.hello.understood': '它读懂了什么',
  'world.hello.leftAfter': '，再问几个它确实需要你拍板的问题。还想起什么，随时继续往左边丢。',
  'world.hello.noneBefore': '把旧稿、图、零散想法丢到左边就好。点下面的按钮之后，AI 会先告诉你',
  'world.hello.noneAfter': '，再问几个它确实需要你拍板的问题 —— 凡是它能自己判断的，不会来烦你。',

  /* ---- AI 的理解 ---- */
  'world.understanding.observations': 'AI 顺手注意到的一些事',

  /* ---- 问答 ---- */
  'world.qa.answered': '{done}/{total} 已答',
  'world.qa.hint': '答不上来也没关系：点「你来定」把决定权交给 AI，它会按你的材料自己判断。',
  'world.qa.suggestLabel': '点一下直接填入：',
  'world.qa.suggestRefresh': '换一批',
  'world.qa.suggestBusy': '正在想…',
  'world.qa.suggestFailed': '这次没能想出新的建议，稍后再试',
  'world.qa.answerPlaceholder': '你的想法（一句话也行）',
  'world.qa.delegatedPlaceholder': '已交给 AI 决定',
  'world.qa.delegatedBtn': '已交给 AI',
  'world.qa.letAiBtn': '你来定',

  /* ---- 作者交代 ---- */
  'world.told.count': '已交代 {n} 条',
  'world.told.descBefore': '这里说的任何话都是',
  'world.told.descStrong': '最高指示',
  'world.told.descAfter':
    '：优先于素材、优先于 AI 的判断。必须遵守的设定、雷区、口味偏好，想到就写下来 —— 下一次 AI 调用（继续聊或写草案）都会带上。',
  'world.told.placeholder': '例如：主角必须是个失败者；不要出现学院设定；这个世界没有神。',

  /* ---- 草案 ---- */
  'world.proposal.included': '{included} / {total} 个条目入选',
  'world.proposal.version': '第 {n} 版',
  'world.proposal.rationale': 'AI 的统筹思路',
  'world.proposal.genrePlaceholder': '题材',
  'world.proposal.tone': '创作纪律（每次 AI 生成都会原文带上）',
  'world.proposal.rules': '世界的底层规则',
  'world.proposal.entries': '条目（{n} 个分类 · 取消勾选的不会写入）',
  'world.proposal.itemCount': '{n} 条',
  'world.proposal.summaryPlaceholder': '一句话概述',
  'world.proposal.relations': '关系连线（{n} 条）',
  'world.proposal.openQuestions': 'AI 替你做主、但拿不准的地方',
  'world.proposal.openQuestionsHint':
    '不满意可以直接在上面改，或者在下面让 AI 重写一版。确认创建时会再问你一次。',
  'world.proposal.uncategorized': '未分类',

  /* ---- 修订 ---- */
  'world.revise.hint':
    '用你自己的话说就行，例如「势力太少了，再加两个互相制衡的」「基调再冷一点」「这个城市的名字换成更像方言的」。',
  'world.revise.placeholder': '说说哪里不对劲…',
  'world.revise.count': '已经改过 {n} 版',

  /* ---- 底部动作条 ---- */
  'world.foot.proposalReady':
    '草案已就绪：{total} 个条目，已勾选 {included} 个。确认后才会真正写入你的世界观库。',
  'world.foot.allAnswered': '都答完了，可以让 AI 接着往下走。',
  'world.foot.answerFirst': '回答完之后，AI 会接着追问或者直接起草。',
  'world.foot.enough': 'AI 觉得信息够了，可以开始写草案了。',
  'world.foot.putMaterials': '放好素材后，先让 AI 读一遍。',

  /* ---- 最终确认 ---- */
  'world.confirm.title': '最后确认一次 —— 以下是你还没拍板的地方：',
  'world.confirm.noOpenQuestions': 'AI 没有留下待定项。',
  'world.confirm.abandon': '确定放弃这次世界创建？已收集的素材、问答和草案都会被清除，且无法恢复。',

  /* ---- 按钮 ---- */
  'world.btn.exit': '退出（进度会留着）',
  'world.btn.abandon': '放弃创建',
  'world.btn.addMaterial': '加进素材',
  'world.btn.reread': '重新读一遍',
  'world.btn.deleteThis': '删掉这条',
  'world.btn.remember': '记下来',
  'world.btn.revise': '让 AI 改一版',
  'world.btn.readOnce': '让 AI 读一遍',
  'world.btn.answerContinue': '答完，接着聊',
  'world.btn.writeDraft': '够了，直接写草案',
  'world.btn.askMore': '再问我几个问题',
  'world.btn.genProposal': '生成设定草案',
  'world.btn.confirmCreate': '确认创建这个世界',
  'world.btn.reviseMore': '再改改',
  'world.btn.confirmNow': '就这样，创建「{name}」',
  'world.btn.deleteWorld': '删除这个世界',
  'world.btn.deleteEntry': '删掉这一条',
  'world.btn.addRule': '加一条',

  /* ---- 进度提示 ---- */
  'world.busy.reading': 'AI 正在读你的材料…',
  'world.busy.more': 'AI 正在想还有哪些没定…',
  'world.busy.proposal': 'AI 正在把材料统筹成一份完整设定…',
  'world.busy.revising': 'AI 正在按你的意见改…',
  'world.busy.creating': '正在创建…',

  /* ---- 错误 / 校验 ---- */
  'world.err.aiNotReady': '还没有接通 AI，请先到「设置 → AI 模型」填写 API Key。',
  'world.err.needMaterials': '先往左边放点东西吧 —— 旧文章、图片、甚至一句临时想到的规则都行。',
  'world.err.needRevise': '先写一句你想改什么，例如「把力量体系改得更残酷一些」。',
  'world.err.needEntry': '至少要保留一个条目，否则这会是个空世界。',
  'world.err.nameRequired': '世界总得有个名字',
  'world.err.callFailed': '调用失败',
  'world.err.proposalFailed': '生成草案失败',
  'world.err.reviseFailed': '修订失败',
  'world.err.createFailed': '创建失败',
  'world.err.maxMaterials': '素材最多 {n} 份，后面的已忽略',
  'world.err.maxImages': '图片最多 {n} 张，已跳过 {name}',
  'world.err.imageFailed': '这张图没能处理（格式或浏览器限制），只能作为索引保留',
  'world.err.tooLong': '内容过长，只读取了前 {n} 字',

  /* ---- toast ---- */
  'world.toast.revised': '已按你的意见改过一版',
  'world.toast.created': '「{name}」已创建',
  'world.toast.deleted': '已删除',
  'world.toast.warnJoin': '；',
  'world.toast.warnMore': ' 等 {n} 条提示',

  /* ---- 编辑世界信息 ---- */
  'world.editor.title': '编辑世界信息',
  'world.editor.deleteConfirm':
    '删除世界「{name}」？其下 {n} 个条目、全部关系与资料都会被永久删除。',
  'world.editor.name': '世界名称',
  'world.editor.tagline': '一句话定位',
  'world.editor.genre': '题材类型',
  'world.editor.genrePlaceholder': '例：低魔奇幻 / 赛博朋克 / 民国悬疑',
  'world.editor.color': '主色调',
  'world.editor.summary': '世界简介',
  'world.editor.summaryPlaceholder':
    '这个世界的核心前提、当前局势与最要紧的矛盾。每次 AI 生成都会带上这段。',
  'world.editor.tone': '基调与创作纪律',
  'world.editor.tonePlaceholder': '例：冷峻克制，力量必须有代价；不要出现现代科技名词。',
  'world.editor.toneHint':
    '这里是给 AI 立的规矩，会原文注入每一次生成。写「禁止什么」比写「想要什么」更有效。',
} as const;
