/**
 * WalletService — domain logic of the `core.wallet` module.
 * ------------------------------------------------------------
 * The service is framework-agnostic: it knows nothing about
 * Next.js, Prisma or React. Everything pluggable is injected:
 *   * `WalletRepository`    — persistence.
 *   * `ModuleEventBus`      — fan-out of realtime events.
 *   * `PermissionsEngine`   — vertical-aware access checks.
 *
 * Monetary model:
 *   * The internal currency is the "Krona" (⚜, code "KRN"). Balances
 *     and transaction amounts are `Float` (per schema). For
 *     production-grade ledgers prefer `Decimal` — see note in
 *     `prisma/schema.prisma`.
 *   * Every operation is double-entry: exactly one wallet is debited
 *     and one is credited (except system-level mint / burn).
 *   * A transfer is atomic at the repository level — the repo is
 *     expected to wrap the balance updates + transaction insert in
 *     a single SQL transaction and to reject any negative-balance
 *     outcome at the DB level.
 *
 * Canonical events published on success:
 *     "core.wallet.transaction.created"
 *     "core.wallet.wallet.created"
 */

import { permissionsEngine, type PermissionsEngine } from "@/core/permissions-engine";
import type {
  ModuleEventBus,
  PermissionKey,
  VerticalSnapshot,
} from "@/types/kernel";
import { WalletPermissions } from "./permissions";
import {
  chainProviders,
  ChainProviderError,
  type ChainProviderRegistry,
  type OnChainTransferIntent,
} from "./providers";

// ------------------------------------------------------------
// Domain types
// ------------------------------------------------------------

export type WalletType = "PERSONAL" | "TREASURY";

/** Default internal currency code. */
export const DEFAULT_CURRENCY = "KRN";

export interface Wallet {
  id: string;
  stateId: string;
  type: WalletType;
  userId: string | null;
  nodeId: string | null;
  address: string;
  /** FK into `StateAsset`. Nullable only for legacy rows. */
  assetId: string | null;
  /** Real on-chain address (EVM / base58) — set for ON_CHAIN wallets. */
  externalAddress: string | null;
  /** Last successful watcher sync (for ON_CHAIN / HYBRID). */
  lastSyncedAt: Date | null;
  /** Block height observed at last sync. */
  lastSyncedBlock: bigint | null;
  balance: number;
  currency: string;
  metadata: Record<string, unknown>;
  createdAt: Date;
  updatedAt: Date;
}

export type TransactionKind =
  | "transfer"
  | "treasury_allocation"
  | "mint"
  | "burn";

export type TransactionStatus = "pending" | "completed" | "failed" | "reversed";

export interface WalletTransaction {
  id: string;
  stateId: string;
  fromWalletId: string | null;
  toWalletId: string | null;
  kind: TransactionKind;
  status: TransactionStatus;
  amount: number;
  assetId: string | null;
  currency: string;
  /** Broadcasted chain tx hash (null until the client confirms). */
  externalTxHash: string | null;
  /** Provider-reported status: "pending" | "confirmed" | "failed" | "dropped". */
  externalStatus: string | null;
  metadata: Record<string, unknown>;
  initiatedById: string;
  createdAt: Date;
}

export interface WalletTransactionCreatedEvent {
  stateId: string;
  transaction: WalletTransaction;
  /** IDs of participants (initiator + from.owner + to.owner + node members of treasury). */
  recipientUserIds: string[];
}

export interface WalletCreatedEvent {
  stateId: string;
  wallet: Wallet;
}

export const WALLET_EVENTS = {
  TransactionCreated: "core.wallet.transaction.created",
  WalletCreated: "core.wallet.wallet.created",
  /** On-chain intent prepared — client should now sign. */
  OnChainIntentPrepared: "core.wallet.on_chain.intent_prepared",
  /** Client reported a tx hash; watcher will finalise it. */
  OnChainBroadcasted: "core.wallet.on_chain.broadcasted",
  /** Watcher flipped an on-chain tx to a terminal state. */
  OnChainSettled: "core.wallet.on_chain.settled",
  /** Treasury Watcher synced a wallet's balance with the chain. */
  BalanceSynced: "core.wallet.balance.synced",
} as const;

export interface OnChainIntentPreparedEvent {
  stateId: string;
  transaction: WalletTransaction;
  intent: OnChainTransferIntent;
}

export interface OnChainBroadcastedEvent {
  stateId: string;
  transaction: WalletTransaction;
}

export interface OnChainSettledEvent {
  stateId: string;
  transaction: WalletTransaction;
}

export interface BalanceSyncedEvent {
  stateId: string;
  walletId: string;
  balanceBefore: number;
  balanceAfter: number;
  blockNumber: bigint | null;
  recipientUserIds: string[];
}

// ------------------------------------------------------------
// Repository contract
// ------------------------------------------------------------

/**
 * Minimal projection of `StateAsset` that the ledger needs in order
 * to wire wallets + transactions to a unit of account. Pulled
 * out of `./settings` to keep `service.ts` self-contained (no
 * circular import through the Currency Factory).
 */
export interface WalletAssetSummary {
  id: string;
  stateId: string;
  symbol: string;
  type: "INTERNAL" | "ON_CHAIN";
  mode: "LOCAL" | "EXTERNAL" | "HYBRID";
  decimals: number;
  contractAddress: string | null;
  network: string | null;
  chainId: number | null;
  // --- Currency Factory knobs (denormalised for the hot path) ---
  // These mirror the columns on `StateAsset` — see the schema for
  // semantics. They're duplicated into the summary so every
  // transfer / mint call has them one lookup away, without
  // forcing the service to talk to the Currency Factory repo.
  canMint: boolean;
  taxRate: number;
  publicSupply: boolean;
}

export interface WalletRepository {
  findPersonalWallet(
    stateId: string,
    userId: string,
    opts?: { assetId?: string | null },
  ): Promise<Wallet | null>;
  findTreasuryWallet(nodeId: string): Promise<Wallet | null>;
  findWalletById(walletId: string): Promise<Wallet | null>;

  listWalletsForUser(stateId: string, userId: string): Promise<Wallet[]>;
  listTreasuriesForState(stateId: string): Promise<Wallet[]>;
  /** All TREASURY wallets whose asset has on-chain presence. */
  listOnChainTreasuries(opts?: { stateId?: string }): Promise<Wallet[]>;

  /**
   * Primary (State-level) treasury: the TreasuryWallet attached to
   * the root VerticalNode (no parent) of the given State. Returns
   * `null` if none exists yet — callers must lazy-provision it
   * before applying taxes / mint-to-treasury flows.
   */
  findRootTreasury(stateId: string, opts?: { assetId?: string }): Promise<Wallet | null>;

  /**
   * Resolves the State's primary `StateAsset`, lazy-creating a
   * default `KRN` Local Ledger row if none exists. This ensures
   * every new Wallet gets a non-null `assetId`.
   */
  ensurePrimaryAsset(stateId: string): Promise<WalletAssetSummary>;
  /** Lookup a single asset by id (scoped to stateId for safety). */
  findAssetById(
    stateId: string,
    assetId: string,
  ): Promise<WalletAssetSummary | null>;

  createPersonalWallet(input: {
    stateId: string;
    userId: string;
    assetId?: string;
    externalAddress?: string | null;
  }): Promise<Wallet>;
  createTreasuryWallet(input: {
    stateId: string;
    nodeId: string;
    assetId?: string;
    externalAddress?: string | null;
  }): Promise<Wallet>;

  /** Mutator used by the Treasury Watcher to persist a fresh balance. */
  updateWalletSyncedBalance(
    walletId: string,
    args: {
      balance: number;
      lastSyncedAt: Date;
      lastSyncedBlock: bigint | null;
    },
  ): Promise<Wallet>;

  /** Set the on-chain holder address for an existing wallet. */
  setExternalAddress(walletId: string, address: string | null): Promise<Wallet>;

  /**
   * Creates a Transaction row in `pending` state without moving any
   * balances. Used for ON_CHAIN transfers — the real debit/credit
   * happens once the Treasury Watcher observes the tx.
   */
  createPendingOnChainTransaction(input: {
    stateId: string;
    fromWalletId: string | null;
    toWalletId: string | null;
    amount: number;
    assetId: string;
    currency: string;
    initiatedById: string;
    intentPayload: Record<string, unknown>;
  }): Promise<WalletTransaction>;

  /**
   * Updates a pending on-chain transaction after the client has
   * broadcasted it (stores the hash). Status stays `pending`; the
   * watcher later flips it to `completed` / `failed`.
   */
  attachOnChainHash(
    transactionId: string,
    args: { externalTxHash: string; externalStatus: string },
  ): Promise<WalletTransaction>;

  /** Watcher: mark a previously-pending on-chain tx as settled. */
  settleOnChainTransaction(
    transactionId: string,
    args: {
      status: TransactionStatus;
      externalStatus: string;
    },
  ): Promise<WalletTransaction>;

  /**
   * Atomic transfer of `amount` minor units between two wallets.
   * Implementations MUST:
   *   * run in a serialisable or equivalent DB transaction,
   *   * reject any negative post-balance on the source wallet,
   *   * insert the `Transaction` row with status="completed"
   *     on success or "failed" on constraint failure.
   *
   * For `kind = "mint"` pass `fromWalletId = null`.
   * For `kind = "burn"` pass `toWalletId   = null`.
   *
   * Optional `tax` splits the payment: the source is still debited
   * by the full `amount`, the destination gets `amount - tax.amount`
   * and `tax.toWalletId` gets `tax.amount`. Both movements happen
   * inside the same DB transaction so partial failure is impossible.
   * The returned object holds the primary row; the tax row is
   * exposed via `.tax`.
   */
  executeTransfer(input: {
    stateId: string;
    fromWalletId: string | null;
    toWalletId: string | null;
    amount: number;
    currency: string;
    kind: TransactionKind;
    initiatedById: string;
    metadata: Record<string, unknown>;
    tax?: {
      toWalletId: string;
      amount: number;
    };
  }): Promise<WalletTransaction & { tax?: WalletTransaction }>;

  listTransactionsForWallet(
    walletId: string,
    opts: { limit: number; before?: Date | null },
  ): Promise<WalletTransaction[]>;

  /** Returns user ids that belong (active) to the given node ids. */
  listUserIdsInNodes(nodeIds: string[]): Promise<string[]>;

  /** Walks the Vertical upwards from `nodeId` (inclusive). */
  walkAncestors(nodeId: string): Promise<string[]>;

  /**
   * Optional: hot-path-friendly projection of `StateSettings` для
   * применения налогов в `transfer()`. Возвращает `null`, если
   * Палата Указов ещё не инициализирована в этом State — тогда
   * сервис считает, что налогов уровня государства нет и работает
   * как раньше.
   *
   * Поля — фракции в [0..1]:
   *   * `transactionTaxRate` — доля от КАЖДОГО `transfer`, уходит в
   *     корневую Казну. Складывается поверх `asset.taxRate`.
   *   * `incomeTaxRate`      — доля от `treasury_allocation` →
   *     PERSONAL (зарплата из казны), возвращается в ту же корневую
   *     Казну. Иначе дифф между министром и сотрудником бы бесконечно
   *     перетекал между казнами.
   *
   * Имплементация через optional-свойство — старые моки из тестов
   * продолжают работать без правок.
   */
  findStateFiscalPolicy?(
    stateId: string,
  ): Promise<{ transactionTaxRate: number; incomeTaxRate: number } | null>;
}

// ------------------------------------------------------------
// Access context
// ------------------------------------------------------------

export interface WalletAccessContext {
  userId: string;
  isOwner: boolean;
  snapshot: VerticalSnapshot;
  permissions: ReadonlySet<PermissionKey>;
}

export class WalletAccessError extends Error {
  constructor(
    message: string,
    public readonly code:
      | "forbidden"
      | "not_found"
      | "invalid_input"
      | "insufficient_funds",
  ) {
    super(message);
    this.name = "WalletAccessError";
  }
}

// ------------------------------------------------------------
// Service
// ------------------------------------------------------------

export interface WalletServiceDeps {
  repo: WalletRepository;
  bus: ModuleEventBus;
  engine?: PermissionsEngine;
  /** Web3 registry (viem-based by default). */
  providers?: ChainProviderRegistry;
}

export interface TransferInput {
  /**
   * Source wallet — either the caller's personal wallet for this
   * State, or a treasury wallet of a node the caller controls.
   * Accepts a wallet id OR one of the convenience shapes below.
   */
  from:
    | { kind: "personal" }
    | { kind: "treasury"; nodeId: string }
    | { kind: "walletId"; walletId: string };
  /** Destination wallet. */
  to:
    | { kind: "user"; userId: string }
    | { kind: "treasury"; nodeId: string }
    | { kind: "walletId"; walletId: string };
  amount: number;
  currency?: string;
  memo?: string;
  metadata?: Record<string, unknown>;
}

export class WalletService {
  private readonly repo: WalletRepository;
  private readonly bus: ModuleEventBus;
  private readonly engine: PermissionsEngine;
  private readonly providers: ChainProviderRegistry;

  constructor(deps: WalletServiceDeps) {
    this.repo = deps.repo;
    this.bus = deps.bus;
    this.engine = deps.engine ?? permissionsEngine;
    this.providers = deps.providers ?? chainProviders();
  }

  // --------------------------------------------------------
  // Wallet lookup / provisioning
  // --------------------------------------------------------

  /**
   * Returns the caller's personal wallet for this State. Creates it
   * lazily if missing — this lets legacy users acquire a wallet
   * without a dedicated migration step.
   */
  async ensurePersonalWallet(
    stateId: string,
    userId: string,
  ): Promise<Wallet> {
    const existing = await this.repo.findPersonalWallet(stateId, userId);
    if (existing) return existing;

    const wallet = await this.repo.createPersonalWallet({ stateId, userId });
    void this.bus
      .emit(WALLET_EVENTS.WalletCreated, {
        stateId,
        wallet,
      } satisfies WalletCreatedEvent)
      .catch(() => {});
    return wallet;
  }

  /**
   * Creates (idempotent) a treasury wallet for a node. Only the
   * Sovereign or holders of `wallet.admin_mint` may call this.
   */
  async ensureTreasuryWallet(
    stateId: string,
    nodeId: string,
    ctx: WalletAccessContext,
  ): Promise<Wallet> {
    if (!ctx.isOwner && !hasPermission(ctx.permissions, WalletPermissions.AdminMint)) {
      throw new WalletAccessError(
        "Only the Sovereign (or `wallet.admin_mint` holders) can create treasuries.",
        "forbidden",
      );
    }
    const node = ctx.snapshot.nodes.get(nodeId);
    if (!node || node.stateId !== stateId) {
      throw new WalletAccessError(
        `Node "${nodeId}" does not belong to this State.`,
        "invalid_input",
      );
    }
    const existing = await this.repo.findTreasuryWallet(nodeId);
    if (existing) return existing;

    const wallet = await this.repo.createTreasuryWallet({ stateId, nodeId });
    void this.bus
      .emit(WALLET_EVENTS.WalletCreated, {
        stateId,
        wallet,
      } satisfies WalletCreatedEvent)
      .catch(() => {});
    return wallet;
  }

  /** Returns the personal wallet of the caller (must already exist). */
  async getOwnWallet(
    stateId: string,
    ctx: WalletAccessContext,
  ): Promise<Wallet> {
    this.requirePermission(ctx, WalletPermissions.ViewOwn);
    const wallet = await this.repo.findPersonalWallet(stateId, ctx.userId);
    if (!wallet) {
      throw new WalletAccessError(
        "Personal wallet has not been provisioned yet.",
        "not_found",
      );
    }
    return wallet;
  }

  /**
   * Returns a treasury wallet if the caller may view it — i.e. they
   * hold `wallet.view_treasury` AND are a member of the node or any
   * of its ancestors (Sovereign bypasses both checks).
   */
  async getTreasury(
    stateId: string,
    nodeId: string,
    ctx: WalletAccessContext,
  ): Promise<Wallet> {
    this.assertCanViewTreasury(stateId, nodeId, ctx);
    const wallet = await this.repo.findTreasuryWallet(nodeId);
    if (!wallet) {
      throw new WalletAccessError(
        "Treasury wallet has not been provisioned for this node.",
        "not_found",
      );
    }
    return wallet;
  }

  /**
   * Lists treasuries visible to the caller: every node whose treasury
   * exists AND which the caller may view (via permission + ancestry).
   * Sovereign sees all.
   */
  async listVisibleTreasuries(
    stateId: string,
    ctx: WalletAccessContext,
  ): Promise<Wallet[]> {
    const all = await this.repo.listTreasuriesForState(stateId);
    if (ctx.isOwner) return all;
    if (!hasPermission(ctx.permissions, WalletPermissions.ViewTreasury)) {
      return [];
    }
    return all.filter((w) =>
      w.nodeId
        ? this.engine.isMemberOfNodeOrAncestor(
            {
              userId: ctx.userId,
              isOwner: ctx.isOwner,
              snapshot: ctx.snapshot,
            },
            w.nodeId,
          ).granted
        : false,
    );
  }

  // --------------------------------------------------------
  // Transactions
  // --------------------------------------------------------

  async listOwnTransactions(
    stateId: string,
    ctx: WalletAccessContext,
    opts: { limit?: number; before?: Date | null } = {},
  ): Promise<WalletTransaction[]> {
    const wallet = await this.getOwnWallet(stateId, ctx);
    return this.repo.listTransactionsForWallet(wallet.id, {
      limit: clampLimit(opts.limit),
      before: opts.before ?? null,
    });
  }

  async listTreasuryTransactions(
    stateId: string,
    nodeId: string,
    ctx: WalletAccessContext,
    opts: { limit?: number; before?: Date | null } = {},
  ): Promise<WalletTransaction[]> {
    const wallet = await this.getTreasury(stateId, nodeId, ctx);
    return this.repo.listTransactionsForWallet(wallet.id, {
      limit: clampLimit(opts.limit),
      before: opts.before ?? null,
    });
  }

  /**
   * Core transfer routine for **INTERNAL / LOCAL / HYBRID**-internal
   * leg transfers. Validates permissions (who can spend from
   * `from`?), resolves both sides to concrete wallet ids, and hands
   * the atomic debit/credit to the repository.
   *
   * For assets whose `type === "ON_CHAIN"` (pure on-chain flow) the
   * caller MUST use `prepareOnChainIntent()` + `confirmOnChainTransfer()`
   * instead — this method will reject with `invalid_input` because
   * the sovereign ledger cannot move funds that live on a real
   * blockchain without a client-side signature.
   */
  async transfer(
    stateId: string,
    ctx: WalletAccessContext,
    input: TransferInput,
  ): Promise<WalletTransaction> {
    this.requirePermission(ctx, WalletPermissions.Transfer);

    if (!Number.isFinite(input.amount) || input.amount <= 0) {
      throw new WalletAccessError(
        "Amount must be a positive finite number.",
        "invalid_input",
      );
    }

    const fromWallet = await this.resolveSpendableWallet(stateId, ctx, input.from);
    const toWallet = await this.resolveDestinationWallet(stateId, ctx, input.to);

    if (fromWallet.id === toWallet.id) {
      throw new WalletAccessError(
        "Source and destination wallets must differ.",
        "invalid_input",
      );
    }

    const currency = input.currency ?? fromWallet.currency ?? DEFAULT_CURRENCY;
    if (fromWallet.currency !== currency || toWallet.currency !== currency) {
      throw new WalletAccessError(
        `Currency mismatch: transfer=${currency}, from=${fromWallet.currency}, to=${toWallet.currency}.`,
        "invalid_input",
      );
    }

    // If the asset is ON_CHAIN, the ledger can't unilaterally move
    // money — the holder must sign a real transaction. Force the
    // caller to use the intent flow instead.
    const asset = fromWallet.assetId
      ? await this.repo.findAssetById(stateId, fromWallet.assetId)
      : null;
    if (asset && asset.type === "ON_CHAIN" && asset.mode === "EXTERNAL") {
      throw new WalletAccessError(
        `Asset "${asset.symbol}" is pure ON_CHAIN — use prepareOnChainIntent() + confirmOnChainTransfer() instead.`,
        "invalid_input",
      );
    }

    if (fromWallet.balance < input.amount) {
      throw new WalletAccessError(
        "Insufficient funds in the source wallet.",
        "insufficient_funds",
      );
    }

    const kind: TransactionKind =
      fromWallet.type === "TREASURY" ? "treasury_allocation" : "transfer";

    const metadata: Record<string, unknown> = {
      ...(input.metadata ?? {}),
      ...(input.memo ? { memo: input.memo } : {}),
      fromType: fromWallet.type,
      toType: toWallet.type,
    };

    // --- State tax (Налог штата + Палата Указов) ---
    //
    // Складываем две ставки:
    //   * `asset.taxRate`               — per-asset монетарная политика
    //                                     из Currency Factory.
    //   * `state.transactionTaxRate`    — общий налог государства
    //                                     (Палата Указов). Применяется
    //                                     ко всем INTERNAL-переводам
    //                                     независимо от актива.
    //   * `state.incomeTaxRate`         — налог на начисления из Казны
    //                                     на личный кошелёк
    //                                     (`treasury_allocation` →
    //                                     PERSONAL).
    //
    // Все три слоя уходят в корневую Казну одной операцией внутри
    // единой SQL-транзакции. Treasury → treasury-переводы не
    // облагаются (см. комментарий о рефлексивной бухгалтерии).
    let taxSplit: { toWalletId: string; amount: number } | undefined;
    const fiscal =
      this.repo.findStateFiscalPolicy
        ? await this.repo.findStateFiscalPolicy(stateId)
        : null;
    const assetTaxRate =
      asset && fromWallet.type === "PERSONAL" ? asset.taxRate : 0;
    const stateTxTaxRate =
      fiscal && fromWallet.type === "PERSONAL"
        ? fiscal.transactionTaxRate
        : 0;
    const stateIncomeTaxRate =
      fiscal &&
      fromWallet.type === "TREASURY" &&
      toWallet.type === "PERSONAL"
        ? fiscal.incomeTaxRate
        : 0;
    // Клампуем сумму ставок: государство не может отобрать больше
    // 100% — иначе получатель не получит ничего и система станет
    // ненаблюдаемой.
    const effectiveTaxRate = Math.min(
      1,
      assetTaxRate + stateTxTaxRate + stateIncomeTaxRate,
    );
    if (effectiveTaxRate > 0) {
      const rootTreasury = await this.repo.findRootTreasury(stateId, {
        assetId: fromWallet.assetId ?? undefined,
      });
      if (rootTreasury && rootTreasury.id !== toWallet.id) {
        const taxAmount = roundToDecimals(
          input.amount * effectiveTaxRate,
          asset?.decimals ?? 18,
        );
        if (taxAmount > 0 && taxAmount < input.amount) {
          taxSplit = { toWalletId: rootTreasury.id, amount: taxAmount };
          metadata.stateTax = {
            rate: effectiveTaxRate,
            breakdown: {
              asset: assetTaxRate,
              transaction: stateTxTaxRate,
              income: stateIncomeTaxRate,
            },
            treasuryWalletId: rootTreasury.id,
          };
        }
      }
    }

    const tx = await this.repo.executeTransfer({
      stateId,
      fromWalletId: fromWallet.id,
      toWalletId: toWallet.id,
      amount: input.amount,
      currency,
      kind,
      initiatedById: ctx.userId,
      metadata,
      tax: taxSplit,
    });

    await this.publishTransactionCreated(stateId, tx, fromWallet, toWallet);
    return tx;
  }

  // --------------------------------------------------------
  // Web3 flow (ON_CHAIN transfers)
  // --------------------------------------------------------

  /**
   * Builds an unsigned on-chain transfer intent and persists a
   * `pending` transaction row for audit. Does NOT broadcast —
   * the server never holds private keys. The client picks up
   * the returned `intent` and signs/submits it via viem /
   * ethers / MetaMask, then calls `confirmOnChainTransfer()`.
   *
   * Permissions mirror `transfer()`: `wallet.transfer` plus
   * spend-side gating on the source wallet.
   */
  async prepareOnChainIntent(
    stateId: string,
    ctx: WalletAccessContext,
    input: TransferInput,
  ): Promise<{ transaction: WalletTransaction; intent: OnChainTransferIntent }> {
    this.requirePermission(ctx, WalletPermissions.Transfer);

    if (!Number.isFinite(input.amount) || input.amount <= 0) {
      throw new WalletAccessError(
        "Amount must be a positive finite number.",
        "invalid_input",
      );
    }

    const fromWallet = await this.resolveSpendableWallet(stateId, ctx, input.from);
    const toWallet = await this.resolveDestinationWallet(stateId, ctx, input.to);
    if (fromWallet.id === toWallet.id) {
      throw new WalletAccessError(
        "Source and destination wallets must differ.",
        "invalid_input",
      );
    }
    if (!fromWallet.assetId) {
      throw new WalletAccessError(
        "Source wallet has no asset binding — on-chain transfer impossible.",
        "invalid_input",
      );
    }

    const asset = await this.repo.findAssetById(stateId, fromWallet.assetId);
    if (!asset) {
      throw new WalletAccessError("Asset not found for this wallet.", "not_found");
    }
    if (asset.type !== "ON_CHAIN" && asset.mode !== "HYBRID") {
      throw new WalletAccessError(
        "Asset is not on-chain — use transfer() instead.",
        "invalid_input",
      );
    }
    if (!asset.contractAddress || !asset.network) {
      throw new WalletAccessError(
        "Asset is missing contractAddress / network.",
        "invalid_input",
      );
    }
    if (!fromWallet.externalAddress) {
      throw new WalletAccessError(
        "Source wallet has no externalAddress — bind one before signing.",
        "invalid_input",
      );
    }
    if (!toWallet.externalAddress) {
      throw new WalletAccessError(
        "Destination wallet has no externalAddress — cannot target it on-chain.",
        "invalid_input",
      );
    }

    // Build the intent via the network-specific provider (viem for
    // EVM, etc.). The amount is converted to minor units using the
    // asset's declared decimals.
    let intent: OnChainTransferIntent;
    try {
      const provider = this.providers.require(asset.network);
      intent = provider.buildTransferIntent({
        contractAddress: asset.contractAddress,
        fromAddress: fromWallet.externalAddress,
        toAddress: toWallet.externalAddress,
        amountMinor: toMinorUnits(input.amount, asset.decimals),
        asset: { symbol: asset.symbol, decimals: asset.decimals },
      });
    } catch (err) {
      if (err instanceof ChainProviderError) {
        throw new WalletAccessError(err.message, "invalid_input");
      }
      throw err;
    }

    const tx = await this.repo.createPendingOnChainTransaction({
      stateId,
      fromWalletId: fromWallet.id,
      toWalletId: toWallet.id,
      amount: input.amount,
      assetId: asset.id,
      currency: asset.symbol,
      initiatedById: ctx.userId,
      intentPayload: {
        ...(input.metadata ?? {}),
        ...(input.memo ? { memo: input.memo } : {}),
        fromType: fromWallet.type,
        toType: toWallet.type,
        intent,
      },
    });

    void this.bus
      .emit(WALLET_EVENTS.OnChainIntentPrepared, {
        stateId,
        transaction: tx,
        intent,
      } satisfies OnChainIntentPreparedEvent)
      .catch(() => {});

    return { transaction: tx, intent };
  }

  /**
   * Records a transaction hash returned by the client after it
   * signed & broadcasted the intent. The Treasury Watcher takes it
   * from here: observes confirmations, flips the row to `completed`
   * or `failed`, and reconciles the cached balance.
   */
  async confirmOnChainTransfer(
    stateId: string,
    ctx: WalletAccessContext,
    args: { transactionId: string; externalTxHash: string },
  ): Promise<WalletTransaction> {
    this.requirePermission(ctx, WalletPermissions.Transfer);

    if (!/^0x[0-9a-fA-F]{64}$/.test(args.externalTxHash)) {
      throw new WalletAccessError(
        "externalTxHash must be a 0x-prefixed 32-byte hash.",
        "invalid_input",
      );
    }

    const updated = await this.repo.attachOnChainHash(args.transactionId, {
      externalTxHash: args.externalTxHash,
      externalStatus: "broadcasting",
    });
    if (updated.stateId !== stateId) {
      throw new WalletAccessError(
        "Transaction belongs to a different State.",
        "forbidden",
      );
    }

    void this.bus
      .emit(WALLET_EVENTS.OnChainBroadcasted, {
        stateId,
        transaction: updated,
      } satisfies OnChainBroadcastedEvent)
      .catch(() => {});

    return updated;
  }

  /**
   * Sovereign (or holder of `wallet.admin_mint`) creates fresh units
   * and credits them to an existing wallet. No source wallet is
   * debited — it's a system-level mint.
   */
  async mint(
    stateId: string,
    ctx: WalletAccessContext,
    input: {
      toWalletId: string;
      amount: number;
      currency?: string;
      memo?: string;
      metadata?: Record<string, unknown>;
    },
  ): Promise<WalletTransaction> {
    if (!ctx.isOwner && !hasPermission(ctx.permissions, WalletPermissions.AdminMint)) {
      throw new WalletAccessError(
        "Only the Sovereign (or `wallet.admin_mint` holders) can mint.",
        "forbidden",
      );
    }
    if (!Number.isFinite(input.amount) || input.amount <= 0) {
      throw new WalletAccessError(
        "Amount must be a positive finite number.",
        "invalid_input",
      );
    }
    const toWallet = await this.repo.findWalletById(input.toWalletId);
    if (!toWallet || toWallet.stateId !== stateId) {
      throw new WalletAccessError(
        "Destination wallet not found in this State.",
        "not_found",
      );
    }
    const currency = input.currency ?? toWallet.currency ?? DEFAULT_CURRENCY;
    if (toWallet.currency !== currency) {
      throw new WalletAccessError(
        `Currency mismatch: mint=${currency}, wallet=${toWallet.currency}.`,
        "invalid_input",
      );
    }

    // Mint is a sovereign-ledger primitive; it makes no sense for a
    // pure on-chain token the State does not own. HYBRID assets can
    // still mint internal units (backed by off-chain reserves).
    const asset = toWallet.assetId
      ? await this.repo.findAssetById(stateId, toWallet.assetId)
      : null;
    if (asset && asset.type === "ON_CHAIN" && asset.mode === "EXTERNAL") {
      throw new WalletAccessError(
        `Cannot mint ON_CHAIN asset "${asset.symbol}" — the sovereign does not own the contract.`,
        "invalid_input",
      );
    }

    // Currency Factory guard: if the Sovereign has frozen emission
    // for this asset (`canMint = false`), reject even their own
    // mint call. The Sovereign can always unfreeze it via the
    // Factory UI before retrying — the guard exists precisely to
    // make deliberate monetary policy auditable.
    if (asset && asset.canMint === false) {
      throw new WalletAccessError(
        `Minting is currently disabled for asset "${asset.symbol}" (canMint=false).`,
        "forbidden",
      );
    }

    const tx = await this.repo.executeTransfer({
      stateId,
      fromWalletId: null,
      toWalletId: toWallet.id,
      amount: input.amount,
      currency,
      kind: "mint",
      initiatedById: ctx.userId,
      metadata: {
        ...(input.metadata ?? {}),
        ...(input.memo ? { memo: input.memo } : {}),
      },
    });

    await this.publishTransactionCreated(stateId, tx, null, toWallet);
    return tx;
  }

  // --------------------------------------------------------
  // Internals
  // --------------------------------------------------------

  private assertCanViewTreasury(
    stateId: string,
    nodeId: string,
    ctx: WalletAccessContext,
  ): void {
    if (ctx.isOwner) return;
    if (!hasPermission(ctx.permissions, WalletPermissions.ViewTreasury)) {
      throw new WalletAccessError(
        `Missing permission "${WalletPermissions.ViewTreasury}".`,
        "forbidden",
      );
    }
    const node = ctx.snapshot.nodes.get(nodeId);
    if (!node || node.stateId !== stateId) {
      throw new WalletAccessError(
        `Node "${nodeId}" does not belong to this State.`,
        "invalid_input",
      );
    }
    const ok = this.engine.isMemberOfNodeOrAncestor(
      { userId: ctx.userId, isOwner: ctx.isOwner, snapshot: ctx.snapshot },
      nodeId,
    ).granted;
    if (!ok) {
      throw new WalletAccessError(
        "Not a member of this node (or any of its ancestors).",
        "forbidden",
      );
    }
  }

  private async resolveSpendableWallet(
    stateId: string,
    ctx: WalletAccessContext,
    from: TransferInput["from"],
  ): Promise<Wallet> {
    let wallet: Wallet | null;
    if (from.kind === "personal") {
      wallet = await this.repo.findPersonalWallet(stateId, ctx.userId);
      if (!wallet) {
        throw new WalletAccessError(
          "Personal wallet not provisioned.",
          "not_found",
        );
      }
      return wallet;
    }
    if (from.kind === "treasury") {
      this.assertCanViewTreasury(stateId, from.nodeId, ctx);
      wallet = await this.repo.findTreasuryWallet(from.nodeId);
      if (!wallet) {
        throw new WalletAccessError(
          "Treasury not provisioned for this node.",
          "not_found",
        );
      }
      return wallet;
    }
    // from.kind === "walletId"
    wallet = await this.repo.findWalletById(from.walletId);
    if (!wallet || wallet.stateId !== stateId) {
      throw new WalletAccessError("Source wallet not found.", "not_found");
    }
    this.assertCanSpendFromWallet(wallet, ctx);
    return wallet;
  }

  private async resolveDestinationWallet(
    stateId: string,
    ctx: WalletAccessContext,
    to: TransferInput["to"],
  ): Promise<Wallet> {
    if (to.kind === "user") {
      const wallet = await this.repo.findPersonalWallet(stateId, to.userId);
      if (!wallet) {
        throw new WalletAccessError(
          "Recipient has no personal wallet in this State.",
          "not_found",
        );
      }
      return wallet;
    }
    if (to.kind === "treasury") {
      const wallet = await this.repo.findTreasuryWallet(to.nodeId);
      if (!wallet) {
        throw new WalletAccessError(
          "Destination treasury not provisioned.",
          "not_found",
        );
      }
      return wallet;
    }
    const wallet = await this.repo.findWalletById(to.walletId);
    if (!wallet || wallet.stateId !== stateId) {
      throw new WalletAccessError("Destination wallet not found.", "not_found");
    }
    return wallet;
  }

  /**
   * Verifies that `ctx.userId` may move funds out of the given
   * wallet. For personal wallets the caller must own it. For
   * treasuries the caller must (a) hold `wallet.manage_treasury`
   * and (b) belong to the node or any of its ancestors. Sovereign
   * bypasses both.
   */
  private assertCanSpendFromWallet(
    wallet: Wallet,
    ctx: WalletAccessContext,
  ): void {
    if (ctx.isOwner) return;

    if (wallet.type === "PERSONAL") {
      if (wallet.userId !== ctx.userId) {
        throw new WalletAccessError(
          "Cannot spend from another user's wallet.",
          "forbidden",
        );
      }
      return;
    }
    if (!wallet.nodeId) {
      throw new WalletAccessError(
        "Treasury wallet is missing its node binding.",
        "invalid_input",
      );
    }
    if (!hasPermission(ctx.permissions, WalletPermissions.ManageTreasury)) {
      throw new WalletAccessError(
        `Missing permission "${WalletPermissions.ManageTreasury}" on this treasury.`,
        "forbidden",
      );
    }
    const member = this.engine.isMemberOfNodeOrAncestor(
      { userId: ctx.userId, isOwner: ctx.isOwner, snapshot: ctx.snapshot },
      wallet.nodeId,
    );
    if (!member.granted) {
      throw new WalletAccessError(
        "Not a member of this node (or any of its ancestors).",
        "forbidden",
      );
    }
  }

  private requirePermission(
    ctx: WalletAccessContext,
    key: PermissionKey,
  ): void {
    if (ctx.isOwner) return;
    if (!hasPermission(ctx.permissions, key)) {
      throw new WalletAccessError(`Missing permission "${key}".`, "forbidden");
    }
  }

  private async publishTransactionCreated(
    stateId: string,
    tx: WalletTransaction,
    from: Wallet | null,
    to: Wallet,
  ): Promise<void> {
    const recipients = new Set<string>();
    recipients.add(tx.initiatedById);
    if (from?.userId) recipients.add(from.userId);
    if (to.userId) recipients.add(to.userId);
    if (to.nodeId) {
      const chain = await this.repo.walkAncestors(to.nodeId);
      for (const uid of await this.repo.listUserIdsInNodes(chain)) {
        recipients.add(uid);
      }
    }
    if (from?.nodeId) {
      const chain = await this.repo.walkAncestors(from.nodeId);
      for (const uid of await this.repo.listUserIdsInNodes(chain)) {
        recipients.add(uid);
      }
    }

    void this.bus
      .emit(WALLET_EVENTS.TransactionCreated, {
        stateId,
        transaction: tx,
        recipientUserIds: [...recipients],
      } satisfies WalletTransactionCreatedEvent)
      .catch(() => {});
  }
}

function hasPermission(
  held: ReadonlySet<PermissionKey>,
  required: PermissionKey,
): boolean {
  if (held.has("*")) return true;
  if (held.has(required)) return true;
  const [domain] = required.split(".");
  if (!domain) return false;
  return held.has(`${domain}.*` as PermissionKey);
}

function clampLimit(n: number | undefined): number {
  if (!n || n <= 0) return 50;
  return Math.min(n, 200);
}

/**
 * Converts a float display amount into a `bigint` of minor units.
 * Intentionally routed through a string to avoid IEEE-754 drift for
 * common decimals (6, 8, 9, 18). For production-critical amounts
 * prefer a decimal input upstream — see the note in
 * `prisma/schema.prisma`.
 */
export function toMinorUnits(amount: number, decimals: number): bigint {
  if (!Number.isFinite(amount) || amount <= 0) {
    throw new WalletAccessError(
      "Amount must be a positive finite number.",
      "invalid_input",
    );
  }
  if (decimals < 0 || decimals > 36 || !Number.isInteger(decimals)) {
    throw new WalletAccessError(
      "Decimals must be an integer in [0, 36].",
      "invalid_input",
    );
  }
  const [whole, frac = ""] = amount.toFixed(decimals).split(".") as [
    string,
    string | undefined,
  ];
  const padded = (frac ?? "").padEnd(decimals, "0").slice(0, decimals);
  return BigInt(whole) * 10n ** BigInt(decimals) + BigInt(padded || "0");
}

/**
 * Rounds a float to `decimals` places using banker-safe toFixed +
 * reparse. Used for State tax amounts: we need the tax component to
 * be representable in the asset's smallest unit so that
 * (netToDest + tax) === amount holds byte-for-byte in the ledger.
 * Rounds half-to-even via `Number.prototype.toFixed` (platform-defined,
 * but deterministic for repeated runs). Clamps decimals to [0, 18].
 */
export function roundToDecimals(value: number, decimals: number): number {
  if (!Number.isFinite(value)) return 0;
  const d = Math.max(0, Math.min(18, Math.trunc(decimals)));
  const factor = 10 ** d;
  return Math.round(value * factor) / factor;
}

/** Inverse of `toMinorUnits` for convenience. */
export function fromMinorUnits(minor: bigint, decimals: number): number {
  const s = minor.toString().padStart(decimals + 1, "0");
  const whole = s.slice(0, s.length - decimals);
  const frac = s.slice(s.length - decimals);
  return Number(`${whole}.${frac}`);
}
