/**
 * Maps `CurrencyFactoryError` → HTTP. The shared
 * `walletErrorResponse` helper in `../_context.ts` doesn't know
 * about this error type (it lives in `core.wallet/settings`,
 * separate from the main wallet service), so we translate here
 * and fall back to the shared handler when it's some other error.
 *
 * Mapping:
 *   * `invalid_input`     → 400
 *   * `not_found`         → 404
 *   * `forbidden`         → 403
 *   * `insufficient_funds`→ 409 (won't happen in practice — kept
 *                                 for exhaustiveness)
 *   * `conflict`          → 409 (used for "symbol already exists"
 *                                 / "asset still in use" cases).
 */

import { NextResponse } from "next/server";
import { CurrencyFactoryError } from "@/modules/wallet";

export function factoryErrorResponse(err: unknown): NextResponse | null {
  if (!(err instanceof CurrencyFactoryError)) return null;
  const status =
    err.code === "forbidden"
      ? 403
      : err.code === "not_found"
        ? 404
        : err.code === "conflict" || err.code === "insufficient_funds"
          ? 409
          : 400;
  return NextResponse.json(
    { error: err.message, code: err.code },
    { status },
  );
}
