/**
 * POST /api/wallet/transfer/confirm
 *
 * Step 2 of the Web3 flow: client signed & broadcasted the intent,
 * sends back the resulting transaction hash. The server stores it
 * on the pending row and marks it as "broadcasting"; the Treasury
 * Watcher then polls the chain and flips the row to `completed` /
 * `failed` when it reaches finality.
 *
 * Body:
 * {
 *   transactionId: string;
 *   externalTxHash: string; // 0x-prefixed 32-byte hash
 * }
 */

import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import {
  loadWalletContext,
  walletErrorResponse,
  serialiseForWire,
} from "../../_context";

export const dynamic = "force-dynamic";

const body = z.object({
  transactionId: z.string().min(1),
  externalTxHash: z.string().regex(/^0x[0-9a-fA-F]{64}$/),
});

export async function POST(req: NextRequest) {
  try {
    const { service, access, stateId } = await loadWalletContext(req);
    const parsed = body.parse(await req.json());

    const transaction = await service.confirmOnChainTransfer(
      stateId,
      access,
      parsed,
    );

    return NextResponse.json(
      serialiseForWire({ transaction }),
      { status: 200 },
    );
  } catch (err) {
    return walletErrorResponse(err);
  }
}
