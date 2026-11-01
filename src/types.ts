/**
 * WorldForge 数据模型
 * 所有实体都带 worldId，天然支持多世界；所有主键为字符串 id，
 * 便于未来从本地 IndexedDB 平移到云端表结构（字段名与列名一一对应）。
 *
 * 提示：这里只描述「数据长什么样」。任何要显示给人看的文字都不写死在本文件里，
 * 而是存一个 i18n 文案 key（如 PieceKindMeta.labelKey），由界面按当前语言取用。
 */

import type { MsgKey } from './i18n/translate';

export type ID = string;

/** 世界（顶层容器） */
export interface World {
  id: ID;
  name: string;
  tagline: string;
  summary: string;
  genre: string;
  /** 供 AI 参考的基调/风格约束，例如「低魔、冷峻、工业革命前夜」 */
  tone: string;
  themeColor: string;
  /**
   * 时间线曾是独立的一域（一条 `TimelineEvent` 一条记录）。现在时间挂在条目上，
   * 旧记录要在第一次打开这个世界时迁成条目。这里记下「已经迁过了」，
   * 否则每开一次都会再迁一遍 —— 那是会把作者的库越迁越乱的。
   */
  timelineMigratedAt?: number;
  createdAt: number;
  updatedAt: number;
}

/** 条目分类（人物 / 地理 / 势力 / 历史 / 设定体系 …） */
export interface Category {
  id: ID;
  worldId: ID;
  name: string;
  icon: string;
  /** 该分类下的结构化字段定义（可选，用于人物年龄、势力规模等） */
  fieldDefs: FieldDef[];
  /** 图谱节点颜色；缺省时按分类顺序取调色板 */
  color?: string;
  order: number;
  createdAt: number;
  updatedAt: number;
}

export interface FieldDef {
  key: string;
  label: string;
  placeholder?: string;
}

export type EntryStatus = 'draft' | 'pending' | 'canon';

/** 世界观条目 —— 知识库的最小单元 */
export interface Entry {
  id: ID;
  worldId: ID;
  categoryId: ID;
  title: string;
  /**
   * 世界内唯一标识：标题的归一化形态（见 `entryKey`）。
   * 同一世界里 key 不许重复 —— 这是「条目不重名」的硬约束，落库前拦截。
   * 标题改动时 key 跟着重算（并重新校验唯一性）。
   */
  key: string;
  /** 别名/旧称，用于检索与一致性检查 */
  aliases: string[];
  summary: string;
  /** Markdown 正文 */
  content: string;
  tags: string[];
  fields: Record<string, string>;
  status: EntryStatus;
  /** 图谱节点颜色（覆盖分类色）；缺省时用分类色 */
  color?: string;
  /**
   * 封面图：杂物间里一张图片的 id（`Piece.id`）。可选。
   *
   * 刻意只存一个引用而不把图塞进条目 —— 媒体文件属于整个世界（杂物间管着它），
   * 条目只是「用」它：同一张图可以同时是某条的封面和另一条正文里的插图，
   * 换图也只换一处。引用失效（那张杂物被删了）时界面如实说「已失效」。
   */
  cover?: ID;
  /**
   * 这个世界里的「什么时候」。可选 —— 没设的条目不会出现在时间轴上，
   * 但在关系图里照旧是一员。两处看的是同一份数据，不会打架。
   */
  time?: EntryTime;
  /** 来源资料 id 列表（可追溯到上传的原始文件） */
  sourceRefs: ID[];
  /** 由 AI 生成并采纳时记录来源任务 id */
  originTaskId?: ID;
  createdAt: number;
  updatedAt: number;
}

export type RelationStatus = 'pending' | 'canon';

/** 条目之间的关系 */
export interface Relation {
  id: ID;
  worldId: ID;
  fromEntryId: ID;
  toEntryId: ID;
  /** 关系类型，例如 隶属 / 效忠 / 敌对 / 位于 / 血缘 */
  type: string;
  note: string;
  status: RelationStatus;
  originTaskId?: ID;
  createdAt: number;
}

/* ------------------------------------------------------------------ */
/* 时间                                                                */
/*                                                                     */
/* 时间不是独立的一域，它是**条目自己的一个可选属性**：一个「人物」有生卒   */
/* 之年，一个「势力」有起讫，一件「事件」就是一个时间点。时间轴上的东西，   */
/* 因此永远等于「设了时间的那些条目」—— 不需要另建一套实体，也就不会再    */
/* 出现「事件」和「条目」两份说法对不上的情况。                          */
/*                                                                     */
/* 时间刻意存成两样东西：给眼睛看的 `from`/`to`（作者怎么写就怎么存，     */
/* 「涨潮纪 12 年」「第三纪·灰烬之年」都行）与给机器排序用的 `at`。        */
/* 只留一份文本的话，轴上的先后就只能靠字符串比较 —— 那会把             */
/* 「涨潮纪 9 年」排到「涨潮纪 10 年」后面。                            */
/* ------------------------------------------------------------------ */

/** 条目时间的分量：决定节点大小，以及标签要不要一直露着 */
export type TimeWeight = 'major' | 'normal' | 'minor';

export const TIME_WEIGHTS: TimeWeight[] = ['major', 'normal', 'minor'];

/**
 * 时间的三种形态。
 *
 * 刻意做成显式枚举而不是「看 `to` 空不空」去猜：作者填了终结时间、后来又删掉，
 * 那份空白既可能是「至今」也可能是「就是个时间点」—— 猜错会让轴上多出一段
 * 本来没有的跨度。让他明说。
 */
export type EntryTimeKind = 'point' | 'range' | 'ongoing';

/**
 * 条目的时间位置。整个字段可选 —— 大部分条目（一条规则、一个地名）根本没有
 * 「什么时候」可言，别逼作者填。
 */
export interface EntryTime {
  kind: EntryTimeKind;
  /** 起始（`point` 时它就是那个时间点）。世界内纪年，作者爱怎么写就怎么写 */
  from: string;
  /** 终结。只有 `kind === 'range'` 时才有意义 */
  to: string;
  /**
   * 排序用的数值位置。轴上的先后、间距与纪元分段全靠它。
   * 作者可以留空 —— 落库时按已有条目往后排一个；但那只是「先来后到」，
   * 不是真实年代，界面上要如实说明，别让人以为它算过。
   */
  at?: number;
  /**
   * 区间的**终点**数值位置（`kind === 'range'` 时可选）。
   *
   * 没有它，轴上就只能把「一段」标成一个横杠 —— 横杠的长度是编的，
   * 而编一个长度就是在替作者的数字撒谎。填了它就按比例画。
   * 「至今」不需要它：那一端永远在轴的右边缘上。
   */
  toAt?: number;
  /** 纪元 / 时代名。同一段的连成一条色带；留空 = 不属于任何纪元 */
  era: string;
  weight: TimeWeight;
  /**
   * 位置与时间文本是否**锁定**。
   *
   * 锁定时 `at` 严格等于 `from` 文本解析出来的数值（「120 年」= 120、「120 年 6 月」
   * = 120.5），两者永远对得上：作者改文本，位置跟着走；AI 排版挪了位置，文本跟着重写。
   * 解析不出来的（「涨潮纪」这种纯文字纪元）等于锁不住 —— 那条退化成普通条目，
   * 位置照旧由作者/排版定，不硬编一个数字。
   *
   * 新设时间的条目默认锁定（见 `DEFAULT_TIME`）；作者在编辑面板里可解锁，解锁后
   * 位置与文本各归各，互不牵连。
   */
  locked?: boolean;
}

/** 上传的资料文件 */
export interface SourceDoc {
  id: ID;
  worldId: ID;
  name: string;
  ext: string;
  size: number;
  /** 抽取出的纯文本 */
  text: string;
  /** 是否已用 AI 抽取过条目 */
  parsed: boolean;
  addedAt: number;
}

/* ------------------------------------------------------------------ */
/* 杂物间：设定之外的一切                                               */
/*                                                                     */
/* 条目库收的是「世界设定」，但一个活的世界远不止设定：还有随手写下的       */
/* 长文短文、碎片灵感、对某个事物的描述、个人剧情，以及图片/音频/视频。     */
/* 这些东西没有结构、不需要审查，放进杂物间就好——它们是 AI 理解这个世界     */
/* 口味的额外养分。                                                     */
/* ------------------------------------------------------------------ */

export type PieceKind =
  | 'long' // 长文
  | 'short' // 短文
  | 'fragment' // 碎片：一句话、一个念头
  | 'desc' // 对某个事物的描述
  | 'plot' // 个人剧情 / 角色故事线
  | 'image' // 图片
  | 'audio' // 音频
  | 'video' // 视频
  | 'other'; // 其他杂物

/** 文字类（存 markdown 正文，可送进 AI 上下文） */
export const TEXT_PIECE_KINDS: PieceKind[] = ['long', 'short', 'fragment', 'desc', 'plot'];

export interface PieceMedia {
  /** 原始文件名 */
  name: string;
  mime: string;
  size: number;
  /** 原始媒体数据（图片/音频/视频），直接以 Blob 存进 IndexedDB */
  blob: Blob;
}

/** 杂物间的一条藏品 */
export interface Piece {
  id: ID;
  worldId: ID;
  kind: PieceKind;
  title: string;
  /** 文字类：Markdown 正文；媒体类：备注/说明（可空） */
  content: string;
  tags: string[];
  /** 媒体文件（图片/音频/视频/其他文件类） */
  media?: PieceMedia;
  /** 图片缩略图（dataURL，列表展示用，避免整图解码） */
  thumb?: string;
  /** 关联的条目 id：这条杂物讲的是哪些条目 */
  linkedEntryIds: ID[];
  pinned: boolean;
  createdAt: number;
  updatedAt: number;
}

export interface PieceKindMeta {
  key: PieceKind;
  /** 显示名文案 key（i18n 的 kind.piece.<key>.label） */
  labelKey: MsgKey;
  /** 说明文案 key（i18n 的 kind.piece.<key>.hint） */
  hintKey: MsgKey;
  icon: string;
}

export const PIECE_KINDS: PieceKindMeta[] = [
  { key: 'long', labelKey: 'kind.piece.long.label', icon: '📜', hintKey: 'kind.piece.long.hint' },
  { key: 'short', labelKey: 'kind.piece.short.label', icon: '✏️', hintKey: 'kind.piece.short.hint' },
  {
    key: 'fragment',
    labelKey: 'kind.piece.fragment.label',
    icon: '🧩',
    hintKey: 'kind.piece.fragment.hint',
  },
  { key: 'desc', labelKey: 'kind.piece.desc.label', icon: '🔭', hintKey: 'kind.piece.desc.hint' },
  { key: 'plot', labelKey: 'kind.piece.plot.label', icon: '🎬', hintKey: 'kind.piece.plot.hint' },
  { key: 'image', labelKey: 'kind.piece.image.label', icon: '🖼️', hintKey: 'kind.piece.image.hint' },
  { key: 'audio', labelKey: 'kind.piece.audio.label', icon: '🎧', hintKey: 'kind.piece.audio.hint' },
  { key: 'video', labelKey: 'kind.piece.video.label', icon: '🎞️', hintKey: 'kind.piece.video.hint' },
  { key: 'other', labelKey: 'kind.piece.other.label', icon: '📦', hintKey: 'kind.piece.other.hint' },
];

export function pieceKindMeta(kind: PieceKind): PieceKindMeta {
  return PIECE_KINDS.find((k) => k.key === kind) ?? PIECE_KINDS[PIECE_KINDS.length - 1];
}

/* ------------------------------------------------------------------ */
/* AI 审查队列                                                         */
/* ------------------------------------------------------------------ */

export type ReviewKind =
  | 'create-entry'
  | 'update-entry'
  | 'delete-entry'
  | 'relation'
  | 'update-relation'
  | 'delete-relation'
  | 'consistency'
  /**
   * 一次「AI 自动排版」的结果：把一批条目摆到轴上的某些位置。
   *
   * 单独成一类，而不是拆成 N 条 `update-entry`：一次排版是一件事 ——
   * 它讲的是「这几条之间的先后」，拆开看每一条都只是「位置从 12 改成 30」，
   * 恰恰把最要紧的那层意思丢了。作者也要能一眼看完整张排布再决定。
   */
  | 'timeline-layout'
  /**
   * 一次「AI 猜测时间」的结果：给一批**还没设时间**的条目猜出「什么时候」，设进轴上。
   *
   * 与 `timeline-layout` 是两件事：排版只动「先后」（`at`），猜测要**凭空定出时间**
   * （`from` 文本 + `at` 位置）—— 后者更重，因为它在替作者编一个日期。所以两条
   * 命令并排挂在「AI 行为」子菜单里，但各自独立进审查，各是一张卡。
   */
  | 'timeline-guess';

export interface EntryChange {
  /** 变更字段名 */
  field: string;
  before: string;
  after: string;
}

/**
 * 一次排版方案里的一行：把某条条目摆到轴上的某个位置。
 *
 * 刻意**只带位置与分组**，不带时间文本 —— 作者写的「涨潮纪十二年」原样留着，
 * AI 只回答「谁先谁后」。让它顺手编一个日期，是这套东西最容易犯的错。
 */
export interface TimeLayoutItem {
  entryId: ID;
  /** 提这一条方案时它的名字。采纳时对不上就跳过（这期间改名或删掉了），并如实记账 */
  title: string;
  /** 排到哪个位置（数值越小越靠前）。轴上的先后与间距全靠它 */
  at: number;
  /** 区间的**终点**位置（可选，只在这条本来就是「一段」时有意义） */
  toAt?: number;
  /** 纪元（可选）。没给就不动作者原来填的 */
  era?: string;
  /** 分量（可选）。没给就不动 */
  weight?: TimeWeight;
  /**
   * **锁定条目的**新时间文本（可选）。
   *
   * 只有这条是锁定状态时才会出现：位置动了，文本必须跟着重写（120 → 130 就是
   * 「130 年」），否则锁定就名存实亡。非锁定条目绝不写这个字段 —— 作者写的是
   * 「涨潮纪十二年」这种不可折算的文字，硬塞一个数字进去等于吃掉他的措辞。
   */
  from?: string;
  /**
   * 它凭哪句话这么排。**必须来自条目本身**（时间文字、正文里的年代、因果先后）——
   * 这一栏是给作者判断的依据，不是给 AI 表功的。
   */
  reason: string;
  /** 排之前的位置；`null` = 这条当时还没排进轴 */
  fromAt: number | null;
}

/**
 * 这条提议是怎么生成的 —— 供「再一次生成」重新执行。
 *
 * 只记**可复现的输入**，不记整份快照（条目会变，快照一过期就重跑不出原味）。
 * 各类任务各记各的：`generate` 记分类与参数，`polish` 记目标条目与打磨方式，
 * `relations` / 时间轴类 / 一致性则只需记「是什么任务」，重跑时拿当下库重算。
 */
/**
 * 打磨的着力点（批量打磨里作者勾了哪些方向）。
 * 放在数据层，因为 ReviewSource（polish 的来源）要记它，供「再生成」复现。
 */
export type PolishFocus = 'detail' | 'style' | 'trim' | 'links' | 'conflict';

export type ReviewSource =
  | {
      task: 'generate';
      categoryId: ID;
      instruction: string;
      count: number;
      keywords: string;
      allowRelations: boolean;
    }
  | {
      task: 'polish';
      targetEntryId: ID;
      focus: PolishFocus[];
      instruction: string;
    }
  | { task: 'relations' }
  | { task: 'timeline-layout' }
  | { task: 'timeline-guess' }
  | { task: 'consistency' };

export interface ReviewItem {
  id: ID;
  worldId: ID;
  kind: ReviewKind;
  title: string;
  note: string;
  /** AI 为什么这么建议 */
  rationale: string;
  status: 'pending' | 'accepted' | 'rejected';
  createdAt: number;
  /**
   * 生成来源，供「再一次生成」重新执行当初那条任务。缺省（undefined）= 老数据 /
   * 没有可重跑来源的提议（如 delete-entry 这类纯删除动作），不摆「再生成」入口。
   */
  source?: ReviewSource;
  /**
   * 「再一次生成」替换掉的那份旧提议的完整快照。
   * 只在**被重跑过**的提议上出现：作者点「撤回」时用它恢复旧结果，让重跑可反悔。
   */
  superseded?: ReviewItem;
  /**
   * 这条提议是谁提的。
   * 缺省（undefined）= 资料抽取 / 批量生成那几条老路径；'agent' = 工作台里的内置 agent。
   * 审查页据此标出来源 —— 作者有权知道他面对的是一台「照文档抄」的机器，还是一个会自己联想的。
   */
  origin?: 'agent';
  /** origin = 'agent' 时，它出自哪段会话 */
  sessionId?: ID;
  /**
   * 这一条属于哪一次批量操作（批量打磨 / 批量生成一次跑出来的提议共用一个 id）。
   * 审查页据此把同批的归到一起，并提供「采纳这一批」——
   * 否则作者得从一堆混在一起的卡片里自己找出刚跑的那批，一条条点。
   */
  batchId?: ID;
  /**
   * kind = create-entry 时的新条目草稿；kind = update-entry 时目标条目的改后字段。
   * `time` 额外允许 `null`：update-entry 里用它表示「把这条条目从时间轴上摘掉」
   * （undefined = 这次没碰时间）。create-entry 不传 null。
   */
  entryDraft?: Omit<Partial<Entry>, 'time'> & { time?: EntryTime | null };
  /** kind = timeline-layout 时的逐条方案（只列**会变的**那些，一条不动的不会出现在这里） */
  layoutDraft?: TimeLayoutItem[];
  /**
   * kind = timeline-guess 时的逐条猜测（给还没设时间的条目定出时间）。
   * 结构与 `layoutDraft` 复用 `TimeLayoutItem`：猜测也是一次「摆到轴上」，只是连
   * 时间文本一起给。`fromAt` 恒为 `null`（这些条目当时都在池子里）。
   */
  guessDraft?: TimeLayoutItem[];
  /** kind = update-entry 时目标条目与字段级 diff */
  targetEntryId?: ID;
  changes?: EntryChange[];
  /** kind = relation */
  relationDraft?: { fromEntryId: ID; toEntryId: ID; type: string; note: string };
  /** kind = update-relation / delete-relation 时目标关系 id */
  targetRelationId?: ID;
  /** kind = consistency */
  severity?: 'high' | 'medium' | 'low';
  relatedEntryIds?: ID[];
  suggestion?: string;
}

/* ------------------------------------------------------------------ */
/* 新建世界：共创草稿                                                   */
/*                                                                     */
/* 这个世界在被「确认」之前，一切都只存在于草稿里。                     */
/* 用户投喂的素材、AI 的提问与回答、AI 统筹出的设定草案，都先落在草稿， */
/* 只有用户点了确认，才会真正写进 worlds / categories / entries。        */
/* ------------------------------------------------------------------ */

/** 用户投喂的一条素材 */
export interface DraftMaterial {
  id: ID;
  /** file=上传的文件；text=粘贴的一段文字；rule=用户现写的规则；image=图片 */
  kind: 'file' | 'text' | 'rule' | 'image';
  name: string;
  /** 抽取出的文本（图片为空） */
  text: string;
  /** 图片：压缩后的 dataURL，供模型读取 */
  dataUrl?: string;
  /** 图片：小尺寸缩略图，仅用于界面展示 */
  thumb?: string;
  /** 用户对这条素材的补充说明（例如「这张图是主角服饰」） */
  note?: string;
  size?: number;
  chars?: number;
  /** 解析过程中的提示（格式不支持、被截断等） */
  warning?: string;
  addedAt: number;
}

/** AI 提出、等待用户回答的问题 */
export interface DraftQuestion {
  id: ID;
  question: string;
  /** AI 解释为什么需要问这个 */
  why: string;
  /** AI 给的建议答案，用户可一键采用 */
  suggest: string[];
  answer: string;
  /** 用户选择了「你来定」 */
  delegated: boolean;
}

export interface ProposalCategory {
  name: string;
  icon: string;
  desc: string;
}

export interface ProposalEntry {
  id: ID;
  title: string;
  /** 所属分类名（对应 ProposalCategory.name） */
  category: string;
  aliases: string[];
  summary: string;
  content: string;
  tags: string[];
  /** 用户可取消勾选，不勾选的不会写入 */
  included: boolean;
}

export interface ProposalRelation {
  from: string;
  to: string;
  type: string;
  note: string;
  included: boolean;
}

/** AI 统筹出的世界设定草案 */
export interface WorldProposal {
  name: string;
  tagline: string;
  genre: string;
  /** 创作纪律（会原文注入每次 AI 生成） */
  tone: string;
  /** 世界简介 / 核心前提 */
  summary: string;
  themeColor: string;
  /** 世界的底层规则 */
  rules: string[];
  categories: ProposalCategory[];
  entries: ProposalEntry[];
  relations: ProposalRelation[];
  /** AI 仍然拿不准、建议用户拍板的点 */
  openQuestions: string[];
  /** AI 说明它是怎么统筹的 */
  rationale: string;
}

export type DraftStage = 'materials' | 'align' | 'proposal';

/** 一次「新建世界」的完整过程 */
export interface WorldDraft {
  id: ID;
  stage: DraftStage;
  materials: DraftMaterial[];
  /**
   * 作者单方面向 AI 交代的话（不针对任何问题，也不是素材）。
   * 优先级最高：AI 必须完全遵守，与素材/自己的判断冲突时以此为准。
   */
  told: { id: ID; text: string; createdAt: number }[];
  /** 累计的问答记录（跨轮次保留），每次生成草案都会一并送给模型 */
  qa: { question: string; answer: string; delegated: boolean }[];
  /** 当前这一轮还没回答的问题 */
  questions: DraftQuestion[];
  /** AI 读完素材后给出的理解 */
  understanding: string;
  /** AI 观察到的矛盾/空白 */
  observations: string[];
  /** 已经问过几轮（用于避免无休止追问） */
  round: number;
  /** AI 认为信息已足够，可以起草 */
  readyToDraft: boolean;
  proposal: WorldProposal | null;
  /** 用户对草案提过的修改意见，用于追溯 */
  revisions: string[];
  createdAt: number;
  updatedAt: number;
}

/* ------------------------------------------------------------------ */
/* 设置                                                                */
/* ------------------------------------------------------------------ */

/**
 * `response_format` 的策略。
 *
 * 做成三态而不是一个「开/关」的勾，是因为两边都会出事：
 *   - `always` —— 有的网关（或本地推理服务）不认这个字段，一家伙 400；
 *   - `never`  —— 反过来，有些自建网关只在明确要求 JSON 时才把 JSON 吐利索。
 * `auto` 就是「按每个任务本来的需要决定」，也就是原来的行为。
 */
export type AIJsonMode = 'auto' | 'always' | 'never';

export interface AISettings {
  provider: string;
  baseUrl: string;
  apiKey: string;
  model: string;
  temperature: number;
  /** 单次生成送入模型的现有条目数量上限 */
  contextLimit: number;
  /** 模型是否支持读图；关闭或模型不支持时会自动跳过图片素材 */
  vision: boolean;

  /* ------------------------------------------------------------------ */
  /* 更细的请求配置                                                       */
  /*                                                                     */
  /* 下面这些都**可选**。设置是存在浏览器里的整块 JSON，老版本存下来的对象  */
  /* 里没有这些键 —— 载入时 `store` 会和 `DEFAULT_AI_SETTINGS` 合并，所以   */
  /* 这里留可选，读的时候按「没设过 = 用默认」处理，不要写成非空断言。       */
  /* ------------------------------------------------------------------ */

  /**
   * 每个厂商各记一个型号。
   *
   * 原先切厂商会把型号直接覆盖成该厂商的第一个，切回去自己的选择就没了 ——
   * 而「换个模型试试」恰恰是要来回切的动作。
   */
  modelByProvider?: Record<string, string>;
  /**
   * 每个厂商各记一个**改过的**地址。
   *
   * 只记「和官方地址不一样」的那些 —— 多半是把某个预设指向了中转站或自建网关。
   * 不记这一笔的话，「切去别家看一眼再切回来」会静默把地址还原成官方的，
   * 而对够不到官方域名的人来说，那等于把配置弄坏了。
   * 界面上有「恢复官方地址」，所以记下来不会把人困住。
   */
  baseUrlByProvider?: Record<string, string>;
  /** 选过 / 手填过的型号，最近的在前。给下拉面板顶上那组「最近用过」用 */
  recentModels?: string[];
  /**
   * 一轮自动探测最多试几个型号。
   *
   * 每一次「探一下」都是**一条真实的对话请求**，所以这个数就是作者要发给厂商的请求数。
   * 默认见 `PROBE_LIMIT`（40）：清单动辄一两百条，全打一遍对厂商是骚扰、对中转站
   * 更容易直接吃限流 —— 而限流之后耽误的是作者真正的活。
   * 设成比默认大（或勾上 `probeUnlimited`）当然可以，只是代价要作者自己认。
   */
  probeLimit?: number;
  /**
   * 探测不设上限：整个清单都试一遍。
   *
   * 单独留一个开关（而不是用 `probeLimit: 0` 这种哨兵值）有两个原因：
   * ① 0 太容易被读成「一个都别探」；② 勾上再取消时，作者调的数目还在。
   */
  probeUnlimited?: boolean;
  /** 单次回复的 token 上限；0 = 不传，交给厂商默认 */
  maxTokens?: number;
  /** top_p；1 = 不传（多数厂商默认就是 1） */
  topP?: number;
  /** 关掉 SSE 流式。有的网关流式不老实（少包、乱序），关掉反而稳 */
  stream?: boolean;
  /** `response_format` 策略，见 `AIJsonMode` */
  jsonMode?: AIJsonMode;
  /**
   * 自定义请求头，写成一个 JSON 对象文本。
   *
   * 存文本而不是对象，是为了「作者正在敲一半」时不被吃掉 —— 中途那不是合法 JSON，
   * 存成对象就得丢弃或者憋着不落盘，两种都别扭。
   */
  extraHeaders?: string;
  /** 额外请求体字段（JSON 对象文本），与内置参数合并；`messages` 不许覆盖 */
  extraBody?: string;
}

export interface AppSettings {
  ai: AISettings;
  activeWorldId: ID | null;
}

/* ------------------------------------------------------------------ */
/* 世界问答                                                            */
/* ------------------------------------------------------------------ */

export interface ChatMessage {
  id: ID;
  role: 'user' | 'assistant';
  content: string;
  /** 引用的条目 */
  cites?: { id: ID; title: string }[];
  createdAt: number;
}

/* ------------------------------------------------------------------ */
/* 操作日志                                                            */
/*                                                                     */
/* 库里发生的每一次写入都留一条记录，不管是作者亲手点的，还是工作台里的    */
/* agent 替他做的。记录里带一份「撤销快照」，因此任何一步都能原样退回去。  */
/*                                                                     */
/* 注意：这里只存结构化事实（谁、对哪种东西、做了什么、对象叫什么），     */
/* 面向人的措辞（「新建了条目」）由界面按当前语言拼，不落库 —— 否则       */
/* 切换语言后历史记录会卡在旧语言上。                                     */
/* ------------------------------------------------------------------ */

/** 这次操作是谁发起的 */
export type OpActor = 'user' | 'agent';

export type OpAction = 'create' | 'update' | 'delete' | 'note' | 'view' | 'propose';

/** 被操作的实体种类（对应一个 store；settings 与 note 例外，没有独立的 store） */
export type OpEntity =
  | 'world'
  | 'category'
  | 'entry'
  | 'relation'
  | 'doc'
  | 'piece'
  /** 纯留痕：不改变任何数据，只记一句话（agent 的「记录」能力） */
  | 'note'
  | 'settings'
  /**
   * 审查队列里的一条提议。
   *
   * 只出现在**撤销快照**里（撤回一条提议 = 把这条待审记录删掉），
   * 不会作为日志行的实体出现：日志行说的是「AI 提议新增了条目「X」」，
   * 实体记的是那条**条目**，这样整句才读得通。所以它也不进日志页的筛选条。
   */
  | 'review';

/**
 * 撤销一步操作所需的信息。
 *
 * 三件事可以同时发生，所以用「集合」而不是「二选一」：
 * 删条目会连带删掉它的关系（写入时要删两条），删分类会连带删掉分类下的条目。
 * 只记主对象会让撤销留下孤儿数据 —— 那样还不如不给撤销。
 */
export type OpUndo = {
  /** 撤销「新增」：把当时建出来的东西删掉 */
  remove?: { entity: OpEntity; id: ID }[];
  /** 撤销「修改 / 删除」：把改动前（或被删掉）的完整对象写回去 */
  restore?: { entity: OpEntity; item: unknown }[];
  /** 一并恢复的设置快照（例如删世界后要切回去的那个「当前世界」） */
  settings?: AppSettings;
};

export interface OpLog {
  id: ID;
  /** 世界级操作；null = 全局操作（如改设置、记一条全局笔记） */
  worldId: ID | null;
  actor: OpActor;
  action: OpAction;
  entity: OpEntity;
  /** 被操作对象的显示名（用户数据，如条目标题）—— 不翻译，原样存 */
  target: string;
  /** 目标 id，供日志页跳转 */
  targetId?: ID;
  /** 补充说明：agent 给的理由、或用户写的备注 */
  detail: string;
  /** update 时被改动的字段名列表 */
  fields?: string[];
  /** 撤销上一次的凭据；null = 这步不可撤销（如纯记录） */
  undo: OpUndo | null;
  /** 已经被撤销过 */
  undone: boolean;
  /** 同属一段 agent 会话的操作共享此 id */
  sessionId?: ID;
  createdAt: number;
}

/* ------------------------------------------------------------------ */
/* 工作台 agent 会话                                                    */
/* ------------------------------------------------------------------ */

/** agent 的执行边界 —— 三种放手程度 */
export type AgentMode = 'plan' | 'auto' | 'hybrid';

/** 一次工具调用（在对话里留痕，用户能看到 agent 到底动过什么） */
export interface AgentToolCall {
  id: ID;
  tool: string;
  args: Record<string, unknown>;
  /** agent 说明为什么要做这一步 */
  why: string;
  status: 'pending' | 'done' | 'failed' | 'skipped';
  /** 执行结果摘要（成功时的一句话，失败时的原因） */
  result: string;
  /** 这一步产生的操作日志 id，便于就地撤销 */
  opIds?: ID[];
  /**
   * 这一步没有直接落库，而是写进了审查队列（新建条目 / 连到待审条目上的关系）。
   * 回执据此挂一个「去审查」的入口：提了案，就得让人一眼看到案子在哪。
   */
  review?: boolean;
}

/** 对话里的一轮 */
export interface ChatTurn {
  id: ID;
  role: 'user' | 'assistant';
  content: string;
  /** assistant：引用了哪些条目 */
  cites?: { id: ID; title: string }[];
  /** assistant：这一轮调用过的工具 */
  calls?: AgentToolCall[];
  /** assistant：这一轮因为执行边界被暂缓、等待作者拍板 */
  pending?: { calls: AgentToolCall[] } | null;
  /**
   * assistant：这一轮模型没按约定的 JSON 协议回（说了一段话或格式不成形）。
   * 记的是**实际处置**：已请它重说一遍、就此收工、还是**替它补齐了括号照常执行**。
   * 刻意不靠「它在列表里是不是最后一条」去猜 —— 那样界面上会先显示一种说法、
   * 下一轮到了又翻成另一种，作者看到的是闪烁的谎话。
   *
   * 第三种是真实翻车逼出来的：它一口气提 8 个动作、每个动作对象少写一个 `}`，
   * 解析层现在能把这种「结构在、少一个括号」修回来（动作一个不丢）。
   * 修好了也得说 —— 不说，作者就以为这模型很乖，下次碰上真救不回来的那回反倒莫名其妙。
   */
  protocolBroken?: 'retried' | 'gaveUp' | 'repaired';
  /**
   * assistant：它连着几步都没有收获，被循环拦下来停住了。
   * 界面要如实说这件事 —— 作者最怕的是「它到底在忙什么」这种不透明。
   *
   * 值要说清**是哪种没收获**，因为两者该做的事正好相反：
   *   - `'empty'`：查不到 → 该给它线索，或者让它来问；
   *   - `'badCall'`：动作写错了（参数名/必填）→ 该告诉它用哪个动作、参数怎么给。
   * 循环那边已经分开了，界面这里再合并回一句话，等于白分。
   */
  stuck?: 'empty' | 'badCall';
  /**
   * assistant：这一轮就结束了，但**交代还没做完**（清单上还剩几条）。
   *
   * 留着它是为了不许「带着一堆没做的事悄悄收工」：模型连着被催了还不接着做时，
   * 循环会把剩下的条数记在这里，界面上明明白白摆出来 —— 而不是让作者以为已经全补完了。
   */
  todoLeft?: number;
  /**
   * assistant：这一轮是**循环自己收的尾**（事情最多来回 20 轮，跑满了）。
   *
   * 跟 `todoLeft` 同族、单独记一份的理由也一样：那段话是循环说的，不是它说的。
   * 带进下一轮的语境里，它会以为那是自己讲过的话。
   */
  exhausted?: boolean;
  /**
   * assistant：它上一条话里说「我接下来还要做…」，可再问一轮它还是没给动作。
   *
   * 单独标出来是因为那句承诺**挂在 UI 上没人兑现**：作者会一直等一个不会来的下一轮。
   * 界面上明说「它说了要接着做，但没有动作」—— 要么给他线索，要么让它先停下来问。
   */
  promised?: boolean;
  /**
   * assistant：它交回话的时候，顺手给的**下一步可以做点什么**。
   *
   * 挂在轮次上而不是留在运行态里，是因为它跟那句话是一体的 ——「导师的动机是……」
   * 下面紧接着「我可以把这段补进正文 / 构思『神祇的监管』条目」，作者一眼就知道
   * 下一句该说什么；等他切页回来、或者过一会儿再看，这几颗按钮还在原地。
   *
   * 界面把它渲染成**一点就跑**的按钮（不是填进输入框让你再按回车）：
   * 作者抱怨的正是「它答得太简单，然后我自己还得想接着问什么」。
   * 点了之后照旧走「放手程度」那三道闸，所以「直接跑」不等于「直接改库」。
   */
  suggest?: AgentSuggestion[];
  createdAt: number;
}

/**
 * agent 建议的下一步。
 *
 * 刻意分 `label` / `goal` 两栏：按钮上要短（「构思『导师』条目」），
 * 点下去交给它的那句话可以更长、更完整（「读一遍『导师』条目，然后按它的内容
 * 提一条新条目的建议」）。只给一句话时两栏一样。
 */
export interface AgentSuggestion {
  /** 按钮上那几个字，要一眼读完 */
  label: string;
  /** 点下去真正发给它的那句话 */
  goal: string;
}

/**
 * 一次交代里，agent 自己维护的**待办清单**上的一条。
 *
 * 为什么要有它：「把所有提到过、但还没建的补全」这类**清点式**任务，一趟要做很多件、
 * 跨很多轮。没有清单时，模型读了三五条就以为「差不多了」，然后说一句「接下来我将继续……」
 * 就收工了 —— 作者看到的是一件半成品，而他无从判断到底漏了多少。
 *
 * 清单是**它自己的账**：写在会话上（刷新还在），每轮随系统提示词一起回到它眼前，
 * 界面上也摆给作者看。它不必一次写完，可以边做边补、边做边勾。
 */
export interface AgentTodoItem {
  /** 一件要做的事，一句话（「读『幽暗沼泽的诅咒』」） */
  text: string;
  done: boolean;
}

/** 一段和工作台 agent 的会话 */
export interface ChatThread {
  id: ID;
  worldId: ID;
  title: string;
  turns: ChatTurn[];
  /**
   * 这一段会话里 agent 给自己立的待办清单（见 `AgentTodoItem`）。
   * 挂在会话上而不是运行态里：切页、刷新之后它还得在 —— 否则作者回来时
   * 既看不到还剩什么，agent 也把进度忘光了。
   */
  todos?: AgentTodoItem[];
  createdAt: number;
  updatedAt: number;
}

/* ------------------------------------------------------------------ */
/* Wiki 的三个子页                                                      */
/*                                                                     */
/* 「条目库」和「杂物间」原本并排摆在侧栏里。它们其实是同一件事的两面 ——  */
/* 都在讲这个世界里有什么，只是「条目库」长了一副编辑器的样子，作者想**读**  */
/* 的时候没有地方可去。所以现在合成一页（Wiki），而这一页里分三种看法：    */
/*                                                                     */
/*   display — 像知识库那样读：瀑布流卡片墙 + 条目阅读视图               */
/*   entries — 像编辑器那样改：原来的条目库                              */
/*   pieces  — 杂物间：碎片与媒体，还没归到条目里的东西                  */
/*                                                                     */
/* 视图名用**英文名词**而不是界面措辞：界面语言可以切换，这几个值不会。    */
/* 它们同时是路由别名（`#entries` / `#pieces` 仍然落在对应子页上）与       */
/* agent 回执里「落在哪一支」的说法。                                    */
/* ------------------------------------------------------------------ */

export type WikiView = 'display' | 'entries' | 'pieces';

export const WIKI_VIEWS: WikiView[] = ['display', 'entries', 'pieces'];

/** 判断一个来路不明的值是不是合法的子页名（路由与 agent 入参都用它把门） */
export function isWikiView(v: unknown): v is WikiView {
  return typeof v === 'string' && (WIKI_VIEWS as string[]).includes(v);
}
