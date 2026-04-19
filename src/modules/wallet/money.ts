import { Decimal } from "@prisma/client/runtime/library";

export { Decimal };

/** Canonical constructor for amounts persisted on `Wallet` / `Transaction`. */
export function ledgerDecimal(n: number | string | Decimal): Decimal {
  return Decimal.isDecimal(n) ? n : new Decimal(n);
}

/** Banker's rounding to asset scale — used for tax splits so net + tax reconciles. */
export function roundLedgerAmount(value: Decimal, maxDecimals: number): Decimal {
  const d = Math.max(0, Math.min(18, Math.trunc(maxDecimals)));
  return value.toDecimalPlaces(d, Decimal.ROUND_HALF_EVEN);
}

/** JSON / UI: narrow ledger values to JS number at the boundary. */
export function moneyToNumber(v: Decimal | number): number {
  return Decimal.isDecimal(v) ? v.toNumber() : v;
}
