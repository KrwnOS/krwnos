/**
 * Scheduled task: promote active memberships to `autoPromotionTargetNodeId`
 * when StateSettings thresholds are met (primary-asset balance + tenure).
 */
import { WalletType } from "@prisma/client";
import { Decimal } from "@prisma/client/runtime/library";
import { shouldPromoteMembershipForAutoPromotion } from "@/core/auto-promotion";
import { prisma } from "@/lib/prisma";

export async function runAutoPromotionTick(): Promise<{
  promoted: number;
  statesScanned: number;
}> {
  const settingsRows = await prisma.stateSettings.findMany({
    where: {
      autoPromotionEnabled: true,
      autoPromotionTargetNodeId: { not: null },
    },
  });

  const now = new Date();
  let promoted = 0;

  for (const settings of settingsRows) {
    const targetId = settings.autoPromotionTargetNodeId;
    if (!targetId) continue;

    const targetNode = await prisma.verticalNode.findFirst({
      where: { id: targetId, stateId: settings.stateId },
      select: { id: true },
    });
    if (!targetNode) {
      continue;
    }

    const needsBalance =
      settings.autoPromotionMinBalance !== null &&
      settings.autoPromotionMinBalance !== undefined;

    const primaryAsset = needsBalance
      ? await prisma.stateAsset.findFirst({
          where: { stateId: settings.stateId, isPrimary: true },
          select: { id: true },
        })
      : null;

    if (needsBalance && !primaryAsset) {
      continue;
    }

    const assetId = primaryAsset?.id ?? null;

    const candidates = await prisma.membership.findMany({
      where: {
        status: "active",
        nodeId: { not: targetId },
        node: { stateId: settings.stateId },
      },
      select: {
        id: true,
        userId: true,
        createdAt: true,
      },
    });

    if (candidates.length === 0) continue;

    const userIds = [...new Set(candidates.map((c) => c.userId))];

    const [wallets, alreadyOnTarget] = await Promise.all([
      assetId
        ? prisma.wallet.findMany({
            where: {
              stateId: settings.stateId,
              type: WalletType.PERSONAL,
              assetId,
              userId: { in: userIds },
            },
            select: { userId: true, balance: true },
          })
        : Promise.resolve([] as { userId: string; balance: Decimal }[]),
      prisma.membership.findMany({
        where: {
          nodeId: targetId,
          userId: { in: userIds },
        },
        select: { userId: true },
      }),
    ]);

    const balanceByUser = new Map<string, Decimal>();
    for (const w of wallets) {
      if (w.userId) {
        balanceByUser.set(w.userId, w.balance);
      }
    }

    const onTarget = new Set(alreadyOnTarget.map((m) => m.userId));

    for (const row of candidates) {
      if (onTarget.has(row.userId)) {
        continue;
      }

      const primaryBalance = assetId
        ? (balanceByUser.get(row.userId) ?? new Decimal(0))
        : new Decimal(0);

      if (
        !shouldPromoteMembershipForAutoPromotion({
          minBalance: settings.autoPromotionMinBalance,
          minDays: settings.autoPromotionMinDays,
          primaryBalance,
          membershipCreatedAt: row.createdAt,
          now,
        })
      ) {
        continue;
      }

      await prisma.membership.update({
        where: { id: row.id },
        data: { nodeId: targetId },
      });
      onTarget.add(row.userId);
      promoted += 1;
    }
  }

  return { promoted, statesScanned: settingsRows.length };
}
