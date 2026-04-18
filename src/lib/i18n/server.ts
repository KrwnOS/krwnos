import "server-only";

/**
 * Server-side helpers for i18n.
 * ------------------------------------------------------------
 * Reads the `krwnos_locale` cookie during SSR so the initial
 * HTML is already rendered in the user's preferred language.
 * If the cookie is missing we fall back to `Accept-Language`
 * (best-effort parse — we only care about the first two chars).
 *
 * `getServerT` returns a synchronous translator that server
 * components can use directly. No React context needed on the
 * server path — we resolve against the compiled dicts.
 */

import { cookies, headers } from "next/headers";

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
import { DEFAULT_LOCALE, LOCALES, isLocale } from "./locales";
import { LOCALE_COOKIE } from "./provider";
import type { LocaleCode, TranslationVars } from "./types";

export async function getServerLocale(): Promise<LocaleCode> {
  try {
    const jar = await cookies();
    const fromCookie = jar.get(LOCALE_COOKIE)?.value;
    if (fromCookie && isLocale(fromCookie)) return fromCookie;
  } catch {
    // Not available outside a request scope — fall through.
  }
  try {
    const hdrs = await headers();
    const accept = hdrs.get("accept-language") ?? "";
    const primary = accept.split(",")[0]?.slice(0, 2).toLowerCase();
    if (primary && isLocale(primary)) return primary;
  } catch {
    // Not in request scope; use default.
  }
  return DEFAULT_LOCALE;
}

export async function getServerT() {
  const locale = await getServerLocale();
  const t = (key: string, vars?: TranslationVars) => {
    const primary = LOCALES[locale].dict[key];
    if (primary !== undefined) return interpolate(primary, vars);
    const fallback = LOCALES[DEFAULT_LOCALE].dict[key];
    if (fallback !== undefined) return interpolate(fallback, vars);
    return key;
  };
  const tp = (key: string, count: number, vars?: TranslationVars) => {
    const template = t(key);
    return interpolate(pluralize(count, template, locale), {
      count,
      ...vars,
    });
  };
  return {
    locale,
    meta: LOCALES[locale].meta,
    t,
    tp,
    formatNumber: (value: number, options?: Intl.NumberFormatOptions) =>
      formatNumber(value, locale, options),
    formatPercent: (fraction: number) => formatPercent(fraction, locale),
    formatCompact,
    formatDate: (input: string | Date) => formatDateShort(input, locale),
    formatDateTime: (input: string | Date) => formatDateTime(input, locale),
    formatTime: (input: string | Date) => formatTimeHM(input, locale),
    formatDuration: (seconds: number) => formatDuration(seconds, locale),
  };
}
