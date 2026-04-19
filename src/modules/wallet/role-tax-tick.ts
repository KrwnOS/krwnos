/**
 * Ежемесячное списание StateSettings.roleTaxRate с личных кошельков (первичный актив)
 * в корневую Казну. Идемпотентность: одна запись RoleTaxPeriodCharge на (state, user, YYYY-MM UTC).
 */
import { Prisma } from "@prisma/client";
import { Decimal } from "@prisma/client/runtime/library";
import { prisma } from "@/lib/prisma";
import {
  createPrismaWalletRepository,
  runLedgerTransferInTx,
} from "./repo";
import { ledgerDecimal, roundLedgerAmount } from "./money";

export function utcPeriodKeyForDate(d: Date): string {
  const y = d.getUTCFullYear();
  const m = d.getUTCMonth() + 1;
  return `${y}-${String(m).padStart(2, "0")}`;
}

export interface RoleTaxTickResult {
  periodKey: string;
  statesSeen: number;
  usersCharged: number;
  usersSkippedDuplicate: number;
  usersSkippedNoWalletOrFunds: number;
  errors: number;
}

function isUniqueViolation(err: unknown): boolean {
  return (
    err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002"
  );
}

export async function runRoleTaxMonthlyTick(opts?: {
  /** По умолчанию — календарный месяц UTC для `now`. */
  periodKey?: string;
  now?: Date;
}): Promise<RoleTaxTickResult> {
  const now = opts?.now ?? new Date();
  const periodKey = opts?.periodKey ?? utcPeriodKeyForDate(now);

  const result: RoleTaxTickResult = {
    periodKey,
    statesSeen: 0,
    usersCharged: 0,
    usersSkippedDuplicate: 0,
    usersSkippedNoWalletOrFunds: 0,
    errors: 0,
  };

  const settingsRows = await prisma.stateSettings.findMany({
    where: { roleTaxRate: { gt: 0 } },
    select: { stateId: true, roleTaxRate: true },
  });

  const repo = createPrismaWalletRepository(prisma);

  for (const { stateId, roleTaxRate } of settingsRows) {
    result.statesSeen += 1;

    const primary = await repo.ensurePrimaryAsset(stateId);
    const decimals = primary.decimals ?? 18;
    const rateDec = new Decimal(roleTaxRate);

    let treasury = await repo.findRootTreasury(stateId, { assetId: primary.id });
    if (!treasury) {
      const root = await prisma.verticalNode.findFirst({
        where: { stateId, parentId: null },
        orderBy: { createdAt: "asc" },
        select: { id: true },
      });
      if (root) {
        treasury = await repo.createTreasuryWallet({
          stateId,
          nodeId: root.id,
          assetId: primary.id,
        });
      }
    }
    if (!treasury) {
      continue;
    }

    const memberships = await prisma.membership.findMany({
      where: {
        status: "active",
        node: { stateId },
      },
      select: { userId: true },
    });
    const userIds = [...new Set(memberships.map((m) => m.userId))];

    for (const userId of userIds) {
      try {
        const charged = await prisma.$transaction(async (tx) => {
          const personal = await tx.wallet.findFirst({
            where: {
              stateId,
              userId,
              type: "PERSONAL",
              assetId: primary.id,
            },
            select: {
              id: true,
              balance: true,
              currency: true,
            },
          });
          if (!personal) {
            return false;
          }

          const balance = ledgerDecimal(personal.balance);
          const rawFee = balance.times(rateDec);
          const fee = roundLedgerAmount(rawFee, decimals);
          if (!fee.gt(0) || fee.gt(balance)) {
            return false;
          }

          await tx.roleTaxPeriodCharge.create({
            data: {
              stateId,
              userId,
              periodKey,
              amount: fee,
            },
          });

          const ledger = await runLedgerTransferInTx(tx, {
            stateId,
            fromWalletId: personal.id,
            toWalletId: treasury.id,
            amount: fee,
            currency: personal.currency,
            kind: "treasury_allocation",
            initiatedById: userId,
            metadata: {
              reason: "role_tax",
              roleTaxPeriod: periodKey,
              roleTaxRate,
            },
          });

          await tx.roleTaxPeriodCharge.update({
            where: {
              stateId_userId_periodKey: { stateId, userId, periodKey },
            },
            data: { transactionId: ledger.main.id },
          });
          return true;
        });
        if (charged) {
          result.usersCharged += 1;
        }
      } catch (err) {
        if (isUniqueViolation(err)) {
          result.usersSkippedDuplicate += 1;
          continue;
        }
        if (
          err instanceof Error &&
          err.message === "insufficient_funds"
        ) {
          result.usersSkippedNoWalletOrFunds += 1;
          continue;
        }
        result.errors += 1;
      }
    }
  }

  return result;
}
