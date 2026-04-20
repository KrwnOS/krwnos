/**
 * Подписки узлов: перевод из казны дочернего узла в казну родителя.
 * Идемпотентность: `NodeSubscriptionPeriodCharge` @@unique([nodeSubscriptionId, periodKey]).
 */
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import {
  createPrismaWalletRepository,
  runLedgerTransferInTx,
} from "./repo";
import { ledgerDecimal, roundLedgerAmount } from "./money";
import { utcPeriodKeyForDate } from "./role-tax-tick";

/** Понедельник ISO-недели (UTC) как `YYYY-MM-DD` — ключ периода для WEEKLY. */
export function utcMondayWeekPeriodKey(d: Date): string {
  const x = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
  const day = (x.getUTCDay() + 6) % 7;
  x.setUTCDate(x.getUTCDate() - day);
  const y = x.getUTCFullYear();
  const m = x.getUTCMonth() + 1;
  const dd = x.getUTCDate();
  return `${y}-${String(m).padStart(2, "0")}-${String(dd).padStart(2, "0")}`;
}

export function periodKeyForSubscription(
  schedule: "MONTHLY" | "WEEKLY",
  now: Date,
): string {
  return schedule === "MONTHLY"
    ? utcPeriodKeyForDate(now)
    : utcMondayWeekPeriodKey(now);
}

export interface NodeSubscriptionTickResult {
  periodKeyMonthly: string;
  periodKeyWeekly: string;
  subscriptionsSeen: number;
  chargesCreated: number;
  skippedDuplicate: number;
  skippedInvalidHierarchy: number;
  skippedNoFunds: number;
  errors: number;
}

function isUniqueViolation(err: unknown): boolean {
  return (
    err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002"
  );
}

export async function runNodeSubscriptionTick(opts?: {
  now?: Date;
}): Promise<NodeSubscriptionTickResult> {
  const now = opts?.now ?? new Date();
  const periodKeyMonthly = utcPeriodKeyForDate(now);
  const periodKeyWeekly = utcMondayWeekPeriodKey(now);

  const result: NodeSubscriptionTickResult = {
    periodKeyMonthly,
    periodKeyWeekly,
    subscriptionsSeen: 0,
    chargesCreated: 0,
    skippedDuplicate: 0,
    skippedInvalidHierarchy: 0,
    skippedNoFunds: 0,
    errors: 0,
  };

  const subs = await prisma.nodeSubscription.findMany({
    where: { enabled: true },
    include: {
      childNode: { select: { id: true, parentId: true, stateId: true } },
      parentNode: { select: { id: true, stateId: true } },
    },
  });

  const repo = createPrismaWalletRepository(prisma);
  const ownerByState = new Map<string, string>();
  async function initiatorForState(stateId: string): Promise<string> {
    let o = ownerByState.get(stateId);
    if (!o) {
      const row = await prisma.state.findUnique({
        where: { id: stateId },
        select: { ownerId: true },
      });
      o = row?.ownerId ?? "";
      ownerByState.set(stateId, o);
    }
    return o;
  }

  for (const sub of subs) {
    result.subscriptionsSeen += 1;

    if (
      sub.childNode.parentId !== sub.parentNodeId ||
      sub.childNode.stateId !== sub.stateId ||
      sub.parentNode.stateId !== sub.stateId
    ) {
      result.skippedInvalidHierarchy += 1;
      continue;
    }

    const periodKey =
      sub.schedule === "MONTHLY" ? periodKeyMonthly : periodKeyWeekly;
    const assetId =
      sub.assetId ?? (await repo.ensurePrimaryAsset(sub.stateId)).id;
    const decimals = (await repo.findAssetById(sub.stateId, assetId))
      ?.decimals ?? 18;

    let childTreasury = await prisma.wallet.findFirst({
      where: {
        stateId: sub.stateId,
        nodeId: sub.childNodeId,
        type: "TREASURY",
        assetId,
      },
      select: { id: true, balance: true, currency: true },
    });
    if (!childTreasury) {
      const w = await repo.createTreasuryWallet({
        stateId: sub.stateId,
        nodeId: sub.childNodeId,
        assetId,
      });
      childTreasury = {
        id: w.id,
        balance: ledgerDecimal(w.balance),
        currency: w.currency,
      };
    }

    let parentTreasury = await prisma.wallet.findFirst({
      where: {
        stateId: sub.stateId,
        nodeId: sub.parentNodeId,
        type: "TREASURY",
        assetId,
      },
      select: { id: true, currency: true },
    });
    if (!parentTreasury) {
      const w = await repo.createTreasuryWallet({
        stateId: sub.stateId,
        nodeId: sub.parentNodeId,
        assetId,
      });
      parentTreasury = { id: w.id, currency: w.currency };
    }

    const rawAmount = ledgerDecimal(sub.amount);
    const balance = ledgerDecimal(childTreasury.balance);
    const pay = roundLedgerAmount(rawAmount, decimals);
    if (!pay.gt(0) || pay.gt(balance)) {
      result.skippedNoFunds += 1;
      continue;
    }

    const initiatedById = await initiatorForState(sub.stateId);
    if (!initiatedById) {
      result.errors += 1;
      continue;
    }

    try {
      const ok = await prisma.$transaction(async (tx) => {
        await tx.nodeSubscriptionPeriodCharge.create({
          data: {
            stateId: sub.stateId,
            nodeSubscriptionId: sub.id,
            periodKey,
            amount: pay,
          },
        });

        const ledger = await runLedgerTransferInTx(tx, {
          stateId: sub.stateId,
          fromWalletId: childTreasury!.id,
          toWalletId: parentTreasury!.id,
          amount: pay,
          currency: childTreasury!.currency,
          kind: "treasury_allocation",
          initiatedById,
          metadata: {
            reason: "node_subscription",
            nodeSubscriptionId: sub.id,
            periodKey,
            schedule: sub.schedule,
          },
        });

        await tx.nodeSubscriptionPeriodCharge.update({
          where: {
            nodeSubscriptionId_periodKey: {
              nodeSubscriptionId: sub.id,
              periodKey,
            },
          },
          data: { transactionId: ledger.main.id },
        });
        return true;
      });
      if (ok) result.chargesCreated += 1;
    } catch (err) {
      if (isUniqueViolation(err)) {
        result.skippedDuplicate += 1;
        continue;
      }
      if (
        err instanceof Error &&
        err.message === "insufficient_funds"
      ) {
        result.skippedNoFunds += 1;
        continue;
      }
      result.errors += 1;
    }
  }

  return result;
}
