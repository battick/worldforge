import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from 'react';
import {
  LOCALES,
  detectLocale,
  localeMeta,
  readLocalePref,
  writeLocalePref,
  currentLocale,
  type Locale,
  type LocaleMeta,
  type LocalePref,
} from './core';
import { translate, tGlobal, type MsgKey, type TFunc, type TParams } from './translate';

/* ------------------------------------------------------------------ */
/* 对外出口                                                            */
/*                                                                     */
/* 翻译核心（MsgKey / translate / tGlobal）在 ./translate.ts —— 那是纯逻辑， */
/* 组件之外的地方从那里导入即可，不必把 React 拖进来。这里只负责 React 侧的 */
/* Provider 与 hooks，并顺手把核心再导出一次，方便组件统一从 './i18n' 引。 */
/* ------------------------------------------------------------------ */

export { translate, tGlobal };
export type { MsgKey, TFunc, TParams };

/* ------------------------------------------------------------------ */
/* Provider                                                            */
/* ------------------------------------------------------------------ */

interface I18nValue {
  /** 当前实际生效的语言 */
  locale: Locale;
  /** 用户偏好（可能是「跟随系统」） */
  pref: LocalePref;
  setPref: (pref: LocalePref) => void;
  t: TFunc;
  locales: LocaleMeta[];
}

const I18nCtx = createContext<I18nValue | null>(null);

export function I18nProvider({ children }: { children: React.ReactNode }) {
  const [pref, setPrefState] = useState<LocalePref>(() => readLocalePref());
  const [locale, setLocale] = useState<Locale>(() => detectLocale());

  const setPref = useCallback((next: LocalePref) => {
    writeLocalePref(next);
    setPrefState(next);
    setLocale(next === 'auto' ? detectLocale() : next);
  }, []);

  // 跟随系统：浏览器语言变化时（多语言用户切换系统语言）实时跟上
  useEffect(() => {
    if (pref !== 'auto') return;
    const onLang = () => setLocale(detectLocale());
    window.addEventListener('languagechange', onLang);
    return () => window.removeEventListener('languagechange', onLang);
  }, [pref]);

  // 同步 <html lang> 与标题，方便浏览器翻译提示、朗读与书签识别
  useEffect(() => {
    document.documentElement.lang = localeMeta(locale).htmlLang;
    document.title = translate(locale, 'app.title');
  }, [locale]);

  const t = useMemo<TFunc>(() => {
    const fn = ((key: MsgKey, params?: TParams) =>
      translate(locale, key, params)) as TFunc;
    fn.dyn = (key: string, params?: TParams) => translate(locale, key, params);
    return fn;
  }, [locale]);

  const value = useMemo<I18nValue>(
    () => ({ locale, pref, setPref, t, locales: LOCALES }),
    [locale, pref, setPref, t],
  );

  return <I18nCtx.Provider value={value}>{children}</I18nCtx.Provider>;
}

/* ------------------------------------------------------------------ */
/* Hooks                                                               */
/* ------------------------------------------------------------------ */

export function useI18n(): I18nValue {
  const ctx = useContext(I18nCtx);
  if (!ctx) throw new Error('useI18n 必须在 I18nProvider 内使用'); // i18n-allow（开发者错误）
  return ctx;
}

/** 只取翻译函数 —— 绝大多数组件只用这个 */
export function useT(): TFunc {
  return useI18n().t;
}

export { LOCALES, currentLocale, localeMeta };
export type { Locale, LocaleMeta, LocalePref };
