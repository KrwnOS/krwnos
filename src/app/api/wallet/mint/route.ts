/**
 * POST /api/wallet/mint
 *
 * Sovereign-only (or `wallet.admin_mint` holder). Creates fresh
 * Kronas and credits them to an existing wallet — no source wallet.
 *
 * Body: { toWalletId: string, amount: number, currency?: string, memo?: string }
 */

import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import {
  loadWalletContext,
  walletErrorResponse,
  serialiseForWire,
} from "../_context";

export const dynamic = "force-dynamic";

const body = z.object({
  toWalletId: z.string().min(1),
  amount: z.number().positive().finite(),
  currency: z.string().min(1).max(16).optional(),
  memo: z.string().max(280).optional(),
  metadata: z.record(z.string(), z.unknown()).optional(),
});

export async function POST(req: NextRequest) {
  try {
    const { service, access, stateId } = await loadWalletContext(req);
    const parsed = body.parse(await req.json());

    const tx = await service.mint(stateId, access, {
      toWalletId: parsed.toWalletId,
      amount: parsed.amount,
      currency: parsed.currency,
      memo: parsed.memo,
      metadata: parsed.metadata,
    });

    return NextResponse.json(
      serialiseForWire({ transaction: tx }),
      { status: 201 },
    );
  } catch (err) {
    return walletErrorResponse(err);
  }
}
