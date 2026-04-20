import IntlMessageFormat from "intl-messageformat";

import { LOCALES, type LocaleCode } from "./locales";

/**
 * ICU MessageFormat rendering using the active locale's plural/select rules.
 * Missing keys are resolved upstream; `message` is always a non-empty pattern.
 */
export function formatIcu(
  locale: LocaleCode,
  message: string,
  values?: Record<
    string,
    string | number | boolean | Date | bigint | null | undefined
  >,
): string {
  const bcp47 = LOCALES[locale].meta.bcp47;
  const normalized: Record<string, string | number | boolean | Date | bigint> =
    {};
  if (values) {
    for (const [k, v] of Object.entries(values)) {
      if (v === null || v === undefined) continue;
      normalized[k] = v as string | number | boolean | Date | bigint;
    }
  }
  try {
    const fmt = new IntlMessageFormat(message, bcp47);
    const out = fmt.format(normalized);
    if (typeof out === "string") return out;
    if (typeof out === "number" || typeof out === "bigint")
      return out.toString();
    if (typeof out === "boolean") return out ? "true" : "false";
    return String(out);
  } catch {
    return message;
  }
}
