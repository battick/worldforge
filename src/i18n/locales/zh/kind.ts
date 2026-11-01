/**
 * 内置枚举的显示名：条目/关系状态、杂物间类型、审查提议类型。
 * 注意：数据里存的始终是英文枚举值（'draft' / 'long' …），这里只负责显示。
 * 命名空间约定：`kind.*`
 */
export default {
  'kind.status.draft': '草稿',
  'kind.status.pending': '待定',
  'kind.status.canon': '已定稿',
  'kind.status.accepted': '已采纳',
  'kind.status.rejected': '已拒绝',
  'kind.status.pendingReview': '待审',

  'kind.rel.pending': '待定',
  'kind.rel.canon': '已定稿',

  /* 关系类型的默认值与候选词（关系类型本身是自由文本，这里只是新建时的建议） */
  'kind.relType.connected': '关联',
  'kind.relType.related': '相关',
  'kind.relType.membership': '隶属',
  'kind.relType.allegiance': '效忠',
  'kind.relType.hostility': '敌对',
  'kind.relType.location': '位于',
  'kind.relType.kinship': '血缘',
  'kind.relType.mentorship': '师徒',
  'kind.relType.possession': '持有',
  'kind.relType.causality': '因果',

  'kind.pieceSection.text': '文字',
  'kind.pieceSection.media': '媒体',

  'kind.piece.long.label': '长文',
  'kind.piece.long.hint': '完整的文章、设定阐述',
  'kind.piece.short.label': '短文',
  'kind.piece.short.hint': '几百字的小段落',
  'kind.piece.fragment.label': '碎片',
  'kind.piece.fragment.hint': '一句话、一个念头',
  'kind.piece.desc.label': '描述',
  'kind.piece.desc.hint': '对某个事物的描写',
  'kind.piece.plot.label': '剧情',
  'kind.piece.plot.hint': '个人剧情、角色故事线',
  'kind.piece.image.label': '图片',
  'kind.piece.image.hint': '插画、截图、地图',
  'kind.piece.audio.label': '音频',
  'kind.piece.audio.hint': '配乐、环境音、语音',
  'kind.piece.video.label': '视频',
  'kind.piece.video.hint': '参考片段、动效',
  'kind.piece.other.label': '其他',
  'kind.piece.other.hint': '什么都行，先放进来',

  'kind.review.create-entry': '新建条目',
  'kind.review.update-entry': '修订条目',
  'kind.review.delete-entry': '删除条目',
  'kind.review.relation': '新增关系',
  'kind.review.update-relation': '修订关系',
  'kind.review.delete-relation': '删除关系',
  'kind.review.consistency': '一致性问题',
  'kind.review.timeline-layout': '时间轴排版',
  'kind.review.timeline-guess': 'AI 猜时间',

  'kind.severity.high': '严重',
  'kind.severity.medium': '中等',
  'kind.severity.low': '轻微',
  /** 状态胶囊里用的短版（只占一个字，避免撑破 pill） */
  'kind.severity.short.high': '高',
  'kind.severity.short.medium': '中',
  'kind.severity.short.low': '低',
} as const;
