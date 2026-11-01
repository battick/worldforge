/**
 * agent 回复的协议解析。
 *
 * 约定的形状（写在系统提示词里）：
 *   {"say": "…", "plan": [{"tool": "…", "args": {}, "why": "…"}]}
 *
 * 一轮的终结点就是「plan 为空」—— 不需要额外的 done 标志，少一个字段就少一处
 * 模型能写错的地方。循环由调用方（useAgent）驱动：有动作就执行、把结果回灌、
 * 再问一轮；回到 plan 为空时，这一轮的 say 就是最终答复。
 *
 * 为什么自定义 JSON 协议而不用厂商原生的 function calling：
 * 这个应用支持任意 OpenAI 兼容端点（含本地小模型），原生 tool_calls 的支持度参差不齐；
 * 「输出一段 JSON」则是所有模型都能做到的，配合 parse.ts 的容错提取足够稳。
 *
 * ── 为什么要容错到这个地步 ──
 *
 * 假上游永远吐标准格式，所以端到端测不出「模型没照格式回」；而真实模型几乎必然变形：
 * 只做一件事时把 plan 写成**对象**而不是数组、键名换成 steps/actions/tool_calls、
 * 把参数塞进 arguments/params、把 plan **序列化成字符串**、或者干脆把 say 和 plan
 * 吐成**两个并列的 JSON 对象**。这些偏差在老实现里全是**静默丢动作** ——
 * 作者看到的是「它说完了，然后什么都没发生」，且无从判断是模型不想做还是解析吃了。
 *
 * 所以这里的立场是：**只要模型表达了动作，就必须救回来**；实在没给 JSON，
 * 就把整段当答复并打上 protocolBroken，让界面能如实提示，而不是装作一切正常。
 *
 * ── 还有一类畸形，光靠上面的容错取不出来（真实翻车）──
 *
 * 模型一口气提 8 个动作时，**每个动作对象少写了一个 `}`**（`args` 关上了、动作自己没关）。
 * 这种「东西都在、就是括号少一个」的毛病，末尾逗号修不掉、截断修复也只会往末尾补括号 ——
 * 于是整轮被判成废品：作者看到「它说完了，然后什么都没发生」，而且请它重说一遍，
 * 它多半照抄同一处错，再废一轮（两条写好的提议就这么没了）。
 * 这类交给 `parse.ts` 的 `looseJson`（逐 token 结构修复），捞回来的这轮记
 * `salvaged`，界面上如实说一句「它少写了括号，我补齐了照常执行」。
 */
import { asArray, extractJsonEx, looseJson, str } from '../parse';
import { tGlobal } from '../../i18n/translate';
import type { AgentSuggestion, AgentTodoItem } from '../../types';

export interface AgentAction {
  tool: string;
  args: Record<string, unknown>;
  why: string;
}

export interface AgentReply {
  say: string;
  plan: AgentAction[];
  /**
   * 它这一轮自己维护的待办清单（可空 = 这一轮没动清单）。
   *
   * 收成独立字段而不是又一个工具，是因为它每一轮都该被看见：「清点式」任务
   * （把提到过、还没建的补全）要跨十几轮，模型得随时知道还剩什么没做，
   * 作者也得随时看得见进度。塞成一个工具调用，它就会变成一件"可做可不做"的事。
   */
  todos: AgentTodoItem[];
  /**
   * 清单里有没有被明确弃掉的项（模型可以不写，写了就按上面那份替换）。
   *
   * 单独记一份是为了**不许靠删清单假装做完**：新清单里少掉的必然未完项，
   * 循环会如实记一笔（`droppedTodo`）。
   */
  todosGiven: boolean;
  /**
   * 它明说「这件事做完了」。
   *
   * 为什么要显式说：光看「plan 为空」区分不了「做完了」和「说到一半停下来了」——
   * 真实翻车就是这样：它说「接下来我将继续检查其他条目」，plan 给 []，循环照旧收工，
   * 作者等到的是半成品加一句空承诺。有了这个字段，循环才敢在它没说完时催它一句。
   * 缺省（没写）时按「不确定」处理：只有清单上确实没剩东西才当收工。
   */
  done: boolean;
  /**
   * 它交回话的时候，顺手给的**下一步可以做什么**（可空 = 这一轮没给）。
   *
   * 收成独立字段而不是让它扮成一次 `ask_author`，是因为这两件事的语义相反：
   * 提问是「我不知道，得你说」，建议是「我知道下一步能做什么，你点一下我就去」。
   * 把建议塞进提问里，作者就得先回答一个他根本不需要回答的问题。
   *
   * 这里只负责**读出来**：「算不算数」由调用方判 —— 手上还有动作没跑完的时候，
   * 任何「接下来你可以…」都是噪音（作者连结果都还没看到），
   * 所以 `useAgent` 只在「把话交回给作者」的那一轮才收下它。
   */
  suggest: AgentSuggestion[];
  /**
   * 模型这轮压根没按 JSON 协议回（说了一段话，或格式彻底不成形）。
   * 界面据此提示「它没照格式说」，useAgent 据此请它重说一遍。
   */
  protocolBroken: boolean;
  /**
   * 严格解析全败、**靠结构修复才捞回来**的（典型：动作对象少写一个 `}`）。
   * 动作是它的、一个没丢，但这一轮它不是按约定写出来的 —— 界面要说这一句，
   * 省得作者以为模型很乖，下次碰上真救不回来的那回反倒莫名其妙。
   */
  salvaged: boolean;
}

/** 单轮最多几个动作 —— 和提示词里的要求保持一致 */
export const MAX_ACTIONS_PER_STEP = 8;

/* ------------------------------------------------------------------ */
/* 取值：真实模型爱换键名，每个字段都认几个别名                          */
/* ------------------------------------------------------------------ */

const firstOf = (o: any, keys: string[]): unknown => {
  for (const k of keys) if (o?.[k] !== undefined && o[k] !== null) return o[k];
  return undefined;
};

/** 工具名可能被包成 `create_entry`、"create_entry"、create_entry(...) */
function cleanTool(v: unknown): string {
  const s = str(v).trim();
  if (!s) return '';
  return s
    .replace(/^[`"'\s]+/, '')
    .replace(/[`"'\s]+$/, '')
    .replace(/\(.*$/, '')
    .trim();
}

const LOOKS_LIKE_ACTION = ['tool', 'name', 'toolName', 'tool_name', 'function', 'action', 'params'];

function isActionShaped(v: unknown): boolean {
  if (!v || typeof v !== 'object' || Array.isArray(v)) return false;
  const o = v as Record<string, unknown>;
  return LOOKS_LIKE_ACTION.some((k) => o[k] !== undefined);
}

function toAction(a: unknown): AgentAction | null {
  // 极端省事的情况：直接把工具名当动作丢过来
  if (typeof a === 'string') {
    const name = cleanTool(a);
    return name ? { tool: name, args: {}, why: '' } : null;
  }
  if (!a || typeof a !== 'object') return null;

  const o = a as Record<string, unknown>;
  let rawTool = firstOf(o, ['tool', 'toolName', 'tool_name', 'name', 'action', 'function']);
  let nestedArgs: unknown;

  // 原生 function calling 的形状：{function: {name, arguments}}
  if (rawTool && typeof rawTool === 'object') {
    const fn = rawTool as Record<string, unknown>;
    nestedArgs = firstOf(fn, ['arguments', 'args', 'parameters']);
    rawTool = firstOf(fn, ['name', 'tool', 'toolName']);
  }

  const tool = cleanTool(rawTool);
  if (!tool) return null;

  const rawArgs =
    firstOf(o, ['args', 'arguments', 'params', 'parameters', 'input', 'payload']) ?? nestedArgs;
  let args: Record<string, unknown> = {};
  if (rawArgs && typeof rawArgs === 'object' && !Array.isArray(rawArgs)) {
    args = rawArgs as Record<string, unknown>;
  } else if (typeof rawArgs === 'string' && rawArgs.trim()) {
    // 参数也会被序列化成字符串
    try {
      const p = JSON.parse(rawArgs);
      if (p && typeof p === 'object' && !Array.isArray(p)) args = p as Record<string, unknown>;
    } catch {
      /* 解不动就当没给参数：工具自己会报缺什么 */
    }
  }

  const why = str(firstOf(o, ['why', 'reason', 'because', 'note', 'desc', 'description'])).trim();
  return { tool, args, why };
}

/** plan 可能是数组、单个动作对象、包着一层的列表、甚至是被序列化的字符串 */
function toActions(raw: unknown): AgentAction[] {
  if (raw === undefined || raw === null) return [];
  if (typeof raw === 'string') {
    const s = raw.trim();
    if (!s) return [];
    try {
      return toActions(JSON.parse(s));
    } catch {
      // 也可能就是「工具名」本身
      const one = toAction(s);
      return one ? [one] : [];
    }
  }
  if (Array.isArray(raw)) {
    return raw.map(toAction).filter((a): a is AgentAction => !!a);
  }
  if (typeof raw === 'object') {
    const nested = asArray<unknown>(raw);
    if (nested.length) return toActions(nested);
    if (isActionShaped(raw)) {
      const one = toAction(raw);
      return one ? [one] : [];
    }
  }
  return [];
}

const SAY_KEYS = ['say', 'reply', 'answer', 'message', 'text', 'content', 'response'];
const PLAN_KEYS = [
  'plan',
  'actions',
  'steps',
  // 注意：**没有** 'todo' / 'todos'。
  // 它们现在是**清单**的键（见 TODO_KEYS）——同一个名字既是「要执行的动作」又是
  // 「要做的待办」，混着认就会把一份待办清单当动作去执行（每一步都成了「没有这个工具」）。
  // 真碰上说 `todos` 是动作的模型，走 `collect()` 里那条「它长得像动作才当动作」的兜底。
  'tasks',
  'calls',
  'tool_calls',
  'toolCalls',
  'next',
];
/** 待办清单的键。模型爱怎么写就怎么写，认全一点 */
const TODO_KEYS = ['todos', 'todo', 'checklist', 'todo_list', 'todoList', 'later'];
/** 「这件事做完了」的键。同义写法都认 */
const DONE_KEYS = ['done', 'finished', 'complete', 'completed', 'allDone', 'all_done'];
/** 单条待办的文字字段 */
const TODO_TEXT_KEYS = ['text', 'title', 'task', 'item', 'content', 'name', 'what', 'label'];
/** 单条待办的完成标记字段 */
const TODO_DONE_KEYS = ['done', 'completed', 'checked', 'finished', 'state', 'status'];
/**
 * 「下一步可以做点什么」的键。
 *
 * **刻意没有 `next`** —— 那个名字在 `PLAN_KEYS` 里是「这一轮要执行的动作」。
 * 同一个词既当动作又当建议，认错的代价是：一串「没有这个工具」的失败，
 * 而作者看到的是一排本该能点的按钮变成了报错。
 * `options` 也不收：它是 `ask_author` 的参数名，两处混起来就分不清
 * 「这个问题的候选答案」和「接下来可以让我做的事」了。
 */
const SUGGEST_KEYS = [
  'suggest',
  'suggestions',
  'nextSteps',
  'next_steps',
  'followUp',
  'follow_up',
  'followups',
];
/** 建议里「按钮上写什么」的字段 */
const SUGGEST_LABEL_KEYS = ['label', 'title', 'name', 'text', 'short', 'action'];
/** 建议里「点下去发给它什么」的字段 */
const SUGGEST_GOAL_KEYS = ['goal', 'prompt', 'query', 'ask', 'say', 'text', 'content', 'detail'];
/** 最多收几条 —— 跟提示词里说的一致。再多就不是「建议」是一堵墙了 */
export const MAX_SUGGESTIONS = 4;

/** 把一个值读成布尔 —— `true` / `"true"` / `"yes"` / `"done"` 都算真 */
function readBool(v: unknown): boolean | undefined {
  if (typeof v === 'boolean') return v;
  if (typeof v === 'number') return v !== 0;
  if (typeof v === 'string') {
    const s = v.trim().toLowerCase();
    if (!s) return undefined;
    if (['true', 'yes', 'y', 'done', 'ok', 'completed', 'finished', '1', '✓', 'x'].includes(s)) {
      return true;
    }
    // 下面两行是**解析用**的关键词表，不是界面文案：模型用哪种语言写清单，与界面语言无关
    if (['false', 'no', 'n', 'todo', 'pending', 'open', '0', '未完成', '待办'].includes(s)) { // i18n-allow
      return false;
    }
  }
  return undefined;
}

/**
 * 一条待办。
 *
 * 模型常把清单写成 Markdown 复选框（`- [x] 读条目`），所以 `[ ]` / `[x]` 也读：
 * **勾选状态就是它表达「做完了」的方式**，不认这一手的话，作者会看到一份永远不动的清单。
 */
function toTodo(v: unknown): AgentTodoItem | null {
  if (typeof v === 'string') {
    const t = cleanTodoText(v);
    return t.text ? { text: t.text, done: t.done } : null;
  }
  if (!v || typeof v !== 'object' || Array.isArray(v)) return null;
  const o = v as Record<string, unknown>;
  const raw = str(firstOf(o, TODO_TEXT_KEYS)).trim();
  const t = cleanTodoText(raw);
  if (!t.text) return null;
  let done = readBool(firstOf(o, TODO_DONE_KEYS));
  if (done === undefined) done = t.done;
  return { text: t.text, done: !!done };
}

/** 剥掉 `- [x]`、`1.`、`✓` 这类前缀，并顺手把它们当完成标记读出来 */
function cleanTodoText(raw: string): { text: string; done: boolean } {
  let s = (raw ?? '').trim();
  let done = false;
  const box = s.match(/^(?:[-*+]\s*)?\[( |x|X|✓|√)\]\s*/);
  if (box) {
    done = box[1].toLowerCase() !== ' ';
    s = s.slice(box[0].length);
  } else {
    const mark = s.match(/^[-*+\s]*[✓√]\s*/);
    if (mark) {
      done = true;
      s = s.slice(mark[0].length);
    }
  }
  s = s.replace(/^[-*+]\s+/, '').replace(/^\d+[.)]\s+/, '').trim();
  return { text: s, done };
}

/**
 * 清单可能是数组、被序列化成字符串、包着一层壳，甚至整个写成一段带换行的文本。
 * 全认。
 */
function toTodos(raw: unknown, depth = 0): { items: AgentTodoItem[]; explicit: boolean } {
  if (raw === undefined || raw === null) return { items: [], explicit: false };
  if (typeof raw === 'string') {
    const s = raw.trim();
    if (!s) return { items: [], explicit: true };
    try {
      return toTodos(JSON.parse(s), depth + 1);
    } catch {
      // 一段带换行的清单文本：按行读，空行丢掉
      const items = s
        .split(/\r?\n/)
        .map((line) => toTodo(line))
        .filter((x): x is AgentTodoItem => !!x);
      return { items, explicit: true };
    }
  }
  if (Array.isArray(raw)) {
    return { items: raw.map(toTodo).filter((x): x is AgentTodoItem => !!x), explicit: true };
  }
  if (typeof raw === 'object' && depth < 2) {
    const o = raw as Record<string, unknown>;
    const nested = firstOf(o, TODO_KEYS);
    if (nested !== undefined) return toTodos(nested, depth + 1);
    const one = toTodo(o);
    if (one) return { items: [one], explicit: true };
  }
  return { items: [], explicit: false };
}

/**
 * 一条「下一步建议」。
 *
 * 模型给的形状主要是两种：一句人话（`"构思『导师』条目"`），或 `{label, goal}`。
 * 两种都收 —— 只给一句话时，按钮上写的和点下去发给它的就是同一句。
 */
function toSuggestion(v: unknown): AgentSuggestion | null {
  const pick = (s: string): string => cleanTodoText(s).text.trim();
  if (typeof v === 'string') {
    const one = pick(v);
    return one ? { label: one, goal: one } : null;
  }
  if (!v || typeof v !== 'object' || Array.isArray(v)) return null;
  const o = v as Record<string, unknown>;
  const goal = pick(str(firstOf(o, SUGGEST_GOAL_KEYS)));
  const label = pick(str(firstOf(o, SUGGEST_LABEL_KEYS)));
  const g = goal || label;
  if (!g) return null;
  return { label: label || goal, goal: g };
}

/** 去重（模型爱把同一条写两遍）并按上限截断 */
function dedupeSuggestions(list: AgentSuggestion[]): AgentSuggestion[] {
  const seen = new Set<string>();
  const out: AgentSuggestion[] = [];
  for (const s of list) {
    const key = s.label.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(s);
    if (out.length >= MAX_SUGGESTIONS) break;
  }
  return out;
}

/**
 * 建议可能是数组、单个对象、被序列化成字符串，甚至整段写成带换行的文本（每行一条）。
 * 全认 —— 这一类字段丢了不会报错，只会让那一排按钮凭空消失，作者只会觉得「它变笨了」。
 */
function toSuggestions(raw: unknown, depth = 0): AgentSuggestion[] {
  if (raw === undefined || raw === null) return [];
  if (typeof raw === 'string') {
    const s = raw.trim();
    if (!s) return [];
    try {
      return toSuggestions(JSON.parse(s), depth + 1);
    } catch {
      return dedupeSuggestions(
        s
          .split(/\r?\n/)
          .map((line) => toSuggestion(line))
          .filter((x): x is AgentSuggestion => !!x),
      );
    }
  }
  if (Array.isArray(raw)) {
    return dedupeSuggestions(
      raw.map(toSuggestion).filter((x): x is AgentSuggestion => !!x),
    );
  }
  if (typeof raw === 'object' && depth < 2) {
    const o = raw as Record<string, unknown>;
    const nested = firstOf(o, SUGGEST_KEYS);
    if (nested !== undefined) return toSuggestions(nested, depth + 1);
    const one = toSuggestion(o);
    if (one) return [one];
  }
  return [];
}

function collect(v: unknown): {
  say: string;
  plan: AgentAction[];
  todos: AgentTodoItem[];
  todosExplicit: boolean;
  done: boolean;
  suggest: AgentSuggestion[];
  suggestGiven: boolean;
} {
  if (typeof v === 'string') {
    return {
      say: v,
      plan: [],
      todos: [],
      todosExplicit: false,
      done: false,
      suggest: [],
      suggestGiven: false,
    };
  }
  if (Array.isArray(v)) {
    return {
      say: '',
      plan: toActions(v),
      todos: [],
      todosExplicit: false,
      done: false,
      suggest: [],
      suggestGiven: false,
    };
  }
  if (!v || typeof v !== 'object') {
    return {
      say: str(v),
      plan: [],
      todos: [],
      todosExplicit: false,
      done: false,
      suggest: [],
      suggestGiven: false,
    };
  }

  const o = v as Record<string, unknown>;
  const say = str(firstOf(o, SAY_KEYS)).trim();
  const rawTodos = firstOf(o, TODO_KEYS);
  const rawSuggest = firstOf(o, SUGGEST_KEYS);

  // `todos` 也可能真是它的**动作列表**（模型把 plan 叫成 todos 是有过的）。
  // 判别很干脆：每一条都长得像动作 → 那是动作，不是清单。
  // 认错了的代价不对称：把动作当清单，这一轮就白跑；把清单当动作，只会得到一串
  // 「没有这个工具」的失败，而作者还能看见清单内容。
  const looksLikePlan =
    Array.isArray(rawTodos) &&
    rawTodos.length > 0 &&
    rawTodos.every((x) => isActionShaped(x));

  const got = looksLikePlan ? { items: [], explicit: false } : toTodos(rawTodos);

  let rawPlan = firstOf(o, PLAN_KEYS);
  if (rawPlan === undefined && looksLikePlan) rawPlan = rawTodos;
  // 根级直接就是一个动作（没有 say/plan 外壳）
  if (rawPlan === undefined && isActionShaped(o)) rawPlan = o;
  const plan = toActions(rawPlan);

  return {
    say,
    plan,
    todos: got.items,
    todosExplicit: got.explicit,
    done: readBool(firstOf(o, DONE_KEYS)) === true && plan.length === 0,
    suggest: toSuggestions(rawSuggest),
    suggestGiven: rawSuggest !== undefined && rawSuggest !== null,
  };
}

/* ------------------------------------------------------------------ */
/* 切分：模型可能把 say 和 plan 吐成两个并列的 JSON 对象                 */
/* ------------------------------------------------------------------ */

function tryParse(s: string): unknown {
  try {
    return JSON.parse(s);
  } catch {
    return undefined;
  }
}

/** 把文本里所有「并列的顶层 JSON 对象/数组」切出来 */
function jsonChunks(raw: string): unknown[] {
  const out: unknown[] = [];
  let depth = 0;
  let start = -1;
  let inStr = false;
  let esc = false;

  for (let i = 0; i < raw.length; i++) {
    const ch = raw[i];
    if (inStr) {
      if (esc) esc = false;
      else if (ch === '\\') esc = true;
      else if (ch === '"') inStr = false;
      continue;
    }
    if (ch === '"') inStr = true;
    else if (ch === '{' || ch === '[') {
      if (depth === 0) start = i;
      depth++;
    } else if (ch === '}' || ch === ']') {
      depth--;
      if (depth <= 0) {
        if (start >= 0 && depth === 0) {
          const v = tryParse(raw.slice(start, i + 1));
          if (v !== undefined) out.push(v);
        }
        depth = 0;
        start = -1;
      }
    }
  }
  return out;
}

/* ------------------------------------------------------------------ */
/* 主入口                                                              */
/* ------------------------------------------------------------------ */

export function parseAgentReply(raw: string): AgentReply {
  const text = (raw ?? '').trim();
  if (!text) {
    return {
      say: '',
      plan: [],
      todos: [],
      todosGiven: false,
      done: false,
      suggest: [],
      protocolBroken: true,
      salvaged: false,
    };
  }

  // 先整体解一次：能顺带救回被 token 上限拦腰截断的那一坨
  let chunks: unknown[] = [];
  let salvaged = false;
  try {
    const got = extractJsonEx(text);
    chunks = [got.value];
    salvaged = got.loose;
    // 结构修复只读**第一个**值。若这段其实就是两个并列的对象（它爱把 say 和 plan
    // 分开吐），逐块扫描看得更全 —— 那种交给它，别让修复把后半个丢了。
    if (salvaged) {
      const parts = jsonChunks(text);
      if (parts.length > 1) {
        chunks = parts;
        salvaged = false;
      }
    }
  } catch {
    // 整体解不动（比如两个并列对象拼在一起）→ 退化成逐块扫描
    chunks = jsonChunks(text);
    if (!chunks.length) {
      // 逐块也读不出来 —— 最后一手：结构在、只是某处少写了括号。
      // 从第一个括号处截起，跳过它前面可能有的那句闲聊。
      const starts = [text.indexOf('{'), text.indexOf('[')].filter((k) => k >= 0);
      const body = starts.length ? text.slice(Math.min(...starts)) : text;
      for (const cand of [body, text]) {
        const got = looseJson(cand);
        if (got === undefined) continue;
        const probe = collect(got);
        // 修出来的东西得**真的是这一轮的东西**才认，不然又是一处静默丢空/静默乱做
        if (probe.say || probe.plan.length || probe.suggest.length) {
          chunks = [got];
          salvaged = true;
          break;
        }
      }
    }
  }

  if (!chunks.length) {
    // 模型压根没给 JSON：整段当答复，别让它白说；但如实标出「没按协议」
    return {
      say: text,
      plan: [],
      todos: [],
      todosGiven: false,
      done: false,
      suggest: [],
      protocolBroken: true,
      salvaged: false,
    };
  }

  const says: string[] = [];
  const plan: AgentAction[] = [];
  /**
   * 清单：**给了就收下，不管这一轮有没有动作**。
   *
   * 早期这里写的是「只在没给动作的时候才收」——那条规矩是错的。真实 agent 的常态
   * 恰恰是**同一轮里先立账、再动手**（「一共 5 条，我先把账立起来，现在读前 2 条」），
   * 把清单丢掉的话，作者界面上那份账永远立不起来，而模型下一轮回来时也看不见
   * 自己刚才说过什么 —— 「清点式」任务就是从这儿烂掉的。
   */
  let todos: AgentTodoItem[] = [];
  let todosExplicit = false;
  let done = false;
  let suggest: AgentSuggestion[] = [];
  for (const c of chunks) {
    const got = collect(c);
    if (got.say) says.push(got.say);
    plan.push(...got.plan);
    if (got.todosExplicit) {
      todos = got.todos;
      todosExplicit = true;
    }
    if (got.done) done = true;
    // 跟清单同一条规矩：**给了就收下**，多块时后一块说了算。
    // 「算不算数」交给调用方 —— 见 `AgentReply.suggest` 的注释。
    if (got.suggestGiven) suggest = got.suggest;
  }

  const trimmed = plan.slice(0, MAX_ACTIONS_PER_STEP);
  const say = says.join('\n\n').trim();
  const hasPlan = trimmed.length > 0;
  return {
    say: say || (hasPlan ? tGlobal('agent.fallback.planOnly') : ''),
    plan: trimmed,
    todos,
    todosGiven: todosExplicit,
    // 「做完了」只有在一件事都不做的时候才成立 —— 手上还有动作就不可能已经收工
    done: hasPlan ? false : done,
    suggest,
    protocolBroken: false,
    salvaged,
  };
}

/**
 * 从还没写完的流式文本里抢先抠出 say。
 * 让作者在等待时就能读到正在生成的那段话，而不是盯着一个转圈。
 */
export function partialSay(raw: string): string {
  const m = raw.match(/"say"\s*:\s*"((?:[^"\\]|\\.)*)/);
  if (!m) return '';
  try {
    return JSON.parse(`"${m[1]}"`) as string;
  } catch {
    return m[1];
  }
}
