/**
 * Prisma adapter for `WalletRepository`.
 * ------------------------------------------------------------
 * The `WalletService` never imports Prisma directly. This file is
 * the only bridge between the module and the database — swap it
 * out in unit tests for an in-memory fake.
 *
 * Atomicity:
 *   `executeTransfer` runs inside a single `prisma.$transaction`.
 *   Balances are updated with conditional `update` calls; a
 *   negative post-balance on the source wallet raises, which
 *   rolls back the whole block and marks the transaction row
 *   `failed` outside the transaction.
 */

import { randomBytes } from "node:crypto";
import type { PrismaClient, Prisma } from "@prisma/client";
import type { Decimal } from "@prisma/client/runtime/library";
import type {
  Wallet,
  WalletAssetSummary,
  WalletRepository,
  WalletTransaction,
  TransactionKind,
  TransactionStatus,
} from "./service";
import { ledgerDecimal } from "./money";
import { DEFAULT_CURRENCY } from "./service";
import type {
  CurrencyFactoryRepository,
  StateAsset,
  StateAssetMode,
  StateAssetType,
} from "./settings";

export function createPrismaWalletRepository(
  prisma: PrismaClient,
): WalletRepository {
  // `StateAsset` is part of the schema but may not be present on
  // older generated clients — we go through a narrow cast so this
  // file still builds before `prisma generate` is re-run.
  const assetClient = (prisma as unknown as {
    stateAsset: {
      findFirst: (args: unknown) => Promise<PrismaStateAssetRow | null>;
      create: (args: unknown) => Promise<PrismaStateAssetRow>;
      update: (args: unknown) => Promise<PrismaStateAssetRow>;
      updateMany: (args: unknown) => Promise<{ count: number }>;
    };
  }).stateAsset;

  /**
   * Resolve (or lazy-create) the State's primary StateAsset.
   * Ensures every wallet row gets a non-null assetId.
   */
  async function ensurePrimaryAsset(stateId: string): Promise<WalletAssetSummary> {
    const primary = await assetClient.findFirst({
      where: { stateId, isPrimary: true },
    });
    if (primary) return mapAssetSummary(primary);

    const any = await assetClient.findFirst({
      where: { stateId },
      orderBy: { createdAt: "asc" },
    });
    if (any) {
      await assetClient.updateMany({
        where: { stateId, isPrimary: true },
        data: { isPrimary: false },
      });
      const promoted = await assetClient.update({
        where: { id: any.id },
        data: { isPrimary: true },
      });
      return mapAssetSummary(promoted);
    }

    // Fresh State → seed a Local Ledger "KRN".
    const seeded = await assetClient.create({
      data: {
        stateId,
        symbol: DEFAULT_CURRENCY,
        name: "Krona",
        type: "INTERNAL",
        mode: "LOCAL",
        decimals: 18,
        isPrimary: true,
        icon: "⚜",
        color: "#C9A227",
        metadata: { seed: true } as Prisma.InputJsonValue,
      },
    });
    return mapAssetSummary(seeded);
  }

  async function findAssetById(
    stateId: string,
    assetId: string,
  ): Promise<WalletAssetSummary | null> {
    const row = await assetClient.findFirst({
      where: { id: assetId, stateId },
    });
    return row ? mapAssetSummary(row) : null;
  }

  return {
    ensurePrimaryAsset,
    findAssetById,

    async findPersonalWallet(stateId, userId, opts) {
      const row = await prisma.wallet.findFirst({
        where: {
          stateId,
          userId,
          type: "PERSONAL",
          ...(opts?.assetId !== undefined
            ? { assetId: opts.assetId }
            : {}),
        },
      });
      return row ? mapWallet(row) : null;
    },

    async findTreasuryWallet(nodeId) {
      const row = await prisma.wallet.findUnique({ where: { nodeId } });
      return row ? mapWallet(row) : null;
    },

    async findWalletById(walletId) {
      const row = await prisma.wallet.findUnique({ where: { id: walletId } });
      return row ? mapWallet(row) : null;
    },

    async listWalletsForUser(stateId, userId) {
      const rows = await prisma.wallet.findMany({
        where: { stateId, userId },
      });
      return rows.map(mapWallet);
    },

    async listTreasuriesForState(stateId) {
      const rows = await prisma.wallet.findMany({
        where: { stateId, type: "TREASURY" },
        orderBy: { createdAt: "asc" },
      });
      return rows.map(mapWallet);
    },

    async findRootTreasury(stateId, opts) {
      const root = await prisma.verticalNode.findFirst({
        where: { stateId, parentId: null },
        orderBy: { createdAt: "asc" },
        select: { id: true },
      });
      if (!root) return null;
      const row = await prisma.wallet.findFirst({
        where: {
          stateId,
          nodeId: root.id,
          type: "TREASURY",
          ...(opts?.assetId ? { assetId: opts.assetId } : {}),
        },
      });
      return row ? mapWallet(row) : null;
    },

    async listOnChainTreasuries(opts) {
      // Narrow cast — include StateAsset in Prisma filter even if
      // the generated client doesn't know the relation yet.
      const rows = await (prisma.wallet.findMany as unknown as (
        args: unknown,
      ) => Promise<PrismaWalletRow[]>)({
        where: {
          type: "TREASURY",
          externalAddress: { not: null },
          asset: {
            type: "ON_CHAIN",
          },
          ...(opts?.stateId ? { stateId: opts.stateId } : {}),
        },
      });
      return rows.map(mapWallet);
    },

    async createPersonalWallet({ stateId, userId, assetId, externalAddress }) {
      const asset = assetId
        ? await findAssetById(stateId, assetId)
        : await ensurePrimaryAsset(stateId);
      if (!asset) {
        throw new Error(`Asset "${assetId}" not found for state "${stateId}".`);
      }
      const row = await prisma.wallet.create({
        data: {
          stateId,
          type: "PERSONAL",
          userId,
          address: generateAddress("usr"),
          currency: asset.symbol,
          assetId: asset.id,
          externalAddress: externalAddress ?? null,
        },
      });
      return mapWallet(row);
    },

    async createTreasuryWallet({ stateId, nodeId, assetId, externalAddress }) {
      const asset = assetId
        ? await findAssetById(stateId, assetId)
        : await ensurePrimaryAsset(stateId);
      if (!asset) {
        throw new Error(`Asset "${assetId}" not found for state "${stateId}".`);
      }
      const row = await prisma.wallet.create({
        data: {
          stateId,
          type: "TREASURY",
          nodeId,
          address: generateAddress("tre"),
          currency: asset.symbol,
          assetId: asset.id,
          externalAddress: externalAddress ?? null,
        },
      });
      return mapWallet(row);
    },

    async updateWalletSyncedBalance(walletId, args) {
      const row = await prisma.wallet.update({
        where: { id: walletId },
        data: {
          balance: args.balance,
          lastSyncedAt: args.lastSyncedAt,
          lastSyncedBlock: args.lastSyncedBlock,
        },
      });
      return mapWallet(row);
    },

    async setExternalAddress(walletId, address) {
      const row = await prisma.wallet.update({
        where: { id: walletId },
        data: { externalAddress: address },
      });
      return mapWallet(row);
    },

    async executeTransfer(input) {
      return executeTransferTx(prisma, input);
    },

    async createPendingOnChainTransaction(input) {
      const row = await prisma.transaction.create({
        data: {
          stateId: input.stateId,
          fromWalletId: input.fromWalletId,
          toWalletId: input.toWalletId,
          amount: input.amount,
          kind: "transfer",
          status: "pending",
          currency: input.currency,
          assetId: input.assetId,
          initiatedById: input.initiatedById,
          externalStatus: "intent_prepared",
          metadata: input.intentPayload as Prisma.InputJsonValue,
        },
      });
      return mapTransaction(row);
    },

    async attachOnChainHash(transactionId, { externalTxHash, externalStatus }) {
      const row = await prisma.transaction.update({
        where: { id: transactionId },
        data: { externalTxHash, externalStatus },
      });
      return mapTransaction(row);
    },

    async settleOnChainTransaction(transactionId, { status, externalStatus }) {
      const row = await prisma.transaction.update({
        where: { id: transactionId },
        data: { status, externalStatus },
      });
      return mapTransaction(row);
    },

    async listTransactionsForWallet(walletId, { limit, before }) {
      const rows = await prisma.transaction.findMany({
        where: {
          OR: [{ fromWalletId: walletId }, { toWalletId: walletId }],
          ...(before ? { createdAt: { lt: before } } : {}),
        },
        orderBy: { createdAt: "desc" },
        take: limit,
      });
      return rows.map(mapTransaction);
    },

    async listUserIdsInNodes(nodeIds) {
      if (nodeIds.length === 0) return [];
      const rows = await prisma.membership.findMany({
        where: { nodeId: { in: nodeIds }, status: "active" },
        select: { userId: true },
      });
      return [...new Set(rows.map((r) => r.userId))];
    },

    async walkAncestors(nodeId) {
      const chain: string[] = [];
      const visited = new Set<string>();
      let cursor: string | null = nodeId;
      while (cursor && !visited.has(cursor)) {
        visited.add(cursor);
        chain.push(cursor);
        const row: { parentId: string | null } | null =
          await prisma.verticalNode.findUnique({
            where: { id: cursor },
            select: { parentId: true },
          });
        cursor = row?.parentId ?? null;
      }
      return chain;
    },

    async findStateFiscalPolicy(stateId) {
      // Lazy reach — узкий каст, чтобы не зависеть от генерации
      // Prisma-клиента во время этого файла. Любая ошибка чтения
      // (например, если миграция `state_settings` ещё не накатана)
      // тихо превращается в «налогов нет» — поведение до Палаты
      // Указов.
      try {
        const row = await (
          prisma as unknown as {
            stateSettings: {
              findUnique: (args: unknown) => Promise<{
                transactionTaxRate: number;
                incomeTaxRate: number;
              } | null>;
            };
          }
        ).stateSettings.findUnique({
          where: { stateId },
          select: { transactionTaxRate: true, incomeTaxRate: true },
        });
        if (!row) return null;
        return {
          transactionTaxRate: row.transactionTaxRate ?? 0,
          incomeTaxRate: row.incomeTaxRate ?? 0,
        };
      } catch {
        return null;
      }
    },
  };
}

function mapAssetSummary(row: PrismaStateAssetRow): WalletAssetSummary {
  return {
    id: row.id,
    stateId: row.stateId,
    symbol: row.symbol,
    type: row.type,
    mode: row.mode,
    decimals: row.decimals,
    contractAddress: row.contractAddress,
    network: row.network,
    chainId: row.chainId,
    canMint: row.canMint ?? true,
    taxRate: row.taxRate ?? 0,
    publicSupply: row.publicSupply ?? false,
  };
}

// ------------------------------------------------------------
// Transfer primitive
// ------------------------------------------------------------

/** Prisma interactive transaction client (or full client) for ledger writes only. */
export type WalletLedgerTx = Pick<PrismaClient, "wallet" | "transaction">;

export type LedgerTransferInput = {
  stateId: string;
  fromWalletId: string | null;
  toWalletId: string | null;
  amount: Decimal;
  currency: string;
  kind: TransactionKind;
  initiatedById: string;
  metadata: Record<string, unknown>;
  tax?: { toWalletId: string; amount: Decimal };
};

/**
 * Double-entry transfer inside an existing Prisma transaction (no nested `$transaction`).
 */
export async function runLedgerTransferInTx(
  tx: WalletLedgerTx,
  input: LedgerTransferInput,
): Promise<{
  main: PrismaTransactionRow;
  tax: PrismaTransactionRow | null;
  resolvedAssetId: string | null;
}> {
  const {
    stateId,
    fromWalletId,
    toWalletId,
    amount,
    currency,
    kind,
    initiatedById,
  } = input;

  const tax = input.tax ?? null;
  if (tax) {
    if (!fromWalletId) {
      throw new Error("tax_requires_source_wallet");
    }
    if (!toWalletId) {
      throw new Error("tax_requires_destination_wallet");
    }
    if (tax.amount.isNeg() || !tax.amount.isFinite()) {
      throw new Error("tax_amount_invalid");
    }
    if (tax.amount.gt(amount)) {
      throw new Error("tax_exceeds_amount");
    }
    if (tax.toWalletId === fromWalletId || tax.toWalletId === toWalletId) {
      throw new Error("tax_wallet_collision");
    }
  }

  let resolvedAssetId: string | null = null;

  if (fromWalletId) {
    const src = await tx.wallet.findUnique({
      where: { id: fromWalletId },
      select: { balance: true, currency: true, assetId: true },
    });
    if (!src) throw new Error("source_not_found");
    if (src.currency !== currency) throw new Error("currency_mismatch");
    if (ledgerDecimal(src.balance).lt(amount)) {
      throw new Error("insufficient_funds");
    }
    resolvedAssetId = src.assetId ?? null;
    const debited = await tx.wallet.updateMany({
      where: {
        id: fromWalletId,
        currency,
        balance: { gte: amount },
      },
      data: { balance: { decrement: amount } },
    });
    if (debited.count !== 1) {
      throw new Error("insufficient_funds");
    }
  }

  const netToDest = tax ? amount.minus(tax.amount) : amount;

  if (toWalletId) {
    const dst = await tx.wallet.findUnique({
      where: { id: toWalletId },
      select: { currency: true, assetId: true },
    });
    if (!dst) throw new Error("destination_not_found");
    if (dst.currency !== currency) throw new Error("currency_mismatch");
    resolvedAssetId = resolvedAssetId ?? dst.assetId ?? null;
    if (netToDest.gt(0)) {
      await tx.wallet.update({
        where: { id: toWalletId },
        data: { balance: { increment: netToDest } },
      });
    }
  }

  let taxCredit = null as { id: string } | null;
  if (tax) {
    const taxWallet = await tx.wallet.findUnique({
      where: { id: tax.toWalletId },
      select: { currency: true, assetId: true, type: true },
    });
    if (!taxWallet) throw new Error("tax_destination_not_found");
    if (taxWallet.currency !== currency) throw new Error("currency_mismatch");
    if (taxWallet.type !== "TREASURY") throw new Error("tax_not_treasury");
    if (tax.amount.gt(0)) {
      await tx.wallet.update({
        where: { id: tax.toWalletId },
        data: { balance: { increment: tax.amount } },
      });
    }
    taxCredit = { id: tax.toWalletId };
  }

  const mainRow = await tx.transaction.create({
    data: {
      stateId,
      fromWalletId,
      toWalletId,
      amount: netToDest,
      currency,
      assetId: resolvedAssetId,
      kind,
      status: "completed",
      initiatedById,
      metadata: {
        ...(input.metadata ?? {}),
        ...(tax
          ? {
              grossAmount: amount,
              taxAmount: tax.amount,
              taxWalletId: tax.toWalletId,
            }
          : {}),
      } as Prisma.InputJsonValue,
    },
  });

  let taxRow: PrismaTransactionRow | null = null;
  if (tax && taxCredit) {
    taxRow = await tx.transaction.create({
      data: {
        stateId,
        fromWalletId,
        toWalletId: taxCredit.id,
        amount: tax.amount,
        currency,
        assetId: resolvedAssetId,
        kind: "treasury_allocation",
        status: "completed",
        initiatedById,
        metadata: {
          taxOf: mainRow.id,
          reason: "state_tax",
        } as Prisma.InputJsonValue,
      },
    });
  }

  return { main: mainRow, tax: taxRow, resolvedAssetId };
}

async function executeTransferTx(
  prisma: PrismaClient,
  input: LedgerTransferInput,
): Promise<WalletTransaction & { tax?: WalletTransaction }> {
  const {
    stateId,
    fromWalletId,
    toWalletId,
    amount,
    currency,
    kind,
    initiatedById,
  } = input;

  let resolvedAssetId: string | null = null;
  try {
    const result = await prisma.$transaction(async (tx) => {
      const r = await runLedgerTransferInTx(tx, input);
      resolvedAssetId = r.resolvedAssetId;
      return r;
    });
    const mapped = mapTransaction(result.main);
    return result.tax
      ? Object.assign(mapped, { tax: mapTransaction(result.tax) })
      : mapped;
  } catch (err) {
    const reason = err instanceof Error ? err.message : String(err);
    const failed = await prisma.transaction.create({
      data: {
        stateId,
        fromWalletId,
        toWalletId,
        amount,
        currency,
        assetId: resolvedAssetId,
        kind,
        status: "failed",
        initiatedById,
        metadata: {
          ...(input.metadata ?? {}),
          error: reason,
        } as Prisma.InputJsonValue,
      },
    });
    const mapped = mapTransaction(failed);
    if (reason === "insufficient_funds") {
      throw Object.assign(new Error("insufficient_funds"), {
        code: "insufficient_funds",
        transaction: mapped,
      });
    }
    if (reason === "currency_mismatch") {
      throw Object.assign(new Error("currency_mismatch"), {
        code: "currency_mismatch",
        transaction: mapped,
      });
    }
    throw err;
  }
}

// ------------------------------------------------------------
// Row mappers
// ------------------------------------------------------------

type PrismaWalletRow = {
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
};

type PrismaTransactionRow = {
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

function mapWallet(row: PrismaWalletRow): Wallet {
  return {
    id: row.id,
    stateId: row.stateId,
    type: row.type,
    userId: row.userId,
    nodeId: row.nodeId,
    address: row.address,
    assetId: row.assetId,
    externalAddress: row.externalAddress,
    lastSyncedAt: row.lastSyncedAt,
    lastSyncedBlock: row.lastSyncedBlock,
    balance: row.balance,
    currency: row.currency,
    metadata: (row.metadata as Record<string, unknown>) ?? {},
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

function mapTransaction(row: PrismaTransactionRow): WalletTransaction {
  return {
    id: row.id,
    stateId: row.stateId,
    fromWalletId: row.fromWalletId,
    toWalletId: row.toWalletId,
    kind: row.kind,
    status: row.status,
    amount: row.amount,
    assetId: row.assetId,
    currency: row.currency,
    externalTxHash: row.externalTxHash,
    externalStatus: row.externalStatus,
    metadata: (row.metadata as Record<string, unknown>) ?? {},
    initiatedById: row.initiatedById,
    createdAt: row.createdAt,
  };
}

function generateAddress(prefix: "usr" | "tre"): string {
  // Internal ledger address — not an EVM / Solana key. The `krwn1`
  // prefix makes it easy to eyeball in logs and cannot collide with
  // real blockchain addresses.
  const body = randomBytes(16).toString("hex");
  return `krwn1${prefix}${body}`;
}

// ------------------------------------------------------------
// Currency Factory adapter
// ------------------------------------------------------------

type PrismaStateAssetRow = {
  id: string;
  stateId: string;
  symbol: string;
  name: string;
  type: StateAssetType;
  mode: StateAssetMode;
  contractAddress: string | null;
  network: string | null;
  chainId: number | null;
  decimals: number;
  exchangeRate: number | null;
  icon: string | null;
  color: string | null;
  isPrimary: boolean;
  canMint: boolean;
  taxRate: number;
  publicSupply: boolean;
  metadata: unknown;
  createdAt: Date;
  updatedAt: Date;
};

function mapAsset(row: PrismaStateAssetRow): StateAsset {
  return {
    id: row.id,
    stateId: row.stateId,
    symbol: row.symbol,
    name: row.name,
    type: row.type,
    mode: row.mode,
    contractAddress: row.contractAddress,
    network: row.network,
    chainId: row.chainId,
    decimals: row.decimals,
    exchangeRate: row.exchangeRate,
    icon: row.icon,
    color: row.color,
    isPrimary: row.isPrimary,
    // `canMint` / `taxRate` / `publicSupply` default-forgiving:
    // older rows predating the Currency Factory migration may
    // come back without these columns set — fall back to the
    // documented defaults (mint ON, no tax, private supply).
    canMint: row.canMint ?? true,
    taxRate: row.taxRate ?? 0,
    publicSupply: row.publicSupply ?? false,
    metadata: (row.metadata as Record<string, unknown>) ?? {},
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

/**
 * Prisma adapter for `CurrencyFactoryRepository`. `setPrimaryAsset`
 * runs inside `$transaction` so the "at most one primary per State"
 * invariant is never observed as violated by a concurrent reader.
 */
export function createPrismaCurrencyFactoryRepository(
  prisma: PrismaClient,
): CurrencyFactoryRepository {
  // `StateAsset` isn't part of the older generated client yet; we
  // reach for it via `any` at the boundary so this file still type-
  // checks before `prisma generate` is re-run.
  const client = prisma as unknown as {
    stateAsset: {
      findMany: (args: unknown) => Promise<PrismaStateAssetRow[]>;
      findUnique: (args: unknown) => Promise<PrismaStateAssetRow | null>;
      findFirst: (args: unknown) => Promise<PrismaStateAssetRow | null>;
      create: (args: unknown) => Promise<PrismaStateAssetRow>;
      update: (args: unknown) => Promise<PrismaStateAssetRow>;
      updateMany: (args: unknown) => Promise<{ count: number }>;
      delete: (args: unknown) => Promise<PrismaStateAssetRow>;
    };
    wallet: {
      count: (args: unknown) => Promise<number>;
    };
    $transaction: <T>(fn: (tx: unknown) => Promise<T>) => Promise<T>;
  };

  return {
    async listAssets(stateId) {
      const rows = await client.stateAsset.findMany({
        where: { stateId },
        orderBy: [{ isPrimary: "desc" }, { createdAt: "asc" }],
      });
      return rows.map(mapAsset);
    },

    async findAsset(stateId, assetId) {
      const row = await client.stateAsset.findFirst({
        where: { id: assetId, stateId },
      });
      return row ? mapAsset(row) : null;
    },

    async findAssetBySymbol(stateId, symbol) {
      const row = await client.stateAsset.findFirst({
        where: { stateId, symbol },
      });
      return row ? mapAsset(row) : null;
    },

    async findPrimaryAsset(stateId) {
      const row = await client.stateAsset.findFirst({
        where: { stateId, isPrimary: true },
      });
      return row ? mapAsset(row) : null;
    },

    async createAsset(input) {
      const row = await client.stateAsset.create({
        data: {
          stateId: input.stateId,
          symbol: input.symbol,
          name: input.name,
          type: input.type,
          mode: input.mode,
          contractAddress: input.contractAddress,
          network: input.network,
          chainId: input.chainId,
          decimals: input.decimals,
          exchangeRate: input.exchangeRate,
          icon: input.icon,
          color: input.color,
          isPrimary: input.isPrimary,
          canMint: input.canMint,
          taxRate: input.taxRate,
          publicSupply: input.publicSupply,
          metadata: input.metadata as Prisma.InputJsonValue,
        },
      });
      return mapAsset(row);
    },

    async updateAsset(stateId, assetId, patch) {
      const row = await client.stateAsset.update({
        where: { id: assetId },
        data: {
          ...(patch.name !== undefined ? { name: patch.name } : {}),
          ...(patch.mode !== undefined ? { mode: patch.mode } : {}),
          ...(patch.contractAddress !== undefined
            ? { contractAddress: patch.contractAddress }
            : {}),
          ...(patch.network !== undefined ? { network: patch.network } : {}),
          ...(patch.chainId !== undefined ? { chainId: patch.chainId } : {}),
          ...(patch.decimals !== undefined ? { decimals: patch.decimals } : {}),
          ...(patch.exchangeRate !== undefined
            ? { exchangeRate: patch.exchangeRate }
            : {}),
          ...(patch.icon !== undefined ? { icon: patch.icon } : {}),
          ...(patch.color !== undefined ? { color: patch.color } : {}),
          ...(patch.canMint !== undefined ? { canMint: patch.canMint } : {}),
          ...(patch.taxRate !== undefined ? { taxRate: patch.taxRate } : {}),
          ...(patch.publicSupply !== undefined
            ? { publicSupply: patch.publicSupply }
            : {}),
          ...(patch.metadata !== undefined
            ? { metadata: patch.metadata as Prisma.InputJsonValue }
            : {}),
        },
      });
      if (row.stateId !== stateId) {
        // Should be impossible (id is globally unique) but guards
        // cross-state tampering if IDs ever leak.
        throw new Error("stateAsset_state_mismatch");
      }
      return mapAsset(row);
    },

    async setPrimaryAsset(stateId, assetId) {
      return client.$transaction(async (tx) => {
        const scoped = tx as unknown as typeof client;
        await scoped.stateAsset.updateMany({
          where: { stateId, isPrimary: true, NOT: { id: assetId } },
          data: { isPrimary: false },
        });
        const row = await scoped.stateAsset.update({
          where: { id: assetId },
          data: { isPrimary: true },
        });
        if (row.stateId !== stateId) {
          throw new Error("stateAsset_state_mismatch");
        }
        return mapAsset(row);
      });
    },

    async deleteAsset(stateId, assetId) {
      const row = await client.stateAsset.findFirst({
        where: { id: assetId, stateId },
      });
      if (!row) return;
      await client.stateAsset.delete({ where: { id: assetId } });
    },

    async countWalletsForAsset(stateId, assetId) {
      return client.wallet.count({ where: { stateId, assetId } });
    },

    async sumAssetSupply(stateId, assetId) {
      // Prisma's `aggregate` returns `{ _sum: { balance: Decimal | null } }`.
      // Older generated clients haven't typed this for our schema yet, so
      // we reach through a narrow cast; the runtime shape is stable.
      const aggClient = prisma as unknown as {
        wallet: {
          aggregate: (args: unknown) => Promise<{
            _sum: { balance: Decimal | null };
          }>;
        };
      };
      const agg = await aggClient.wallet.aggregate({
        where: { stateId, assetId, balance: { gt: 0 } },
        _sum: { balance: true },
      });
      return ledgerDecimal(agg._sum.balance ?? 0).toNumber();
    },
  };
}

// ============================================================
// Treasury Watcher persistence
// ============================================================

/**
 * Prisma adapter for the Treasury Watcher. Kept separate from
 * `createPrismaWalletRepository` so the watcher can be pointed at
 * a dedicated read-replica (or an alternative store in tests).
 */
export function createPrismaWatcherPersistence(
  prisma: PrismaClient,
): import("./watcher").WatcherPersistence {
  const assetClient = (prisma as unknown as {
    stateAsset: {
      findFirst: (args: unknown) => Promise<PrismaStateAssetRow | null>;
    };
  }).stateAsset;

  return {
    async listOnChainTreasuries(opts) {
      const rows = await (prisma.wallet.findMany as unknown as (
        args: unknown,
      ) => Promise<PrismaWalletRow[]>)({
        where: {
          type: "TREASURY",
          externalAddress: { not: null },
          asset: { type: "ON_CHAIN" },
          ...(opts?.stateId ? { stateId: opts.stateId } : {}),
        },
      });
      return rows.map(mapWallet);
    },

    async findAssetById(stateId, assetId) {
      const row = await assetClient.findFirst({
        where: { id: assetId, stateId },
      });
      if (!row) return null;
      return mapAssetSummary(row);
    },

    async updateWalletSyncedBalance(walletId, args) {
      const row = await prisma.wallet.update({
        where: { id: walletId },
        data: {
          balance: args.balance,
          lastSyncedAt: args.lastSyncedAt,
          lastSyncedBlock: args.lastSyncedBlock,
        },
      });
      return mapWallet(row);
    },

    async listPendingOnChainTransactions(opts) {
      const rows = await (prisma.transaction.findMany as unknown as (
        args: unknown,
      ) => Promise<PrismaTransactionRow[]>)({
        where: {
          status: "pending",
          externalTxHash: { not: null },
          ...(opts?.stateId ? { stateId: opts.stateId } : {}),
        },
        orderBy: { createdAt: "asc" },
        take: 200,
      });
      return rows.map(mapTransaction);
    },

    async settleOnChainTransaction(transactionId, { status, externalStatus }) {
      const row = await prisma.transaction.update({
        where: { id: transactionId },
        data: { status, externalStatus },
      });
      return mapTransaction(row);
    },

    async listWatchersForWallet(wallet) {
      if (wallet.type === "TREASURY" && wallet.nodeId) {
        const ancestors = await walkAncestors(prisma, wallet.nodeId);
        const rows = await prisma.membership.findMany({
          where: { nodeId: { in: ancestors }, status: "active" },
          select: { userId: true },
        });
        return [...new Set(rows.map((r) => r.userId))];
      }
      if (wallet.type === "PERSONAL" && wallet.userId) {
        return [wallet.userId];
      }
      return [];
    },
  };
}

async function walkAncestors(
  prisma: PrismaClient,
  nodeId: string,
): Promise<string[]> {
  const chain: string[] = [];
  const visited = new Set<string>();
  let cursor: string | null = nodeId;
  while (cursor && !visited.has(cursor)) {
    visited.add(cursor);
    chain.push(cursor);
    const row: { parentId: string | null } | null =
      await prisma.verticalNode.findUnique({
        where: { id: cursor },
        select: { parentId: true },
      });
    cursor = row?.parentId ?? null;
  }
  return chain;
}
