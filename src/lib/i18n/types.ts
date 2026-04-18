/**
 * Core i18n types for KrwnOS.
 * ------------------------------------------------------------
 * The localization layer is intentionally minimal — no external
 * dependencies (no react-intl / i18next). Each locale is a flat
 * dictionary `Record<string, string>` whose keys are dotted paths
 * like `"admin.nexus.title"`. Values may contain `{placeholder}`
 * slots that the `t()` function substitutes with typed vars.
 *
 * Why flat keys?
 *   * Typed autocompletion (keyof RuDict) across the whole app.
 *   * Simple JSON-compatible fallback/merge behaviour.
 *   * Trivial to generate / diff against a translation tool.
 *
 * Adding a new language: create `locales/<code>.ts` that exports
 * the same keys as `ru.ts`, then register it in `locales/index.ts`.
 * Missing keys fall back to the `ru` dictionary — so a partial
 * translation degrades gracefully rather than rendering empty
 * strings.
 */

export type LocaleCode = "ru" | "en";

export interface LocaleMeta {
  code: LocaleCode;
  /** Native name, shown in the language switcher. */
  nativeName: string;
  /** BCP 47 tag for `Intl.*` + `<html lang>`. */
  bcp47: string;
  /** Pluralization rule — Slavic-style (one/few/many) or English-style. */
  plural: "slavic" | "english";
}

/**
 * A dictionary is a flat map from dotted key → template string.
 * Placeholders use curly-brace syntax: `"Hello, {name}"`.
 */
export type Dict = Record<string, string>;

export type TranslationVars = Record<string, string | number>;
