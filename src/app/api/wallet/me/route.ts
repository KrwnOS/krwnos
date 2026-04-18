/**
 * GET /api/wallet/me
 *   Returns the caller's personal wallet + recent transactions.
 *   Lazy-provisions a wallet if missing (for legacy users).
 */

import { NextResponse, type NextRequest } from "next/server";
import {
  loadWalletContext,
  walletErrorResponse,
  serialiseForWire,
} from "../_context";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  try {
    const { service, access, stateId } = await loadWalletContext(req);

    const wallet = await service.ensurePersonalWallet(stateId, access.userId);
    const transactions = await service.listOwnTransactions(stateId, access, {
      limit: 25,
    });

    return NextResponse.json(
      serialiseForWire({ wallet, transactions }),
    );
  } catch (err) {
    return walletErrorResponse(err);
  }
}
