/**
 * POST /api/state/purchase-role
 *
 * Self-service promotion from the Waiting Room into a non-lobby node when
 * `StateSettings.rolesPurchasable` is true. Charges `citizenshipFeeAmount`
 * (same source of truth as invite acceptance) to the target node's treasury.
 *
 * Preconditions:
 *   * Caller is not the Sovereign.
 *   * Caller has a membership on the lobby node (any status).
 *   * Caller has no active membership on any non-lobby node.
 *   * Target node belongs to the State and is not the lobby.
 */

import { randomBytes } from "node:crypto";
import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { ledgerDecimal, moneyToNumber } from "@/modules/wallet/money";
import { authenticateCli } from "../../cli/auth";
import { walletErrorResponse } from "../../wallet/_context";

export const dynamic = "force-dynamic";

class InsufficientRolePurchaseFeeError extends Error {
  constructor(
    public readonly required: number,
    public readonly available: number,
  ) {
    super(
      `Insufficient balance: need ${required} to purchase a role, have ${available}.`,
    );
    this.name = "InsufficientRolePurchaseFeeError";
  }
}

const bodySchema = z.object({
  targetNodeId: z.string().min(1),
});

const cliLookup = {
  findByHash: async (tokenHash: string) =>
    prisma.cliToken.findUnique({
      where: { tokenHash },
      select: {
        id: true,
        userId: true,
        stateId: true,
        scopes: true,
        expiresAt: true,
        revokedAt: true,
      },
    }),
  touch: async (id: string) =>
    void (await prisma.cliToken.update({
      where: { id },
      data: { lastUsedAt: new Date() },
    })),
};

export async function POST(req: NextRequest) {
  try {
    const cli = await authenticateCli(req, cliLookup);
    if (!cli.stateId) {
      return NextResponse.json(
        { error: "Token is not scoped to any State.", code: "invalid_input" },
        { status: 400 },
      );
    }
    const stateId = cli.stateId;
    const parsed = bodySchema.parse(await req.json());

    const [state, settings, targetNode, lobby] = await Promise.all([
      prisma.state.findUnique({
        where: { id: stateId },
        select: { ownerId: true },
      }),
      prisma.stateSettings.findUnique({
        where: { stateId },
        select: { rolesPurchasable: true, citizenshipFeeAmount: true },
      }),
      prisma.verticalNode.findUnique({
        where: { id: parsed.targetNodeId },
        select: { id: true, stateId: true, isLobby: true },
      }),
      prisma.verticalNode.findFirst({
        where: { stateId, isLobby: true },
        select: { id: true },
      }),
    ]);

    if (!state) {
      return NextResponse.json({ error: "State not found.", code: "not_found" }, { status: 404 });
    }
    if (state.ownerId === cli.userId) {
      return NextResponse.json(
        { error: "The Sovereign cannot use the role market.", code: "forbidden" },
        { status: 403 },
      );
    }
    if (!settings?.rolesPurchasable) {
      return NextResponse.json(
        {
          error: "Role purchase is not enabled for this State (constitution).",
          code: "roles_not_purchasable",
        },
        { status: 403 },
      );
    }
    if (!targetNode || targetNode.stateId !== stateId) {
      return NextResponse.json({ error: "Target node not found.", code: "not_found" }, { status: 404 });
    }
    if (targetNode.isLobby) {
      return NextResponse.json(
        { error: "Cannot purchase the Waiting Room itself.", code: "invalid_target" },
        { status: 400 },
      );
    }
    if (!lobby) {
      return NextResponse.json(
        { error: "This State has no Waiting Room configured.", code: "lobby_missing" },
        { status: 409 },
      );
    }

    const [lobbyMembership, activeElsewhere] = await Promise.all([
      prisma.membership.findUnique({
        where: {
          userId_nodeId: { userId: cli.userId, nodeId: lobby.id },
        },
        select: { id: true },
      }),
      prisma.membership.findFirst({
        where: {
          userId: cli.userId,
          status: "active",
          node: { stateId, isLobby: false },
        },
        select: { id: true },
      }),
    ]);

    if (!lobbyMembership) {
      return NextResponse.json(
        {
          error: "You must be in the Waiting Room to purchase a role.",
          code: "not_in_lobby",
        },
        { status: 400 },
      );
    }
    if (activeElsewhere) {
      return NextResponse.json(
        {
          error: "You already hold an active role outside the Waiting Room.",
          code: "already_has_role",
        },
        { status: 400 },
      );
    }

    const fee = settings.citizenshipFeeAmount ?? 0;

    const primaryAsset = await prisma.stateAsset.findFirst({
      where: { stateId, isPrimary: true },
      select: { id: true, symbol: true, decimals: true },
    });
    if (!primaryAsset) {
      return NextResponse.json(
        { error: "State has no primary currency.", code: "no_primary_asset" },
        { status: 409 },
      );
    }

    await prisma.$transaction(async (tx) => {
      let walletRow = await tx.wallet.findFirst({
        where: {
          stateId,
          userId: cli.userId,
          type: "PERSONAL",
          assetId: primaryAsset.id,
        },
        select: { id: true, balance: true },
      });
      if (!walletRow) {
        walletRow = await tx.wallet.create({
          data: {
            stateId,
            type: "PERSONAL",
            userId: cli.userId,
            address: `krwn1usr${randomBytes(16).toString("hex")}`,
            currency: primaryAsset.symbol,
            assetId: primaryAsset.id,
            balance: 0,
          },
          select: { id: true, balance: true },
        });
      }

      if (fee > 0) {
        const feeDec = ledgerDecimal(fee);
        const bal = ledgerDecimal(walletRow.balance);
        if (bal.lt(feeDec)) {
          throw new InsufficientRolePurchaseFeeError(
            fee,
            moneyToNumber(bal),
          );
        }

        let treasury = await tx.wallet.findFirst({
          where: {
            stateId,
            nodeId: parsed.targetNodeId,
            type: "TREASURY",
            assetId: primaryAsset.id,
          },
          select: { id: true },
        });
        if (!treasury) {
          treasury = await tx.wallet.create({
            data: {
              stateId,
              type: "TREASURY",
              nodeId: parsed.targetNodeId,
              address: `krwn1tre${randomBytes(16).toString("hex")}`,
              currency: primaryAsset.symbol,
              assetId: primaryAsset.id,
              balance: 0,
            },
            select: { id: true },
          });
        }

        const debit = await tx.wallet.updateMany({
          where: { id: walletRow.id, balance: { gte: feeDec } },
          data: { balance: { decrement: feeDec } },
        });
        if (debit.count !== 1) {
          throw new InsufficientRolePurchaseFeeError(
            fee,
            moneyToNumber(ledgerDecimal(walletRow.balance)),
          );
        }
        await tx.wallet.update({
          where: { id: treasury.id },
          data: { balance: { increment: feeDec } },
        });

        await tx.transaction.create({
          data: {
            stateId,
            fromWalletId: walletRow.id,
            toWalletId: treasury.id,
            kind: "treasury_allocation",
            status: "completed",
            amount: feeDec,
            assetId: primaryAsset.id,
            currency: primaryAsset.symbol,
            initiatedById: cli.userId,
            metadata: {
              reason: "role_purchase",
              targetNodeId: parsed.targetNodeId,
            },
          },
        });
      }

      await tx.membership.upsert({
        where: {
          userId_nodeId: {
            userId: cli.userId,
            nodeId: parsed.targetNodeId,
          },
        },
        create: {
          userId: cli.userId,
          nodeId: parsed.targetNodeId,
          status: "active",
        },
        update: { status: "active" },
      });

      await tx.membership
        .delete({
          where: {
            userId_nodeId: { userId: cli.userId, nodeId: lobby.id },
          },
        })
        .catch(() => {});
    });

    return NextResponse.json({
      ok: true,
      targetNodeId: parsed.targetNodeId,
      feePaid: fee,
      currency: primaryAsset.symbol,
    });
  } catch (err) {
    if (err instanceof InsufficientRolePurchaseFeeError) {
      return NextResponse.json(
        {
          error: err.message,
          code: "insufficient_funds",
          required: err.required,
          available: err.available,
        },
        { status: 409 },
      );
    }
    return walletErrorResponse(err);
  }
}
