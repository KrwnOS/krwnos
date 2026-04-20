/**
 * Штрафы с личного кошелька: указ Суверена или исполнение предложения
 * с `targetConfigKey === "walletFine"`. Идемпотентность для Парламента —
 * `WalletFine.proposalId` unique; сначала INSERT строки, затем перевод.
 */
import { Prisma } from "@prisma/client";
import { Decimal } from "@prisma/client/runtime/library";
import { prisma } from "@/lib/prisma";
import {
  createPrismaWalletRepository,
  runLedgerTransferInTx,
} from "./repo";
import { ledgerDecimal, roundLedgerAmount } from "./money";
import type { WalletAssetSummary } from "./service";

export interface WalletFinePayload {
  debtorUserId: string;
  /** Сумма в минорных единицах актива (как `Wallet.balance`). */
  amount: number;
  /** Казна этого узла получает нетто после налогов (как в обычном transfer). */
  beneficiaryNodeId: string;
}

export function parseWalletFinePayload(raw: unknown): WalletFinePayload {
  if (!raw || typeof raw !== "object") {
    throw new Error("wallet_fine_invalid_payload");
  }
  const o = raw as Record<string, unknown>;
  if (typeof o.debtorUserId !== "string" || !o.debtorUserId.trim()) {
    throw new Error("wallet_fine_invalid_debtor");
  }
  if (typeof o.beneficiaryNodeId !== "string" || !o.beneficiaryNodeId.trim()) {
    throw new Error("wallet_fine_invalid_beneficiary");
  }
  if (typeof o.amount !== "number" || !Number.isFinite(o.amount) || o.amount <= 0) {
    throw new Error("wallet_fine_invalid_amount");
  }
  return {
    debtorUserId: o.debtorUserId.trim(),
    beneficiaryNodeId: o.beneficiaryNodeId.trim(),
    amount: o.amount,
  };
}

function computeTaxSplit(
  stateId: string,
  amount: Decimal,
  asset: WalletAssetSummary | null,
  fiscal: { transactionTaxRate: number; incomeTaxRate: number } | null,
  rootTreasuryId: string | null,
  toWalletId: string,
): { toWalletId: string; amount: Decimal } | undefined {
  const assetTaxRate = asset ? asset.taxRate : 0;
  const stateTxTaxRate = fiscal ? fiscal.transactionTaxRate : 0;
  const effectiveTaxRate = Math.min(1, assetTaxRate + stateTxTaxRate);
  if (effectiveTaxRate <= 0 || !rootTreasuryId || rootTreasuryId === toWalletId) {
    return undefined;
  }
  const taxAmount = roundLedgerAmount(
    amount.times(effectiveTaxRate),
    asset?.decimals ?? 18,
  );
  if (!taxAmount.gt(0) || !taxAmount.lt(amount)) return undefined;
  return { toWalletId: rootTreasuryId, amount: taxAmount };
}

export interface ApplyWalletFineInput {
  stateId: string;
  payload: WalletFinePayload;
  source: "governance" | "decree";
  proposalId?: string | null;
  decreeByUserId?: string | null;
  /** Для аудита `Transaction.initiatedById` (исполнитель DAO / Суверен). */
  initiatedById: string;
  assetId?: string | null;
}

/**
 * Атомарно: запись штрафа + перевод PERSONAL → TREASURY(beneficiary).
 */
export async function applyWalletFine(
  input: ApplyWalletFineInput,
): Promise<{ walletFineId: string; transactionId: string }> {
  const repo = createPrismaWalletRepository(prisma);
  const assetIdResolved =
    input.assetId ??
    (await repo.ensurePrimaryAsset(input.stateId)).id;

  const payload = input.payload;
  const amountDec = ledgerDecimal(new Decimal(payload.amount));

  const beneficiaryNode = await prisma.verticalNode.findFirst({
    where: { id: payload.beneficiaryNodeId, stateId: input.stateId },
    select: { id: true },
  });
  if (!beneficiaryNode) {
    throw new Error("wallet_fine_beneficiary_not_found");
  }

  let treasury = await prisma.wallet.findFirst({
    where: {
      stateId: input.stateId,
      nodeId: payload.beneficiaryNodeId,
      type: "TREASURY",
      assetId: assetIdResolved,
    },
    select: { id: true },
  });
  if (!treasury) {
    const w = await repo.createTreasuryWallet({
      stateId: input.stateId,
      nodeId: payload.beneficiaryNodeId,
      assetId: assetIdResolved,
    });
    treasury = { id: w.id };
  }

  const personal = await prisma.wallet.findFirst({
    where: {
      stateId: input.stateId,
      userId: payload.debtorUserId,
      type: "PERSONAL",
      assetId: assetIdResolved,
    },
    select: {
      id: true,
      balance: true,
      currency: true,
      assetId: true,
      type: true,
    },
  });
  if (!personal) {
    throw new Error("wallet_fine_no_wallet");
  }

  const asset = await repo.findAssetById(input.stateId, assetIdResolved);
  const fiscal = (await repo.findStateFiscalPolicy?.(input.stateId)) ?? null;
  const rootTreasury = await repo.findRootTreasury(input.stateId, {
    assetId: assetIdResolved,
  });
  const tax = computeTaxSplit(
    input.stateId,
    amountDec,
    asset,
    fiscal,
    rootTreasury?.id ?? null,
    treasury.id,
  );

  return prisma.$transaction(async (tx) => {
    if (input.source === "governance" && input.proposalId) {
      await tx.walletFine.create({
        data: {
          stateId: input.stateId,
          debtorUserId: payload.debtorUserId,
          amount: amountDec,
          assetId: assetIdResolved,
          beneficiaryNodeId: payload.beneficiaryNodeId,
          source: "governance",
          proposalId: input.proposalId,
          transactionId: null,
          metadata: {},
        },
      });
    }

    const ledger = await runLedgerTransferInTx(tx, {
      stateId: input.stateId,
      fromWalletId: personal.id,
      toWalletId: treasury.id,
      amount: amountDec,
      currency: personal.currency,
      kind: "transfer",
      initiatedById: input.initiatedById,
      metadata: {
        reason: "wallet_fine",
        source: input.source,
        proposalId: input.proposalId ?? undefined,
        beneficiaryNodeId: payload.beneficiaryNodeId,
      },
      tax,
    });

    if (input.source === "decree" || !input.proposalId) {
      const wf = await tx.walletFine.create({
        data: {
          stateId: input.stateId,
          debtorUserId: payload.debtorUserId,
          amount: amountDec,
          assetId: assetIdResolved,
          beneficiaryNodeId: payload.beneficiaryNodeId,
          source: "decree",
          proposalId: null,
          decreeByUserId: input.decreeByUserId ?? null,
          transactionId: ledger.main.id,
          metadata: tax
            ? {
                taxAmount: tax.amount.toString(),
                taxToWalletId: tax.toWalletId,
              }
            : {},
        },
      });
      return { walletFineId: wf.id, transactionId: ledger.main.id };
    }

    const updated = await tx.walletFine.update({
      where: { proposalId: input.proposalId },
      data: {
        transactionId: ledger.main.id,
        metadata: tax
          ? {
              taxAmount: tax.amount.toString(),
              taxToWalletId: tax.toWalletId,
            }
          : {},
      },
    });
    return { walletFineId: updated.id, transactionId: ledger.main.id };
  });
}

export function isWalletFineUniqueViolation(err: unknown): boolean {
  return (
    err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002"
  );
}
