/**
 * GET /api/wallet/treasuries/:nodeId
 *   Returns the treasury wallet of a node + its recent transactions.
 *   Caller must hold `wallet.view_treasury` AND be a member of the
 *   node or any of its ancestors (Sovereign bypasses both).
 */

import { NextResponse, type NextRequest } from "next/server";
import {
  loadWalletContext,
  walletErrorResponse,
  serialiseForWire,
} from "../../_context";

export const dynamic = "force-dynamic";

export async function GET(
  req: NextRequest,
  { params }: { params: { nodeId: string } },
) {
  try {
    const { service, access, stateId } = await loadWalletContext(req);
    const wallet = await service.getTreasury(stateId, params.nodeId, access);
    const transactions = await service.listTreasuryTransactions(
      stateId,
      params.nodeId,
      access,
      { limit: 25 },
    );
    return NextResponse.json(serialiseForWire({ wallet, transactions }));
  } catch (err) {
    return walletErrorResponse(err);
  }
}
