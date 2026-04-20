/**
 * PUT /api/wallet/node-subscription — настроить подписку казны дочернего узла
 * в пользу казны родителя (расписание: MONTHLY / WEEKLY).
 *
 * Auth: Суверен или держатель `wallet.manage_treasury` на дочернем узле
 * (член узла или предка).
 */
import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { Decimal } from "@prisma/client/runtime/library";
import { prisma } from "@/lib/prisma";
import { permissionsEngine } from "@/core/permissions-engine";
import {
  WalletAccessError,
  WalletPermissions,
} from "@/modules/wallet";
import type { PermissionKey } from "@/types/kernel";
import {
  loadWalletContext,
  walletErrorResponse,
  serialiseForWire,
} from "../_context";

export const dynamic = "force-dynamic";

const body = z.object({
  childNodeId: z.string().min(1),
  parentNodeId: z.string().min(1),
  amount: z.number().positive().finite(),
  schedule: z.enum(["MONTHLY", "WEEKLY"]),
  enabled: z.boolean().optional(),
  assetId: z.string().min(1).optional().nullable(),
});

function hasTreasuryManage(held: ReadonlySet<PermissionKey>): boolean {
  if (held.has("*")) return true;
  if (held.has(WalletPermissions.ManageTreasury)) return true;
  if (held.has("wallet.*" as PermissionKey)) return true;
  return false;
}

function assertCanConfigure(
  ctx: import("@/modules/wallet").WalletAccessContext,
  stateId: string,
  childNodeId: string,
): void {
  if (ctx.isOwner) return;
  const node = ctx.snapshot.nodes.get(childNodeId);
  if (!node || node.stateId !== stateId) {
    throw new WalletAccessError(
      "Child node not found in this State.",
      "invalid_input",
    );
  }
  if (!hasTreasuryManage(ctx.permissions)) {
    throw new WalletAccessError(
      `Missing permission "${WalletPermissions.ManageTreasury}".`,
      "forbidden",
    );
  }
  const m = permissionsEngine.isMemberOfNodeOrAncestor(
    { userId: ctx.userId, isOwner: ctx.isOwner, snapshot: ctx.snapshot },
    childNodeId,
  );
  if (!m.granted) {
    throw new WalletAccessError(
      "Not a member of this node (or any of its ancestors).",
      "forbidden",
    );
  }
}

export async function PUT(req: NextRequest) {
  try {
    const { access, stateId } = await loadWalletContext(req);
    const parsed = body.parse(await req.json());
    assertCanConfigure(access, stateId, parsed.childNodeId);

    const child = await prisma.verticalNode.findFirst({
      where: { id: parsed.childNodeId, stateId },
      select: { id: true, parentId: true },
    });
    if (!child || child.parentId !== parsed.parentNodeId) {
      throw new WalletAccessError(
        "parentNodeId must be the direct parent of childNodeId in the Vertical.",
        "invalid_input",
      );
    }

    const parent = await prisma.verticalNode.findFirst({
      where: { id: parsed.parentNodeId, stateId },
      select: { id: true },
    });
    if (!parent) {
      throw new WalletAccessError("Parent node not found.", "not_found");
    }

    const amountDec = new Decimal(parsed.amount);
    const row = await prisma.nodeSubscription.upsert({
      where: { childNodeId: parsed.childNodeId },
      create: {
        stateId,
        childNodeId: parsed.childNodeId,
        parentNodeId: parsed.parentNodeId,
        amount: amountDec,
        schedule: parsed.schedule,
        enabled: parsed.enabled ?? true,
        assetId: parsed.assetId ?? null,
      },
      update: {
        parentNodeId: parsed.parentNodeId,
        amount: amountDec,
        schedule: parsed.schedule,
        ...(parsed.enabled !== undefined ? { enabled: parsed.enabled } : {}),
        ...(parsed.assetId !== undefined ? { assetId: parsed.assetId } : {}),
      },
    });

    return NextResponse.json(serialiseForWire({ subscription: row }));
  } catch (err) {
    return walletErrorResponse(err);
  }
}
