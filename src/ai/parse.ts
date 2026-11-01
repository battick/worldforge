import { AIError } from './client';
import { tGlobal } from '../i18n/translate';

/**
 * 修复被截断的 JSON：补上未闭合的字符串与括号。
 * 模型输出经常撞到 token 上限被拦腰斩断（尤其草案这种长输出），
 * 与其让用户重试整次生成，不如把已经写完的部分抢救出来。
 *
 * 同时回报「它到底是不是被截断了」。这一位很要紧：后面那手「逐个丢掉尾部元素再试」
 * 只对**截断**成立；对一份括号齐了、只是某处写坏了的输出，那样做等于
 * **拿一把刀从最后一个逗号处切下去** —— 切出来的前缀照样能 `JSON.parse` 成功，
 * 于是整段 plan 就这么无声无息地没了（真实病例：`{"say":"…", // 注释` 把 plan 全切掉）。
 */
function closeTruncated(s: string): { text: string; truncated: boolean } {
  let inStr = false;
  let esc = false;
  const stack: string[] = [];
  for (const ch of s) {
    if (inStr) {
      if (esc) esc = false;
      else if (ch === '\\') esc = true;
      else if (ch === '"') inStr = false;
      continue;
    }
    if (ch === '"') inStr = true;
    else if (ch === '{' || ch === '[') stack.push(ch);
    else if (ch === '}' || ch === ']') stack.pop();
  }
  const truncated = inStr || esc || stack.length > 0;
  let out = s;
  if (esc) out = out.slice(0, -1); // 尾部悬着半个转义符
  if (inStr) out += '"';
  while (stack.length) out += stack.pop() === '{' ? '}' : ']';
  return { text: out, truncated };
}

/* ------------------------------------------------------------------ */
/* 结构修复：东西都在，只是括号少写了一个                                */
/* ------------------------------------------------------------------ */

type Frame =
  | { kind: 'obj'; state: 'key' | 'colon' | 'value' | 'comma' }
  | { kind: 'arr'; state: 'value' | 'comma' };

const IDENT_START = /[A-Za-z_$\u4e00-\u9fa5]/;
const IDENT_CHAR = /[A-Za-z0-9_$\u4e00-\u9fa5]/;
/** 值原子的分界（按字符判，不按正则——每字符一次正则太慢） */
const ATOM_STOP = new Set([',', ':', '{', '}', '[', ']', '"', "'", ' ', '\n', '\r', '\t']);

/**
 * 全角的结构符号：模型（尤其中文的）偶尔把括号冒号也打成全角。
 * 只在**结构判断**处归一，绝不换算字符串内容 —— 正文里的「：」是内容的一部分，
 * 动了它就是改作者的稿子。引号的全角变体（“ ”）不在此列：那要区分「它用全角引号当
 * JSON 定界符」还是「内容里就有引号」，猜错不如老实报「读不懂」。
 */
const FULLWIDTH: Record<string, string> = { '｛': '{', '｝': '}', '［': '[', '］': ']', '：': ':' }; // i18n-allow

/**
 * 「差不多是 JSON」的最后一手救援。
 *
 * 典型病例（真实翻车，作者贴过来的原话）：模型一口气提 8 个动作，每个都写成
 *   {"tool": "create_entry", "args": {…}, {"tool": …
 * —— `args` 那层的 `}` 写上了，**动作对象自己那个 `}` 却没写**。整份输出因此不合法，
 * 而前面那两手都救不了它：末尾逗号修不掉它，`closeTruncated` 只会在**末尾**补括号，
 * 少在中间的东西它看不见。于是作者看到的是「它说完了，然后什么都没发生」——
 * 而且请它重说一遍，它多半照抄同一处错，再废一轮。
 *
 * 所以这里做一个逐 token 的**结构修复**：一边扫一边记住「现在在哪一层、下一个该出现什么」，
 * 撞见不该出现的 token（最典型的就是在「该写键名」的地方撞见了 `{`）就地补一个 `}` 把当前这层收掉，
 * 再拿同一个 token 到外层重试。顺带把别的常见畸形一起收：字符串里的裸换行、非法转义、
 * 该有逗号却没有、全角括号引号、`//` 注释、没加引号的字面量。
 *
 * ── 为什么要求「看得出是 JSON」 ──
 * 一段随笔里孤立的花括号（「我先看看{名字}是什么意思」）绝不能被"修"成一个空对象 ——
 * 那正是本文件最怕的**静默丢空**：调用方拿到 `{}`，`asArray()` 得到 `[]`，
 * 界面上变成一句假的「没有问题」。所以进来先验一道形：必须**带引号的键 + 冒号**，
 * 且修完还得真能 `JSON.parse` 出东西，否则老实返回 undefined，让调用方去报错。
 *
 * 返回修好的值；救不动返回 undefined。
 */
export function looseJson(raw: string): unknown | undefined {
  const src = (raw ?? '').trim();
  if (!src) return undefined;
  // 必须是「对象里带键值对」的样子：`"key":` 或 `key:`
  if (!/"[^"\n]{1,60}"\s*:/.test(src) && !/(^|[{,\[])\s*[A-Za-z_$][\w$]*\s*:/.test(src)) {
    return undefined;
  }

  const out: string[] = [];
  const stack: Frame[] = [];
  const n = src.length;
  let i = 0;
  /** 第 k 个字符（全角结构符号按 ASCII 看）；越界给 undefined */
  const at = (k: number): string | undefined => {
    const c = src[k];
    return c === undefined ? undefined : (FULLWIDTH[c] ?? c);
  };
  /** 补了几处结构 —— 补得离谱（相对输入长度）说明这压根不是 JSON，宁可放弃 */
  let fixes = 0;

  /**
   * 收尾：补 `}`/`]` 之前，把紧挨着的那个逗号撤掉。
   *
   * 两处都需要它：一是模型写了 `{… ,}` 这种尾逗号；二是我们**刚补的收尾**就在一个
   * 已经发出的逗号后面（`…"args":{…},}` —— 那个逗号原本属于外层，被我们收掉这一层
   * 之后就成了这一层的尾逗号）。`{…,}` 不是合法 JSON，白修一场。
   */
  const closeWith = (ch: '}' | ']') => {
    if (out[out.length - 1] === ',') out.pop();
    out.push(ch);
  };

  /** 跳过空白与注释（模型爱在 JSON 里写 `// 说明`） */
  const noise = () => {
    for (;;) {
      while (i < n && (src[i] === ' ' || src[i] === '\n' || src[i] === '\r' || src[i] === '\t')) i++;
      if (src[i] === '/' && src[i + 1] === '/') {
        while (i < n && src[i] !== '\n') i++;
        continue;
      }
      if (src[i] === '/' && src[i + 1] === '*') {
        i += 2;
        while (i < n && !(src[i] === '*' && src[i + 1] === '/')) i++;
        i += 2;
        continue;
      }
      return;
    }
  };

  /** 读一个字符串：裸换行、非法转义在这里就地修好 */
  const readString = (): string => {
    const quote = src[i];
    i++;
    let s = '"';
    while (i < n) {
      const ch = src[i];
      if (ch === '\\') {
        const nx = src[i + 1] ?? '';
        if (nx && '"\\/bfnrt'.includes(nx)) {
          s += '\\' + nx;
          i += 2;
          continue;
        }
        if (nx === 'u' && /^[0-9a-fA-F]{4}$/.test(src.slice(i + 2, i + 6))) {
          s += src.slice(i, i + 6);
          i += 6;
          continue;
        }
        // 非法转义（模型会把 markdown 的 \- \* 也转义）：拆开，当普通反斜杠
        s += '\\\\';
        i++;
        continue;
      }
      if (ch === quote) {
        i++;
        return s + '"';
      }
      if (ch === '"') {
        s += '\\"';
        i++;
        continue;
      }
      if (ch === '\n') {
        s += '\\n';
        i++;
        continue;
      }
      if (ch === '\r') {
        s += '\\r';
        i++;
        continue;
      }
      if (ch === '\t') {
        s += '\\t';
        i++;
        continue;
      }
      if (ch < ' ') {
        s += '\\u' + ch.charCodeAt(0).toString(16).padStart(4, '0');
        i++;
        continue;
      }
      s += ch;
      i++;
    }
    return s + '"'; // 走到头都没收尾：当它是被截断的
  };

  /** 读一个值（对象/数组/字符串/字面量） */
  const readValue = (): boolean => {
    noise();
    const ch = at(i);
    if (ch === undefined) return false;
    if (ch === '"' || ch === "'") {
      out.push(readString());
      return true;
    }
    if (ch === '{') {
      out.push('{');
      stack.push({ kind: 'obj', state: 'key' });
      i++;
      return true;
    }
    if (ch === '[') {
      out.push('[');
      stack.push({ kind: 'arr', state: 'value' });
      i++;
      return true;
    }
    let j = i;
    for (;;) {
      const c = at(j);
      if (c === undefined || ATOM_STOP.has(c)) break;
      j++;
    }
    const atom = src.slice(i, j).trim();
    if (!atom) {
      i++;
      return false;
    }
    i = j;
    if (atom === 'true' || atom === 'false' || atom === 'null' || /^-?\d+(\.\d+)?([eE][+-]?\d+)?$/.test(atom)) {
      out.push(atom);
    } else {
      out.push(JSON.stringify(atom)); // 没加引号的词，当字符串
    }
    return true;
  };

  const guard = n * 4 + 64;
  let hops = 0;
  while (i < n && hops++ < guard) {
    const top = stack[stack.length - 1];

    // 根：只认第一个值，它之后的絮叨（「以上是我的提议」）丢掉
    if (!top) {
      if (out.length) break;
      if (!readValue()) i++;
      continue;
    }

    if (top.kind === 'obj') {
      if (top.state === 'key') {
        noise();
        const ch = at(i);
        if (ch === undefined) break;
        if (ch === '}') {
          closeWith('}');
          stack.pop();
          i++;
          continue;
        }
        if (ch === ',') {
          i++; // 多余逗号
          continue;
        }
        if (ch === '"' || ch === "'") {
          out.push(readString());
          top.state = 'colon';
          continue;
        }
        if (IDENT_START.test(ch)) {
          // 可能是没加引号的键；也可能是「这层早该收尾了」——看到冒号才算键
          let j = i;
          while (j < n && IDENT_CHAR.test(src[j])) j++;
          let k = j;
          while (k < n && (src[k] === ' ' || src[k] === '\t')) k++;
          if (at(k) === ':') {
            out.push(JSON.stringify(src.slice(i, j)));
            i = k;
            top.state = 'colon';
            continue;
          }
        }
        // 该写键名却撞见了别的东西 —— 这一层早该收尾了。
        // 补一个 } 收掉，不推进：同一个 token 到外层重新判。
        closeWith('}');
        stack.pop();
        fixes++;
        continue;
      }

      if (top.state === 'colon') {
        noise();
        if (at(i) === ':') i++;
        else fixes++;
        out.push(':');
        top.state = 'value';
        continue;
      }

      if (top.state === 'value') {
        noise();
        const ch = at(i);
        if (ch === '}') {
          out.push('null'); // 有键没值
          fixes++;
          top.state = 'comma';
          continue;
        }
        if (!readValue()) {
          i++;
          continue;
        }
        top.state = 'comma';
        continue;
      }

      // comma：等一个逗号，或者收尾
      noise();
      const ch = at(i);
      if (ch === undefined) break;
      if (ch === ',') {
        out.push(',');
        i++;
        top.state = 'key';
        continue;
      }
      if (ch === '}') {
        closeWith('}');
        stack.pop();
        i++;
        continue;
      }
      out.push(','); // 该有逗号却没有
      fixes++;
      top.state = 'key';
      continue;
    }

    // 数组
    if (top.state === 'value') {
      noise();
      const ch = at(i);
      if (ch === undefined) break;
      if (ch === ']') {
        closeWith(']');
        stack.pop();
        i++;
        continue;
      }
      if (ch === '}') {
        closeWith(']'); // 这一层漏了收尾
        stack.pop();
        fixes++;
        continue;
      }
      if (!readValue()) {
        i++;
        continue;
      }
      top.state = 'comma';
      continue;
    }

    noise();
    const ch = at(i);
    if (ch === undefined) break;
    if (ch === ',') {
      out.push(',');
      i++;
      top.state = 'value';
      continue;
    }
    if (ch === ']') {
      closeWith(']');
      stack.pop();
      i++;
      continue;
    }
    if (ch === '}') {
      closeWith(']');
      stack.pop();
      fixes++;
      continue;
    }
    out.push(',');
    fixes++;
    top.state = 'value';
  }

  // 没扫完就散了的（截断）：把还开着的一层层收掉
  while (stack.length) {
    closeWith(stack.pop()!.kind === 'obj' ? '}' : ']');
    fixes++;
  }

  // 补得比原文还多，说明这压根不是 JSON，别硬凑
  if (fixes > 64 || fixes > n / 8) return undefined;

  try {
    return JSON.parse(out.join(''));
  } catch {
    return undefined;
  }
}

/** `extractJsonEx` 的产物：值，外加「这值是怎么来的」 */
export interface ExtractedJson<T> {
  value: T;
  /**
   * 严格解解不动、走了 `looseJson` 那一手才捞回来的。
   * 界面据此如实告诉作者「它少写了括号」—— 修好不等于它写对了，
   * 作者有权知道这个模型/这条提示词正在变松。
   */
  loose: boolean;
}

/**
 * 在一整段模型输出里定位最外层 JSON（`{...}` 或 `[...]`）的边界。
 *
 * 为什么不用 `indexOf('{')` + `lastIndexOf('}')`：
 * 那一手在 content 里含有 `}` 或 ` ``` ` 时会选错边界 —— 真实翻车：
 * `{"content":"```js\ncode\n```"}` 被 `lastIndexOf('}')` 切到 content 内部的 `}`，
 * 或者被围栏正则把整段 JSON 吞掉。于是明明写完了的条目也报「无法解析」。
 *
 * 这里逐字符扫，用 `inStr`/`esc` 跟踪字符串与转义，只认**结构层**的括号。
 * 返回 `complete: false` 表示没找到配对的收尾括号（被截断了），调用方据此走修复流程。
 */
function findJsonBounds(text: string): { start: number; end: number; complete: boolean } {
  let start = -1;
  const n = text.length;

  // 第一遍：找到第一个 { 或 [（不跟踪引号 —— 周围文本里的「它的」「他说"」不影响起点判断）
  for (let i = 0; i < n; i++) {
    const ch = text[i];
    if (ch === '{' || ch === '[') {
      start = i;
      break;
    }
  }
  if (start === -1) return { start: -1, end: -1, complete: false };

  // 第二遍：从起点开始跟踪深度与字符串状态，找到**最后一个**回到顶层的收尾括号。
  // 模型偶尔会把多个 JSON 对象拼在一起（`{"say":"…"}\n{"plan":[…]}`），
  // 不能只取第一个就把后面的 plan 丢掉 —— 所以一路扫到底，记录最后一次 depth 归零的位置。
  let depth = 1;
  let inStr = false;
  let esc = false;
  let lastClose = -1;
  for (let i = start + 1; i < n; i++) {
    const ch = text[i];
    if (inStr) {
      if (esc) esc = false;
      else if (ch === '\\') esc = true;
      else if (ch === '"' || ch === "'") inStr = false;
      continue;
    }
    if (ch === '"' || ch === "'") inStr = true;
    else if (ch === '{' || ch === '[') depth++;
    else if (ch === '}' || ch === ']') {
      depth--;
      if (depth === 0) lastClose = i;
      else if (depth < 0) depth = 0; // 多余的收尾括号，忽略
    }
  }
  if (lastClose !== -1) return { start, end: lastClose, complete: true };
  // 没找到配对收尾：被截断了
  return { start, end: n, complete: false };
}

/**
 * 从模型输出里稳健地抠出 JSON。
 * 兼容：```json 围栏、前后闲聊、数组或对象两种根、末尾多余逗号、
 * 被输出长度上限拦腰截断的 JSON（补齐括号、丢弃残缺的尾部元素）、
 * 以及**结构在、只是括号少写了一个**（见 looseJson）。
 */
export function extractJsonEx<T = any>(raw: string): ExtractedJson<T> {
  if (!raw || !raw.trim()) throw new AIError(tGlobal('ai.err.noContent'));

  let text = raw.trim();

  // 去掉 markdown 代码围栏 —— 但只剥 JSON **外面**那层。
  // 关键：content 里也可能有 ```（代码块示例），那种不能动。
  // 判断方法：如果第一个 ``` 出现在第一个 { / [ 之前，说明围栏包在 JSON 外面，剥掉；
  // 否则 ``` 在 JSON 内部，交给 findJsonBounds 按字符串处理。
  const firstBrace = Math.max(text.indexOf('{'), text.indexOf('['));
  const firstFence = text.indexOf('```');
  if (firstFence !== -1 && (firstBrace === -1 || firstFence < firstBrace)) {
    const fence = text.match(/```(?:json|JSON)?\s*\n?([\s\S]*?)```/);
    if (fence) text = fence[1].trim();
  }

  // 全角的括号（模型偶尔把结构符号也打成全角）：严格路径只认 ASCII，接着往下走就会
  // 从 plan 的 `[` 开始截 —— 截出来的那个数组**照样能解析成功**，于是 say 整段没了。
  // 所以只要见到全角括号，就先交给结构修复（它两套括号都认）。
  if (/[｛｝［］]/.test(text)) { // i18n-allow
    const fw = looseJson(text);
    if (fw !== undefined) return { value: fw as T, loose: true };
  }

  // 用深度扫描定位 JSON 边界（content 里的 } / ] / ``` 不会干扰）
  const bounds = findJsonBounds(text);
  if (bounds.start !== -1) {
    text = text.slice(bounds.start, bounds.end + 1);
  }

  const tryParse = (s: string): T | undefined => {
    try {
      return JSON.parse(s) as T;
    } catch {
      return undefined;
    }
  };

  const ok = (value: T): ExtractedJson<T> => ({ value, loose: false });

  let parsed = tryParse(text);
  if (parsed !== undefined) return ok(parsed);

  // 修复常见的结尾多余逗号
  parsed = tryParse(text.replace(/,\s*([}\]])/g, '$1'));
  if (parsed !== undefined) return ok(parsed);

  // ---- 先按结构修，再考虑切尾巴 ----
  //
  // 顺序很讲究。下面那一手（「从最后一个逗号切下去，切出来的前缀只要还能解析就算数」）
  // 是**有损**的：真实病例里，8 个动作少写括号的那份输出被它一路切到只剩 1 个，
  // 而且**报告成功** —— 界面上看起来一切正常，作者只觉得「它没补全」。
  // 所以能按结构修就按结构修，一个动作都不丢。
  //
  // 只有一种情况该切：它**确实被截断了**（结尾是写到一半的正文，而不是收尾括号）。
  // 那时把没写完的那件也捞进审查队列才是添乱 —— 半条正文比没有更糟。
  const loose = (): ExtractedJson<T> | undefined => {
    const got = looseJson(text);
    return got === undefined ? undefined : { value: got as T, loose: true };
  };
  const trunc = closeTruncated(text);
  if (/[}\]]\s*$/.test(text)) {
    const got = loose();
    if (got) return got;
  }

  // ---- 截断修复：补齐引号/括号；若最后一个元素写到一半，逐步丢弃再试 ----
  if (trunc.truncated) {
    let candidate = text;
    for (let i = 0; i < 24; i++) {
      const repaired = closeTruncated(candidate);
      parsed = tryParse(repaired.text.replace(/,\s*([}\]])/g, '$1'));
      if (parsed !== undefined) return ok(parsed);
      // 扔掉最后一个逗号之后的残缺内容（多半是写到一半的数组元素）
      const comma = candidate.lastIndexOf(',');
      if (comma <= 0) break;
      candidate = candidate.slice(0, comma);
    }
  }

  // ---- 最后一手：结构修复（少括号、缺逗号、裸换行……见 looseJson 的注释）----
  const got = loose();
  if (got) return got;

  throw new AIError(tGlobal('ai.err.badJson', { raw: raw.slice(0, 300) }));
}

/** `extractJsonEx` 的薄包装：只要值 */
export function extractJson<T = any>(raw: string): T {
  return extractJsonEx<T>(raw).value;
}

/**
 * 提示词里**明写过**的列表键名。
 *
 * 这份名单是「契约」：`promptText/*.ts` 里让模型返回什么形状，这里就得认什么形状。
 * 曾经漏了 `issues` 与 `relations` —— 一致性检查与关系推荐的提示词写着
 * `{"issues": [...]}` / `{"relations": [...]}`，解析层却只认 `items`/`entries` 等，
 * 于是**结果被静默丢空**，界面上表现成一句「没有发现问题」。
 * 所以：往提示词里加新形状时，记得同时来这里登记。
 */
const LIST_KEYS = [
  // 各任务的既定形状
  'items', // 文档抽取
  'entries', // 批量生成条目
  'issues', // 一致性检查
  'relations', // 关系推荐
  'suggestions', // 文章审校
  'questions', // 追问
  'layout', // 时间轴自动排版
  'categories', // 世界草案
  'rules', // 世界草案
  // 模型自己爱套的壳
  'data',
  'result',
  'results',
  'list',
];

/** 模型爱把真正的结果再包一层的键名（`{"data": {...}}`） */
const WRAP_KEYS = ['data', 'result', 'response', 'payload', 'output'];

/**
 * 列表装在哪个键下。先按提示词写明的键名找；找不到时**整份返回里只有一个数组字段**
 * 就认它 —— 模型偶尔把 `issues` 写成 `conflicts`，键名对不上但意图是清楚的，
 * 不该因此丢掉整份结果（那会变成一句假的「没有问题」）。有多个数组字段就不猜了，
 * 那是真歧义，猜错比返回空更糟。
 *
 * 另外容忍它把结果再包一层（`{"data": {...}}`）—— 同样是为了不让形状差异吃掉结论。
 */
function findList(value: unknown, depth = 0): unknown[] | null {
  if (Array.isArray(value)) return value;
  if (!value || typeof value !== 'object') return null;

  const obj = value as Record<string, unknown>;

  for (const key of LIST_KEYS) {
    if (Array.isArray(obj[key])) return obj[key] as unknown[];
  }

  const arrays = Object.keys(obj).filter((k) => Array.isArray(obj[k]));
  if (arrays.length === 1) return obj[arrays[0]] as unknown[];

  if (depth < 2) {
    for (const key of WRAP_KEYS) {
      const inner = findList(obj[key], depth + 1);
      if (inner) return inner;
    }
  }
  return null;
}

export function asArray<T>(value: unknown): T[] {
  return (findList(value) ?? []) as T[];
}

/**
 * 整份返回里有没有「列表形态」。
 *
 * 用来把两种「列表是空的」分开：
 *   - `{"issues": []}` —— **它说没有问题**，是结论；
 *   - `{"note": "一切自洽"}` —— **它答非所问**，我们没读懂。
 * 两者都得到空数组，但对作者的意义完全相反，调用方据此决定是报「没问题」还是报错。
 */
export function hasListShape(value: unknown): boolean {
  return findList(value) !== null;
}

export function str(v: unknown, fallback = ''): string {
  if (typeof v === 'string') return v;
  if (typeof v === 'number' || typeof v === 'boolean') return String(v);
  return fallback;
}

export function strArray(v: unknown): string[] {
  if (Array.isArray(v)) return v.map((x) => str(x)).filter(Boolean);
  if (typeof v === 'string' && v.trim()) {
    return v
      .split(/[,，、;；|]/)
      .map((s) => s.trim())
      .filter(Boolean);
  }
  return [];
}
