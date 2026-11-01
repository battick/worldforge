export default {
  /* ---------- 页面标题与整体 ---------- */
  'graph.title': '时间与关系',
  'graph.panel.desc':
    '两个看法，同一份数据：**关系**里节点是条目、连线是关系；**时间**里排的是设了时间的条目。悬停看简介，双击改名，右键改颜色/连关系 —— 孤立点就是世界观里还没接上的部分。',
  'graph.view.relations': '关系',
  'graph.view.time': '时间',
  'graph.view.relationsHint': '条目是一张网：谁和谁有关系',
  'graph.view.timeHint': '条目是一根轴：什么先、什么后',
  'graph.view.timeBadge': '{n} 条有时间',
  'graph.view.chronicle': '编年',
  'graph.view.chronicleHint': '条目排成一部编年：卡片在上、跨度在下，同一套横坐标',
  'graph.panel.showPending': '显示待定关系',
  'graph.panel.byWeight': '按联系轻重',
  'graph.panel.byWeightHint':
    '条目一多，先看枢纽：连得多的圆更大、更实，连得少的浅一点、名字也淡。想全都一样大就取消勾选。',
  'graph.panel.startLinkHint': '从当前选中的节点开始连一条新关系',
  'graph.panel.aiRecommend': '让 AI 推荐关系',
  'graph.panel.relayout': '重排',
  'graph.panel.linkBanner':
    '连线模式：正在从「{from}」出发 —— 点另一个节点就建立关系（会沿用上次的类型「{type}」），Esc 取消。',
  'graph.panel.noWorld': '请先创建一个世界',

  /* ---------- toast / 提示消息 ---------- */
  'graph.panel.toast.renamed': '已改名为「{name}」',
  'graph.panel.toast.needNode': '先点一个节点，再点这里开始连线',
  'graph.panel.toast.linkCancelled': '已取消连线',
  'graph.panel.toast.dupLink': '这两个条目之间已经有关系了，已为你选中那条连线',
  'graph.panel.toast.linkCreated': '已连上「{from} → {to}」，可改类型',
  'graph.panel.toast.noSuggestions': '没有发现新的关系建议',
  'graph.panel.toast.recommended': 'AI 推荐了 {n} 条关系，已进入审查队列',
  'graph.panel.toast.entryDeleted': '条目已删除',
  'graph.panel.toast.linkDeleted': '连线已删除',
  'graph.panel.toast.dirReversed': '已反转方向',

  /* ---------- 图谱概览（未选中时） ---------- */
  'graph.panel.overview.title': '图谱概览',
  'graph.panel.overview.nodes': '节点',
  'graph.panel.overview.links': '连线',
  'graph.panel.overview.isolated': '孤立点',
  'graph.panel.overview.densest': '最密节点',
  'graph.panel.overview.hint':
    '悬停节点看简介；双击改名；右键改颜色、连线、删除；点一条连线可以改它的类型与方向。',
  'graph.panel.overview.glossary': '术语',
  'graph.panel.overview.help1': '单击节点 = 选中（右侧变成快速编辑）',
  'graph.panel.overview.help2': '双击节点 = 就地改名，回车保存',
  'graph.panel.overview.help3': '右键节点 = 颜色 / 连线 / 删除',
  'graph.panel.overview.help4': '点「连线」再点两个节点 = 建立关系',
  'graph.panel.overview.help5': '点连线 = 改类型、反转方向、切换状态',
  'graph.panel.overview.help6': 'Esc = 取消当前操作',
  'graph.panel.overview.help7': '圆的轻重 = 联系的多少（连得多的大而实，可在上方关掉）',

  /* ---------- 侧栏：条目快速编辑 ---------- */
  'graph.panel.entry.label': '条目',
  'graph.panel.entry.selectHint': '单击节点选中',
  'graph.panel.entry.namePlaceholder': '条目名',
  'graph.panel.entry.saveHint': '改完回车或点开别处即保存（图谱上的标签会同步更新）',
  'graph.panel.entry.renameOnCanvas': '在图上改',
  'graph.panel.entry.category': '分类',
  'graph.panel.entry.status': '状态',
  'graph.panel.entry.nodeColor': '节点色',
  'graph.panel.entry.categoryColor': '分类色',
  'graph.panel.entry.aliases': '又名 {names}',
  'graph.panel.entry.relsTitle': '关联（{n}）',
  'graph.panel.entry.linkHint': '点这里，再去点另一个节点',
  'graph.panel.entry.relTypeHint': '关系类型，回车保存',
  'graph.panel.entry.jumpHint': '跳到这个条目',
  'graph.panel.entry.relStatusPendingHint': '待定关系，点击转为已定稿',
  'graph.panel.entry.relStatusCanonHint': '已定稿，点击退回待定',
  'graph.panel.entry.deselect': '取消选中',

  /* ---------- 右键快捷菜单 ---------- */
  'graph.menu.nodeColor': '节点颜色',
  /* 图谱快捷菜单里的「改名」——比通用按钮「重命名」更短，避免撑宽菜单 */
  'graph.menu.rename': '改名',
  'graph.menu.categoryColor': '分类颜色（影响「{name}」全部节点）',
  'graph.menu.linkFromHere': '从此节点连线',
  'graph.menu.confirmDeleteEntry': '删除条目「{name}」？与它相关的连线也会一并删除。',
  'graph.menu.deleteEntry': '删除条目',
  'graph.menu.relType': '关系类型',
  'graph.menu.reverse': '反转方向',
  'graph.menu.markCanon': '标记为已定稿',
  'graph.menu.markPending': '退回待定',
  'graph.menu.deleteLink': '删除这条连线',

  /* ---------- 悬停预览卡 ---------- */
  'graph.hover.aliases': ' ｜ 又名 {names}',
  /* 双向关系：两个方向各有一句（A 敌对 B / B 效忠 A），中间用这个符号接起来 */
  'graph.mutualSep': ' ⇄ ',
  'graph.hover.relCount': '关联 {n} 条：',
  'graph.hover.relMore': ' 等 {n} 条',
  'graph.hover.footNode': '双击改名 · 右键改颜色/连线 · 单击选中',
  'graph.hover.footLink': '单击选中后可改类型/方向/删除',
  'graph.noRelations': '还没有关联',

  /* ---------- 图例 ---------- */
  'graph.legend.dotHint': '点击改这个分类的节点颜色',
  'graph.legend.toggleHint': '点击隐藏/显示该分类',
  'graph.legend.count': '{name}（{n}）',
  'graph.legend.tips': '｜ 虚线 = 待定关系 ｜ 拖动节点摆位 ｜ 双击改名 ｜ 右键更多操作',
  'graph.legend.weight': '联系少 → 多',
  'graph.legend.weightHint': '圆的大小与深浅跟着联系的多少走 —— 只数看得见的连线',
  'graph.legend.catColorTitle': '{name} 的颜色',
  'graph.legend.catColorHint': '影响该分类下全部 {n} 个节点（单独改过颜色的条目不受影响）',

  /* ---------- 侧栏：连线编辑 ---------- */
  'graph.link.label': '连线',
  'graph.link.cancel': '取消连线',
  'graph.link.mutualHint': '这两个条目之间还有反向的一条：「{type}」。图上已合并成一条双箭头，两边各改各的。',
  'graph.link.type': '类型',
  'graph.link.typePlaceholder': '例如 隶属 / 效忠 / 敌对',
  'graph.link.direction': '方向',
  'graph.link.reverse': '反转',
  'graph.link.status': '状态',
  'graph.link.note': '备注',
  'graph.link.notePlaceholder': '这条关系为什么成立？',
  'graph.link.delete': '删除连线',

  /* ---------- 共用小部件 ---------- */
  'graph.customColor': '自定义颜色',
  'graph.restoreDefault': '恢复默认',
  'graph.defaultColor': '默认',
  'graph.followCategory': '跟随分类',
  'graph.deleted': '（已删除）',
  'graph.uncategorized': '未分类',
  'graph.openEntry': '打开条目详情',
} as const;
