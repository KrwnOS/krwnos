/**
 * Krwn Exchange Engine — межгосударственная торговля.
 * ------------------------------------------------------------
 * Первый мост между финансовыми суверенитетами KrwnOS. Сервис
 * живёт в ядре (не в модуле!) потому что он пересекает границы
 * State — один-единственный модуль никогда не может торговать за
 * пределами своего государства. Здесь — клиринговая палата.
 *
 * Что умеет:
 *   * `upsertPair`       — Суверен фиксирует курс обмена между
 *                          двумя `StateAsset` (1 `fromAsset` =
 *                          `rate` `toAsset`). Направление важно:
 *                          обратный курс объявляется отдельным
 *                          `ExchangePair`. Несогласие одной из
 *                          сторон открыть обратный путь = торговый
 *                          барьер.
 *   * `setPairEnabled`   — экономическая блокада. Отключение пары
 *                          делает `crossStateTransfer` невозможным
 *                          независимо от прав пользователя.
 *   * `quote`            — «Сколько я получу?» — чистый расчёт,
 *                          без списания средств.
 *   * `getForeignBalance`— разрешённый запрос баланса из другого
 *                          State. По умолчанию доступ только
 *                          владельцу кошелька или Суверену
 *                          целевого State. Для делегированного
 *                          доступа — `core.exchange.view_foreign`.
 *   * `crossStateTransfer` — атомарный burn в source-State + mint
 *                          в destination-State по пеггингу пары.
 *                          Пишет запись в глобальный лог
 *                          `CrossStateTransaction`.
 *
 * Внимание: ядро не импортирует модули. Поэтому ExchangeService
 * работает с кошельками и ассетами через свой собственный
 * repository-контракт (`ExchangeRepository`), а Prisma-адаптер
 * дергает те же таблицы, что и `core.wallet`. Это сознательное
 * дублирование: модуль `core.wallet` отвечает за одно государство,
 * а `ExchangeService` — за сам факт пересечения границы.
 */

import type {
  ModuleEventBus,
  PermissionDescriptor,
  PermissionKey,
  VerticalSnapshot,
} from "@/types/kernel";
import { Decimal } from "@prisma/client/runtime/library";
import { eventBus } from "./event-bus";
import { permissionsEngine, type PermissionsEngine } from "./permissions-engine";

// ============================================================
// 1. Permissions
// ============================================================

export const EXCHANGE_MODULE_SLUG = "core.exchange";

export const ExchangePermissions = {
  /** Создавать / редактировать / отключать `ExchangePair`. */
  ManagePairs: "core.exchange.manage_pairs" as PermissionKey,
  /** Смотреть балансы кошельков в другом State. */
  ViewForeign: "core.exchange.view_foreign" as PermissionKey,
  /** Инициировать межгосударственный своп. */
  Swap: "core.exchange.swap" as PermissionKey,
} as const;

export const exchangePermissionDescriptors: PermissionDescriptor[] = [
  {
    key: ExchangePermissions.ManagePairs,
    owner: "core",
    label: "Управлять обменными парами",
    description:
      "Фиксировать курс обмена между валютами, вводить и снимать " +
      "санкции на обмен. По умолчанию доступно только Суверену.",
  },
  {
    key: ExchangePermissions.ViewForeign,
    owner: "core",
    label: "Видеть балансы в других государствах",
    description:
      "Разрешает запрашивать баланс кошелька в другом State (если " +
      "Суверен того State разрешил делегирование). Иначе — доступ " +
      "только у самого владельца кошелька и его Суверена.",
  },
  {
    key: ExchangePermissions.Swap,
    owner: "core",
    label: "Межгосударственный своп",
    description:
      "Инициировать обмен валют через зарегистрированный " +
      "`ExchangePair`. Дополнительно требует право распоряжаться " +
      "кошельком-источником (`wallet.transfer` / `wallet.manage_treasury`).",
  },
];

// ============================================================
// 2. Domain types
// ============================================================

export type ExchangeErrorCode =
  | "not_found"
  | "forbidden"
  | "invalid_input"
  | "insufficient_funds"
  | "pair_disabled"
  | "pair_missing"
  | "blockade"
  | "currency_mismatch"
  | "conflict";

export class ExchangeError extends Error {
  constructor(message: string, public readonly code: ExchangeErrorCode) {
    super(message);
    this.name = "ExchangeError";
  }
}

export interface ExchangePair {
  id: string;
  fromAssetId: string;
  fromStateId: string;
  toAssetId: string;
  toStateId: string;
  rate: number;
  isManual: boolean;
  enabled: boolean;
  createdById: string;
  metadata: Record<string, unknown>;
  createdAt: Date;
  updatedAt: Date;
}

/** Projection used by the engine — no need for a full `Wallet`. */
export interface ExchangeWalletRef {
  id: string;
  stateId: string;
  assetId: string | null;
  /** PERSONAL → owner userId; TREASURY → node id. */
  userId: string | null;
  nodeId: string | null;
  type: "PERSONAL" | "TREASURY";
  balance: Decimal;
  currency: string;
}

export interface ExchangeAssetRef {
  id: string;
  stateId: string;
  symbol: string;
  decimals: number;
}

export interface CrossStateTransaction {
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
  metadata: Record<string, unknown>;
  createdAt: Date;
}

export interface Quote {
  pair: ExchangePair;
  fromAmount: number;
  toAmount: number;
  rate: number;
}

// ============================================================
// 3. Access context
// ============================================================

/**
 * Per-State view of what the actor may do. `ExchangeService` never
 * builds these itself — callers (route handlers / the CLI / RSC
 * actions) compose them once per request using the same
 * PermissionsEngine the wallet module uses.
 */
export interface ExchangeStateAccess {
  stateId: string;
  /** Actor is the Sovereign of this State. */
  isOwner: boolean;
  /** Effective permissions in this State after Vertical inheritance. */
  permissions: ReadonlySet<PermissionKey>;
  /** VerticalSnapshot of the State (for membership-scoped checks). */
  snapshot: VerticalSnapshot;
}

export interface ExchangeActor {
  userId: string;
  /**
   * Per-State access the actor carries. Keyed by stateId so the
   * service can look up both the source side (where it must be
   * able to spend) and the destination side (where it may need
   * `view_foreign`). Callers only have to include the states
   * relevant to the operation — the service enforces that.
   */
  states: ReadonlyMap<string, ExchangeStateAccess>;
}

// ============================================================
// 4. Repository contract
// ============================================================

/**
 * Persistence boundary. A Prisma-backed implementation lives in
 * `src/core/exchange-prisma.ts` (thin adapter around `prisma.*`).
 * Tests inject an in-memory fake — see
 * `src/core/__tests__/exchange.test.ts`.
 */
export interface ExchangeRepository {
  // ---- ExchangePair ----
  findPair(fromAssetId: string, toAssetId: string): Promise<ExchangePair | null>;
  findPairById(id: string): Promise<ExchangePair | null>;
  listPairs(filter?: {
    stateId?: string;
    direction?: "outbound" | "inbound" | "both";
  }): Promise<ExchangePair[]>;
  upsertPair(input: {
    fromAssetId: string;
    fromStateId: string;
    toAssetId: string;
    toStateId: string;
    rate: number;
    isManual: boolean;
    enabled: boolean;
    createdById: string;
    metadata: Record<string, unknown>;
  }): Promise<ExchangePair>;
  setPairEnabled(pairId: string, enabled: boolean): Promise<ExchangePair>;
  deletePair(pairId: string): Promise<void>;

  // ---- Assets + Wallets (cross-state lookups) ----
  findAssetById(assetId: string): Promise<ExchangeAssetRef | null>;
  findWalletById(walletId: string): Promise<ExchangeWalletRef | null>;

  // ---- Cross-state swap (atomic) ----
  /**
   * Executes the double-entry swap inside a single DB transaction:
   *   1. Debit `fromWallet.balance` by `fromAmount` (reject if
   *      negative post-balance).
   *   2. Credit `toWallet.balance` by `toAmount`.
   *   3. Insert two per-State `Transaction` rows (burn + mint) so
   *      each sovereign ledger sees its leg.
   *   4. Insert the `CrossStateTransaction` journal row.
   * All-or-nothing: if any step fails the entire transaction is
   * rolled back and a `failed` CrossStateTransaction row is
   * written outside the DB transaction for audit.
   */
  executeCrossStateTransfer(input: {
    pair: ExchangePair;
    fromWallet: ExchangeWalletRef;
    toWallet: ExchangeWalletRef;
    fromAsset: ExchangeAssetRef;
    toAsset: ExchangeAssetRef;
    fromAmount: number;
    toAmount: number;
    initiatedById: string;
    metadata: Record<string, unknown>;
  }): Promise<CrossStateTransaction>;

  // ---- Global audit log ----
  listCrossStateTransactions(filter: {
    stateId?: string;
    pairId?: string;
    initiatedById?: string;
    limit?: number;
    before?: Date | null;
  }): Promise<CrossStateTransaction[]>;
}

// ============================================================
// 5. Service
// ============================================================

export interface ExchangeServiceDeps {
  repo: ExchangeRepository;
  bus?: ModuleEventBus;
  engine?: PermissionsEngine;
}

export const EXCHANGE_EVENTS = {
  PairUpserted: "core.exchange.pair.upserted",
  PairDisabled: "core.exchange.pair.disabled",
  PairEnabled: "core.exchange.pair.enabled",
  SwapCompleted: "core.exchange.swap.completed",
  SwapFailed: "core.exchange.swap.failed",
} as const;

export interface UpsertPairInput {
  fromAssetId: string;
  toAssetId: string;
  rate: number;
  isManual?: boolean;
  enabled?: boolean;
  metadata?: Record<string, unknown>;
}

export interface CrossStateTransferInput {
  fromWalletId: string;
  toWalletId: string;
  /**
   * Quantity to debit from the source wallet (in the source
   * asset's display units). The destination amount is derived
   * from the active `ExchangePair.rate`.
   */
  amount: number;
  memo?: string;
  metadata?: Record<string, unknown>;
}

export class ExchangeService {
  private readonly repo: ExchangeRepository;
  private readonly bus: ModuleEventBus;
  private readonly engine: PermissionsEngine;

  constructor(deps: ExchangeServiceDeps) {
    this.repo = deps.repo;
    this.bus = deps.bus ?? eventBus;
    this.engine = deps.engine ?? permissionsEngine;
  }

  // --------------------------------------------------------
  // ExchangePair management
  // --------------------------------------------------------

  listPairs(
    filter: { stateId?: string; direction?: "outbound" | "inbound" | "both" } = {},
  ): Promise<ExchangePair[]> {
    return this.repo.listPairs(filter);
  }

  async getPair(fromAssetId: string, toAssetId: string): Promise<ExchangePair> {
    const pair = await this.repo.findPair(fromAssetId, toAssetId);
    if (!pair) {
      throw new ExchangeError(
        `No ExchangePair registered for ${fromAssetId} → ${toAssetId}.`,
        "pair_missing",
      );
    }
    return pair;
  }

  /**
   * Registers or updates a directional pair. The actor must be the
   * Sovereign of `fromAsset.stateId` (or hold `core.exchange.manage_pairs`
   * in that State) — the source side owns the rate. The destination
   * side is NOT consulted: if the target Sovereign wants to refuse
   * inbound trade, they just never open the reverse pair (or flip
   * `enabled = false` on any pair where `toAsset.stateId` is theirs).
   */
  async upsertPair(
    actor: ExchangeActor,
    input: UpsertPairInput,
  ): Promise<ExchangePair> {
    if (!Number.isFinite(input.rate) || input.rate <= 0) {
      throw new ExchangeError(
        "rate must be a positive finite number.",
        "invalid_input",
      );
    }
    if (input.fromAssetId === input.toAssetId) {
      throw new ExchangeError(
        "fromAsset and toAsset must differ.",
        "invalid_input",
      );
    }

    const [fromAsset, toAsset] = await Promise.all([
      this.repo.findAssetById(input.fromAssetId),
      this.repo.findAssetById(input.toAssetId),
    ]);
    if (!fromAsset) {
      throw new ExchangeError(
        `Source asset "${input.fromAssetId}" not found.`,
        "not_found",
      );
    }
    if (!toAsset) {
      throw new ExchangeError(
        `Destination asset "${input.toAssetId}" not found.`,
        "not_found",
      );
    }

    this.requireManagePairs(actor, fromAsset.stateId);

    const pair = await this.repo.upsertPair({
      fromAssetId: fromAsset.id,
      fromStateId: fromAsset.stateId,
      toAssetId: toAsset.id,
      toStateId: toAsset.stateId,
      rate: input.rate,
      isManual: input.isManual ?? true,
      enabled: input.enabled ?? true,
      createdById: actor.userId,
      metadata: input.metadata ?? {},
    });

    void this.bus.emit(EXCHANGE_EVENTS.PairUpserted, { pair }).catch(() => {});
    return pair;
  }

  /**
   * Flip the санкционный тумблер. Disabling a pair is how a
   * Sovereign enforces an economic blockade: all existing
   * references to the pair stay intact but `crossStateTransfer`
   * refuses to execute until it is re-enabled.
   */
  async setPairEnabled(
    actor: ExchangeActor,
    pairId: string,
    enabled: boolean,
  ): Promise<ExchangePair> {
    const existing = await this.repo.findPairById(pairId);
    if (!existing) {
      throw new ExchangeError(`Pair "${pairId}" not found.`, "not_found");
    }
    // Either side of the pair may toggle it: the source Sovereign
    // can refuse outbound trade, the destination Sovereign can
    // refuse inbound currency.
    const allowedInState =
      this.canManagePairs(actor, existing.fromStateId) ||
      this.canManagePairs(actor, existing.toStateId);
    if (!allowedInState) {
      throw new ExchangeError(
        "Only Sovereigns of either side (or holders of `core.exchange.manage_pairs`) may toggle this pair.",
        "forbidden",
      );
    }
    const updated = await this.repo.setPairEnabled(pairId, enabled);
    void this.bus
      .emit(
        enabled ? EXCHANGE_EVENTS.PairEnabled : EXCHANGE_EVENTS.PairDisabled,
        { pair: updated },
      )
      .catch(() => {});
    return updated;
  }

  // --------------------------------------------------------
  // Quotes
  // --------------------------------------------------------

  /**
   * Pure rate lookup — no funds are moved. Useful for the UI
   * ("Сколько я получу?") and for the internal pre-flight inside
   * `crossStateTransfer`.
   */
  async quote(
    fromAssetId: string,
    toAssetId: string,
    amount: number,
  ): Promise<Quote> {
    if (!Number.isFinite(amount) || amount <= 0) {
      throw new ExchangeError(
        "amount must be a positive finite number.",
        "invalid_input",
      );
    }
    const pair = await this.getPair(fromAssetId, toAssetId);
    if (!pair.enabled) {
      throw new ExchangeError(
        `Pair ${fromAssetId} → ${toAssetId} is currently blockaded (enabled=false).`,
        "pair_disabled",
      );
    }
    const toAsset = await this.repo.findAssetById(toAssetId);
    const toAmount = roundToDecimals(amount * pair.rate, toAsset?.decimals ?? 18);
    return { pair, fromAmount: amount, toAmount, rate: pair.rate };
  }

  // --------------------------------------------------------
  // Foreign balance lookup
  // --------------------------------------------------------

  /**
   * Returns the balance of a wallet that lives in a different
   * State than the caller's primary one. Access rules:
   *
   *   * Wallet owner → always allowed (users see their own money
   *     wherever it lives).
   *   * Sovereign of the wallet's State → always allowed.
   *   * Any actor holding `core.exchange.view_foreign` in the
   *     wallet's State → allowed.
   *
   * That last bullet is the opt-in door the target State can open
   * for trade counterparts without handing out full Sovereignty.
   */
  async getForeignBalance(
    actor: ExchangeActor,
    walletId: string,
  ): Promise<ExchangeWalletRef> {
    const wallet = await this.repo.findWalletById(walletId);
    if (!wallet) {
      throw new ExchangeError(`Wallet "${walletId}" not found.`, "not_found");
    }

    // Bypass #1 — the owner themselves.
    if (wallet.type === "PERSONAL" && wallet.userId === actor.userId) {
      return wallet;
    }

    const access = actor.states.get(wallet.stateId);
    if (!access) {
      throw new ExchangeError(
        `No access context for State "${wallet.stateId}" — build an ExchangeStateAccess first.`,
        "forbidden",
      );
    }

    // Bypass #2 — the Sovereign of that State.
    if (access.isOwner) return wallet;

    // Bypass #3 — explicit delegation.
    if (hasPerm(access.permissions, ExchangePermissions.ViewForeign)) {
      // Treasuries still require membership in the node or an ancestor.
      if (wallet.type === "TREASURY" && wallet.nodeId) {
        const member = this.engine.isMemberOfNodeOrAncestor(
          {
            userId: actor.userId,
            isOwner: access.isOwner,
            snapshot: access.snapshot,
          },
          wallet.nodeId,
        );
        if (!member.granted) {
          throw new ExchangeError(
            "Not a member of the target treasury node or any of its ancestors.",
            "forbidden",
          );
        }
      }
      return wallet;
    }

    throw new ExchangeError(
      `Missing permission "${ExchangePermissions.ViewForeign}" in State "${wallet.stateId}".`,
      "forbidden",
    );
  }

  // --------------------------------------------------------
  // crossStateTransfer
  // --------------------------------------------------------

  /**
   * Atomically debits `fromWallet` (State A, asset A) by `amount`
   * and credits `toWallet` (State B, asset B) by `amount * rate`,
   * using the active `ExchangePair(assetA → assetB)` to resolve
   * the rate. Writes a `CrossStateTransaction` row into the global
   * audit log and two per-State `Transaction` rows (burn + mint)
   * so each sovereign ledger preserves its own view.
   *
   * Refuses when:
   *   * no active ExchangePair exists (`pair_missing`);
   *   * the pair is disabled (`pair_disabled` — экономическая блокада);
   *   * the caller cannot spend from `fromWallet` (`forbidden`);
   *   * source balance is too low (`insufficient_funds`);
   *   * wallet and asset are mismatched (`currency_mismatch`).
   */
  async crossStateTransfer(
    actor: ExchangeActor,
    input: CrossStateTransferInput,
  ): Promise<CrossStateTransaction> {
    if (!Number.isFinite(input.amount) || input.amount <= 0) {
      throw new ExchangeError(
        "amount must be a positive finite number.",
        "invalid_input",
      );
    }
    if (input.fromWalletId === input.toWalletId) {
      throw new ExchangeError(
        "Source and destination wallets must differ.",
        "invalid_input",
      );
    }

    const [fromWallet, toWallet] = await Promise.all([
      this.repo.findWalletById(input.fromWalletId),
      this.repo.findWalletById(input.toWalletId),
    ]);
    if (!fromWallet) {
      throw new ExchangeError("Source wallet not found.", "not_found");
    }
    if (!toWallet) {
      throw new ExchangeError("Destination wallet not found.", "not_found");
    }
    if (!fromWallet.assetId || !toWallet.assetId) {
      throw new ExchangeError(
        "Both wallets must be bound to a StateAsset for cross-state transfers.",
        "invalid_input",
      );
    }
    if (fromWallet.stateId === toWallet.stateId) {
      throw new ExchangeError(
        "Both wallets live in the same State — use the intra-state exchange point instead.",
        "invalid_input",
      );
    }

    // Permission: the actor MUST be able to spend from `fromWallet`
    // inside its own State (source-side check only — receiving a
    // credit in another State does not require permissions there).
    this.assertCanSpendFromWallet(actor, fromWallet);

    const [fromAsset, toAsset] = await Promise.all([
      this.repo.findAssetById(fromWallet.assetId),
      this.repo.findAssetById(toWallet.assetId),
    ]);
    if (!fromAsset) {
      throw new ExchangeError("Source asset metadata missing.", "not_found");
    }
    if (!toAsset) {
      throw new ExchangeError("Destination asset metadata missing.", "not_found");
    }
    if (fromAsset.symbol !== fromWallet.currency) {
      throw new ExchangeError(
        "Source wallet currency is out of sync with its asset.",
        "currency_mismatch",
      );
    }
    if (toAsset.symbol !== toWallet.currency) {
      throw new ExchangeError(
        "Destination wallet currency is out of sync with its asset.",
        "currency_mismatch",
      );
    }

    const pair = await this.repo.findPair(fromAsset.id, toAsset.id);
    if (!pair) {
      throw new ExchangeError(
        `No ExchangePair registered for ${fromAsset.symbol} → ${toAsset.symbol}.`,
        "pair_missing",
      );
    }
    if (!pair.enabled) {
      throw new ExchangeError(
        `Trade on pair ${fromAsset.symbol} → ${toAsset.symbol} is currently blockaded.`,
        "blockade",
      );
    }

    if (ledgerAmount(fromWallet.balance).lt(ledgerAmount(input.amount))) {
      throw new ExchangeError(
        "Insufficient funds in the source wallet.",
        "insufficient_funds",
      );
    }

    const toAmount = roundToDecimals(input.amount * pair.rate, toAsset.decimals);
    if (toAmount <= 0) {
      throw new ExchangeError(
        "Computed destination amount is zero — raise the source amount or adjust the rate.",
        "invalid_input",
      );
    }

    const metadata: Record<string, unknown> = {
      ...(input.metadata ?? {}),
      ...(input.memo ? { memo: input.memo } : {}),
      source: {
        stateId: fromWallet.stateId,
        assetSymbol: fromAsset.symbol,
        walletType: fromWallet.type,
      },
      destination: {
        stateId: toWallet.stateId,
        assetSymbol: toAsset.symbol,
        walletType: toWallet.type,
      },
    };

    let journal: CrossStateTransaction;
    try {
      journal = await this.repo.executeCrossStateTransfer({
        pair,
        fromWallet,
        toWallet,
        fromAsset,
        toAsset,
        fromAmount: input.amount,
        toAmount,
        initiatedById: actor.userId,
        metadata,
      });
    } catch (err) {
      void this.bus
        .emit(EXCHANGE_EVENTS.SwapFailed, {
          pairId: pair.id,
          actor: actor.userId,
          reason: err instanceof Error ? err.message : String(err),
        })
        .catch(() => {});
      throw err;
    }

    void this.bus
      .emit(EXCHANGE_EVENTS.SwapCompleted, { transaction: journal })
      .catch(() => {});
    return journal;
  }

  // --------------------------------------------------------
  // Audit log
  // --------------------------------------------------------

  listCrossStateTransactions(filter: {
    stateId?: string;
    pairId?: string;
    initiatedById?: string;
    limit?: number;
    before?: Date | null;
  }): Promise<CrossStateTransaction[]> {
    return this.repo.listCrossStateTransactions(filter);
  }

  // --------------------------------------------------------
  // Internals
  // --------------------------------------------------------

  private requireManagePairs(actor: ExchangeActor, stateId: string): void {
    if (!this.canManagePairs(actor, stateId)) {
      throw new ExchangeError(
        `Only the Sovereign of "${stateId}" (or a holder of ` +
          `"${ExchangePermissions.ManagePairs}") may manage exchange pairs here.`,
        "forbidden",
      );
    }
  }

  private canManagePairs(actor: ExchangeActor, stateId: string): boolean {
    const access = actor.states.get(stateId);
    if (!access) return false;
    if (access.isOwner) return true;
    return hasPerm(access.permissions, ExchangePermissions.ManagePairs);
  }

  private assertCanSpendFromWallet(
    actor: ExchangeActor,
    wallet: ExchangeWalletRef,
  ): void {
    const access = actor.states.get(wallet.stateId);
    if (!access) {
      throw new ExchangeError(
        `No access context for source State "${wallet.stateId}".`,
        "forbidden",
      );
    }
    if (access.isOwner) return;

    if (wallet.type === "PERSONAL") {
      if (wallet.userId !== actor.userId) {
        throw new ExchangeError(
          "Cannot spend from another user's personal wallet.",
          "forbidden",
        );
      }
      // `wallet.transfer` is the baseline right to move personal funds.
      // It lives in the wallet module's namespace; the kernel checks
      // for the literal string so that it doesn't have to import the
      // module.
      if (!hasPerm(access.permissions, "wallet.transfer" as PermissionKey)) {
        throw new ExchangeError(
          'Missing permission "wallet.transfer" in the source State.',
          "forbidden",
        );
      }
      return;
    }

    // TREASURY
    if (!wallet.nodeId) {
      throw new ExchangeError(
        "Treasury wallet is missing its node binding.",
        "invalid_input",
      );
    }
    if (!hasPerm(access.permissions, "wallet.manage_treasury" as PermissionKey)) {
      throw new ExchangeError(
        'Missing permission "wallet.manage_treasury" on this treasury.',
        "forbidden",
      );
    }
    const member = this.engine.isMemberOfNodeOrAncestor(
      { userId: actor.userId, isOwner: access.isOwner, snapshot: access.snapshot },
      wallet.nodeId,
    );
    if (!member.granted) {
      throw new ExchangeError(
        "Not a member of the source treasury node or any of its ancestors.",
        "forbidden",
      );
    }
  }
}

// ============================================================
// 6. Helpers
// ============================================================

function ledgerAmount(n: number | Decimal): Decimal {
  return Decimal.isDecimal(n) ? n : new Decimal(n);
}

function hasPerm(
  held: ReadonlySet<PermissionKey>,
  required: PermissionKey,
): boolean {
  if (held.has("*")) return true;
  if (held.has(required)) return true;
  const [domain] = required.split(".");
  if (!domain) return false;
  return held.has(`${domain}.*` as PermissionKey);
}

/**
 * Rounds to `decimals` places through `toFixed` + parse. Mirrors
 * the helper in `modules/wallet/service.ts` — kept local so the
 * kernel does not depend on a module.
 */
export function roundToDecimals(value: number, decimals: number): number {
  if (!Number.isFinite(value)) return 0;
  const d = Math.max(0, Math.min(18, Math.trunc(decimals)));
  const factor = 10 ** d;
  return Math.round(value * factor) / factor;
}
