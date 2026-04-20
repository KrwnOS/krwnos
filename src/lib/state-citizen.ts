/**
 * Citizen-facing helpers for constitution-backed flows (emigration, role market).
 * Amounts follow the same conventions as `StateSettings`: `exitRefundRate` is a
 * fraction in [0, 1], not a percentage.
 */

import { ledgerDecimal, moneyToNumber, roundLedgerAmount } from "@/modules/wallet/money";

export interface EmigrationSplit {
  /** Balance retained on the personal wallet (per constitution). */
  kept: number;
  /** Amount routed to the state treasury on exit. */
  forfeit: number;
}

/**
 * Splits a wallet balance into kept vs treasury forfeit using `exitRefundRate`.
 * `kept ≈ balance × exitRefundRate`, `forfeit` is the remainder after rounding.
 */
export function splitEmigrationAmounts(
  balance: number,
  exitRefundRate: number,
  decimals: number,
): EmigrationSplit {
  if (!Number.isFinite(balance) || balance < 0) {
    throw new RangeError("balance must be a finite non-negative number");
  }
  if (
    !Number.isFinite(exitRefundRate) ||
    exitRefundRate < 0 ||
    exitRefundRate > 1
  ) {
    throw new RangeError("exitRefundRate must be in [0, 1]");
  }

  const bal = ledgerDecimal(balance);
  if (bal.eq(0)) {
    return { kept: 0, forfeit: 0 };
  }

  const rawKept = bal.times(exitRefundRate);
  const keptDec = roundLedgerAmount(rawKept, decimals);
  const forfeitDec = bal.minus(keptDec);
  if (forfeitDec.lt(0)) {
    return { kept: moneyToNumber(bal), forfeit: 0 };
  }

  return {
    kept: moneyToNumber(keptDec),
    forfeit: moneyToNumber(forfeitDec),
  };
}
