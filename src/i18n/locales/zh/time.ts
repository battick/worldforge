/**
 * 时间 —— 条目上的「什么时候」，以及「关系与时间」里的那一支轴。
 *
 * 这一块的主张：时间**不是独立的一域**，它是条目的一个可选属性。
 * 所以轴上画的东西永远等于「设了时间的那些条目」，文案里说的也都是
 * 「位置」「先后」「拖」，而不是「第几条事件」—— 一件事就是一个条目，
 * 没有两套说法可以对不上。
 */
export default {
  /* ---------- 时间视图（关系与时间 → 时间） ---------- */
  'time.view.desc':
    '右边是**还没排进去**的条目：拖一条到轴上，它就在那个位置上了 —— 位置就是它的时间。想说得更细（「元年」这样的说法、一段、至今、纪元、分量、精确位置），选中它，在右边直接改，改完立刻生效。',
  'time.view.tool.add': '新建一条',
  'time.scale.proportional': '按数值比例',
  'time.scale.even': '均匀铺开',
  'time.scale.hintProportional': '节点的间距反映「位置」数值的差距',
  'time.scale.hintEven': '不管差距，一条挨一条，方便看清顺序',
  'time.view.tool.onlyMajor': '只看重大',
  'time.view.tool.zoomIn': '放宽',
  'time.view.tool.zoomOut': '收紧',
  'time.view.tool.density': '疏密',
  'time.view.tool.reset': '复位视图',

  /* ---------- 空态 ---------- */
  'time.empty.title': '还没有哪条排进时间轴',
  'time.empty.desc':
    '这个世界什么时候发生了什么？把右边的条目拖进这条轴，它就在那个位置上了。',
  'time.empty.action': '新建一条并排进来',
  'time.empty.goRelations': '去看关系',
  'time.empty.hasNone':
    '这个世界已经有 {n} 条条目，但一条都还没排进轴 —— 轴是空的，因为没东西可排。',

  /* ---------- 轴 ---------- */
  'time.axis.addHint': '点这里，在这一刻新建一条',
  'time.axis.dragHint': '按住节点左右拖，改它的先后',
  'time.axis.dropHere': '把右边「还没排进去」的条目拖到这条轴上 —— 落在哪儿，它就在什么时候',
  'time.axis.notimeLegend': '虚线圈 = 位置定了，时间文字还没写',
  'time.axis.samePosition':
    '有几条挨得太近（或位置数值一样），先上下让开摆着 —— 想让它们真的分开，去改各自的位置。',
  'time.axis.dragging': '位置 {n}',
  'time.axis.ongoingArrow': '至今',

  /* ---------- 把时间念成人话 ---------- */
  /**
   * 连接号也是文案的一部分：中文用全角「－」，英文用 en dash。
   * 所以它不能写死在组件里 —— 那样中文版式和英文版式会跟着代码走，而不是跟着语言走。
   */
  'time.label.range': '{from} － {to}',
  'time.label.ongoing': '{from} － {until}',
  /** 列表与面板里已经先印了起点，只补后半截 */
  'time.label.tailRange': '－ {to}',
  'time.label.tailOngoing': '－ {until}',
  /** 界面上没有的「终点」占位（只有起点、终点还空着） */
  'time.label.unknown': '?',
  'time.legend.clear': '看全部',

  /* ---------- 分量 ---------- */
  'time.weight.major': '重大',
  'time.weight.normal': '一般',
  'time.weight.minor': '琐记',
  'time.weight.major.hint': '转折点、开端与终结 —— 轴上会画得更大，名字一直露着',
  'time.weight.normal.hint': '值得一提的事',
  'time.weight.minor.hint': '背景里的小事，鼠标放上去才显示名字',

  /* ---------- 轴下面的列表 ---------- */
  'time.list.heading': '按时间排开',
  'time.list.count': '共 {n} 条',
  'time.list.empty': '这个筛选下没有条目',
  'time.list.noFrom': '（没写时间）',

  /* ---------- 右侧快速看一眼 ---------- */
  'time.panel.title': '时间轴上',
  'time.panel.hint':
    '点一个节点或下面列表里的一行，就能在这里直接改它的时间，或者打开条目看正文 —— 轴上的东西就是条目本身，没有第二份说法。',
  'time.panel.timed': '已排进轴',
  'time.panel.untimed': '还没排进去',
  'time.panel.open': '打开条目',
  'time.panel.relations': '它牵着的条目',
  'time.panel.when': '它什么时候',
  'time.panel.editHint':
    '改完立刻生效，不用翻进条目编辑器。位置是最要紧的那个数 —— 轴上的先后全靠它，数字越小越靠前。',

  /* ---------- 还没排进去的条目池 ---------- */
  'time.pool.heading': '还没排进去',
  'time.pool.hint':
    '拖到轴上任意位置就排好了 —— 位置就是它的时间。也可以点一下，再点轴上任意一处。',
  'time.pool.search': '搜条目名、别名、标签…',
  'time.pool.noMatch': '没搜到还没排进去的条目',
  'time.pool.allPlaced': '这个世界里的条目全都排进去了。',
  'time.pool.more': '还有 {n} 条没列出来 —— 打个字搜更快。',
  'time.pool.pending': '点轴上任意一处，把「{title}」放在那儿',
  'time.pool.pendingCancel': '算了',
  'time.pool.rowHint': '把「{title}」拖到轴上；或者点一下它，再点轴上任意一处',
  'time.pool.dropAt': '落在 {n}',
  'time.pool.dropHint': '往轴上拖',

  /* ---------- AI 自动排版 ---------- */
  /**
   * 它做的事只有一件：**给一批条目定先后**（写 `at`）。
   * 所以文案里绝不说「重排时间」「修正年代」—— 时间文字是作者写的，AI 不碰。
   */
  'time.layout.btn': 'AI 自动排版',
  'time.layout.running': '正在排版',
  'time.layout.hint':
    '让 AI 读一遍这个世界的时间与条目，提出一份先后的排布。它只会**提议**：结果先进审查队列，你点采纳才动轴。',
  'time.layout.group': '时间轴排版',
  'time.layout.label': '为《{world}》排一遍时间轴',
  'time.layout.needEntries': '这个世界还没有条目可排 —— 先建几条再来。',
  'time.layout.queued': '已排上（队列里共 {n} 件），做完会送进审查队列',
  'time.layout.exists': '已经有一件排版在队列里了',
  'time.layout.note': '已提交 {n} 处改动，等你在审查队列里确认',
  'time.layout.noChange': 'AI 看过之后认为现在的顺序已经对了，没有改动',
  'time.layout.unmatched': 'AI 报了 {n} 个清单里对不上的标题，这一次没有可采纳的改动',
  'time.layout.planTitle': '时间轴排版 · {n} 处',
  'time.layout.planNote': '这次送进去 {sent} 条，还有 {rest} 条没参与。',
  'time.layout.planUnmatched': '它报了 {n} 个清单里没有的标题，已忽略：{titles}',
  'time.layout.pendingBanner':
    '有一份 AI 排版方案（{n} 处改动）等你确认 —— 采纳之前，轴上的位置一点都不会变。',
  'time.layout.goReview': '去审查',

  /* ---------- AI 行为总菜单 ---------- */
  'time.aiMenu.label': 'AI 行为',
  'time.aiMenu.hint': '让 AI 帮你理时间：排先后，或给没时间的条目猜个时候。结果都先进审查队列。',
  'time.layout.shortHint': '给已有时间的条目重排先后',

  /* ---------- AI 猜测时间 ---------- */
  'time.guess.btn': 'AI 猜时间',
  'time.guess.running': '正在猜时间',
  'time.guess.hint':
    '让 AI 根据设定，给还没设时间的条目猜一个合理的时间并设好。它在替你编日期，所以结果一律进审查队列，你点采纳才动轴。',
  'time.guess.shortHint': '给没时间的条目猜并设好时间',
  'time.guess.group': 'AI 猜时间',
  'time.guess.label': '为《{world}》猜一遍条目时间',
  'time.guess.needPool': '所有条目都已经设了时间，没有可猜的了。',
  'time.guess.queued': '已排上（队列里共 {n} 件），做完会送进审查队列',
  'time.guess.exists': '已经有一件猜时间的活在队列里了',
  'time.guess.note': '已提交 {n} 条猜测，等你在审查队列里确认',
  'time.guess.noChange': 'AI 看过之后认为没有能猜出时间的条目',
  'time.guess.unmatched': 'AI 报了 {n} 个池子里对不上的标题，这一次没有可采纳的结果',
  'time.guess.planTitle': 'AI 猜时间 · {n} 条',
  'time.guess.planNote': '这次送进去 {sent} 条，还有 {rest} 条没参与。',
  'time.guess.planUnmatched': '它报了 {n} 个池子里没有的标题，已忽略：{titles}',
  'time.guess.pendingBanner':
    '有一份 AI 猜时间的方案（{n} 条）等你确认 —— 采纳之前，轴上一个都不会变。',
  'time.guess.goReview': '去审查',

  /* ------------------------------------------------------------------ */
  /* 编年视图（时间与关系 → 编年，第一入口）                              */
  /*                                                                     */
  /* 与旧轴是**同一份数据的两种读法**，所以这里只管版式与读法，绝不重复   */
  /* 「时间是什么」那一套说法 —— 那些一律走上面的 `time.*`。             */
  /* ------------------------------------------------------------------ */
  'chron.view.desc':
    '这一页从上到下是「同一个时间轴的四层读法」：纪元带、卡片、甘特轨、刻度尺。卡片按先后并成一条带，谁也不压谁，挨得太近的就地铺开；精确的跨度看下面那条轨。按住卡片或横条左右拖，改它的先后；点最下面那条虚线带，在这一刻新建一条。',
  'chron.era.filterHint': '只看「{era}」这一段（再点一下看全部）',
  /** 只有位置、还没写下时间文字。虚线的意思是「先后定了，说法还没有」 */
  'chron.card.noTimeText': '还没写下时间',
  /** 悬停卡片时浮出的那行字 —— 点卡片就是打开这一条 */
  'chron.card.view': '查看详情',
  'chron.legend.point': '时间点',
  'chron.legend.range': '一段（长度就是真实跨度）',
  'chron.legend.ongoing': '至今',
  'chron.panel.title': '编年',
  'chron.panel.hint':
    '点一张卡片或底下的横条，就能在这里直接改它的时间，或者打开条目看正文 —— 墙上的东西就是条目本身，没有第二份说法。',
  'chron.pool.hint': '拖到左边那条轨上任意一处就排好了；也可以点一下它，再点画布任意一处。位置就是它的时间。',
  /** 底部工具条：动作常显，「看法」收进这个浮层 */
  'chron.tools.more': '显示',
  'chron.tools.moreHint': '比例、只看重大、疏密 —— 调一次就不再碰的，都收在这儿',
  /** 去旧的那支点轴（时间视图）—— 编年转正后它从这个口子进 */
  'chron.tools.oldView': '旧的',
  'chron.tools.oldViewHint':
    '换回旧的那支点轴（时间视图）—— 与编年读的是同一份数据，在哪边改都算数',
  /**
   * 挤在同一处的几张被「就地铺开」了，横坐标与它时间上的位置不再重合。
   * 可以取舍（不重叠是作者点名的硬要求），但必须报出来。
   */
  'chron.push.hint': '{n} 张就地铺开',
  'chron.push.hintTitle':
    '这 {n} 张挨得太近（同一刻，或者位置差极小），摆在一起的顺序就是先后 —— 精确跨度看下面的轨',

  /* ---------- 时间的形态 ---------- */
  'time.kind.point': '时间点',
  'time.kind.range': '一段',
  'time.kind.ongoing': '起始 - 至今',
  'time.kind.hint.point': '就一个时刻，例如「涨潮纪十二年」',
  'time.kind.hint.range': '有始有终，例如「涨潮纪十二年」到「涨潮纪三十九年」',
  'time.kind.hint.ongoing': '起了个头、还没结束 —— 轴上会一直画到最右边',

  /* ---------- 条目编辑器里的「时间」 ---------- */
  'time.edit.tab': '时间',
  'time.edit.heading': '这条在世界里的什么时候',
  'time.edit.none': '这条没有时间',
  'time.edit.noneHint':
    '不设也完全没问题 —— 一条规则、一个地名，本来就没有「什么时候」可言。设了才会出现在时间轴上。',
  'time.edit.set': '设个时间',
  'time.edit.unset': '去掉时间',
  'time.edit.from': '起始',
  'time.edit.fromPlaceholder': '例如「涨潮纪十二年」',
  'time.edit.to': '终结',
  'time.edit.toPlaceholder': '例如「涨潮纪三十九年」',
  'time.edit.toAt': '终点的位置',
  'time.edit.toAtHint':
    '可选 —— 填了这段跨度才会按比例画在轴上；不填就只标出一段虚线（长度是画的，不代表真实跨度）。',
  'time.edit.at': '轴上的位置',
  'time.edit.atHint':
    '数字越小越靠前，数值的差就是轴上的距离 —— 轴上拖节点改的也是它。留空会排在现有条目的最后，那只是「先来后到」，不是真实年代。',
  'time.edit.era': '纪元',
  'time.edit.eraPlaceholder': '同一段的时间会连成一条色带，例如「涨潮纪」',
  'time.edit.weight': '分量',
  'time.edit.lock': '锁定（位置与时间文字绑定）',
  'time.edit.lockHint':
    '锁定时「120 年」就是位置 120、「120 年 6 月」就是 120.5 —— 改文字位置跟着走，拖位置文字跟着重写。文字写的是「涨潮纪」这种算不出数字的纪元时锁不住，会退回普通条目。',
  'time.edit.linkHint': '正文里写清楚经过就行 —— 这条本身就是那个时间点。',

  /* ---------- 提示 ---------- */
  'time.toast.set': '已给「{title}」设上时间',
  'time.toast.unset': '已去掉「{title}」的时间',
  'time.toast.moved': '「{title}」挪到了位置 {n}',
  'time.toast.added': '已添上「{title}」，接着把它写清楚',
  'time.toast.placed': '「{title}」排进时间轴了 —— 想把时间说清楚，在右边面板里改',
} as const;
