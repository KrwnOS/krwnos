/**
 * Prisma adapter for `ExchangeRepository`.
 * ------------------------------------------------------------
 * Lives next to `src/core/exchange.ts` because it is the only
 * thing in the kernel that physically reaches into the DB — the
 * service itself stays pure. Tests inject an in-memory fake via
 * the repository contract instead of going through this file.
 *
 * Atomicity:
 *   `executeCrossStateTransfer` runs every DB mutation (both
 *   balance updates, both per-State Transaction inserts, and the
 *   CrossStateTransaction journal row) inside a single
 *   `prisma.$transaction`. If any step fails the block rolls
 *   back and a `failed` CrossStateTransaction row is written
 *   OUTSIDE the transaction for post-mortem audit.
 */

import type { Prisma, PrismaClient } from "@prisma/client";
import type {
  CrossStateTransaction,
  ExchangeAssetRef,
  ExchangePair,
  ExchangeRepository,
  ExchangeWalletRef,
} from "./exchange";

// `PrismaClient` here may be older than the generated client that
// knows about `ExchangePair` / `CrossStateTransaction`. We therefore
// cast to a narrow, dynamic shape at the boundary — everything
// below is type-checked against our own types.
type LooseDelegate = {
  findFirst: (args: unknown) => Promise<unknown>;
  findUnique: (args: unknown) => Promise<unknown>;
  findMany: (args: unknown) => Promise<unknown[]>;
  create: (args: unknown) => Promise<unknown>;
  update: (args: unknown) => Promise<unknown>;
  upsert: (args: unknown) => Promise<unknown>;
  delete: (args: unknown) => Promise<unknown>;
};

type LooseTxClient = Record<string, LooseDelegate> & {
  $queryRaw?: unknown;
};

export function createPrismaExchangeRepository(
  prisma: PrismaClient,
): ExchangeRepository {
  const loose = prisma as unknown as {
    exchangePair: LooseDelegate;
    crossStateTransaction: LooseDelegate;
    stateAsset: LooseDelegate;
    wallet: LooseDelegate & {
      update: (args: unknown) => Promise<{
        id: string;
        balance: number;
      }>;
    };
    transaction: LooseDelegate;
    $transaction: <T>(fn: (tx: LooseTxClient) => Promise<T>) => Promise<T>;
  };

  return {
    async findPair(fromAssetId, toAssetId) {
      const row = (await loose.exchangePair.findUnique({
        where: {
          fromAssetId_toAssetId: { fromAssetId, toAssetId },
        },
      })) as PrismaExchangePairRow | null;
      return row ? mapPair(row) : null;
    },

    async findPairById(id) {
      const row = (await loose.exchangePair.findUnique({
        where: { id },
      })) as PrismaExchangePairRow | null;
      return row ? mapPair(row) : null;
    },

    async listPairs(filter = {}) {
      const direction = filter.direction ?? "both";
      const where: Record<string, unknown> = {};
      if (filter.stateId) {
        if (direction === "outbound") where.fromStateId = filter.stateId;
        else if (direction === "inbound") where.toStateId = filter.stateId;
        else
          where.OR = [
            { fromStateId: filter.stateId },
            { toStateId: filter.stateId },
          ];
      }
      const rows = (await loose.exchangePair.findMany({
        where,
        orderBy: [{ createdAt: "desc" }],
      })) as PrismaExchangePairRow[];
      return rows.map(mapPair);
    },

    async upsertPair(input) {
      const row = (await loose.exchangePair.upsert({
        where: {
          fromAssetId_toAssetId: {
            fromAssetId: input.fromAssetId,
            toAssetId: input.toAssetId,
          },
        },
        update: {
          rate: input.rate,
          isManual: input.isManual,
          enabled: input.enabled,
          createdById: input.createdById,
          metadata: input.metadata as Prisma.InputJsonValue,
          fromStateId: input.fromStateId,
          toStateId: input.toStateId,
        },
        create: {
          fromAssetId: input.fromAssetId,
          fromStateId: input.fromStateId,
          toAssetId: input.toAssetId,
          toStateId: input.toStateId,
          rate: input.rate,
          isManual: input.isManual,
          enabled: input.enabled,
          createdById: input.createdById,
          metadata: input.metadata as Prisma.InputJsonValue,
        },
      })) as PrismaExchangePairRow;
      return mapPair(row);
    },

    async setPairEnabled(pairId, enabled) {
      const row = (await loose.exchangePair.update({
        where: { id: pairId },
        data: { enabled },
      })) as PrismaExchangePairRow;
      return mapPair(row);
    },

    async deletePair(pairId) {
      await loose.exchangePair.delete({ where: { id: pairId } });
    },

    async findAssetById(assetId) {
      const row = (await loose.stateAsset.findUnique({
        where: { id: assetId },
        select: { id: true, stateId: true, symbol: true, decimals: true },
      })) as PrismaAssetRow | null;
      return row
        ? {
            id: row.id,
            stateId: row.stateId,
            symbol: row.symbol,
            decimals: row.decimals,
          }
        : null;
    },

    async findWalletById(walletId) {
      const row = (await loose.wallet.findUnique({
        where: { id: walletId },
        select: {
          id: true,
          stateId: true,
          assetId: true,
          userId: true,
          nodeId: true,
          type: true,
          balance: true,
          currency: true,
        },
      })) as PrismaWalletRow | null;
      return row ? mapWallet(row) : null;
    },

    async executeCrossStateTransfer(input) {
      try {
        const journal = await loose.$transaction(async (tx) => {
          const scoped = tx as unknown as {
            wallet: LooseDelegate & {
              update: (args: unknown) => Promise<{ id: string; balance: number }>;
              findUnique: (args: unknown) => Promise<unknown>;
            };
            transaction: LooseDelegate;
            crossStateTransaction: LooseDelegate;
          };

          // 1. Read-and-guard the source wallet — the raw `decrement`
          //    is atomic but would happily drive the balance negative;
          //    reject first.
          const src = (await scoped.wallet.findUnique({
            where: { id: input.fromWallet.id },
            select: { balance: true, currency: true },
          })) as { balance: number; currency: string } | null;
          if (!src) throw new Error("source_not_found");
          if (src.currency !== input.fromAsset.symbol) {
            throw new Error("currency_mismatch_source");
          }
          if (src.balance < input.fromAmount) {
            throw new Error("insufficient_funds");
          }
          await scoped.wallet.update({
            where: { id: input.fromWallet.id },
            data: { balance: { decrement: input.fromAmount } },
          });

          const dst = (await scoped.wallet.findUnique({
            where: { id: input.toWallet.id },
            select: { currency: true },
          })) as { currency: string } | null;
          if (!dst) throw new Error("destination_not_found");
          if (dst.currency !== input.toAsset.symbol) {
            throw new Error("currency_mismatch_destination");
          }
          await scoped.wallet.update({
            where: { id: input.toWallet.id },
            data: { balance: { increment: input.toAmount } },
          });

          // 2. Per-State audit: burn on source, mint on destination.
          const burnRow = (await scoped.transaction.create({
            data: {
              stateId: input.fromWallet.stateId,
              fromWalletId: input.fromWallet.id,
              toWalletId: null,
              amount: input.fromAmount,
              kind: "burn",
              status: "completed",
              currency: input.fromAsset.symbol,
              assetId: input.fromAsset.id,
              initiatedById: input.initiatedById,
              metadata: {
                reason: "cross_state_swap",
                pairId: input.pair.id,
                peer: {
                  stateId: input.toWallet.stateId,
                  assetId: input.toAsset.id,
                  walletId: input.toWallet.id,
                },
                ...(input.metadata ?? {}),
              } as Prisma.InputJsonValue,
            },
          })) as { id: string };

          const mintRow = (await scoped.transaction.create({
            data: {
              stateId: input.toWallet.stateId,
              fromWalletId: null,
              toWalletId: input.toWallet.id,
              amount: input.toAmount,
              kind: "mint",
              status: "completed",
              currency: input.toAsset.symbol,
              assetId: input.toAsset.id,
              initiatedById: input.initiatedById,
              metadata: {
                reason: "cross_state_swap",
                pairId: input.pair.id,
                peer: {
                  stateId: input.fromWallet.stateId,
                  assetId: input.fromAsset.id,
                  walletId: input.fromWallet.id,
                },
                ...(input.metadata ?? {}),
              } as Prisma.InputJsonValue,
            },
          })) as { id: string };

          // 3. Global KrwnOS journal.
          const journal = (await scoped.crossStateTransaction.create({
            data: {
              pairId: input.pair.id,
              fromStateId: input.fromWallet.stateId,
              fromAssetId: input.fromAsset.id,
              fromWalletId: input.fromWallet.id,
              fromTransactionId: burnRow.id,
              toStateId: input.toWallet.stateId,
              toAssetId: input.toAsset.id,
              toWalletId: input.toWallet.id,
              toTransactionId: mintRow.id,
              fromAmount: input.fromAmount,
              toAmount: input.toAmount,
              rate: input.pair.rate,
              status: "completed",
              initiatedById: input.initiatedById,
              metadata: (input.metadata ?? {}) as Prisma.InputJsonValue,
            },
          })) as PrismaCrossStateTxRow;

          return journal;
        });
        return mapCrossStateTx(journal);
      } catch (err) {
        // Post-mortem audit row. Intentionally outside the rolled-back
        // transaction so the operator can see a trail even when
        // the money never moved.
        const reason = err instanceof Error ? err.message : String(err);
        const failed = (await loose.crossStateTransaction.create({
          data: {
            pairId: input.pair.id,
            fromStateId: input.fromWallet.stateId,
            fromAssetId: input.fromAsset.id,
            fromWalletId: input.fromWallet.id,
            toStateId: input.toWallet.stateId,
            toAssetId: input.toAsset.id,
            toWalletId: input.toWallet.id,
            fromAmount: input.fromAmount,
            toAmount: input.toAmount,
            rate: input.pair.rate,
            status: "failed",
            initiatedById: input.initiatedById,
            metadata: {
              ...(input.metadata ?? {}),
              error: reason,
            } as Prisma.InputJsonValue,
          },
        })) as PrismaCrossStateTxRow;
        if (reason === "insufficient_funds") {
          throw Object.assign(new Error("insufficient_funds"), {
            code: "insufficient_funds",
            transaction: mapCrossStateTx(failed),
          });
        }
        if (
          reason === "currency_mismatch_source" ||
          reason === "currency_mismatch_destination"
        ) {
          throw Object.assign(new Error("currency_mismatch"), {
            code: "currency_mismatch",
            transaction: mapCrossStateTx(failed),
          });
        }
        throw err;
      }
    },

    async listCrossStateTransactions(filter) {
      const where: Record<string, unknown> = {};
      if (filter.stateId) {
        where.OR = [
          { fromStateId: filter.stateId },
          { toStateId: filter.stateId },
        ];
      }
      if (filter.pairId) where.pairId = filter.pairId;
      if (filter.initiatedById) where.initiatedById = filter.initiatedById;
      if (filter.before) where.createdAt = { lt: filter.before };

      const rows = (await loose.crossStateTransaction.findMany({
        where,
        orderBy: { createdAt: "desc" },
        take: clampLimit(filter.limit),
      })) as PrismaCrossStateTxRow[];
      return rows.map(mapCrossStateTx);
    },
  };
}

// ------------------------------------------------------------
// Row mappers
// ------------------------------------------------------------

type PrismaExchangePairRow = {
  id: string;
  fromAssetId: string;
  fromStateId: string;
  toAssetId: string;
  toStateId: string;
  rate: number;
  isManual: boolean;
  enabled: boolean;
  createdById: string;
  metadata: unknown;
  createdAt: Date;
  updatedAt: Date;
};

type PrismaCrossStateTxRow = {
  id: string;
  pairId: string | null;
  fromStateId: string;
  fromAssetId: string;
  fromWalletId: string;
  fromTransactionId: string | null;
  toStateId: string;
  toAssetId: string;
  toWalletId: string;
  toTransactionId: string | null;
  fromAmount: number;
  toAmount: number;
  rate: number;
  status: "pending" | "completed" | "failed" | "reversed";
  initiatedById: string;
  metadata: unknown;
  createdAt: Date;
};

type PrismaAssetRow = {
  id: string;
  stateId: string;
  symbol: string;
  decimals: number;
};

type PrismaWalletRow = {
  id: string;
  stateId: string;
  assetId: string | null;
  userId: string | null;
  nodeId: string | null;
  type: "PERSONAL" | "TREASURY";
  balance: number;
  currency: string;
};

function mapPair(row: PrismaExchangePairRow): ExchangePair {
  return {
    id: row.id,
    fromAssetId: row.fromAssetId,
    fromStateId: row.fromStateId,
    toAssetId: row.toAssetId,
    toStateId: row.toStateId,
    rate: row.rate,
    isManual: row.isManual,
    enabled: row.enabled,
    createdById: row.createdById,
    metadata: (row.metadata as Record<string, unknown>) ?? {},
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

function mapCrossStateTx(row: PrismaCrossStateTxRow): CrossStateTransaction {
  return {
    id: row.id,
    pairId: row.pairId,
    fromStateId: row.fromStateId,
    fromAssetId: row.fromAssetId,
    fromWalletId: row.fromWalletId,
    fromTransactionId: row.fromTransactionId,
    toStateId: row.toStateId,
    toAssetId: row.toAssetId,
    toWalletId: row.toWalletId,
    toTransactionId: row.toTransactionId,
    fromAmount: row.fromAmount,
    toAmount: row.toAmount,
    rate: row.rate,
    status: row.status,
    initiatedById: row.initiatedById,
    metadata: (row.metadata as Record<string, unknown>) ?? {},
    createdAt: row.createdAt,
  };
}

function mapWallet(row: PrismaWalletRow): ExchangeWalletRef {
  return {
    id: row.id,
    stateId: row.stateId,
    assetId: row.assetId,
    userId: row.userId,
    nodeId: row.nodeId,
    type: row.type,
    balance: row.balance,
    currency: row.currency,
  };
}

function clampLimit(n: number | undefined): number {
  if (!n || n <= 0) return 50;
  return Math.min(n, 200);
}

// Keep the declared ref in use so TS does not complain about an
// unused import — `ExchangeAssetRef` is re-exported for clarity
// even though it is only constructed inline in `findAssetById`.
export type { ExchangeAssetRef };
