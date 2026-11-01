/**
 * 世界内纪年文本 ↔ 轴位置数值 的换算。
 *
 * 编年里的「锁定」靠这一份：锁定的条目，位置（`at`）严格等于时间文本（`from`）
 * 解析出来的数值 —— 「120 年」就是 120，「120 年 6 月」就是 120.5。作者改文本，
 * 位置跟着走；AI 排版挪了位置，文本跟着重写。两边永远对得上，不会各说各话。
 *
 * 为什么单独成一份而不是塞在组件里：换算是**纯函数**，锁定联动（拖轴改文本、
 * AI 排版重写文本、QuickTime 里手填 at）都要用；写进组件就等于把同一个规则
 * 抄三份，迟早三份对不齐。
 */

/** 一次解析的结果：解析不出来就返回 null，**不猜** —— 猜错会凭空造出一个年份 */
export interface ParsedTime {
  /** 总数值位置（年 + 月折算的小数部分）。这就是 `at` */
  value: number;
  /** 年（整数，可为负，如「前 3 年」） */
  year: number;
  /** 月（1-12；没写月就是 0，代表「那年」，不是一月） */
  month: number;
  /** 是否有明确的月（决定了「120.5」能不能被还原成「120 年 6 月」） */
  hasMonth: boolean;
}

/**
 * 把作者写的时间文本解析成数值位置。
 *
 * 认这些写法（大小写、全角半角、空格都不影响）：
 *   - 「120 年」→ 120
 *   - 「120 年 6 月」→ 120.5（月按 /12 折算，6 月正好是半年）
 *   - 「前 3 年」/「-3 年」→ -3（公元前 / 纪年之前）
 *   - 「第 3 纪元 45 年」→ 只取数字串里最后一组「年」前的数 → 45（纪元前缀不参与折算）
 *
 * 只认「年 / 月」这种**可排序**的写法。像「涨潮纪」「灰烬之年」这类纯文字纪元，
 * 或者「第三纪 · 四十年」里没有阿拉伯数字的，解析不出来 —— 返回 null，
 * 让调用方决定怎么办（锁定条目给不出位置就退回「不锁定」的默认落位）。
 *
 * 为什么月按 /12 而不是 /10：轴位置要能比较大小，「120 年 6 月」得严格落在
 * 「120 年」和「121 年」之间，而且越接近 12 月越靠近下一年。用 /12 时 6 月 = .5、
 * 12 月 = 1.0（正好是下一年年初），符合直觉；用 /10 会让 12 月折成 1.2，越过下一年。
 */
export function parseTimeText(text: string): ParsedTime | null {
  const s = text.trim();
  if (!s) return null;

  // 抓「数字 + 年」：取**最后一组**（「第 3 纪元 45 年」里的 45，不是纪元序号 3）
  const yearRe = /([+-]?\d+(?:\.\d+)?)\s*年/g;
  let m: RegExpExecArray | null;
  let yearRaw: string | null = null;
  while ((m = yearRe.exec(s))) yearRaw = m[1];

  if (yearRaw === null) {
    // 没有「年」字，试试纯数字（「120」、以及「120.5」这类已经折好的）
    const pure = /^[+-]?\d+(?:\.\d+)?$/.test(s) ? s : null;
    if (pure === null) return null;
    const v = Number(pure);
    if (!Number.isFinite(v)) return null;
    return { value: v, year: Math.trunc(v), month: 0, hasMonth: false };
  }

  let year = Number(yearRaw);
  if (!Number.isFinite(year)) return null;
  // 「前 N 年」＝公元前 / 纪年之前，折成负数。「前」字本身不参与正则（上面只抓数字），
  // 但它是负号的同义写法 —— 认下来，否则「前 3 年」会被当成「3 年」排到正轴上去。
  if (year >= 0 && /前\s*$/.test(s.slice(0, s.lastIndexOf(yearRaw)))) year = -year;

  // 月：跟在「年」字后面那一组「数字 + 月」
  const monthRe = /年\s*(\d+)\s*月/g;
  const mm = monthRe.exec(s);
  let month = 0;
  let hasMonth = false;
  if (mm) {
    const mv = Number(mm[1]);
    if (Number.isFinite(mv) && mv >= 1 && mv <= 12) {
      month = mv;
      hasMonth = true;
    }
  }

  const sign = year < 0 ? -1 : 1;
  const absYear = Math.abs(year);
  const value = sign * (absYear + (hasMonth ? month / 12 : 0));
  return { value, year, month, hasMonth };
}

/**
 * 把数值位置还原成时间文本。
 *
 * 只能还原「年 / 月」这两种**数值含义明确**的写法。小数部分接近某个「月/12」时
 * 折成「N 年 M 月」，否则只写「N 年」。它和 `parseTimeText` 是**一对**：
 * `parseTimeText(formatTimeText(v))` 约等于 `v`（浮点误差内）。
 *
 * 这是给「锁定联动」用的 —— AI 排版把锁定条目从 120 挪到 130，界面上得有一句
 * 「130 年」落进 `from`。但**只有锁定的条目才这么改写**：没锁的条目作者写的是
 * 「涨潮纪十二年」这种不可折算的文字，硬还原成「12 年」就是把他的措辞吃掉。
 */
export function formatTimeText(value: number): string {
  if (!Number.isFinite(value)) return '';
  const sign = value < 0 ? -1 : 1;
  const abs = Math.abs(value);
  // 一年 = 1.0；一个月 = 1/12。把小数部分折回最接近的「月」，误差小于 1/24 就认。
  const year = Math.floor(abs + 1e-9);
  const frac = abs - year;
  const month = Math.round(frac * 12);
  // 「年 / 月」是世界内纪年的**通用写法约定**（与提示词里告诉模型的一致），
  // 属于写入 `from` 字段的数据格式，不随界面语言变化 —— 作者存进去的就是这几个字。
  const prefix = sign < 0 ? '前 ' : ''; // i18n-allow
  const yearText = `${prefix}${year} 年`; // i18n-allow
  // 月接近 12（≈ 1.0）时其实已经滚进下一年，别再写「12 月」
  if (month >= 1 && month <= 11) return `${yearText} ${month} 月`; // i18n-allow
  return yearText;
}

/**
 * 从数值位置反推「月」的余数 —— 供 AI 排版时把「半年的位置」表达成「6 月」。
 *
 * 单独抽出来是因为 `formatTimeText` 是给人看的整句，而 AI 排版需要的是
 * 「这个位置对应哪个月」这个中间量，好告诉模型「120.5 = 120 年 6 月」。
 */
export function monthOfValue(value: number): number {
  const abs = Math.abs(value);
  const year = Math.floor(abs + 1e-9);
  const frac = abs - year;
  const month = Math.round(frac * 12);
  return month >= 1 && month <= 11 ? month : 0;
}
