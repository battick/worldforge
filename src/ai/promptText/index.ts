import { currentLocale, type Locale } from '../../i18n/core';
import zh from './zh';
import en from './en';

export type PromptKey = keyof typeof zh;

const PACKS: Record<Locale, Record<PromptKey, string>> = {
  'zh-CN': zh,
  'en-US': en,
};

/**
 * 取一段提示词模板并填充 `{占位符}`。
 *
 * 语言跟随当前界面语言 —— 用英文界面时提示词也是英文，模型因此更容易
 * 顺着英文输出，界面上看到的和模型看到的保持一致。
 * 每次调用都重新读取语言（而不是模块加载时定死），所以切换语言后立即生效。
 */
export function pt(key: PromptKey, params?: Record<string, string | number>): string {
  const pack = PACKS[currentLocale()] ?? zh;
  const raw = pack[key] ?? zh[key] ?? '';
  if (!params) return raw;
  return raw.replace(/\{(\w+)\}/g, (whole, name: string) =>
    Object.prototype.hasOwnProperty.call(params, name) ? String(params[name]) : whole,
  );
}
