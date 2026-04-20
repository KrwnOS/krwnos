/**
 * POST /api/state/emigrate
 *
 * Leaves the State (all memberships removed). Applies `exitRefundRate` from
 * StateSettings: `kept = balance × rate` stays on the personal wallet; the
 * remainder is credited to the root treasury in one atomic transfer (no extra
 * transaction tax — constitutional exit, same class as citizenship fee).
 *
 * Revokes all CLI tokens scoped to this State for the user so access ends
 * with citizenship.
 *
 * The Sovereign cannot emigrate while owning the State.
 */

import { randomBytes } from "node:crypto";
import { NextResponse, type NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { splitEmigrationAmounts } from "@/lib/state-citizen";
import { ledgerDecimal, moneyToNumber } from "@/modules/wallet/money";
import { authenticateCli } from "../../cli/auth";
import { walletErrorResponse } from "../../wallet/_context";

export const dynamic = "force-dynamic";

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

    const state = await prisma.state.findUnique({
      where: { id: stateId },
      select: { ownerId: true },
    });
    if (!state) {
      return NextResponse.json({ error: "State not found.", code: "not_found" }, { status: 404 });
    }
    if (state.ownerId === cli.userId) {
      return NextResponse.json(
        {
          error:
            "The Sovereign cannot emigrate. Transfer ownership of the State first.",
          code: "sovereign_cannot_emigrate",
        },
        { status: 403 },
      );
    }

    const membershipCount = await prisma.membership.count({
      where: { userId: cli.userId, node: { stateId } },
    });
    if (membershipCount === 0) {
      return NextResponse.json(
        { error: "You have no membership in this State.", code: "no_membership" },
        { status: 400 },
      );
    }

    const settings = await prisma.stateSettings.findUnique({
      where: { stateId },
      select: { exitRefundRate: true },
    });
    const exitRefundRate = settings?.exitRefundRate ?? 0;

    const primaryAsset = await prisma.stateAsset.findFirst({
      where: { stateId, isPrimary: true },
      select: { id: true, symbol: true, decimals: true },
    });
    if (!primaryAsset) {
      return NextResponse.json(
        { error: "State has no primary currency; cannot settle balances.", code: "no_primary_asset" },
        { status: 409 },
      );
    }

    const result = await prisma.$transaction(async (tx) => {
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

      const balanceNum = moneyToNumber(ledgerDecimal(walletRow.balance));
      const { kept, forfeit } = splitEmigrationAmounts(
        balanceNum,
        exitRefundRate,
        primaryAsset.decimals,
      );

      const rootNode = await tx.verticalNode.findFirst({
        where: { stateId, parentId: null },
        orderBy: { createdAt: "asc" },
        select: { id: true },
      });
      if (!rootNode) {
        throw new Error("State has no root node; cannot route emigration forfeit.");
      }

      let treasury = await tx.wallet.findFirst({
        where: {
          stateId,
          nodeId: rootNode.id,
          type: "TREASURY",
          assetId: primaryAsset.id,
        },
        select: { id: true },
      });
      if (!treasury && forfeit > 0) {
        treasury = await tx.wallet.create({
          data: {
            stateId,
            type: "TREASURY",
            nodeId: rootNode.id,
            address: `krwn1tre${randomBytes(16).toString("hex")}`,
            currency: primaryAsset.symbol,
            assetId: primaryAsset.id,
            balance: 0,
          },
          select: { id: true },
        });
      }

      if (forfeit > 0 && treasury) {
        const forfeitDec = ledgerDecimal(forfeit);
        const debit = await tx.wallet.updateMany({
          where: { id: walletRow.id, balance: { gte: forfeitDec } },
          data: { balance: { decrement: forfeitDec } },
        });
        if (debit.count !== 1) {
          throw new Error("insufficient_funds");
        }
        await tx.wallet.update({
          where: { id: treasury.id },
          data: { balance: { increment: forfeitDec } },
        });
        await tx.transaction.create({
          data: {
            stateId,
            fromWalletId: walletRow.id,
            toWalletId: treasury.id,
            kind: "treasury_allocation",
            status: "completed",
            amount: forfeitDec,
            assetId: primaryAsset.id,
            currency: primaryAsset.symbol,
            initiatedById: cli.userId,
            metadata: {
              reason: "emigration_forfeit",
              exitRefundRate,
              kept,
              forfeit,
            },
          },
        });
      }

      await tx.membership.deleteMany({
        where: { userId: cli.userId, node: { stateId } },
      });

      await tx.cliToken.updateMany({
        where: { userId: cli.userId, stateId, revokedAt: null },
        data: { revokedAt: new Date() },
      });

      return {
        exitRefundRate,
        balanceBefore: balanceNum,
        kept,
        forfeit,
        currency: primaryAsset.symbol,
      };
    });

    return NextResponse.json({ ok: true, ...result });
  } catch (err) {
    if (err instanceof Error && err.message === "insufficient_funds") {
      return NextResponse.json(
        { error: "Insufficient balance to complete emigration split.", code: "insufficient_funds" },
        { status: 409 },
      );
    }
    return walletErrorResponse(err);
  }
}
