/**
 * i18n 基础层 —— 与 React 无关的部分
 *
 * 这一层刻意不依赖 React：AI 提示词构建、诊断日志、导出等「非组件环境」
 * 也需要知道当前语言，它们直接调 currentLocale() 即可。
 */

export type Locale = 'zh-CN' | 'en-US';

export interface LocaleMeta {
  id: Locale;
  /** 用该语言自己写的名字（语言选择器里显示这个） */
  native: string;
  /** 用中文写的名字，便于在中文界面里辨认 */
  zhName: string;
  /** 写入 <html lang> 的值 */
  htmlLang: string;
}

/**
 * 支持的语言清单。
 * 新增一门语言 = 在 locales/ 下加两个文件（zh 目录同构的模块 + en 目录的模块），
 * 再往这里加一行 —— 具体步骤见 README 的「多语言」一节。
 */
export const LOCALES: LocaleMeta[] = [
  { id: 'zh-CN', native: '简体中文', zhName: '简体中文', htmlLang: 'zh-CN' }, // i18n-allow
  { id: 'en-US', native: 'English', zhName: '英语', htmlLang: 'en' }, // i18n-allow
];

/** 兜底语言：任何 key 在所有语言包里都找不到时用它 */
export const FALLBACK_LOCALE: Locale = 'zh-CN';

/** 用户没有显式选择过时的语言 */
export const DEFAULT_LOCALE: Locale = 'zh-CN';

export const LOCALE_STORAGE_KEY = 'worldforge:locale';

/** 用户的语言偏好：跟随系统，或锁定到某一门语言 */
export type LocalePref = 'auto' | Locale;

export function isLocale(v: unknown): v is Locale {
  return typeof v === 'string' && LOCALES.some((l) => l.id === v);
}

export function isLocalePref(v: unknown): v is LocalePref {
  return v === 'auto' || isLocale(v);
}

export function localeMeta(id: Locale): LocaleMeta {
  return LOCALES.find((l) => l.id === id) ?? LOCALES[0];
}

/** 把浏览器给的语言标签映射到我们支持的语言（zh-HK / zh-TW 一并落到 zh-CN） */
function matchNavigator(): Locale | null {
  if (typeof navigator === 'undefined') return null;
  const tags = navigator.languages?.length ? navigator.languages : [navigator.language];
  for (const raw of tags) {
    if (!raw) continue;
    const tag = raw.toLowerCase();
    if (tag.startsWith('zh')) return 'zh-CN';
    if (tag.startsWith('en')) return 'en-US';
  }
  return null;
}

export function readLocalePref(): LocalePref {
  try {
    const raw = localStorage.getItem(LOCALE_STORAGE_KEY);
    if (isLocalePref(raw)) return raw;
  } catch {
    /* 隐私模式下可能抛错，忽略 */
  }
  return 'auto';
}

export function writeLocalePref(pref: LocalePref): void {
  try {
    if (pref === 'auto') localStorage.removeItem(LOCALE_STORAGE_KEY);
    else localStorage.setItem(LOCALE_STORAGE_KEY, pref);
  } catch {
    /* ignore */
  }
}

/** 解析用户偏好 + 浏览器语言，得到真正生效的语言 */
export function detectLocale(): Locale {
  const pref = readLocalePref();
  if (pref !== 'auto') return pref;
  return matchNavigator() ?? DEFAULT_LOCALE;
}

/** 非组件环境读取当前语言（AI 提示词、诊断日志、导出等） */
export function currentLocale(): Locale {
  return detectLocale();
}
