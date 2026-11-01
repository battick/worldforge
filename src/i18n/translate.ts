/**
 * 翻译核心 —— 纯 TypeScript，不依赖 React。
 *
 * 组件之外的地方（数据模型、AI 提示词、诊断日志、导出、存储层）都用这里的
 * `tGlobal()` 与 `MsgKey`，这样它们不会把 React 拖进依赖里，也能被单独编译测试。
 * React 侧的 Provider 与 `useT()` 在 ./index.tsx。
 */
import { FALLBACK_LOCALE, currentLocale, type Locale } from './core';
import zh from './locales/zh';
import en from './locales/en';

/** 所有可用的文案 key —— 由中文语言包（source of truth）推导 */
export type MsgKey = keyof typeof zh;

export type TParams = Record<string, string | number>;

export interface TFunc {
  (key: MsgKey, params?: TParams): string;
  /** 动态拼接 key（如 `'kind.' + kind`）时用，放弃静态检查 */
  dyn: (key: string, params?: TParams) => string;
}

const BUNDLES: Record<Locale, Record<string, string>> = {
  'zh-CN': zh,
  'en-US': en,
};

/**
 * 是否处于开发构建。直接写 `import.meta.env.DEV` 会让这个模块依赖 Vite 的类型定义，
 * 而它同时要被纯 Node 的单测脚本编译，所以这里做一次防御性取值。
 */
const DEV = (import.meta as unknown as { env?: { DEV?: boolean } }).env?.DEV === true;

/** `Hello {name}` + `{ name: '世界' }` → `Hello 世界` */
export function interpolate(template: string, params?: TParams): string {
  if (!params) return template;
  return template.replace(/\{(\w+)\}/g, (whole, name: string) =>
    Object.prototype.hasOwnProperty.call(params, name) ? String(params[name]) : whole,
  );
}

/**
 * 取一条文案。找不到时的兜底顺序：当前语言 → 中文 → key 本身。
 * 第三层是为了让遗漏在界面上「看得见」，而不是静默变空白。
 */
export function translate(locale: Locale, key: string, params?: TParams): string {
  const raw = BUNDLES[locale]?.[key] ?? BUNDLES[FALLBACK_LOCALE]?.[key];
  if (raw === undefined) {
    if (DEV) console.warn(`[i18n] 缺少文案：${key}`); // i18n-allow（开发期告警）
    return key;
  }
  return interpolate(raw, params);
}

/** 非组件环境（数据模型、AI 提示词、诊断日志、导出、存储层）取一条文案 */
export function tGlobal(key: string, params?: TParams): string {
  return translate(currentLocale(), key, params);
}
