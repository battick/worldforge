/**
 * 工作台 agent 的工具箱 —— 它唯一能碰数据的手。
 *
 * 设计上的几条底线：
 * 1. **指认只用标题/别名**。模型不该知道、也不该编造 id，所以所有入口参数都是
 *    人类可读的名字，由这里解析成 id。
 * 2. **读写分明**。`risk` 决定它在「混合 / 计划模式」下会不会被拦下来等作者点头。
 * 3. **回执要说人话**。`summary` 是给作者看的一句话（走 i18n），`data` 是回灌给
 *    模型的细节 —— 两者都返回，各取所需。
 * 4. **视图操作不抢方向盘**。navigate 只记下「建议去哪个页面」，由界面渲染成
 *    一个可点的跳转按钮 —— 否则 agent 会在你读它回复时把页面直接拽走。
 */
import type {
  AppSettings,
  Category,
  Entry,
  EntryTime,
  EntryTimeKind,
  ID,
  Piece,
  PieceKind,
  Relation,
  ReviewItem,
  TimeWeight,
  World,
} from '../../types';
import { TEXT_PIECE_KINDS, TIME_WEIGHTS } from '../../types';
import type { StoreValue } from '../../state/store';
import { entryKey, now, uid } from '../../lib/id';
import { runPolish, runTimelineLayout, runTimelineGuess } from '../tasks';
import { POLISH_FOCUS, type PolishFocus } from '../prompts';
import { tGlobal, type MsgKey } from '../../i18n/translate';

/** 一次批量打磨最多处理几条。再多就该让作者自己分批 —— 见工具内的注释 */
const POLISH_MAX = 8;

/**
 * 把模型写来的着力点认出来。
 *
 * 参数清单里给的是英文键（detail / style / …），但模型很容易顺手写中文
 * （「补全细节」）或写成别的说法。认不出就丢掉太浪费 —— 那等于让它白写一句意图。
 * 所以这里做一次宽松匹配，实在认不出再放弃（放弃只是不指定着力点，不是错误）。
 */
function resolvePolishFocus(raw: unknown): PolishFocus | null {
  const key = str(raw).trim().toLowerCase();
  if (!key) return null;
  const hit = POLISH_FOCUS.find((f) => f === key);
  if (hit) return hit;
  // 中文说法也认（模型经常顺手写「补全细节」而不是 detail）。
  // 这是**解析用的关键词表**，不是界面文案 —— 模型用哪种语言说，跟界面语言无关，
  // 所以不跟着语言包走；行尾的 i18n-allow 正是这个意思。
  const hints: Record<PolishFocus, string[]> = {
    detail: ['detail', '细节', '补全', '扩写', '展开'], // i18n-allow
    style: ['style', '文风', '风格', '术语', '统一', '口吻'], // i18n-allow
    trim: ['trim', '精简', '去水', '压缩', '删减', '冗'], // i18n-allow
    links: ['link', '关联', '关系', '互链', '连接'], // i18n-allow
    conflict: ['conflict', '冲突', '矛盾', '一致', '核对'], // i18n-allow
  };
  return POLISH_FOCUS.find((f) => hints[f].some((h) => key.includes(h))) ?? null;
}

export interface AgentContext {
  store: StoreValue;
  /** 本段会话的 id，写进操作日志用于归类 */
  sessionId: ID;
  /**
   * 模型给这一步写的 why。
   * 工具把它一并记进「审查项」的 rationale —— 作者在审查页看到的那句「AI 依据」，
   * 就是它当时给自己的辩解，而不是事后补的。
   */
  why?: string;
  /**
   * 作者按「停止」时会被 abort。
   *
   * 只有会自己调模型的工具（批量打磨）用得上 —— 其余工具都是一次快的库操作，
   * 没有可中断的中间态。但批量打磨一跑就是十几次模型往返，作者按了停止却停不下来，
   * 是那种「只能看着它烧 token」的体验，所以这条信号必须一路传下去。
   */
  signal?: AbortSignal;
}

export interface ToolOutcome {
  ok: boolean;
  /** 给作者看的一句话 */
  summary: string;
  /** 回灌给模型的细节 */
  data?: unknown;
  /**
   * 这次动作明明成功了，但什么都没捞到（查询零命中、列表为空）。
   *
   * 单独标出来是因为它对模型的意义完全不同：「没有结果」意味着**信息不足**，
   * 该做的是去问作者，而不是换个关键词接着查。执行循环靠这个标记识别打转。
   */
  empty?: boolean;
  /**
   * 这一步没有直接落库，而是写进了审查队列等作者拍板。
   * 界面据此在回执后面挂一个「去审查」的入口 —— 光说「已进审查队列」而不给门，
   * 作者还得自己猜那扇门在哪。
   */
  proposal?: boolean;
  /**
   * 这次失败是**调用格式**不对（缺必填、参数名不认、工具名不存在），不是「没查到」。
   *
   * 两者对模型的要求正好相反：查不到要它去问作者，格式不对要它照着重写。
   * 混成一句「没收获」的话，打转护栏给出的建议就会是错的（叫它去问，而它该做的是改调用）。
   */
  badCall?: boolean;
}

/**
 * 工具名的全集。
 *
 * 收成联合类型是为了让 `TOOL_LABEL` 能强制「每个工具都有界面标签」——
 * 新增一个工具却忘了给它起名字，tsc 会直接拦下来。
 */
export type AgentToolName =
  | 'world_overview'
  | 'search_entries'
  | 'read_entry'
  | 'list_relations'
  | 'list_timeline'
  | 'list_pieces'
  | 'list_docs'
  | 'read_doc'
  | 'list_review'
  | 'list_ops'
  | 'create_entry'
  | 'update_entry'
  | 'polish_entries'
  | 'delete_entry'
  | 'create_relation'
  | 'update_relation'
  | 'delete_relation'
  | 'create_category'
  | 'update_category'
  | 'delete_category'
  | 'update_world'
  | 'create_piece'
  | 'update_piece'
  | 'delete_piece'
  | 'add_doc'
  | 'delete_doc'
  | 'update_settings'
  | 'layout_timeline'
  | 'guess_timeline'
  | 'navigate'
  | 'note'
  | 'ask_author';

export interface AgentTool {
  name: AgentToolName;
  /** 读 = 不改数据；写 = 会落库（受执行边界约束） */
  risk: 'read' | 'write';
  /** 必需参数名。执行前会按它自检，缺了就给出**可照着重写**的报错（见 `checkRequired`） */
  required: string[];
  /**
   * 这个工具认得哪些参数名（规范名）。
   *
   * 三件事共用这一份声明，所以它必须准：
   *   1. **别名归一**。模型把 `entry` 写成 `title`／`name`／`标题` 是常态，而工具内部
   *      只读 `args.entry` —— 读不到就等于「没传」，于是报出「缺少标题」这种
   *      **看起来像它漏传、其实它明明写了**的错。它从这句里学不到任何东西，只会原样重试，
   *      几步之后撞上打转护栏、整件事中止（真实发生过：让 agent 补全缺失条目，
   *      它连读 8 次条目全废）。`normalizeArgs` 靠这份声明把别名折回规范名。
   *   2. **渲染给模型看**。参数名会印在系统提示词的工具清单里 —— 第一次就写对，
   *      比事后补救便宜得多（见 `renderToolList`）。
   *   3. **自检**。`required` 里的名字必须出现在这里，漏了 `unit-args.mjs` 会报。
   */
  args: string[];
  /**
   * 这是一步「把话交回给作者」的动作 —— 执行它就是本轮终点。
   *
   * 后面的动作一律不再执行：它们多半建立在「作者会怎么回答」的假设上，
   * 那些假设一旦错了，后面做的全是白工（还得再撤）。也正因为如此，
   * 它永远不会被「计划模式」拦下来等你点头 —— 拦一个提问，就是让你
   * 先批准它问你，这显然说不通。
   */
  terminal?: boolean;
  run: (ctx: AgentContext, args: Record<string, unknown>) => Promise<ToolOutcome>;
}

/**
 * 工具名 → 界面上的短标签。
 *
 * 回执区放的是给作者看的句子，所以渲染的是「新建条目」而不是 `create_entry`：
 * 工具名是模型和代码之间的方言，不该漏到界面上。
 */
const TOOL_LABEL: Record<AgentToolName, MsgKey> = {
  world_overview: 'agent.toolName.world_overview',
  search_entries: 'agent.toolName.search_entries',
  read_entry: 'agent.toolName.read_entry',
  list_relations: 'agent.toolName.list_relations',
  list_timeline: 'agent.toolName.list_timeline',
  list_pieces: 'agent.toolName.list_pieces',
  list_docs: 'agent.toolName.list_docs',
  read_doc: 'agent.toolName.read_doc',
  list_review: 'agent.toolName.list_review',
  list_ops: 'agent.toolName.list_ops',
  create_entry: 'agent.toolName.create_entry',
  update_entry: 'agent.toolName.update_entry',
  polish_entries: 'agent.toolName.polish_entries',
  delete_entry: 'agent.toolName.delete_entry',
  create_relation: 'agent.toolName.create_relation',
  update_relation: 'agent.toolName.update_relation',
  delete_relation: 'agent.toolName.delete_relation',
  create_category: 'agent.toolName.create_category',
  update_category: 'agent.toolName.update_category',
  delete_category: 'agent.toolName.delete_category',
  update_world: 'agent.toolName.update_world',
  create_piece: 'agent.toolName.create_piece',
  update_piece: 'agent.toolName.update_piece',
  delete_piece: 'agent.toolName.delete_piece',
  add_doc: 'agent.toolName.add_doc',
  delete_doc: 'agent.toolName.delete_doc',
  update_settings: 'agent.toolName.update_settings',
  layout_timeline: 'agent.toolName.layout_timeline',
  guess_timeline: 'agent.toolName.guess_timeline',
  navigate: 'agent.toolName.navigate',
  note: 'agent.toolName.note',
  ask_author: 'agent.toolName.ask_author',
};

/** 取工具的人类可读名字。查不到就退回去显示工具名（宁可难看，也别空着） */
export function toolLabel(name: string): string {
  const key = TOOL_LABEL[name as AgentToolName];
  return key ? tGlobal(key) : name;
}

const ok = (summary: string, data?: unknown): ToolOutcome => ({ ok: true, summary, data });
const fail = (summary: string, data?: unknown): ToolOutcome => ({ ok: false, summary, data });
/** 成功了，但什么都没捞到 —— 这是「信息不足」，不是「查错了」 */
const none = (summary: string, data?: unknown): ToolOutcome => ({
  ok: true,
  summary,
  data,
  empty: true,
});

/**
 * 列表类工具的统一出口：有东西就是「列出了 N 项」，没有就是「零命中」。
 *
 * 两种结果的措辞不同只是表面，真正的区别在 `empty` 标记：
 * 执行循环靠它认出「这一轮没收获」，攒够了就会把模型从「换个词再查」里拽出来、
 * 逼它去问作者。所以这里必须走同一条路，不能各写各的。
 */
const listed = (
  items: unknown[],
  data: unknown,
  key: 'agent.done.list' | 'agent.done.search' = 'agent.done.list',
): ToolOutcome =>
  items.length ? ok(tGlobal(key, { n: items.length }), data) : none(tGlobal('agent.done.empty'), data);

/** 解析结果：要么拿到东西，要么带着一条可以原样退回给作者的失败 */
type Found<T> = { value: T } | { error: ToolOutcome };

const str = (v: unknown, fallback = ''): string =>
  typeof v === 'string' ? v : typeof v === 'number' || typeof v === 'boolean' ? String(v) : fallback;

const strList = (v: unknown): string[] =>
  Array.isArray(v) ? v.map((x) => str(x).trim()).filter(Boolean) : str(v) ? [str(v).trim()] : [];

/* ------------------------------------------------------------------ */
/* 参数：把模型的别名折回规范名，并给出「照着改就能过」的报错              */
/*                                                                     */
/* 起因是一次真实的翻车：让 agent「把条目里提到、但还没建的人物和物品补全」，*/
/* 它连着调了 8 次 read_entry，每次都报「缺少标题」—— 它明明写了标题，     */
/* 只是写在了 `title` 这个键上。这句报错里读不出「你的键名它不认识」，      */
/* 于是它原样重试、再失败，几步之后撞上打转护栏，**整件事中止、一条也没补**。*/
/*                                                                     */
/* 教训有两层：                                                          */
/*   1. 工具内部只读 `args.<规范名>`，模型换个词就等于没传 —— 得先归一；   */
/*   2. 归一之后仍然缺的，报错必须**可照着重写**（说清缺哪个、认哪些、      */
/*      它给的是什么），否则模型只能靠猜。                                 */
/* ------------------------------------------------------------------ */

/**
 * 规范参数名 → 模型可能用的同义写法。
 *
 * 顺带收了一批中文键：模型用中文思考时经常直接把键名写成中文（`{"标题": …}`）。
 * 这张表是**解析用的**，跟界面语言无关，所以不跟着语言包走。
 */
const ARG_ALIASES: Record<string, string[]> = {
  entry: ['title', 'name', 'entryName', 'entryTitle', 'entryId', 'id', '条目', '标题', '名称', '条目名', '名字'], // i18n-allow
  entries: ['items', 'list', 'titles', 'names', 'entryList', '条目', '条目列表', '标题列表'], // i18n-allow
  // `event` / `eventTitle` 留着：轴已经不是独立的表了，「记一件事」现在走 create_entry，
  // 模型多半还会管那件事叫 event。
  title: ['name', 'entryTitle', 'pieceTitle', 'event', 'eventTitle', '标题', '名称', '名字', '事件', '大事'], // i18n-allow
  content: ['text', 'body', 'markdown', '正文', '内容', '文本', 'eventDetail', 'happened', '经过', '始末'], // i18n-allow
  summary: ['abstract', 'desc', 'description', 'oneLiner', '摘要', '概述', '简介'], // i18n-allow
  category: ['cat', 'categoryName', 'categoryId', '分类', '类别', '分类名'], // i18n-allow
  status: ['state', 'entryStatus', '状态'], // i18n-allow
  limit: ['count', 'max', 'number', 'top', '数量', '条数', '上限'], // i18n-allow
  query: ['q', 'keyword', 'keywords', 'search', 'term', 'text', '关键词', '关键字', '搜索词'], // i18n-allow
  kind: ['pieceKind', 'type', '体裁', '类型'], // i18n-allow
  doc: ['document', 'docName', 'fileName', 'file', 'name', 'title', '资料', '文档', '文件名'], // i18n-allow
  piece: ['pieceTitle', 'pieceName', 'title', 'name', '藏品', '标题'], // i18n-allow
  from: ['source', 'fromEntry', 'fromTitle', 'fromName', '起点', '来源', '主动方'], // i18n-allow
  to: ['target', 'targetEntry', 'toEntry', 'toTitle', 'toName', '终点', '目标', '被动方'], // i18n-allow
  type: ['relationType', 'kind', '关系类型', '类型'], // i18n-allow
  note: ['remark', 'detail', 'why', '备注', '说明', '理由'], // i18n-allow
  name: ['title', 'categoryName', 'docName', '名称', '名字', '标题'], // i18n-allow
  icon: ['emoji', '图标'], // i18n-allow
  color: ['colour', 'hex', '颜色'], // i18n-allow
  themeColor: ['color', 'colour', 'theme', '主题色', '颜色'], // i18n-allow
  tagline: ['slogan', 'oneLiner', '一句话简介'], // i18n-allow
  genre: ['category', '题材', '类型'], // i18n-allow
  tone: ['基调', '风格', '语气'], // i18n-allow
  tags: ['tag', 'labels', '标签'], // i18n-allow
  aliases: ['alias', 'aka', '别名', '别称'], // i18n-allow
  pinned: ['pin', 'top', '置顶'], // i18n-allow
  page: ['view', 'route', '页面'], // i18n-allow
  text: ['content', 'body', 'message', '正文', '内容', '文本'], // i18n-allow
  question: ['ask', 'prompt', '问题', '提问'], // i18n-allow
  options: ['choices', 'candidates', '选项', '候选项'], // i18n-allow
  instruction: ['requirement', 'prompt', 'extra', '要求', '说明', '额外要求'], // i18n-allow
  focus: ['aspects', 'dims', '着力点', '方面'], // i18n-allow
  temperature: ['temp', '温度'], // i18n-allow
  contextLimit: ['context_limit', 'contextEntries', '上下文上限'], // i18n-allow
  vision: ['readImages', '读图', '图片'], // i18n-allow
  addTags: ['add_tags', 'tagsAdd', '新增标签'], // i18n-allow
  removeTags: ['remove_tags', 'tagsRemove', '删除标签'], // i18n-allow
  era: ['eraName', 'period', 'epoch', '纪元', '时代', '时期'], // i18n-allow
  /**
   * 时间的**起点文本**（照作者的世界内写法，不换算公历）。
   *
   * 以前这个位置叫 `date`，因为那时它只服务「时间线事件」这一张表；现在时间是条目上的
   * 一个可选字段，一件「什么时候发生了什么」就是一条带时间的条目，所以键名改成
   * `when`/`until` —— 跟 `propose_timeline_event` 一起消失的是旧说法，而 `date`
   * 留在别名里，模型写 `date:` 照样折得回来。
   */
  when: ['date', 'time', 'fromDate', 'from', 'start', 'startDate', 'whenHappened', '时间', '年份', '日期', '纪年', '起', '何时'], // i18n-allow
  /** 区间的**终点文本**。只有 `kind: 'range'` 时才有意义 */
  until: ['toDate', 'to', 'end', 'endDate', 'untilDate', 'finish', '至', '到', '终', '结束', '截止'], // i18n-allow
  /** 区间一直延续到现在（`kind: 'ongoing'`）—— 必须显式给，不许靠「没给到哪天」去猜 */
  ongoing: ['tillNow', 'toNow', 'present', 'unfinished', '至今', '到现在', '一直', '持续', '未结束'], // i18n-allow
  /** 把条目上的时间**去掉**（它随即离开时间轴）。不传才是「不动它的时间」 */
  clearTime: ['removeTime', 'untime', 'forgetTime', 'noTime', '去掉时间', '清除时间', '取消时间', '不设时间'], // i18n-allow
  weight: ['importance', 'significance', 'level', '重要程度', '级别', '权重'], // i18n-allow
};

/** 键名只比「字母/数字/汉字」，大小写与分隔符都不计：`fromEntryId` = `from_entry_id` = `From-Entry-Id` */
const foldKey = (s: string): string => s.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, '');

/** 折名 → 它可能是哪几个规范名（一个别名可能对应多个，最终由「本工具认哪些」来定夺） */
const ALIAS_TO_CANONS: Map<string, string[]> = (() => {
  const m = new Map<string, string[]>();
  const add = (key: string, canon: string) => {
    const f = foldKey(key);
    const arr = m.get(f);
    if (!arr) m.set(f, [canon]);
    else if (!arr.includes(canon)) arr.push(canon);
  };
  for (const [canon, list] of Object.entries(ARG_ALIASES)) {
    add(canon, canon);
    for (const a of list) add(a, canon);
  }
  return m;
})();

/**
 * 把模型给的参数折成工具认的规范名。
 *
 * 两遍走：
 *   1. **归位写法**。键名本身就是规范名、只是大小写/分隔符不一样（`Entry`、`entry_id`）——
 *      直接改回 `entry`。不做这一步的话，`args.entry` 依然读不到。
 *   2. **补别名**。缺的规范名去模型给的键里找一个「能折成它、且不是本工具另一个规范名」的键。
 *      第二遍刻意**不抢**本工具的规范名：`update_entry` 里 `title` 是「改成什么标题」，
 *      不是「改哪一个」—— 那种歧义该老老实实报缺 `entry`，而不是猜。
 *
 * 剩下不认识的键原样留着（工具本来就不看，或将来会看）。
 */
export function normalizeArgs(tool: AgentTool, raw: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  const canonByFold = new Map<string, string>();
  for (const a of tool.args) canonByFold.set(foldKey(a), a);

  const used = new Set<string>();
  for (const [k, v] of Object.entries(raw)) {
    const exact = canonByFold.get(foldKey(k));
    if (exact && out[exact] === undefined) {
      out[exact] = v;
      used.add(k);
    }
  }

  for (const a of tool.args) {
    if (out[a] !== undefined) continue;
    const hit = Object.keys(raw).find((k) => {
      if (used.has(k)) return false;
      if (canonByFold.has(foldKey(k))) return false; // 那是本工具的另一个参数，别乱抢
      const targets = ALIAS_TO_CANONS.get(foldKey(k));
      return !!targets && targets.includes(a);
    });
    if (hit !== undefined) {
      out[a] = raw[hit];
      used.add(hit);
    }
  }

  for (const [k, v] of Object.entries(raw)) {
    if (!used.has(k) && out[k] === undefined) out[k] = v;
  }
  return out;
}

/**
 * 必填参数自检。
 *
 * 报错要能**照着重写**：缺哪个、这个工具认哪些、你给的又是什么 —— 三样缺一不可。
 * 只说「缺少标题」，模型既不知道它写的 `title` 被无视了，也不知道该改叫 `entry`,
 * 于是只能原样重试（然后撞护栏）。这条报错是那次翻车最直接的教训。
 */
export function checkRequired(tool: AgentTool, args: Record<string, unknown>): ToolOutcome | null {
  const missing = tool.required.filter((k) => {
    const v = args[k];
    return v === undefined || v === null || (typeof v === 'string' && !v.trim());
  });
  if (!missing.length) return null;
  const sent = Object.keys(args);
  // 参数名之间的分隔符跟工具清单用的是同一个（中文「、」，英文「, 」）
  const sep = tGlobal('agent.sys.toolArgSep');
  return {
    ok: false,
    summary: tGlobal('agent.fail.missingArgs', {
      tool: tool.name,
      missing: missing.join(sep),
      accepts: tool.args.length ? tool.args.join(sep) : tGlobal('agent.fail.noArgsAtAll'),
      sent: sent.length ? sent.join(sep) : tGlobal('agent.fail.sentNothing'),
    }),
    // 这是「调用格式不对」，不是「查不到」—— 执行循环据此给出不同的下一步建议
    badCall: true,
  };
}

const clamp = (n: unknown, lo: number, hi: number, fallback: number): number => {
  const v = Number(n);
  if (!Number.isFinite(v)) return fallback;
  return Math.min(hi, Math.max(lo, Math.round(v)));
};

/** 页面清单 —— navigate 只认这些（都是 App 里真实存在的路由） */
export const AGENT_PAGES = [
  'dashboard',
  'wiki',
  'graph',
  'studio',
  'review',
  'docs',
  'consistency',
  'ask',
  'article',
  'export',
  'settings',
  'log',
] as const;

/**
 * 页面**内部的视图分支**。
 *
 * 「时间与关系」分两支（一部编年 / 一张网，编年是第一入口），Wiki 分三个子页
 * （阅读 / 编辑 / 杂物间）。收成一个联合类型，是为了让「带了分支的跳转」在类型上
 * 走得通 —— 只有 resolveAgentPage 会产出它，界面按 `page` 把它分派给对应的页面。
 * `time` 留在类型里：旧的那支点轴还从编年的「旧的」进得去，但 agent 的落点
 * 一律是新入口（chronicle）。
 */
export type AgentPageView = 'time' | 'chronicle' | 'entries' | 'pieces';

const PAGE_TITLE_KEY: Record<string, string> = {
  dashboard: 'agent.page.dashboard',
  wiki: 'agent.page.wiki',
  graph: 'agent.page.graph',
  studio: 'agent.page.studio',
  review: 'agent.page.review',
  docs: 'agent.page.docs',
  consistency: 'agent.page.consistency',
  ask: 'agent.page.ask',
  article: 'agent.page.article',
  export: 'agent.page.export',
  settings: 'agent.page.settings',
  log: 'agent.page.log',
};

/** `agent.page.*` 的 key 只对真实路由有；别名一律先归到真实路由再查 */
export function pageTitleKey(page: string): string {
  return PAGE_TITLE_KEY[page] ?? 'agent.page.dashboard';
}

/**
 * 把模型说的「页面」解析成真实路由。
 *
 * 有两处**旧页面名**要认下来：
 *   - 「世界时间线」并进了「时间与关系」当一个视图分支，所以 `timeline` 落到
 *     graph + `view: 'chronicle'`（编年转正之后，这一支的第一入口是它）；
 *   - 「条目库」和「杂物间」并进了「Wiki」当两个子页，所以 `entries` / `pieces`
 *     落到 wiki + 对应子页。
 *
 * 模型（和它记住的旧说法，以及它读到的旧文档）多半还会说旧名字；认下来比让它
 * 撞一句「没有这个页面」再自己猜强 —— 而它猜出来的多半是**放弃这件事**。
 * 界面拿到 `view` 就知道该落在哪一支，不用作者自己再找一下那个页签。
 *
 * 认不出来就返回 null，由调用方报一条「照着重写」的错（带上真实页面清单）。
 */
export function resolveAgentPage(raw: unknown): { page: string; view?: AgentPageView } | null {
  const key = str(raw).trim().toLowerCase();
  if (!key) return null;
  if ((AGENT_PAGES as readonly string[]).includes(key)) return { page: key };
  // 轴的老说法（时间线 / 年表）—— 编年已经接管了那一支的位置，落点跟着走。
  // 这几个词是**模型可能吐出来的入参词汇**（跟界面语言无关，中文界面下英文模型也会写
  // `timeline`），所以不跟语言包走。 // i18n-allow
  if (['timeline', 'chrono', 'chronicle', 'axis', '时间线', '年表', '时间轴'].includes(key)) { // i18n-allow
    return { page: 'graph', view: 'chronicle' };
  }
  // 并进 Wiki 的那两页。中英两种写法都认 —— 模型很可能照着旧提示词里的中文名来。 // i18n-allow
  if (['entries', 'entry', 'entrylist', '条目', '条目库', '词条'].includes(key)) { // i18n-allow
    return { page: 'wiki', view: 'entries' };
  }
  if (['pieces', 'piece', 'scrapbook', '杂物间', '碎片', '杂物'].includes(key)) { // i18n-allow
    return { page: 'wiki', view: 'pieces' };
  }
  return null;
}

/**
 * 回执里那句「跳到了哪儿」。
 *
 * 只说「Wiki」是不够的 —— 这一页有三个子页，作者得知道它把自己送到了哪一个
 * （尤其是它自己去打开编辑页的时候）。`view` 有就拼上，没有就只说页名。
 */
export function pageLabel(page: string, view?: AgentPageView): string {
  const base = tGlobal(pageTitleKey(page));
  if (!view) return base;
  const sub = tGlobal(VIEW_TITLE_KEY[view]);
  return tGlobal('agent.page.withView', { page: base, view: sub });
}

/**
 * 视图分支的显示名。
 *
 * 刻意**复用界面上的那份文案**（Wiki 的页签名、关系图那一支的切换名）：
 * agent 说「去杂物间」之后界面上显示的是「Wiki · 杂物间」，与作者顺着页签
 * 找过去看到的字一模一样 —— 对不上号的提示等于没提示。
 */
const VIEW_TITLE_KEY: Record<AgentPageView, string> = {
  time: 'graph.view.time',
  chronicle: 'graph.view.chronicle',
  entries: 'wiki.tab.entries',
  pieces: 'wiki.tab.pieces',
};

/* ------------------------------------------------------------------ */
/* 解析：把「名字」变成真实对象                                          */
/* ------------------------------------------------------------------ */

/**
 * 按标题 / 别名 / id 找条目。
 * 精确命中优先；退化成包含匹配时有歧义就报错 —— 宁可让 agent 再问一句，
 * 也不要它自作主张改错条目。
 */
export function resolveEntry(entries: Entry[], raw: unknown): Found<Entry> {
  const key = str(raw).trim();
  if (!key) return { error: fail(tGlobal('agent.fail.needTitle')) };
  const lower = key.toLowerCase();

  const byId = entries.find((e) => e.id === key);
  if (byId) return { value: byId };

  const exact = entries.filter(
    (e) => e.title.toLowerCase() === lower || e.aliases.some((a) => a.toLowerCase() === lower),
  );
  if (exact.length === 1) return { value: exact[0] };
  if (exact.length > 1) {
    return { error: fail(tGlobal('agent.fail.entryAmbiguous', { name: key })) };
  }

  const loose = entries.filter(
    (e) => e.title.toLowerCase().includes(lower) || lower.includes(e.title.toLowerCase()),
  );
  if (loose.length === 1) return { value: loose[0] };
  if (loose.length > 1) {
    return { error: fail(tGlobal('agent.fail.entryAmbiguous', { name: key })) };
  }
  return { error: fail(tGlobal('agent.fail.entryNotFound', { name: key })) };
}

/**
 * 现有分类的名字，串成一行。
 *
 * 报「没有这个分类」时**必须**把它带上 —— 否则模型只知道这个名字不对，
 * 不知道对的是什么，于是它做的下一件事多半是**自己造一个分类**。
 * 真实翻车正是这样：作者说「把提到的人物和物品补全」，模型把「物品」当成分类名，
 * 连撞三次「没有叫「物品」的分类」，然后自己新建了一个「物品」分类 ——
 * 而作者要的本来只是「补全条目」。同 `agent.fail.missingArgs` 那条：
 * **报错要让模型能照着重写**。
 */
function categoryNames(categories: Category[]): string {
  if (!categories.length) return tGlobal('agent.fail.categoryListEmpty');
  return categories.map((c) => c.name).join(tGlobal('agent.sys.toolArgSep'));
}

/**
 * 分类名对不上 —— 归到「调用写错」那一类。
 *
 * 这不是「库里没有」而是「你这个参数值写错了」，而且报错里已经带着**正确的取值清单**，
 * 模型要做的只有一件事：照着重写这个动作。归错类的代价很具体：护栏会按「查不到」
 * 去劝它「停下来问作者」，可答案就在眼前，问作者反而把一步就能改好的事推给了人。
 */
const categoryBadCall = (summary: string, categories: Category[]): ToolOutcome => ({
  ok: false,
  summary,
  badCall: true,
  data: {
    categories: categories.map((c) => c.name),
    hint: tGlobal('agent.data.categoryHint'),
  },
});

function resolveCategory(categories: Category[], raw: unknown): Found<Category> {
  const key = str(raw).trim();
  const list = categoryNames(categories);
  if (!key) {
    return {
      error: categoryBadCall(tGlobal('agent.fail.categoryNotFound', { name: '', list }), categories),
    };
  }
  const lower = key.toLowerCase();
  const hit =
    categories.find((c) => c.id === key) ??
    categories.find((c) => c.name.toLowerCase() === lower) ??
    categories.find((c) => c.name.toLowerCase().includes(lower));
  if (hit) return { value: hit };
  return {
    error: categoryBadCall(tGlobal('agent.fail.categoryNotFound', { name: key, list }), categories),
  };
}

function resolvePiece(pieces: Piece[], raw: unknown): Found<Piece> {
  const key = str(raw).trim();
  if (!key) return { error: fail(tGlobal('agent.fail.pieceNotFound', { name: key })) };
  const lower = key.toLowerCase();
  const hit =
    pieces.find((p) => p.id === key) ??
    pieces.find((p) => p.title.toLowerCase() === lower) ??
    pieces.find((p) => p.title.toLowerCase().includes(lower));
  if (hit) return { value: hit };
  return { error: fail(tGlobal('agent.fail.pieceNotFound', { name: key })) };
}

function resolveRelation(
  relations: Relation[],
  entries: Entry[],
  args: Record<string, unknown>,
): Found<Relation> {
  const from = resolveEntry(entries, args.from);
  if ('error' in from) return from;
  const to = resolveEntry(entries, args.to);
  if ('error' in to) return to;
  const type = str(args.type).trim();
  const between = relations.filter(
    (r) =>
      (r.fromEntryId === from.value.id && r.toEntryId === to.value.id) ||
      (r.fromEntryId === to.value.id && r.toEntryId === from.value.id),
  );
  const hit = type ? between.find((r) => r.type === type) : between[0];
  if (!hit) {
    return {
      error: fail(
        tGlobal('agent.fail.relationNotFound', { from: from.value.title, to: to.value.title }),
      ),
    };
  }
  return { value: hit };
}

/* ------------------------------------------------------------------ */
/* 提议：把动作写进审查队列，而不是直接落库                                */
/*                                                                     */
/* agent 会自己联想（「你提到的那个人库里还没有，我先把骨架搭出来」），   */
/* 这种事做多了就会变成替作者写设定。所以它新建的东西一律先进审查队列，   */
/* 由作者在审查页拍板 —— agent 负责提议，人负责定稿。                    */
/*                                                                     */
/* 同时留一条「提议」日志：作者在操作日志里能看到它提过什么，也能一键     */
/* 把提议撤回（撤回的是那条待审记录，不是已经落地的东西）。               */
/* ------------------------------------------------------------------ */

async function propose(
  ctx: AgentContext,
  input: {
    kind: ReviewItem['kind'];
    title: string;
    entryDraft?: ReviewItem['entryDraft'];
    relationDraft?: ReviewItem['relationDraft'];
    /** 一次排版 / 猜测时间的逐条方案 */
    layoutDraft?: ReviewItem['layoutDraft'];
    guessDraft?: ReviewItem['guessDraft'];
    note?: string;
    /** 修订既有条目时：改的是哪一条，以及逐字段的 diff */
    targetEntryId?: ID;
    changes?: ReviewItem['changes'];
    /** 修订/删除既有关系时：改的是哪一条 */
    targetRelationId?: ID;
    /**
     * 这条提议「为什么」，覆盖默认的 `ctx.why`。
     * 批量打磨时每条改的东西都不一样，逐条的理由（模型给的 changeNote）
     * 比整步那句统一的 why 有用得多。
     */
    rationale?: string;
    /** 同一次批量操作共用一个批号，审查页据此把它们归到一起 */
    batchId?: ID;
    /** 生成来源，供「再生成」重跑当初这条任务 */
    source?: ReviewItem['source'];
  },
): Promise<ReviewItem> {
  const worldId = ctx.store.activeWorld!.id;
  const item: ReviewItem = {
    id: uid('rv'),
    worldId,
    kind: input.kind,
    title: input.title,
    note: input.note ?? '',
    rationale: str(input.rationale).trim() || str(ctx.why).trim(),
    status: 'pending',
    createdAt: now(),
    origin: 'agent',
    sessionId: ctx.sessionId,
    batchId: input.batchId,
    source: input.source,
    entryDraft: input.entryDraft,
    targetEntryId: input.targetEntryId,
    changes: input.changes,
    relationDraft: input.relationDraft,
    targetRelationId: input.targetRelationId,
    layoutDraft: input.layoutDraft,
    guessDraft: input.guessDraft,
  };
  // 排版 / 猜测不是针对某一条条目或关系的动作，日志实体记成「note」——
  // 它不落在任何 store 上，纯留一句「AI 提了一份时间轴方案」。
  const isBulk =
    input.kind === 'timeline-layout' || input.kind === 'timeline-guess';
  await ctx.store.pushReview([item]);
  await ctx.store.logOp({
    worldId,
    action: 'propose',
    entity: isBulk
      ? 'note'
      : input.kind === 'relation' ||
          input.kind === 'update-relation' ||
          input.kind === 'delete-relation'
        ? 'relation'
        : 'entry',
    target: input.title,
    targetId: input.entryDraft?.id ?? input.targetEntryId ?? input.targetRelationId,
    detail: item.rationale,
    undo: { remove: [{ entity: 'review', id: item.id }] },
  });
  return item;
}

/**
 * 在**待审的**新建条目提议里按标题找草稿。
 *
 * agent 常常一气呵成地「建 A，再把 A 连到 B」——那一刻 A 还没入库（它在审查队列里排队），
 * 走正常解析必然「找不到」。可这不是错误：A 就在那儿，只是还没批。
 * 认不出它，agent 就只能把话咽回去，等作者批完再重来一遍 —— 白费一轮，还显得笨。
 */
function resolvePendingDraft(store: StoreValue, raw: unknown): ReviewItem | null {
  const key = str(raw).trim().toLowerCase();
  if (!key) return null;
  const drafts = store.pendingReview.filter(
    (r) => r.kind === 'create-entry' && r.status === 'pending' && r.entryDraft,
  );
  const titleOf = (r: ReviewItem) => (r.entryDraft?.title ?? '').toLowerCase();

  const byId = drafts.find((r) => r.entryDraft!.id === str(raw));
  if (byId) return byId;

  const exact = drafts.filter((r) => titleOf(r) === key);
  if (exact.length === 1) return exact[0];
  if (exact.length > 1) return null;

  const loose = drafts.filter((r) => titleOf(r).includes(key));
  // 有歧义就当没找到：宁可让 agent 问一句，也不要它把关系挂到错的那条提议上
  return loose.length === 1 ? loose[0] : null;
}

/* ------------------------------------------------------------------ */
/* 给模型看的瘦身版数据（别把整库塞回提示词）                             */
/* ------------------------------------------------------------------ */

/**
 * 把一份「时间」渲染成一句话给模型看。
 *
 * 三种形态各一套说法（时间点 / 一段 / 一段且至今）—— 光甩两个裸字段给模型，
 * 它读不出「这是起点」还是「这是终点」，回话时就会把区间说成时间点。
 * 文案复用导出用的那两条，免得同一个「甲 － 乙」在库里长出两套说法。
 */
export const whenLabel = (tm: EntryTime | undefined): string => {
  if (!tm) return '';
  if (tm.kind === 'ongoing') return tGlobal('lib.export.timelineOngoing', { from: tm.from });
  if (tm.kind === 'range') return tGlobal('lib.export.timelineRange', { from: tm.from, to: tm.to });
  return tm.from;
};

/**
 * 参数里那些「像不像真」的写法：true / yes / 1 / on / 是。
 *
 * 模型给布尔参数时经常不写真 `true`，而是写这些词（中文界面下还会写「是」「对」）。
 * 这是**入参词汇表**，跟界面语言无关，所以不跟语言包走。 // i18n-allow
 */
const truthy = (v: unknown): boolean => {
  if (v === true) return true;
  if (v === false || v === undefined || v === null) return false;
  // prettier-ignore
  return ['true', 'yes', 'y', 'on', '1', '是', '对'].includes(str(v).trim().toLowerCase()); // i18n-allow
};

/**
 * 从工具参数里读出一份「时间」—— 三种形态都在这儿认。
 *
 * 返回 `undefined` 表示**这次根本没提时间**，不是「时间被清空了」：前者不动条目上原有的
 * 时间，后者要显式走 `clearTime`。两者混成一句话的话，agent 每改一次正文都会顺手
 * 把这条条目的时间抹掉 —— 那是数据丢失，不是「没改」。
 *
 * 数值位置（`at`）**不给模型**：它无从知道轴上已经排到哪儿了，硬猜一个数只会把它
 * 扔到十年之外。位置由 store 补（见 `createEntry` / `setEntryTime` 里的 `nextAt`），
 * 作者在轴上拖一下就能挪到该在的地方。
 */
export function readTimeArgs(args: Record<string, unknown>): EntryTime | undefined {
  const from = str(args.when).trim();
  // 时间的起点是必给的：只有终点的那段时间没法排序，也没法在轴上落位
  if (!from) return undefined;
  const to = str(args.until).trim();
  // 三态必须**显式**。拿「没给 to」去猜「至今」，轴上就会凭空多出一段跨度 ——
  // 猜错是看得出来的错，不如让模型自己说（ongoing: true）。
  const kind: EntryTimeKind = truthy(args.ongoing) ? 'ongoing' : to ? 'range' : 'point';
  const weightRaw = str(args.weight).trim().toLowerCase();
  const weight: TimeWeight = (TIME_WEIGHTS as readonly string[]).includes(weightRaw)
    ? (weightRaw as TimeWeight)
    : 'normal';
  return {
    kind,
    from,
    to: kind === 'range' ? to : '',
    era: str(args.era).trim(),
    weight,
  };
}

const entryBrief = (e: Entry, categories: Category[]) => ({
  id: e.id,
  title: e.title,
  category: categories.find((c) => c.id === e.categoryId)?.name ?? '',
  status: e.status,
  aliases: e.aliases,
  tags: e.tags,
  summary: e.summary,
  // 时间没设就不印这个键 —— 一堆空的 `when: ""` 只会把真正有时间的那几条淹掉
  ...(e.time ? { when: whenLabel(e.time), timeKind: e.time.kind } : {}),
});

const relationBrief = (r: Relation, entries: Entry[]) => {
  const nameOf = (id: ID) => entries.find((e) => e.id === id)?.title ?? id;
  return {
    id: r.id,
    from: nameOf(r.fromEntryId),
    to: nameOf(r.toEntryId),
    type: r.type,
    note: r.note,
    status: r.status,
  };
};

const STATUSES = ['draft', 'pending', 'canon'] as const;

/* ------------------------------------------------------------------ */
/* 工具箱                                                              */
/* ------------------------------------------------------------------ */

export const AGENT_TOOLS: AgentTool[] = [
  /* ---------------------------- 读 ---------------------------- */
  {
    name: 'world_overview',
    risk: 'read',
    required: [],
    args: [],
    run: async ({ store }) => {
      const w = store.activeWorld!;
      const cats = store.categories.map((c) => ({
        name: c.name,
        icon: c.icon,
        entries: store.entries.filter((e) => e.categoryId === c.id).length,
      }));
      const data = {
        name: w.name,
        tagline: w.tagline,
        genre: w.genre,
        tone: w.tone,
        themeColor: w.themeColor,
        summary: w.summary,
        counts: {
          entries: store.entries.length,
          relations: store.relations.length,
          pieces: store.pieces.length,
          docs: store.docs.length,
          reviewPending: store.pendingReview.length,
          // 「设了时间的条目」—— 它现在就是时间轴上的全部内容（见 Entry.time）
          timed: store.timedEntries.length,
        },
        categories: cats,
      };
      return ok(tGlobal('agent.done.list', { n: store.entries.length }), data);
    },
  },
  {
    name: 'search_entries',
    risk: 'read',
    required: [],
    args: ['query', 'category', 'status', 'limit'],
    run: async ({ store }, args) => {
      const q = str(args.query).trim().toLowerCase();
      const catName = str(args.category).trim().toLowerCase();
      const status = str(args.status).trim();
      const limit = clamp(args.limit, 1, 60, 20);

      let list = store.entries;
      if (catName) {
        const cat = resolveCategory(store.categories, args.category);
        if ('error' in cat) return cat.error;
        list = list.filter((e) => e.categoryId === cat.value.id);
      }
      if (status && (STATUSES as readonly string[]).includes(status)) {
        list = list.filter((e) => e.status === status);
      }
      if (q) {
        list = list.filter(
          (e) =>
            e.title.toLowerCase().includes(q) ||
            e.aliases.some((a) => a.toLowerCase().includes(q)) ||
            e.tags.some((t) => t.toLowerCase().includes(q)) ||
            e.summary.toLowerCase().includes(q),
        );
      }
      const items = list.slice(0, limit).map((e) => entryBrief(e, store.categories));
      return listed(
        items,
        { count: list.length, shown: items.length, items },
        'agent.done.search',
      );
    },
  },
  {
    name: 'read_entry',
    risk: 'read',
    required: ['entry'],
    args: ['entry'],
    run: async ({ store }, args) => {
      const found = resolveEntry(store.entries, args.entry);
      if ('error' in found) return found.error;
      const e = found.value;
      const rels = store.relations
        .filter((r) => r.fromEntryId === e.id || r.toEntryId === e.id)
        .map((r) => relationBrief(r, store.entries));
      return ok(tGlobal('agent.done.read', { title: e.title }), {
        ...entryBrief(e, store.categories),
        content: e.content,
        fields: e.fields,
        // 时间单拎出来给全：`entryBrief` 里那句话是给列表用的，这里要让它看见
        // 形态、起点、终点、纪元、分量 —— 否则它没法判断「这段该不该改」。
        time: e.time ?? null,
        when: whenLabel(e.time),
        relations: rels,
      });
    },
  },
  {
    name: 'list_relations',
    risk: 'read',
    required: [],
    args: ['entry'],
    run: async ({ store }, args) => {
      let rels = store.relations;
      if (str(args.entry).trim()) {
        const found = resolveEntry(store.entries, args.entry);
        if ('error' in found) return found.error;
        const id = found.value.id;
        rels = rels.filter((r) => r.fromEntryId === id || r.toEntryId === id);
      }
      const items = rels.slice(0, 60).map((r) => relationBrief(r, store.entries));
      return listed(items, { count: rels.length, items });
    },
  },
  {
    /**
     * 「时间轴」= **设了时间的那些条目**。
     *
     * 它已经不是一张独立的表了：一件「什么时候发生了什么」就是一条带 `time` 的条目
     * （见 `Entry.time`），所以这里列的是**条目**，只是按轴上的先后排 —— 而轴又是
     * 「关系与时间」里的一个视图分支，不是另一个世界。
     * 名字保留 `list_timeline`：轴这个概念还在，只是换了存放方式，模型的老说法照样能用。
     */
    name: 'list_timeline',
    risk: 'read',
    required: [],
    args: ['era', 'query', 'limit'],
    run: async ({ store }, args) => {
      const era = str(args.era).trim().toLowerCase();
      const q = str(args.query).trim().toLowerCase();
      const limit = clamp(args.limit, 1, 80, 40);
      // store.timedEntries 已经按轴上的位置排好序（先后即从左到右），原文顺序就是模型该看到的顺序
      let list = store.timedEntries;
      if (era) list = list.filter((e) => (e.time?.era ?? '').toLowerCase().includes(era));
      if (q) {
        list = list.filter((e) => {
          const tm = e.time;
          return (
            e.title.toLowerCase().includes(q) ||
            (tm?.from ?? '').toLowerCase().includes(q) ||
            (tm?.to ?? '').toLowerCase().includes(q) ||
            e.summary.toLowerCase().includes(q) ||
            e.content.toLowerCase().includes(q)
          );
        });
      }
      // 「这件事牵涉到谁」现在就是它自己的关系 —— 现算，不另存一份，也就不会过期
      const linkedOf = new Map<ID, string[]>();
      for (const r of store.relations) {
        const add = (a: ID, b: ID) => {
          const other = store.entries.find((x) => x.id === b)?.title;
          if (!other) return;
          const arr = linkedOf.get(a);
          if (!arr) linkedOf.set(a, [other]);
          else if (!arr.includes(other)) arr.push(other);
        };
        add(r.fromEntryId, r.toEntryId);
        add(r.toEntryId, r.fromEntryId);
      }
      const items = list.slice(0, limit).map((e) => {
        const tm = e.time!;
        return {
          id: e.id,
          title: e.title,
          kind: tm.kind,
          from: tm.from,
          to: tm.to,
          when: whenLabel(tm),
          era: tm.era,
          weight: tm.weight,
          at: tm.at,
          summary: e.summary.slice(0, 300),
          linked: (linkedOf.get(e.id) ?? []).slice(0, 8),
        };
      });
      // 轴上一条都还没有时，「没有找到匹配的内容」会误导它 ——
      // 它读起来像「查询没命中」，该做的却是「那就把第一件事记上」。
      if (!items.length && !era && !q) {
        return none(tGlobal('agent.done.timelineEmpty'), { count: 0, items });
      }
      return listed(items, { count: list.length, items });
    },
  },
  {
    name: 'list_pieces',
    risk: 'read',
    required: [],
    args: ['query', 'kind', 'limit'],
    run: async ({ store }, args) => {
      const q = str(args.query).trim().toLowerCase();
      const kind = str(args.kind).trim();
      const limit = clamp(args.limit, 1, 40, 15);
      let list = store.pieces;
      if ((TEXT_PIECE_KINDS as readonly string[]).includes(kind)) {
        list = list.filter((p) => p.kind === kind);
      }
      if (q) {
        list = list.filter(
          (p) =>
            p.title.toLowerCase().includes(q) ||
            p.tags.some((t) => t.toLowerCase().includes(q)) ||
            (p.content ?? '').toLowerCase().includes(q),
        );
      }
      const items = list.slice(0, limit).map((p) => ({
        id: p.id,
        kind: p.kind,
        title: p.title,
        tags: p.tags,
        pinned: p.pinned,
        excerpt: (p.content ?? '').slice(0, 300),
      }));
      return listed(items, { count: list.length, items });
    },
  },
  {
    name: 'list_docs',
    risk: 'read',
    required: [],
    args: [],
    run: async ({ store }) => {
      const items = store.docs.slice(0, 40).map((d) => ({
        id: d.id,
        name: d.name,
        ext: d.ext,
        size: d.size,
        chars: d.text.length,
        parsed: d.parsed,
      }));
      return listed(items, { count: store.docs.length, items });
    },
  },
  {
    name: 'read_doc',
    risk: 'read',
    required: ['doc'],
    args: ['doc'],
    run: async ({ store }, args) => {
      const key = str(args.doc).trim().toLowerCase();
      const hit =
        store.docs.find((d) => d.id === str(args.doc)) ??
        store.docs.find((d) => d.name.toLowerCase() === key) ??
        store.docs.find((d) => d.name.toLowerCase().includes(key));
      if (!hit) return fail(tGlobal('agent.fail.docNotFound', { name: str(args.doc) }));
      return ok(tGlobal('agent.done.read', { title: hit.name }), {
        name: hit.name,
        ext: hit.ext,
        text: hit.text.slice(0, 12000),
        truncated: hit.text.length > 12000,
      });
    },
  },
  {
    name: 'list_review',
    risk: 'read',
    required: [],
    args: [],
    run: async ({ store }) => {
      const items = store.pendingReview.slice(0, 40).map((r) => ({
        id: r.id,
        kind: r.kind,
        title: r.title,
        rationale: r.rationale,
        fromAgent: r.origin === 'agent',
      }));
      return listed(items, { count: store.pendingReview.length, items });
    },
  },
  {
    name: 'list_ops',
    risk: 'read',
    required: [],
    args: ['limit'],
    run: async ({ store }, args) => {
      const limit = clamp(args.limit, 1, 60, 20);
      const items = store.ops.slice(0, limit).map((o) => ({
        actor: o.actor,
        action: o.action,
        entity: o.entity,
        target: o.target,
        detail: o.detail,
        fields: o.fields,
        undone: o.undone,
        at: o.createdAt,
      }));
      return listed(items, { items });
    },
  },

  /* ---------------------------- 写 ---------------------------- */
  {
    name: 'create_entry',
    risk: 'write',
    required: ['title', 'category'],
    args: [
      'title',
      'category',
      'summary',
      'content',
      'tags',
      'aliases',
      // 时间是可选的：给了 when 这条条目才落进时间轴，不给就只是普通条目
      'when',
      'until',
      'ongoing',
      'era',
      'weight',
    ],
    run: async (ctx, args) => {
      const { store } = ctx;
      const title = str(args.title).trim();
      if (!title) return fail(tGlobal('agent.fail.needTitle'));
      if (!store.categories.length) return fail(tGlobal('agent.fail.noCategoryForEntry'));

      let categoryId: ID;
      if (str(args.category).trim()) {
        const cat = resolveCategory(store.categories, args.category);
        if ('error' in cat) return cat.error;
        categoryId = cat.value.id;
      } else if (store.categories.length === 1) {
        categoryId = store.categories[0].id;
      } else {
        // 没给分类、又有好几个可选：把可选的都报出来，让它自己挑一个重写
        return categoryBadCall(
          tGlobal('agent.fail.categoryMissing', { list: categoryNames(store.categories) }),
          store.categories,
        );
      }

      // 同名挡一下：agent 很容易在几轮里反复「想起」同一个人，不挡就会攒出一排重复提议。
      // 用归一化 key 比对（大小写、空白、标点都不影响），和 store 层的唯一性约束对齐。
      const k = entryKey(title);
      const exists = store.entries.find((e) => e.key === k);
      if (exists) {
        return fail(tGlobal('agent.fail.entryExists', { name: exists.title }), {
          id: exists.id,
          title: exists.title,
          status: exists.status,
          hint: tGlobal('agent.data.readInstead'),
        });
      }
      if (resolvePendingDraft(store, title)) {
        return fail(tGlobal('agent.fail.entryProposed', { name: title }));
      }

      const draft: Partial<Entry> = {
        id: uid('en'),
        worldId: store.activeWorld!.id,
        categoryId,
        title,
        aliases: strList(args.aliases),
        summary: str(args.summary),
        content: str(args.content),
        tags: strList(args.tags),
        fields: {},
        status: 'pending',
        sourceRefs: [],
      };
      // 时间是可选的、而且**没给就是没有**：一件「什么时候发生了什么」现在就是一条
      // 带时间的普通条目，走的是同一条路（以前它得另跑一个 propose_timeline_event）。
      const time = readTimeArgs(args);
      if (time) draft.time = time;
      await propose(ctx, { kind: 'create-entry', title, entryDraft: draft });
      return {
        ok: true,
        summary: tGlobal('agent.done.proposeEntry', { title }),
        data: {
          id: draft.id,
          title,
          when: whenLabel(draft.time),
          status: 'pending-review',
          note: tGlobal('agent.data.pendingReviewNote'),
        },
        proposal: true,
      };
    },
  },
  {
    name: 'update_entry',
    risk: 'write',
    required: ['entry'],
    args: [
      'entry',
      'title',
      'summary',
      'content',
      'category',
      'status',
      'aliases',
      'color',
      'addTags',
      'removeTags',
      // 时间：给了 when 才是「改时间」，什么都没给就是「不动它的时间」，
      // 要把它从轴上摘下来得显式 clearTime —— 三态分开，免得改正文顺手抹掉时间。
      'when',
      'until',
      'ongoing',
      'era',
      'weight',
      'clearTime',
    ],
    run: async (ctx, args) => {
      const { store } = ctx;
      const found = resolveEntry(store.entries, args.entry);
      if ('error' in found) return found.error;
      const cur = found.value;

      const patch: Partial<Entry> = {};
      const changed: string[] = [];
      /**
       * 时间**不能**跟着 `patch` 一起整体覆盖。
       *
       * `updateEntry` 是 `{...cur, ...patch}`，而模型给的时间只有文本、没有轴上的位置
       * （它无从知道轴排到哪儿了）—— 直接覆盖会把 `at` 抹成 undefined，
       * 这条条目当场被甩到轴的最左边。所以走 `setEntryTime`：它和原有时间**合并**
       * 再规整，位置留着不动。
       * `null` = 摘掉时间，`undefined` = 这次没提时间、一个字都别动。
       */
      let timeAction: EntryTime | null | undefined;
      if (args.title !== undefined && str(args.title).trim()) {
        patch.title = str(args.title).trim();
        changed.push('title');
      }
      if (args.summary !== undefined) {
        patch.summary = str(args.summary);
        changed.push('summary');
      }
      if (args.content !== undefined) {
        patch.content = str(args.content);
        changed.push('content');
      }
      if (args.aliases !== undefined) {
        patch.aliases = strList(args.aliases);
        changed.push('aliases');
      }
      if (args.category !== undefined && str(args.category).trim()) {
        const cat = resolveCategory(store.categories, args.category);
        if ('error' in cat) return cat.error;
        patch.categoryId = cat.value.id;
        changed.push('category');
      }
      if (args.status !== undefined) {
        const s = str(args.status).trim();
        if ((STATUSES as readonly string[]).includes(s)) {
          patch.status = s as Entry['status'];
          changed.push('status');
        }
      }
      if (args.color !== undefined && /^#[0-9a-f]{6}$/i.test(str(args.color).trim())) {
        patch.color = str(args.color).trim();
        changed.push('color');
      }

      // 标签走增删而不是整体覆盖：模型只说了「加一个」，不该把别的标签抹掉
      const addTags = strList(args.addTags);
      const removeTags = strList(args.removeTags);
      if (addTags.length || removeTags.length) {
        const set = new Set(cur.tags);
        addTags.forEach((t) => set.add(t));
        removeTags.forEach((t) => set.delete(t));
        patch.tags = [...set];
        changed.push('tags');
      }

      const time = readTimeArgs(args);
      if (truthy(args.clearTime)) {
        // 显式摘掉：这条条目随即离开轴（但它在关系图里照旧是一员）
        if (cur.time) {
          timeAction = null;
          changed.push('time');
        }
      } else if (time) {
        timeAction = time;
        changed.push('time');
      }

      if (!changed.length) {
        return ok(tGlobal('agent.done.noChange'), { id: cur.id, title: cur.title });
      }

      // 改后字段（只放改动的，未提的字段在采纳时用原值兜底）
      const draft: ReviewItem['entryDraft'] = { ...patch };
      // 时间三态：undefined=没碰、null=摘掉、EntryTime=改后时间
      if (timeAction !== undefined) draft!.time = timeAction;

      // 字段级 diff，供审查页展示「改前 → 改后」
      const sep = tGlobal('ai.task.listSep');
      const catName = (id: ID) => store.categories.find((c) => c.id === id)?.name ?? id;
      const changes: ReviewItem['changes'] = [
        patch.title !== undefined
          ? { field: 'title', before: cur.title, after: patch.title }
          : null,
        patch.summary !== undefined
          ? { field: 'summary', before: cur.summary, after: patch.summary }
          : null,
        patch.content !== undefined
          ? { field: 'content', before: cur.content, after: patch.content }
          : null,
        patch.aliases !== undefined
          ? { field: 'aliases', before: cur.aliases.join(sep), after: patch.aliases.join(sep) }
          : null,
        patch.categoryId !== undefined
          ? { field: 'category', before: catName(cur.categoryId), after: catName(patch.categoryId) }
          : null,
        patch.status !== undefined
          ? { field: 'status', before: cur.status, after: patch.status }
          : null,
        patch.color !== undefined
          ? { field: 'color', before: cur.color ?? '', after: patch.color }
          : null,
        patch.tags !== undefined
          ? { field: 'tags', before: cur.tags.join(sep), after: patch.tags.join(sep) }
          : null,
        timeAction !== undefined
          ? {
              field: 'time',
              before: whenLabel(cur.time),
              after: timeAction === null ? '' : whenLabel(timeAction),
            }
          : null,
      ].filter((c): c is NonNullable<typeof c> => c !== null);

      await propose(ctx, {
        kind: 'update-entry',
        title: tGlobal('ai.task.updateTitle', { title: cur.title }),
        entryDraft: draft,
        targetEntryId: cur.id,
        changes,
      });
      return {
        ok: true,
        summary: tGlobal('agent.done.updateEntryQueued', { title: cur.title }),
        data: {
          id: cur.id,
          title: cur.title,
          changed,
          status: 'pending-review',
          note: tGlobal('agent.data.pendingReviewNote'),
        },
        proposal: true,
      };
    },
  },
  {
    name: 'polish_entries',
    risk: 'write',
    required: ['entries'],
    args: ['entries', 'focus', 'instruction'],
    run: async (ctx, args) => {
      const { store } = ctx;
      const names = strList(args.entries);
      if (!names.length) return fail(tGlobal('agent.fail.polishNeedEntries'));

      // 一次最多这么多条。每一条都是一次完整的模型往返，几十条排下去，
      // 作者要盯着干等十几分钟 —— 该分批就分批。
      if (names.length > POLISH_MAX) {
        return fail(tGlobal('agent.fail.polishTooMany', { n: names.length, max: POLISH_MAX }));
      }

      const targets: Entry[] = [];
      const unresolved: string[] = [];
      for (const name of names) {
        const found = resolveEntry(store.entries, name);
        if ('error' in found) {
          unresolved.push(name);
          continue;
        }
        if (!targets.some((e) => e.id === found.value.id)) targets.push(found.value);
      }
      // 一个都对不上：那就不是「有几个名字写歪了」，而是它记错了库里的东西。
      // 把解析器原样的话退回去（"找不到 X" / "X 有歧义"），让它自己纠。
      if (!targets.length) {
        const first = resolveEntry(store.entries, names[0]);
        return 'error' in first
          ? first.error
          : fail(tGlobal('agent.fail.polishNeedEntries'));
      }

      const focus = strList(args.focus)
        .map(resolvePolishFocus)
        .filter((f): f is PolishFocus => !!f);
      const instruction = str(args.instruction).trim();
      const batchId = uid('bt');

      const submitted: ReviewItem[] = [];
      const skipped: string[] = [];
      const failed: string[] = [];
      /** 作者中途按了停止 —— 已经做完的那几条照常进队列，剩下的不再硬跑 */
      let aborted = false;

      for (let i = 0; i < targets.length; i++) {
        if (ctx.signal?.aborted) {
          aborted = true;
          break;
        }
        const entry = targets[i];
        try {
          const items = await runPolish(
            store.settings.ai,
            store.activeWorld!,
            entry,
            store.entries,
            store.categories,
            { focus, instruction, i: i + 1, total: targets.length },
            { signal: ctx.signal },
          );
          if (!items.length) {
            // 它看过，觉得没什么可改。这条不摆进队列 —— 批量打磨会连着摆十几张卡，
            // 多一张空 diff 就是让作者多读一遍。
            skipped.push(entry.title);
            continue;
          }
          for (const it of items) {
            // 一律走 propose：修订和新建一样，agent 只提议，落库由作者在审查页拍板。
            const saved = await propose(ctx, {
              kind: it.kind,
              title: it.title,
              entryDraft: it.entryDraft,
              relationDraft: it.relationDraft,
              targetEntryId: it.targetEntryId,
              changes: it.changes,
              note: it.note,
              rationale: it.rationale,
              batchId,
              source: {
                task: 'polish',
                targetEntryId: entry.id,
                focus,
                instruction,
              },
            });
            submitted.push(saved);
          }
        } catch (e) {
          if (ctx.signal?.aborted) {
            aborted = true;
            break;
          }
          failed.push(entry.title);
        }
      }

      if (!submitted.length) {
        if (skipped.length && !failed.length) {
          // 「我逐条看过，都没什么可改的」是个明确结论，不是失败。
          return ok(tGlobal('agent.done.polishNothing', { n: skipped.length }), {
            skipped,
            unresolved,
          });
        }
        if (failed.length) return fail(tGlobal('agent.fail.polishFailed', { n: failed.length }));
        return ok(tGlobal('agent.done.polishNothing', { n: skipped.length }), { skipped, unresolved });
      }

      const data = {
        submitted: submitted.map((r) => ({ id: r.id, kind: r.kind, title: r.title })),
        skipped,
        unresolved,
        failed,
        aborted: aborted || undefined,
        note: tGlobal('agent.data.pendingReviewNote'),
      };

      // 提议本身已经由 propose() 逐条记进操作日志（作者能看见它提过什么、也能一键撤回），
      // 这里不再另记一条汇总 —— 日志里出现一条「批量打磨了 8 条」而看不到是哪 8 条，反而不好查。
      return {
        ok: true,
        summary: aborted
          ? tGlobal('agent.done.polishAborted', { n: submitted.length })
          : tGlobal('agent.done.polishEntries', {
              n: submitted.filter((r) => r.kind === 'update-entry').length,
              skipped: skipped.length,
            }),
        data,
        proposal: true,
      };
    },
  },
  {
    name: 'delete_entry',
    risk: 'write',
    required: ['entry'],
    args: ['entry'],
    run: async (ctx, args) => {
      const { store } = ctx;
      const found = resolveEntry(store.entries, args.entry);
      if ('error' in found) return found.error;
      const en = found.value;
      // 删条目是不可逆的破坏操作 —— AI 只能提议，由作者在审查页拍板。
      // 即便执行边界调到「直接执行」，这条也照旧只进审查队列（档位管的是
      // 「动作要不要先问」，跨不过「生产出来的东西要不要审」这道门）。
      await propose(ctx, {
        kind: 'delete-entry',
        title: tGlobal('agent.done.proposeDeleteTitle', { title: en.title }),
        targetEntryId: en.id,
      });
      return {
        ok: true,
        summary: tGlobal('agent.done.proposeDelete', { title: en.title }),
        data: { id: en.id, status: 'pending-review' },
        proposal: true,
      };
    },
  },
  {
    name: 'create_relation',
    risk: 'write',
    required: ['from', 'to', 'type'],
    args: ['from', 'to', 'type', 'note'],
    run: async (ctx, args) => {
      const { store } = ctx;
      const type = str(args.type).trim();
      if (!type) return fail(tGlobal('agent.fail.badArgs', { detail: 'type' }));

      const from = resolveEntry(store.entries, args.from);
      const to = resolveEntry(store.entries, args.to);
      let fromId = 'error' in from ? '' : from.value.id;
      let toId = 'error' in to ? '' : to.value.id;
      let fromName = 'error' in from ? str(args.from).trim() : from.value.title;
      let toName = 'error' in to ? str(args.to).trim() : to.value.title;

      // 有一端找不到时，可能不是「找不到」，而是「刚提过、还没批」。先看一眼审查队列。
      const fromDraft = fromId ? null : resolvePendingDraft(store, args.from);
      const toDraft = toId ? null : resolvePendingDraft(store, args.to);
      if (fromDraft) {
        fromId = fromDraft.entryDraft!.id!;
        fromName = fromDraft.entryDraft!.title!;
      }
      if (toDraft) {
        toId = toDraft.entryDraft!.id!;
        toName = toDraft.entryDraft!.title!;
      }

      if (fromId && toId && fromId === toId) return fail(tGlobal('agent.fail.relationSelf'));

      if (fromDraft && toDraft) {
        return fail(tGlobal('agent.fail.relationBothDraft', { from: fromName, to: toName }));
      }

      if (fromDraft || toDraft) {
        // 一端待审：这条关系也只能一起等 —— 毕竟它牵着的那个条目还不存在。
        // 挂到待审草稿的 id 上，作者采纳那条草稿时，这条关系会跟着一起生效
        // （见 store.acceptReview 的 follow 逻辑）。
        await propose(ctx, {
          kind: 'relation',
          title: tGlobal('agent.done.relationPair', { from: fromName, to: toName }),
          relationDraft: { fromEntryId: fromId, toEntryId: toId, type, note: str(args.note) },
        });
        return {
          ok: true,
          summary: tGlobal('agent.done.proposeRelation', { from: fromName, to: toName }),
          data: {
            status: 'pending-review',
            note: tGlobal('agent.data.pendingRelationNote'),
          },
          proposal: true,
        };
      }

      if ('error' in from) return from.error;
      if ('error' in to) return to.error;
      if (fromId === toId) return fail(tGlobal('agent.fail.relationSelf'));

      const dup = store.relations.some(
        (r) =>
          (r.fromEntryId === fromId && r.toEntryId === toId) ||
          (r.fromEntryId === toId && r.toEntryId === fromId),
      );
      if (dup) return fail(tGlobal('agent.fail.relationExists', { from: fromName, to: toName }));

      // 一律进审查队列：关系是条目的附属，AI 不能绕过作者直接往图谱里牵线。
      await propose(ctx, {
        kind: 'relation',
        title: tGlobal('agent.done.relationPair', { from: fromName, to: toName }),
        relationDraft: { fromEntryId: fromId, toEntryId: toId, type, note: str(args.note) },
      });
      return {
        ok: true,
        summary: tGlobal('agent.done.proposeRelationBothExist', { from: fromName, to: toName }),
        data: {
          status: 'pending-review',
          note: tGlobal('agent.data.pendingRelationNote'),
        },
        proposal: true,
      };
    },
  },
  {
    name: 'update_relation',
    risk: 'write',
    required: ['from', 'to'],
    args: ['from', 'to', 'type', 'note'],
    run: async (ctx, args) => {
      const { store } = ctx;
      const found = resolveRelation(store.relations, store.entries, args);
      if ('error' in found) return found.error;
      const rel = found.value;
      const patch: Partial<Relation> = {};
      if (str(args.type).trim()) patch.type = str(args.type).trim();
      if (args.note !== undefined) patch.note = str(args.note);
      if (!Object.keys(patch).length) {
        return ok(tGlobal('agent.done.noChange'), { id: rel.id });
      }

      const fromName = store.entries.find((e) => e.id === rel.fromEntryId)?.title ?? '';
      const toName = store.entries.find((e) => e.id === rel.toEntryId)?.title ?? '';
      const pair = tGlobal('agent.done.relationPair', { from: fromName, to: toName });

      const changes: ReviewItem['changes'] = [
        patch.type !== undefined
          ? { field: 'type', before: rel.type, after: patch.type }
          : null,
        patch.note !== undefined
          ? { field: 'note', before: rel.note, after: patch.note }
          : null,
      ].filter((c): c is NonNullable<typeof c> => c !== null);

      await propose(ctx, {
        kind: 'update-relation',
        title: tGlobal('agent.done.updateRelationTitle', { pair }),
        targetRelationId: rel.id,
        relationDraft: {
          fromEntryId: rel.fromEntryId,
          toEntryId: rel.toEntryId,
          type: patch.type ?? rel.type,
          note: patch.note ?? rel.note,
        },
        changes,
      });
      return {
        ok: true,
        summary: tGlobal('agent.done.updateRelationQueued', { pair }),
        data: { id: rel.id, status: 'pending-review', note: tGlobal('agent.data.pendingReviewNote') },
        proposal: true,
      };
    },
  },
  {
    name: 'delete_relation',
    risk: 'write',
    required: ['from', 'to'],
    args: ['from', 'to'],
    run: async (ctx, args) => {
      const { store } = ctx;
      const found = resolveRelation(store.relations, store.entries, args);
      if ('error' in found) return found.error;
      const rel = found.value;
      const fromName = store.entries.find((e) => e.id === rel.fromEntryId)?.title ?? '';
      const toName = store.entries.find((e) => e.id === rel.toEntryId)?.title ?? '';
      const pair = tGlobal('agent.done.relationPair', { from: fromName, to: toName });

      await propose(ctx, {
        kind: 'delete-relation',
        title: tGlobal('agent.done.deleteRelationTitle', { pair }),
        targetRelationId: rel.id,
        relationDraft: {
          fromEntryId: rel.fromEntryId,
          toEntryId: rel.toEntryId,
          type: rel.type,
          note: rel.note,
        },
      });
      return {
        ok: true,
        summary: tGlobal('agent.done.deleteRelationQueued', { pair }),
        data: { id: rel.id, status: 'pending-review', note: tGlobal('agent.data.pendingReviewNote') },
        proposal: true,
      };
    },
  },
  {
    name: 'create_category',
    risk: 'write',
    required: ['name'],
    args: ['name', 'icon', 'color'],
    run: async ({ store }, args) => {
      const name = str(args.name).trim();
      if (!name) return fail(tGlobal('agent.fail.badArgs', { detail: 'name' }));
      const cat = await store.createCategory({
        worldId: store.activeWorld!.id,
        name,
        icon: str(args.icon).trim() || '📁',
        color: /^#[0-9a-f]{6}$/i.test(str(args.color).trim()) ? str(args.color).trim() : undefined,
        order: store.categories.length,
      });
      return ok(tGlobal('agent.done.createCategory', { name: cat.name }), { id: cat.id });
    },
  },
  {
    name: 'update_category',
    risk: 'write',
    required: ['category'],
    args: ['category', 'name', 'icon', 'color'],
    run: async ({ store }, args) => {
      const found = resolveCategory(store.categories, args.category);
      if ('error' in found) return found.error;
      const patch: Partial<Category> = {};
      if (str(args.name).trim()) patch.name = str(args.name).trim();
      if (str(args.icon).trim()) patch.icon = str(args.icon).trim();
      if (/^#[0-9a-f]{6}$/i.test(str(args.color).trim())) patch.color = str(args.color).trim();
      if (!Object.keys(patch).length) {
        return ok(tGlobal('agent.done.noChange'), { id: found.value.id });
      }
      await store.updateCategory(found.value.id, patch);
      return ok(tGlobal('agent.done.updateCategory', { name: found.value.name }), {
        id: found.value.id,
        fields: Object.keys(patch),
      });
    },
  },
  {
    name: 'delete_category',
    risk: 'write',
    required: ['category'],
    args: ['category'],
    run: async ({ store }, args) => {
      const found = resolveCategory(store.categories, args.category);
      if ('error' in found) return found.error;
      // 删掉最后一个分类等于清空整个世界 —— 这种「聪明」不要有
      if (store.categories.length <= 1) return fail(tGlobal('agent.fail.entryLastCategory'));
      const name = found.value.name;
      await store.deleteCategory(found.value.id);
      return ok(tGlobal('agent.done.deleteCategory', { name }), { id: found.value.id });
    },
  },
  {
    name: 'update_world',
    risk: 'write',
    required: [],
    args: ['name', 'tagline', 'summary', 'genre', 'tone', 'themeColor'],
    run: async ({ store }, args) => {
      const patch: Partial<World> = {};
      (['name', 'tagline', 'summary', 'genre', 'tone'] as const).forEach((k) => {
        if (args[k] !== undefined) patch[k] = str(args[k]);
      });
      const color = str(args.themeColor).trim();
      if (/^#[0-9a-f]{6}$/i.test(color)) patch.themeColor = color;
      if (!Object.keys(patch).length) {
        return ok(tGlobal('agent.done.noChange'), { id: store.activeWorld!.id });
      }
      await store.updateWorld(store.activeWorld!.id, patch);
      return ok(tGlobal('agent.done.updateWorld'), { fields: Object.keys(patch) });
    },
  },
  {
    name: 'create_piece',
    risk: 'write',
    required: ['title', 'content'],
    args: ['title', 'content', 'kind', 'tags'],
    run: async ({ store }, args) => {
      const title = str(args.title).trim();
      const content = str(args.content);
      if (!title) return fail(tGlobal('agent.fail.needTitle'));
      if (!content.trim()) return fail(tGlobal('agent.fail.needText'));
      const kind = str(args.kind).trim();
      const piece = await store.createPiece({
        worldId: store.activeWorld!.id,
        kind: (TEXT_PIECE_KINDS as readonly string[]).includes(kind)
          ? (kind as PieceKind)
          : 'fragment',
        title,
        content,
        tags: strList(args.tags),
      });
      return ok(tGlobal('agent.done.createPiece', { title: piece.title }), { id: piece.id });
    },
  },
  {
    name: 'update_piece',
    risk: 'write',
    required: ['piece'],
    args: ['piece', 'title', 'content', 'tags', 'pinned'],
    run: async ({ store }, args) => {
      const found = resolvePiece(store.pieces, args.piece);
      if ('error' in found) return found.error;
      const patch: Partial<Piece> = {};
      if (str(args.title).trim()) patch.title = str(args.title).trim();
      if (args.content !== undefined) patch.content = str(args.content);
      if (args.tags !== undefined) patch.tags = strList(args.tags);
      if (args.pinned !== undefined) patch.pinned = args.pinned === true;
      if (!Object.keys(patch).length) {
        return ok(tGlobal('agent.done.noChange'), { id: found.value.id });
      }
      await store.updatePiece(found.value.id, patch);
      return ok(tGlobal('agent.done.updatePiece', { title: found.value.title }), {
        id: found.value.id,
        fields: Object.keys(patch),
      });
    },
  },
  {
    name: 'delete_piece',
    risk: 'write',
    required: ['piece'],
    args: ['piece'],
    run: async ({ store }, args) => {
      const found = resolvePiece(store.pieces, args.piece);
      if ('error' in found) return found.error;
      await store.deletePiece(found.value.id);
      return ok(tGlobal('agent.done.deletePiece', { title: found.value.title }), {
        id: found.value.id,
      });
    },
  },
  {
    name: 'add_doc',
    risk: 'write',
    required: ['name', 'text'],
    args: ['name', 'text'],
    run: async ({ store }, args) => {
      const name = str(args.name).trim();
      const text = str(args.text);
      if (!name) return fail(tGlobal('agent.fail.badArgs', { detail: 'name' }));
      if (!text.trim()) return fail(tGlobal('agent.fail.needText'));
      const doc = await store.addDoc({
        worldId: store.activeWorld!.id,
        name,
        ext: 'txt',
        size: new TextEncoder().encode(text).length,
        text,
        parsed: false,
        addedAt: Date.now(),
      });
      return ok(tGlobal('agent.done.addDoc', { name: doc.name }), { id: doc.id });
    },
  },
  {
    name: 'delete_doc',
    risk: 'write',
    required: ['doc'],
    args: ['doc'],
    run: async ({ store }, args) => {
      const key = str(args.doc).trim().toLowerCase();
      const hit =
        store.docs.find((d) => d.id === str(args.doc)) ??
        store.docs.find((d) => d.name.toLowerCase() === key) ??
        store.docs.find((d) => d.name.toLowerCase().includes(key));
      if (!hit) return fail(tGlobal('agent.fail.docNotFound', { name: str(args.doc) }));
      await store.deleteDoc(hit.id);
      return ok(tGlobal('agent.done.deleteDoc', { name: hit.name }), { id: hit.id });
    },
  },
  {
    name: 'update_settings',
    risk: 'write',
    required: [],
    args: ['temperature', 'contextLimit', 'vision'],
    run: async ({ store }, args) => {
      const before = store.settings;
      const patch: Partial<AppSettings['ai']> = {};
      if (args.temperature !== undefined && Number.isFinite(Number(args.temperature))) {
        patch.temperature = Math.min(2, Math.max(0, Number(args.temperature)));
      }
      if (args.contextLimit !== undefined) {
        patch.contextLimit = clamp(args.contextLimit, 5, 500, 60);
      }
      if (args.vision !== undefined) patch.vision = args.vision === true;
      if (!Object.keys(patch).length) {
        return ok(tGlobal('agent.done.noChange'), {});
      }
      await store.updateAI(patch);
      await store.logOp({
        worldId: null,
        action: 'update',
        entity: 'settings',
        target: '',
        fields: Object.keys(patch),
        undo: { settings: before },
      });
      return ok(tGlobal('agent.done.updateSettings'), { fields: Object.keys(patch) });
    },
  },
  {
    /**
     * 「AI 自动排版」：让 AI 把时间轴上的条目重排一遍（只动先后）。
     *
     * 这是**入队式的重活**，不是一个快动作 —— 它会调一次模型，产出方案后进审查队列，
     * 由作者在审查页拍板。agent 调用它，等于替作者按下了编年里那个「AI 排版」按钮。
     * 锁定的条目若被挪了位置，时间文字会跟着一起改（见 `runTimelineLayout`）。
     */
    name: 'layout_timeline',
    risk: 'write',
    required: [],
    args: [],
    run: async (ctx) => {
      const { store } = ctx;
      if (store.entries.length < 2) return none(tGlobal('agent.done.layoutNeedEntries'), {});
      const out = await runTimelineLayout(
        store.settings.ai,
        store.activeWorld!,
        store.entries,
        store.categories,
        { signal: ctx.signal },
      );
      if (!out.items.length) {
        return out.unmatched.length
          ? fail(tGlobal('agent.done.layoutUnmatched', { n: out.unmatched.length }))
          : ok(tGlobal('agent.done.layoutNoChange'));
      }
      const item = await propose(ctx, {
        kind: 'timeline-layout',
        title: tGlobal('agent.done.layoutPlanTitle', { n: out.items.length }),
        layoutDraft: out.items,
        note: out.unmatched.length
          ? tGlobal('agent.done.layoutUnmatchedNote', {
              n: out.unmatched.length,
              titles: out.unmatched.slice(0, 6).join(tGlobal('agent.sys.toolArgSep')),
            })
          : '',
        rationale: out.note,
        source: { task: 'timeline-layout' },
      });
      return {
        ok: true,
        summary: tGlobal('agent.done.layoutQueued', { n: out.items.length }),
        data: { id: item.id, count: out.items.length, status: 'pending-review' },
        proposal: true,
      };
    },
  },
  {
    /**
     * 「AI 猜测时间」：给还没设时间的条目猜出「什么时候」并设定好。
     *
     * 与排版是两件事：排版只动先后，猜测要凭空定出时间（文本 + 位置一起）。它更重，
     * 因为它在替作者编日期，所以结果一律进审查队列，绝不直接落库。
     */
    name: 'guess_timeline',
    risk: 'write',
    required: [],
    args: [],
    run: async (ctx) => {
      const { store } = ctx;
      const untimed = store.entries.filter((e) => !e.time).length;
      if (!untimed) return none(tGlobal('agent.done.guessNoPool'), {});
      const out = await runTimelineGuess(
        store.settings.ai,
        store.activeWorld!,
        store.entries,
        store.categories,
        { signal: ctx.signal },
      );
      if (!out.items.length) {
        return out.unmatched.length
          ? fail(tGlobal('agent.done.guessUnmatched', { n: out.unmatched.length }))
          : ok(tGlobal('agent.done.guessNoChange'));
      }
      const item = await propose(ctx, {
        kind: 'timeline-guess',
        title: tGlobal('agent.done.guessPlanTitle', { n: out.items.length }),
        guessDraft: out.items,
        note: out.unmatched.length
          ? tGlobal('agent.done.guessUnmatchedNote', {
              n: out.unmatched.length,
              titles: out.unmatched.slice(0, 6).join(tGlobal('agent.sys.toolArgSep')),
            })
          : '',
        rationale: out.note,
        source: { task: 'timeline-guess' },
      });
      return {
        ok: true,
        summary: tGlobal('agent.done.guessQueued', { n: out.items.length }),
        data: { id: item.id, count: out.items.length, status: 'pending-review' },
        proposal: true,
      };
    },
  },

  /* ------------------------- 视图与留痕 ------------------------- */
  {
    name: 'navigate',
    risk: 'read',
    required: ['page'],
    args: ['page', 'entry'],
    run: async ({ store }, args) => {
      const target = resolveAgentPage(args.page);
      if (!target) {
        return fail(tGlobal('agent.fail.badArgs', { detail: 'page' }), { pages: AGENT_PAGES });
      }
      // 指定了条目就顺手解析成 id，界面据此直接开编辑面板
      let entryId: ID | undefined;
      if (str(args.entry).trim()) {
        const found = resolveEntry(store.entries, args.entry);
        if ('error' in found) return found.error;
        entryId = found.value.id;
      }
      return ok(tGlobal('agent.done.navigate', { page: pageLabel(target.page, target.view) }), {
        page: target.page,
        // 旧说法落到哪一支上（时间线 → 关系图谱的时间分支；旧的两页 → Wiki 的子页），
        // 界面照着这个值切视图
        view: target.view,
        entryId,
      });
    },
  },
  {
    /**
     * 把话交回给作者 —— 这是「聪明」和「轴」的分界线。
     *
     * 查不到、说不清、有几种可能拿不准，都该走这里，而不是换个关键词再查一遍。
     * 它是 terminal 的：执行到它这一轮就结束，作者的回答就是下一轮的开头。
     */
    name: 'ask_author',
    risk: 'read',
    terminal: true,
    required: ['question'],
    args: ['question', 'options'],
    run: async (_ctx, args) => {
      const question = str(args.question).trim();
      if (!question) return fail(tGlobal('agent.fail.needQuestion'));
      const options = strList(args.options).slice(0, 4);
      return ok(question, { asked: question, options });
    },
  },
  {
    name: 'note',
    risk: 'read',
    required: ['text'],
    args: ['text'],
    run: async ({ store }, args) => {
      const text = str(args.text).trim();
      if (!text) return fail(tGlobal('agent.fail.needText'));
      await store.logNote(text, { actor: 'agent' });
      return ok(tGlobal('agent.done.note', { text }), { text });
    },
  },
];

export const TOOL_BY_NAME: Record<string, AgentTool> = Object.fromEntries(
  AGENT_TOOLS.map((t) => [t.name, t]),
);

/** 去掉大小写、下划线、连字符、空格之后的形状，用来兜住模型的写法差异 */
const loose = (s: string): string => s.toLowerCase().replace(/[^a-z0-9]/g, '');

const TOOL_BY_LOOSE: Record<string, AgentTool> = Object.fromEntries(
  AGENT_TOOLS.map((t) => [loose(t.name), t]),
);

/**
 * 按名字找工具。
 *
 * 真实模型经常把 `create_entry` 写成 `CreateEntry` / `create-entry` / `create entry` ——
 * 严格查表会把这种动作当成「未知工具」拒掉，作者看到的是一次莫名其妙的失败。
 * 这里容一层写法差异，只认形状不认大小写。
 */
export function findTool(name: string): AgentTool | undefined {
  const raw = (name ?? '').trim();
  if (!raw) return undefined;
  return TOOL_BY_NAME[raw] ?? TOOL_BY_LOOSE[loose(raw)];
}

/** 工具行的显示名（给模型看的清单里用） */
export function toolSpec(name: string): string {
  return tGlobal(`agent.tool.${name}`);
}

/** 「- create_entry（写）：新建一个条目…」 */
export function renderToolList(): string {
  return AGENT_TOOLS.map((t) => {
    // 参数名一并印出来。
    // 不印的话，模型只能从描述里的散话去猜键名 —— `read_entry` 的描述只说「参数用标题或别名」，
    // 它猜成 `title` 就永远调不通（真实发生过：连调 8 次全废）。
    // 参数名是代码标识符，不是给人看的措辞，所以不进语言包。
    //
    // **一个工具占一行**：`agent.tool.*` 的文案里不许有换行。换行会把参数清单挤到下一行，
    // 读起来像另起一个工具 —— `unit-args.mjs` 的第八节正是拿「这一行里有没有『参数：』」盯它。
    const args = t.args.length
      ? t.args
          .map((a) =>
            t.required.includes(a)
              ? tGlobal('agent.sys.toolArgRequired', { name: a })
              : a,
          )
          .join(tGlobal('agent.sys.toolArgSep'))
      : tGlobal('agent.sys.toolArgNone');
    return tGlobal('agent.sys.toolLine', {
      name: t.name,
      risk: tGlobal(t.risk === 'read' ? 'agent.sys.riskRead' : 'agent.sys.riskWrite'),
      spec: toolSpec(t.name),
      args: tGlobal('agent.sys.toolArgs', { list: args }),
    });
  }).join('\n');
}
