/**
 * GET /api/wallet/treasuries
 *   Lists treasury wallets the caller can view.
 *
 * POST /api/wallet/treasuries
 *   Provisions a treasury wallet for a given nodeId (Sovereign /
 *   `wallet.admin_mint` only).
 *   Body: { nodeId: string }
 */

import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import {
  loadWalletContext,
  walletErrorResponse,
  serialiseForWire,
} from "../_context";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  try {
    const { service, access, stateId } = await loadWalletContext(req);
    const treasuries = await service.listVisibleTreasuries(stateId, access);
    return NextResponse.json(serialiseForWire({ treasuries }));
  } catch (err) {
    return walletErrorResponse(err);
  }
}

const provisionBody = z.object({ nodeId: z.string().min(1) });

export async function POST(req: NextRequest) {
  try {
    const { service, access, stateId } = await loadWalletContext(req);
    const body = provisionBody.parse(await req.json());
    const wallet = await service.ensureTreasuryWallet(
      stateId,
      body.nodeId,
      access,
    );
    return NextResponse.json(serialiseForWire({ wallet }), { status: 201 });
  } catch (err) {
    return walletErrorResponse(err);
  }
}
