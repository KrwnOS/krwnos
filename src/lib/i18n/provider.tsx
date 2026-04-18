"use client";

/**
 * Client-side i18n provider + hooks.
 * ------------------------------------------------------------
 * The provider is the single place that owns "what language is
 * the user currently seeing?" state. The active locale gets:
 *   - written to localStorage (client-only persistence)
 *   - mirrored into the `krwnos_locale` cookie so the server
 *     can pick it up on the next request (see `server.ts`)
 *   - pushed onto `document.documentElement.lang` so screen
 *     readers and browsers announce the right language.
 *
 * The provider never fetches dictionaries — everything is
 * compiled in. Runtime cost of switching languages is a
 * single setState + cookie write.
 */

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";

import {
  formatCompact,
  formatDateShort,
  formatDateTime,
  formatDuration,
  formatNumber,
  formatPercent,
  formatTimeHM,
  interpolate,
  pluralize,
} from "./formatters";
import { AVAILABLE_LOCALES, DEFAULT_LOCALE, LOCALES, isLocale } from "./locales";
import type { LocaleCode, LocaleMeta, TranslationVars } from "./types";

const STORAGE_KEY = "krwnos.locale";
export const LOCALE_COOKIE = "krwnos_locale";

/** Signature of the translation function returned by `useT` / `useI18n`. */
export type TFunction = (key: string, vars?: TranslationVars) => string;

/** Signature of the pluralized translation function. */
export type TpFunction = (
  key: string,
  count: number,
  vars?: TranslationVars,
) => string;

interface I18nContextValue {
  locale: LocaleCode;
  meta: LocaleMeta;
  availableLocales: LocaleMeta[];
  setLocale: (next: LocaleCode) => void;
  t: (key: string, vars?: TranslationVars) => string;
  tp: (key: string, count: number, vars?: TranslationVars) => string;
  formatNumber: (value: number, options?: Intl.NumberFormatOptions) => string;
  formatPercent: (fraction: number) => string;
  formatCompact: (value: number) => string;
  formatDate: (input: string | Date) => string;
  formatDateTime: (input: string | Date) => string;
  formatTime: (input: string | Date) => string;
  formatDuration: (seconds: number) => string;
}

const I18nContext = createContext<I18nContextValue | null>(null);

function resolve(
  locale: LocaleCode,
  key: string,
  vars?: TranslationVars,
): string {
  const primary = LOCALES[locale].dict[key];
  if (primary !== undefined) return interpolate(primary, vars);
  const fallback = LOCALES[DEFAULT_LOCALE].dict[key];
  if (fallback !== undefined) return interpolate(fallback, vars);
  return key;
}

function writeCookie(locale: LocaleCode) {
  if (typeof document === "undefined") return;
  const oneYear = 60 * 60 * 24 * 365;
  document.cookie = `${LOCALE_COOKIE}=${locale}; path=/; max-age=${oneYear}; samesite=lax`;
}

interface I18nProviderProps {
  initialLocale?: LocaleCode;
  children: ReactNode;
}

export function I18nProvider({
  initialLocale = DEFAULT_LOCALE,
  children,
}: I18nProviderProps) {
  const [locale, setLocaleState] = useState<LocaleCode>(initialLocale);

  // On first mount, upgrade the SSR-chosen locale with whatever
  // the user previously picked on this device (localStorage wins
  // over the cookie because it's the most recent explicit choice).
  useEffect(() => {
    if (typeof window === "undefined") return;
    try {
      const stored = window.localStorage.getItem(STORAGE_KEY);
      if (stored && isLocale(stored) && stored !== locale) {
        setLocaleState(stored);
        writeCookie(stored);
      }
    } catch {
      // localStorage may throw in private mode — harmless, we
      // just keep the SSR locale.
    }
  }, []);

  // Keep the <html lang> attribute in sync so assistive tech and
  // browser spellcheck use the right language.
  useEffect(() => {
    if (typeof document === "undefined") return;
    document.documentElement.lang = LOCALES[locale].meta.bcp47;
  }, [locale]);

  const setLocale = useCallback((next: LocaleCode) => {
    if (!isLocale(next)) return;
    setLocaleState(next);
    try {
      window.localStorage.setItem(STORAGE_KEY, next);
    } catch {
      // ignored — see comment in mount effect
    }
    writeCookie(next);
  }, []);

  const value = useMemo<I18nContextValue>(() => {
    const t = (key: string, vars?: TranslationVars) =>
      resolve(locale, key, vars);
    const tp = (key: string, count: number, vars?: TranslationVars) => {
      const template = resolve(locale, key);
      const merged: TranslationVars = { count, ...vars };
      return interpolate(pluralize(count, template, locale), merged);
    };
    return {
      locale,
      meta: LOCALES[locale].meta,
      availableLocales: AVAILABLE_LOCALES,
      setLocale,
      t,
      tp,
      formatNumber: (value, options) => formatNumber(value, locale, options),
      formatPercent: (fraction) => formatPercent(fraction, locale),
      formatCompact,
      formatDate: (input) => formatDateShort(input, locale),
      formatDateTime: (input) => formatDateTime(input, locale),
      formatTime: (input) => formatTimeHM(input, locale),
      formatDuration: (seconds) => formatDuration(seconds, locale),
    };
  }, [locale, setLocale]);

  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>;
}

export function useI18n(): I18nContextValue {
  const ctx = useContext(I18nContext);
  if (!ctx) {
    throw new Error("useI18n must be used inside <I18nProvider>");
  }
  return ctx;
}

/** Shortcut when only the translation function is needed. */
export function useT() {
  return useI18n().t;
}

/** Shortcut for pluralized strings. */
export function useTp() {
  return useI18n().tp;
}
