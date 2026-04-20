/**
 * Автозарплата: корневая TREASURY → PERSONAL (первичный актив) для каждого
 * активного члена. Идемпотентность: `PayrollPeriodPayout` (state, user, YYYY-MM UTC).
 * Удержание `incomeTaxRate` и проводки — та же схема, что у `WalletService.transfer`
 * для `treasury_allocation` (см. `runLedgerTransferInTx` + налог в корневую Казну).
 */
import { Prisma } from "@prisma/client";
import { Decimal } from "@prisma/client/runtime/library";
import { eventBus } from "@/core";
import { prisma } from "@/lib/prisma";
import {
  createPrismaWalletRepository,
  runLedgerTransferInTx,
} from "./repo";
import {
  WALLET_EVENTS,
  type Wallet,
  type WalletTransaction,
} from "./service";
import { ledgerDecimal, roundLedgerAmount } from "./money";
import { utcPeriodKeyForDate } from "./role-tax-tick";

export interface PayrollTickResult {
  periodKey: string;
  statesSeen: number;
  usersPaid: number;
  usersSkippedDuplicate: number;
  usersSkippedNoTreasuryOrFunds: number;
  errors: number;
}

function isUniqueViolation(err: unknown): boolean {
  return (
    err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002"
  );
}

type PrismaTxRow = {
  id: string;
  stateId: string;
  fromWalletId: string | null;
  toWalletId: string | null;
  kind: "transfer" | "treasury_allocation" | "mint" | "burn";
  status: "pending" | "completed" | "failed" | "reversed";
  amount: Decimal;
  assetId: string | null;
  currency: string;
  externalTxHash: string | null;
  externalStatus: string | null;
  metadata: unknown;
  initiatedById: string;
  createdAt: Date;
};

function mapPrismaTxRow(row: PrismaTxRow): WalletTransaction {
  return {
    id: row.id,
    stateId: row.stateId,
    fromWalletId: row.fromWalletId,
    toWalletId: row.toWalletId,
    kind: row.kind,
    status: row.status,
    amount: ledgerDecimal(row.amount),
    assetId: row.assetId,
    currency: row.currency,
    externalTxHash: row.externalTxHash,
    externalStatus: row.externalStatus,
    metadata: (row.metadata as Record<string, unknown>) ?? {},
    initiatedById: row.initiatedById,
    createdAt: row.createdAt,
  };
}

function mapWalletRow(w: {
  id: string;
  stateId: string;
  type: "PERSONAL" | "TREASURY";
  userId: string | null;
  nodeId: string | null;
  address: string;
  assetId: string | null;
  externalAddress: string | null;
  lastSyncedAt: Date | null;
  lastSyncedBlock: bigint | null;
  balance: Decimal;
  currency: string;
  metadata: unknown;
  createdAt: Date;
  updatedAt: Date;
}): Wallet {
  return {
    id: w.id,
    stateId: w.stateId,
    type: w.type,
    userId: w.userId,
    nodeId: w.nodeId,
    address: w.address,
    assetId: w.assetId,
    externalAddress: w.externalAddress,
    lastSyncedAt: w.lastSyncedAt,
    lastSyncedBlock: w.lastSyncedBlock,
    balance: ledgerDecimal(w.balance),
    currency: w.currency,
    metadata: (w.metadata as Record<string, unknown>) ?? {},
    createdAt: w.createdAt,
    updatedAt: w.updatedAt,
  };
}

async function emitPayrollTransactionActivity(
  repo: ReturnType<typeof createPrismaWalletRepository>,
  stateId: string,
  main: PrismaTxRow,
  fromWallet: Wallet,
  toWallet: Wallet,
): Promise<void> {
  const transaction = mapPrismaTxRow(main);
  const recipients = new Set<string>();
  recipients.add(transaction.initiatedById);
  if (fromWallet.userId) recipients.add(fromWallet.userId);
  if (toWallet.userId) recipients.add(toWallet.userId);
  if (toWallet.nodeId) {
    const chain = await repo.walkAncestors(toWallet.nodeId);
    for (const uid of await repo.listUserIdsInNodes(chain)) {
      recipients.add(uid);
    }
  }
  if (fromWallet.nodeId) {
    const chain = await repo.walkAncestors(fromWallet.nodeId);
    for (const uid of await repo.listUserIdsInNodes(chain)) {
      recipients.add(uid);
    }
  }
  void eventBus
    .emit(WALLET_EVENTS.TransactionCreated, {
      stateId,
      transaction,
      recipientUserIds: [...recipients],
    })
    .catch(() => {});
}

export async function runPayrollPeriodicTick(opts?: {
  periodKey?: string;
  now?: Date;
}): Promise<PayrollTickResult> {
  const now = opts?.now ?? new Date();
  const periodKey = opts?.periodKey ?? utcPeriodKeyForDate(now);

  const result: PayrollTickResult = {
    periodKey,
    statesSeen: 0,
    usersPaid: 0,
    usersSkippedDuplicate: 0,
    usersSkippedNoTreasuryOrFunds: 0,
    errors: 0,
  };

  const settingsRows = await prisma.stateSettings.findMany({
    where: {
      payrollEnabled: true,
      payrollAmountPerCitizen: { gt: 0 },
    },
    select: {
      stateId: true,
      payrollAmountPerCitizen: true,
    },
  });

  const repo = createPrismaWalletRepository(prisma);

  for (const settingsRow of settingsRows) {
    const { stateId, payrollAmountPerCitizen } = settingsRow;
    result.statesSeen += 1;

    const stateRow = await prisma.state.findUnique({
      where: { id: stateId },
      select: { ownerId: true },
    });
    if (!stateRow) continue;

    const primary = await repo.ensurePrimaryAsset(stateId);
    const decimals = primary.decimals ?? 18;
    const gross = roundLedgerAmount(
      new Decimal(String(payrollAmountPerCitizen)),
      decimals,
    );
    if (!gross.gt(0)) continue;

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
    if (!treasury) continue;

    const fiscal = (await repo.findStateFiscalPolicy?.(stateId)) ?? null;
    const stateIncomeTaxRate =
      fiscal && Number.isFinite(fiscal.incomeTaxRate) ? fiscal.incomeTaxRate : 0;
    const effectiveTaxRate = Math.min(1, stateIncomeTaxRate);

    const rootTreasury = await repo.findRootTreasury(stateId, {
      assetId: primary.id,
    });

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
        let personal = await prisma.wallet.findFirst({
          where: {
            stateId,
            userId,
            type: "PERSONAL",
            assetId: primary.id,
          },
          select: { id: true },
        });
        if (!personal) {
          const created = await repo.createPersonalWallet({
            stateId,
            userId,
            assetId: primary.id,
          });
          personal = { id: created.id };
        }

        const mainRow = await prisma.$transaction(async (tx) => {
          await tx.payrollPeriodPayout.create({
            data: {
              stateId,
              userId,
              periodKey,
              amount: gross,
            },
          });

          const treasuryLive = await tx.wallet.findUnique({
            where: { id: treasury!.id },
            select: { balance: true, currency: true },
          });
          if (!treasuryLive || ledgerDecimal(treasuryLive.balance).lt(gross)) {
            throw new Error("insufficient_funds");
          }

          let tax: { toWalletId: string; amount: Decimal } | undefined;
          const metadata: Record<string, unknown> = {
            reason: "payroll",
            payrollPeriod: periodKey,
            fromType: "TREASURY",
            toType: "PERSONAL",
          };
          if (
            effectiveTaxRate > 0 &&
            rootTreasury &&
            rootTreasury.id !== personal.id
          ) {
            const taxAmount = roundLedgerAmount(
              gross.times(effectiveTaxRate),
              decimals,
            );
            if (taxAmount.gt(0) && taxAmount.lt(gross)) {
              tax = { toWalletId: rootTreasury.id, amount: taxAmount };
              metadata.stateTax = {
                rate: effectiveTaxRate,
                breakdown: {
                  asset: 0,
                  transaction: 0,
                  income: stateIncomeTaxRate,
                },
                treasuryWalletId: rootTreasury.id,
              };
            }
          }

          const leg = await runLedgerTransferInTx(tx, {
            stateId,
            fromWalletId: treasury!.id,
            toWalletId: personal.id,
            amount: gross,
            currency: treasuryLive.currency,
            kind: "treasury_allocation",
            initiatedById: stateRow.ownerId,
            metadata,
            tax,
          });

          await tx.payrollPeriodPayout.update({
            where: {
              stateId_userId_periodKey: { stateId, userId, periodKey },
            },
            data: { transactionId: leg.main.id },
          });
          return leg.main;
        });

        const [fromW, toW] = await Promise.all([
          prisma.wallet.findUniqueOrThrow({ where: { id: treasury!.id } }),
          prisma.wallet.findUniqueOrThrow({ where: { id: personal.id } }),
        ]);

        await emitPayrollTransactionActivity(
          repo,
          stateId,
          mainRow as PrismaTxRow,
          mapWalletRow(fromW),
          mapWalletRow(toW),
        );
        result.usersPaid += 1;
      } catch (err) {
        if (isUniqueViolation(err)) {
          result.usersSkippedDuplicate += 1;
          continue;
        }
        if (err instanceof Error && err.message === "insufficient_funds") {
          result.usersSkippedNoTreasuryOrFunds += 1;
          continue;
        }
        result.errors += 1;
      }
    }
  }

  return result;
}
