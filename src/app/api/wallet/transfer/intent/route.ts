/**
 * POST /api/wallet/transfer/intent
 *
 * Step 1 of the Web3 flow: server builds an unsigned `transfer(to,
 * amount)` payload via viem and persists a `pending` Transaction
 * row. The client receives the intent, displays `humanReadable` to
 * the user, signs & broadcasts through MetaMask / WalletConnect,
 * then calls /api/wallet/transfer/confirm with the resulting hash.
 *
 * Only used when `StateAsset.type === "ON_CHAIN"` (or HYBRID
 * withdraws). Pure INTERNAL transfers keep using /api/wallet/transfer.
 *
 * Body: same shape as /api/wallet/transfer (see that file).
 */

import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import {
  loadWalletContext,
  walletErrorResponse,
  serialiseForWire,
} from "../../_context";

export const dynamic = "force-dynamic";

const walletRef = z.union([
  z.object({ kind: z.literal("walletId"), walletId: z.string().min(1) }),
  z.object({ kind: z.literal("personal") }),
  z.object({ kind: z.literal("treasury"), nodeId: z.string().min(1) }),
]);

const destination = z.union([
  z.object({ kind: z.literal("walletId"), walletId: z.string().min(1) }),
  z.object({ kind: z.literal("user"), userId: z.string().min(1) }),
  z.object({ kind: z.literal("treasury"), nodeId: z.string().min(1) }),
]);

const body = z.object({
  from: walletRef,
  to: destination,
  amount: z.number().positive().finite(),
  currency: z.string().min(1).max(16).optional(),
  memo: z.string().max(280).optional(),
  metadata: z.record(z.string(), z.unknown()).optional(),
});

export async function POST(req: NextRequest) {
  try {
    const { service, access, stateId } = await loadWalletContext(req);
    const parsed = body.parse(await req.json());

    const { transaction, intent } = await service.prepareOnChainIntent(
      stateId,
      access,
      {
        from:
          parsed.from.kind === "personal"
            ? { kind: "personal" }
            : parsed.from.kind === "treasury"
              ? { kind: "treasury", nodeId: parsed.from.nodeId }
              : { kind: "walletId", walletId: parsed.from.walletId },
        to:
          parsed.to.kind === "user"
            ? { kind: "user", userId: parsed.to.userId }
            : parsed.to.kind === "treasury"
              ? { kind: "treasury", nodeId: parsed.to.nodeId }
              : { kind: "walletId", walletId: parsed.to.walletId },
        amount: parsed.amount,
        currency: parsed.currency,
        memo: parsed.memo,
        metadata: parsed.metadata,
      },
    );

    return NextResponse.json(
      serialiseForWire({ transaction, intent }),
      { status: 201 },
    );
  } catch (err) {
    return walletErrorResponse(err);
  }
}
