/**
 * Public surface of the i18n subsystem.
 * ------------------------------------------------------------
 * Client code should import from here, not from the individual
 * modules, so we can refactor internals without touching call
 * sites. Server-only helpers live in `./server` and must be
 * imported directly (Next.js enforces the boundary).
 */

export type { LocaleCode, LocaleMeta, Dict, TranslationVars } from "./types";
export {
  AVAILABLE_LOCALES,
  DEFAULT_LOCALE,
  LOCALES,
  isLocale,
} from "./locales";
export {
  I18nProvider,
  LOCALE_COOKIE,
  useI18n,
  useT,
  useTp,
} from "./provider";
export type { TFunction, TpFunction } from "./provider";
export {
  bcp47Of,
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
