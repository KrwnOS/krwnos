/**
 * Formatting helpers for wallet UI.
 * ------------------------------------------------------------
 * Balances on the wire are JSON numbers. Server-only code may pass
 * Prisma `Decimal`-like objects (`toNumber()`). Do **not** import
 * `@prisma/client/runtime/library` here — it pulls Node `fs` and
 * breaks Next.js client bundles (`TransactionList`, etc.).
 */

export const KRONA_SYMBOL = "⚜";
export const DEFAULT_CURRENCY = "KRN";

/** Narrow shape shared by Prisma.Decimal / decimal.js — no runtime import. */
export type Decimalish = { toNumber: () => number };

function isDecimalLike(value: unknown): value is Decimalish {
  return (
    typeof value === "object" &&
    value !== null &&
    "toNumber" in value &&
    typeof (value as Decimalish).toNumber === "function"
  );
}

/** Loose parser — accepts number | string | bigint | Decimal-like. */
export function toNumber(value: number | string | bigint | Decimalish): number {
  if (isDecimalLike(value)) return value.toNumber();
  if (typeof value === "number") return value;
  if (typeof value === "bigint") return Number(value);
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
}

/**
 * Render an amount with the currency marker. For "KRN" we append
 * the Krona glyph (⚜); for other currencies we append the 3-letter
 * code.
 *
 *   formatAmount(12345.67)         -> "12 345.67 ⚜"
 *   formatAmount(100, "USD")       -> "100.00 USD"
 *   formatAmount(1, { withSymbol: false }) -> "1.00"
 */
export function formatAmount(
  value: number | string | bigint | Decimalish,
  currencyOrOpts:
    | string
    | { currency?: string; withSymbol?: boolean; fractionDigits?: number } = {},
): string {
  const opts =
    typeof currencyOrOpts === "string"
      ? { currency: currencyOrOpts }
      : currencyOrOpts;
  const currency = opts.currency ?? DEFAULT_CURRENCY;
  const fractionDigits = opts.fractionDigits ?? 2;

  const amount = toNumber(value);
  const negative = amount < 0;
  const abs = Math.abs(amount);

  const [intPart, decPart = ""] = abs.toFixed(fractionDigits).split(".");
  const major = formatThousands(intPart ?? "0");
  const body = fractionDigits > 0 ? `${major}.${decPart}` : major;
  const signed = negative ? `−${body}` : body;

  if (opts.withSymbol === false) return signed;
  if (currency === "KRN") return `${signed} ${KRONA_SYMBOL}`;
  return `${signed} ${currency}`;
}

/** Back-compat alias — many call sites use `formatKrona(...)`. */
export function formatKrona(
  value: number | string | bigint | Decimalish,
  opts: { withSymbol?: boolean } = {},
): string {
  return formatAmount(value, { currency: DEFAULT_CURRENCY, ...opts });
}

function formatThousands(digits: string): string {
  // Thin space (U+202F) keeps digits grouped without visual noise.
  return digits.replace(/\B(?=(\d{3})+(?!\d))/g, "\u202F");
}

export function shortAddress(address: string, head = 8, tail = 6): string {
  if (address.length <= head + tail + 1) return address;
  return `${address.slice(0, head)}…${address.slice(-tail)}`;
}

/**
 * Parse user-entered string ("12.50", "12,50", "1000") into a
 * finite number. Returns null for invalid input — caller decides
 * how to surface the error.
 */
export function parseAmountInput(raw: string): number | null {
  const trimmed = raw.trim().replace(",", ".");
  if (!trimmed) return null;
  if (!/^\d+(\.\d+)?$/.test(trimmed)) return null;
  const n = Number(trimmed);
  if (!Number.isFinite(n) || n <= 0) return null;
  return n;
}
