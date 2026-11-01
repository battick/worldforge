/**
 * 审查页「修改前 / 修改后」用的文本差异计算。
 *
 * 设计目标：一眼看出「多了什么、少了什么」，而不是把整段文字都涂成红/绿。
 * 做法是按词（中文按字）切 token，再用最长公共子序列（LCS）对齐，
 * 产出 equal / add / del 三段，渲染时分别上样式。
 */

export type DiffSeg =
  | { type: 'equal'; value: string }
  | { type: 'add'; value: string }
  | { type: 'del'; value: string };

/**
 * 把文本切成可比较的最小单元。
 *
 * 中文逐字（一个汉字就是一个 token），拉丁按单词，空白和标点各自成 token。
 * 这样「他是一个勇敢的骑士」改成「他是一个无畏的骑士」时，
 * 只有「勇敢」和「无畏」会被标出来，而不是整句重涂。
 */
function tokenize(text: string): string[] {
  const out: string[] = [];
  const re = /[\u4e00-\u9fa5]|[A-Za-z0-9]+(?:['’-][A-Za-z0-9]+)*|\s+|[^\w\s]/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null) out.push(m[0]);
  return out;
}

/**
 * 计算最长公共子序列长度，用于回溯差异。
 * 两个字符串都不超过几千字，O(n*m) 的 DP 表完全够；
 * 真遇上超长文本再换 Hirschberg，目前没必要。
 */
function lcsTable(a: string[], b: string[]): number[][] {
  const n = a.length;
  const m = b.length;
  const dp: number[][] = Array.from({ length: n + 1 }, () => new Array(m + 1).fill(0));
  for (let i = 1; i <= n; i++) {
    for (let j = 1; j <= m; j++) {
      dp[i][j] =
        a[i - 1] === b[j - 1] ? dp[i - 1][j - 1] + 1 : Math.max(dp[i - 1][j], dp[i][j - 1]);
    }
  }
  return dp;
}

/**
 * 生成逐段差异。返回的是「before 视图」和「after 视图」两份片段序列：
 *   · before 视图 = equal + del（删掉的部分在左边高亮）
 *   · after 视图  = equal + add（新增的部分在右边高亮）
 *
 * 两边的 equal 段是对齐的，作者对照着看就能定位改动点。
 */
export function diffText(before: string, after: string): {
  before: DiffSeg[];
  after: DiffSeg[];
} {
  if (before === after) {
    const seg: DiffSeg = { type: 'equal', value: before };
    return { before: [seg], after: [seg] };
  }
  // 空值兜底：一边是空，另一边就是纯增/纯删
  if (!before) return { before: [], after: [{ type: 'add', value: after }] };
  if (!after) return { before: [{ type: 'del', value: before }], after: [] };

  const a = tokenize(before);
  const b = tokenize(after);
  const dp = lcsTable(a, b);

  const beforeSegs: DiffSeg[] = [];
  const afterSegs: DiffSeg[] = [];
  let i = a.length;
  let j = b.length;

  // 回溯 LCS，把相同的、删掉的、新增的分别收集。
  // 因为是从后往前走，最后要反转。
  const bRev: DiffSeg[] = [];
  const aRev: DiffSeg[] = [];
  while (i > 0 && j > 0) {
    if (a[i - 1] === b[j - 1]) {
      bRev.push({ type: 'equal', value: a[i - 1] });
      aRev.push({ type: 'equal', value: b[j - 1] });
      i--;
      j--;
    } else if (dp[i - 1][j] >= dp[i][j - 1]) {
      bRev.push({ type: 'del', value: a[i - 1] });
      i--;
    } else {
      aRev.push({ type: 'add', value: b[j - 1] });
      j--;
    }
  }
  while (i > 0) {
    bRev.push({ type: 'del', value: a[i - 1] });
    i--;
  }
  while (j > 0) {
    aRev.push({ type: 'add', value: b[j - 1] });
    j--;
  }

  beforeSegs.push(...bRev.reverse());
  afterSegs.push(...aRev.reverse());

  // 相邻同类型的段合并，避免每个字都包一层 span
  return { before: merge(beforeSegs), after: merge(afterSegs) };
}

function merge(segs: DiffSeg[]): DiffSeg[] {
  if (segs.length <= 1) return segs;
  const out: DiffSeg[] = [segs[0]];
  for (let k = 1; k < segs.length; k++) {
    const last = out[out.length - 1];
    const cur = segs[k];
    if (last.type === cur.type) {
      last.value += cur.value;
    } else {
      out.push(cur);
    }
  }
  return out;
}
