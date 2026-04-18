/**
 * Locale registry.
 * ------------------------------------------------------------
 * To add a new language:
 *   1. Copy `ru.ts` → `<code>.ts`, translate the values.
 *   2. Register it in `LOCALES` below with its metadata.
 * That's it — the `<LanguageSwitcher />` will pick it up, users
 * can persist it via cookie/localStorage, and `useT()` will
 * start returning its strings for any caller inside the provider.
 *
 * `ru` is the canonical source. Missing keys in other locales
 * silently fall back to the Russian value so a partial
 * translation never renders as empty.
 */

import type { Dict, LocaleCode, LocaleMeta } from "../types";
import { ru } from "./ru";
import { en } from "./en";

export type { LocaleCode, LocaleMeta, Dict };

interface LocaleEntry {
  meta: LocaleMeta;
  dict: Dict;
}

export const LOCALES: Readonly<Record<LocaleCode, LocaleEntry>> = {
  ru: {
    meta: {
      code: "ru",
      nativeName: "Русский",
      bcp47: "ru-RU",
      plural: "slavic",
    },
    dict: ru,
  },
  en: {
    meta: {
      code: "en",
      nativeName: "English",
      bcp47: "en-US",
      plural: "english",
    },
    dict: en,
  },
};

export const DEFAULT_LOCALE: LocaleCode = "ru";

export const AVAILABLE_LOCALES: LocaleMeta[] = Object.values(LOCALES).map(
  (l) => l.meta,
);

export function isLocale(value: unknown): value is LocaleCode {
  return typeof value === "string" && value in LOCALES;
}
