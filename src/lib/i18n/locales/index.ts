/**
 * Locale registry. English is the canonical fallback for missing keys.
 */

import type { Dict, LocaleCode, LocaleMeta } from "../types";
import { en } from "./en";
import { es } from "./es";
import { ru } from "./ru";
import { tr } from "./tr";
import { zh } from "./zh";

export type { LocaleCode, LocaleMeta, Dict };

interface LocaleEntry {
  meta: LocaleMeta;
  dict: Dict;
}

export const LOCALES: Readonly<Record<LocaleCode, LocaleEntry>> = {
  en: {
    meta: {
      code: "en",
      nativeName: "English",
      bcp47: "en-US",
      plural: "english",
    },
    dict: en,
  },
  ru: {
    meta: {
      code: "ru",
      nativeName: "Русский",
      bcp47: "ru-RU",
      plural: "slavic",
    },
    dict: ru,
  },
  es: {
    meta: {
      code: "es",
      nativeName: "Español",
      bcp47: "es-ES",
      plural: "english",
    },
    dict: es,
  },
  zh: {
    meta: {
      code: "zh",
      nativeName: "简体中文",
      bcp47: "zh-CN",
      plural: "english",
    },
    dict: zh,
  },
  tr: {
    meta: {
      code: "tr",
      nativeName: "Türkçe",
      bcp47: "tr-TR",
      plural: "english",
    },
    dict: tr,
  },
};

export const DEFAULT_LOCALE: LocaleCode = "en";

export const AVAILABLE_LOCALES: LocaleMeta[] = Object.values(LOCALES).map(
  (l) => l.meta,
);

export function isLocale(value: unknown): value is LocaleCode {
  return typeof value === "string" && value in LOCALES;
}
