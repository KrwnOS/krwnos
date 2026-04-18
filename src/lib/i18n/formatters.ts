/**
 * Locale-aware formatters for numbers, dates and pluralization.
 * ------------------------------------------------------------
 * The translation function handles static strings. Anything that
 * depends on the *value* at render time (a balance, a timestamp,
 * a count of items) goes through here so it picks up the right
 * locale's `Intl.*` configuration automatically.
 *
 * Plural rule:
 *   * Russian/Ukrainian-style "slavic" split — 3 forms
 *     (one / few / many): "1 узел", "2 узла", "5 узлов".
 *   * English-style "english" split — 2 forms (one / other).
 *   * The template syntax is the same for both: three pipe-
 *     separated variants ("one | few | many"). For English we
 *     pick [0] when the count is 1, [2] otherwise; for Slavic
 *     we use the standard mod-10 / mod-100 rules.
 */

import { LOCALES, type LocaleCode } from "./locales";
import type { TranslationVars } from "./types";

export function bcp47Of(locale: LocaleCode): string {
  return LOCALES[locale].meta.bcp47;
}

export function formatNumber(
  value: number,
  locale: LocaleCode,
  options?: Intl.NumberFormatOptions,
): string {
  if (!Number.isFinite(value)) return "—";
  return new Intl.NumberFormat(bcp47Of(locale), {
    maximumFractionDigits: 2,
    ...options,
  }).format(value);
}

export function formatPercent(fraction: number, locale: LocaleCode): string {
  if (!Number.isFinite(fraction)) return "—";
  const pct = fraction * 100;
  const precision = pct === 0 || pct >= 10 ? 0 : 2;
  return `${pct.toFixed(precision)}%`;
}

export function formatDateShort(
  input: string | Date,
  locale: LocaleCode,
): string {
  const d = typeof input === "string" ? new Date(input) : input;
  if (Number.isNaN(d.getTime())) {
    return typeof input === "string" ? input : "—";
  }
  return new Intl.DateTimeFormat(bcp47Of(locale), {
    day: "2-digit",
    month: "short",
    year: "numeric",
  }).format(d);
}

export function formatDateTime(
  input: string | Date,
  locale: LocaleCode,
): string {
  const d = typeof input === "string" ? new Date(input) : input;
  if (Number.isNaN(d.getTime())) {
    return typeof input === "string" ? input : "—";
  }
  return d.toLocaleString(bcp47Of(locale));
}

export function formatTimeHM(
  input: string | Date,
  locale: LocaleCode,
): string {
  const d = typeof input === "string" ? new Date(input) : input;
  if (Number.isNaN(d.getTime())) return "";
  return d.toLocaleTimeString(bcp47Of(locale), {
    hour: "2-digit",
    minute: "2-digit",
  });
}

/**
 * Compact number formatter for tight UI slots (vote tallies).
 * 1.23k / 4.56M — always two decimals when scaled; plain integer
 * or fixed(2) otherwise. Locale-independent on purpose: tally
 * columns stay narrow across any UI language.
 */
export function formatCompact(n: number): string {
  if (!Number.isFinite(n)) return "—";
  if (Math.abs(n) >= 1_000_000) return `${(n / 1_000_000).toFixed(2)}M`;
  if (Math.abs(n) >= 1_000) return `${(n / 1_000).toFixed(2)}k`;
  return Number.isInteger(n) ? String(n) : n.toFixed(2);
}

/**
 * Human-readable duration ("3d 4h" / "3д 4ч"). Keeps units short
 * so it fits in a stat box; hardcoded units per-locale because
 * Intl.RelativeTimeFormat doesn't have a "fixed duration" API.
 */
export function formatDuration(seconds: number, locale: LocaleCode): string {
  if (!Number.isFinite(seconds) || seconds < 0) return "—";
  const days = Math.floor(seconds / 86_400);
  const hours = Math.floor((seconds % 86_400) / 3_600);
  const mins = Math.floor((seconds % 3_600) / 60);
  const units =
    locale === "ru"
      ? { d: "д", h: "ч", m: "м" }
      : { d: "d", h: "h", m: "m" };
  if (days > 0) return `${days}${units.d} ${hours}${units.h}`;
  if (hours > 0) return `${hours}${units.h} ${mins}${units.m}`;
  return `${mins}${units.m}`;
}

/**
 * Pluralization. `template` is three pipe-separated variants in
 * order (one | few | many); see `locales/ru.ts` header for the
 * canonical example. For non-Slavic locales the middle variant
 * is ignored; we only look at `one` vs `other`.
 */
export function pluralize(
  n: number,
  template: string,
  locale: LocaleCode,
): string {
  const variants = template.split("|").map((s) => s.trim());
  const one = variants[0] ?? template;
  const few = variants[1] ?? variants[0] ?? template;
  const many = variants[2] ?? variants[1] ?? variants[0] ?? template;

  const rule = LOCALES[locale].meta.plural;
  if (rule === "english") {
    return Math.abs(n) === 1 ? one : many;
  }
  const abs = Math.abs(n) % 100;
  const last = abs % 10;
  if (abs > 10 && abs < 20) return many;
  if (last > 1 && last < 5) return few;
  if (last === 1) return one;
  return many;
}

/**
 * Interpolates `{placeholder}` tokens with values from `vars`.
 * Missing vars leave the placeholder literal — easier to spot
 * in the UI than silently rendering the string "undefined".
 */
export function interpolate(
  template: string,
  vars?: TranslationVars,
): string {
  if (!vars) return template;
  return template.replace(/\{(\w+)\}/g, (match, key) => {
    const v = vars[key as keyof TranslationVars];
    return v === undefined ? match : String(v);
  });
}
