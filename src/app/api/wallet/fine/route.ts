/**
 * POST /api/wallet/fine — штраф по указу Суверена (вне Парламента).
 * Auth: Sovereign (`isOwner`) в текущем State.
 */
import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { applyWalletFine, WalletAccessError } from "@/modules/wallet";
import {
  loadWalletContext,
  walletErrorResponse,
  serialiseForWire,
} from "../_context";

export const dynamic = "force-dynamic";

const body = z.object({
  debtorUserId: z.string().min(1),
  amount: z.number().positive().finite(),
  beneficiaryNodeId: z.string().min(1),
  assetId: z.string().min(1).optional().nullable(),
});

export async function POST(req: NextRequest) {
  try {
    const { access, stateId } = await loadWalletContext(req);
    if (!access.isOwner) {
      throw new WalletAccessError(
        "Only the Sovereign may issue decree fines in this State.",
        "forbidden",
      );
    }
    const parsed = body.parse(await req.json());
    const result = await applyWalletFine({
      stateId,
      payload: {
        debtorUserId: parsed.debtorUserId,
        amount: parsed.amount,
        beneficiaryNodeId: parsed.beneficiaryNodeId,
      },
      source: "decree",
      decreeByUserId: access.userId,
      initiatedById: access.userId,
      assetId: parsed.assetId ?? null,
    });
    return NextResponse.json(serialiseForWire(result), { status: 201 });
  } catch (err) {
    return walletErrorResponse(err);
  }
}
