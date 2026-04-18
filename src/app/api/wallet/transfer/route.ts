/**
 * POST /api/wallet/transfer
 *
 * Body:
 * {
 *   from: { kind: "personal" }
 *       | { kind: "treasury", nodeId: string }
 *       | { kind: "walletId", walletId: string };
 *   to:   { kind: "user",     userId: string }
 *       | { kind: "treasury", nodeId: string }
 *       | { kind: "walletId", walletId: string };
 *   amount: number;   // schema stores `Float`
 *   currency?: string; // defaults to source wallet's currency
 *   memo?: string;
 *   metadata?: Record<string, unknown>;
 * }
 *
 * Permissions:
 *   * `wallet.transfer` to initiate at all.
 *   * For `from.kind = "treasury"`: `wallet.view_treasury` AND
 *     membership in the node (or any ancestor). Sovereign bypasses.
 */

import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import {
  loadWalletContext,
  walletErrorResponse,
  serialiseForWire,
} from "../_context";

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

    const tx = await service.transfer(stateId, access, {
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
    });

    return NextResponse.json(
      serialiseForWire({ transaction: tx }),
      { status: 201 },
    );
  } catch (err) {
    return walletErrorResponse(err);
  }
}
