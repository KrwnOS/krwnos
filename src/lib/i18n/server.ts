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

import { prisma } from "@/lib/prisma";

import {
  formatCompact,
  formatDateShort,
  formatDateTime,
  formatDuration,
  formatNumber,
  formatPercent,
  formatTimeHM,
} from "./formatters";
import { formatIcu } from "./icu";
import { DEFAULT_LOCALE, LOCALES, isLocale } from "./locales";
import { LOCALE_COOKIE } from "./provider";
import type { LocaleCode, TranslationVars } from "./types";

async function loadPersistedStateUiLocale(): Promise<LocaleCode | null> {
  try {
    const state = await prisma.state.findFirst({
      orderBy: { createdAt: "asc" },
      select: { id: true },
    });
    if (!state) return null;
    const row = await prisma.stateSettings.findUnique({
      where: { stateId: state.id },
      select: { uiLocale: true },
    });
    const raw = row?.uiLocale;
    if (typeof raw !== "string") return null;
    const code = raw.trim().toLowerCase();
    return isLocale(code) ? code : null;
  } catch {
    return null;
  }
}

export async function getServerLocale(): Promise<LocaleCode> {
  try {
    const jar = await cookies();
    const fromCookie = jar.get(LOCALE_COOKIE)?.value;
    if (fromCookie && isLocale(fromCookie)) return fromCookie;
  } catch {
    // Not available outside a request scope — fall through.
  }
  const fromState = await loadPersistedStateUiLocale();
  if (fromState) return fromState;
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
    let pattern: string | undefined;
    for (const loc of [locale, DEFAULT_LOCALE, "ru"] as const) {
      const hit = LOCALES[loc].dict[key];
      if (hit !== undefined) {
        pattern = hit;
        break;
      }
    }
    if (pattern === undefined) return key;
    return formatIcu(locale, pattern, vars);
  };
  const tp = (key: string, count: number, vars?: TranslationVars) =>
    t(key, { count, ...vars });
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
