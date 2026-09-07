import { createContext, createElement, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { normalizeLang, type Lang } from '@core/i18n';
import { enumLabel, translate, type StringKey, type Vars } from './strings';

export const LANG_STORAGE_KEY = 'ot.lang';

export function isLang(v: unknown): v is Lang {
  return v === 'en' || v === 'ko';
}

/** `?lang=` from the hash query (HashRouter) or, failing that, from the plain search string. */
export function readQueryLang(): string | null {
  if (typeof window === 'undefined') return null;
  const hash = window.location.hash ?? '';
  const qi = hash.indexOf('?');
  const fromHash = qi >= 0 ? new URLSearchParams(hash.slice(qi + 1)).get('lang') : null;
  return fromHash ?? new URLSearchParams(window.location.search).get('lang');
}

export function readStoredLang(): Lang | null {
  try {
    const v = window.localStorage.getItem(LANG_STORAGE_KEY);
    return isLang(v) ? v : null;
  } catch {
    return null;
  }
}

export function persistLang(lang: Lang): void {
  try {
    window.localStorage.setItem(LANG_STORAGE_KEY, lang);
  } catch {
    /* storage unavailable: ignore */
  }
}

/** Resolution order: URL query (?lang=ko|en, persisted when present) -> localStorage -> navigator.language. */
export function resolveInitialLang(): Lang {
  const q = readQueryLang();
  if (isLang(q)) {
    persistLang(q);
    return q;
  }
  const stored = readStoredLang();
  if (stored) return stored;
  return normalizeLang(typeof navigator !== 'undefined' ? navigator.language : 'en');
}

export function applyHtmlLang(lang: Lang): void {
  if (typeof document !== 'undefined') document.documentElement.setAttribute('lang', lang);
}

export interface I18n {
  lang: Lang;
  setLang: (lang: Lang) => void;
  /** UI string by key, with `{var}` substitution. */
  t: (key: StringKey, vars?: Vars) => string;
  /** Data enum label (invoice status, activity type, ...) with raw-value fallback. */
  te: (prefix: string, value: string | null | undefined) => string;
}

const fallback: I18n = {
  lang: 'en',
  setLang: () => {},
  t: (key, vars) => translate('en', key, vars),
  te: (prefix, value) => enumLabel('en', prefix, value),
};

/** Works without a provider (English) so isolated component tests do not need wrapping. */
export const I18nContext = createContext<I18n>(fallback);

export function I18nProvider({ children, initialLang }: { children: ReactNode; initialLang?: Lang }) {
  const [lang, setLangState] = useState<Lang>(() => initialLang ?? resolveInitialLang());

  useEffect(() => {
    applyHtmlLang(lang);
  }, [lang]);

  const setLang = useCallback((l: Lang) => {
    persistLang(l);
    setLangState(l);
  }, []);

  const value = useMemo<I18n>(
    () => ({
      lang,
      setLang,
      t: (key, vars) => translate(lang, key, vars),
      te: (prefix, v) => enumLabel(lang, prefix, v),
    }),
    [lang, setLang],
  );

  return createElement(I18nContext.Provider, { value }, children);
}

export function useI18n(): I18n {
  return useContext(I18nContext);
}
