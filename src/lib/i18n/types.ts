/**
 * Core i18n types for KrwnOS.
 * ------------------------------------------------------------
 * Each locale is a flat dictionary `Record<string, string>` whose keys
 * are dotted paths like `"admin.nexus.title"`. Values use ICU
 * MessageFormat (plural, select, `{name}` placeholders) rendered via
 * `intl-messageformat`.
 *
 * Why flat keys?
 *   * Simple JSON-compatible fallback/merge behaviour.
 *   * Trivial to generate / diff against a translation tool.
 *
 * Adding a new language: add overrides in `locales/<code>.ts`, merge
 * with `en` in `locales/index.ts`. Missing keys fall back to English.
 */

export type LocaleCode = "en" | "ru" | "es" | "zh" | "tr";

export interface LocaleMeta {
  code: LocaleCode;
  /** Native name, shown in the language switcher. */
  nativeName: string;
  /** BCP 47 tag for `Intl.*` + `<html lang>`. */
  bcp47: string;
  /** Legacy pipe-plural helper (`formatters.pluralize`) — prefer ICU in messages. */
  plural: "slavic" | "english";
}

/**
 * A dictionary is a flat map from dotted key → template string.
 * Placeholders use curly-brace syntax: `"Hello, {name}"`.
 */
export type Dict = Record<string, string>;

export type TranslationVars = Record<string, string | number>;
