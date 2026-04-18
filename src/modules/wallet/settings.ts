/**
 * Currency Factory — Настройка национальной валюты.
 * ------------------------------------------------------------
 * Финансовый суверенитет KrwnOS. Суверен государства выбирает
 * одну из трёх моделей учёта для каждого актива:
 *
 *   * `LOCAL`    — Local Ledger. Баланс живёт исключительно в
 *                  Postgres (`Wallet.balance`). Быстро, бесплатно,
 *                  без блокчейна. Идеально для закрытых компаний
 *                  и малых кланов.
 *   * `EXTERNAL` — Импорт существующего токена в цепочке
 *                  (ERC-20 / SPL / ...). Каждая транзакция
 *                  привязана к реальному контракту; внутренний
 *                  баланс — кэш из on-chain индексации.
 *   * `HYBRID`   — Расчёты происходят мгновенно в БД, но актив
 *                  может быть "выведен" (Withdraw) в реальную
 *                  крипту по `exchangeRate`.
 *
 * Сервис сознательно не зависит от Next.js / Prisma / React. Всё
 * инъектируется через `CurrencyFactoryRepository`, чтобы его можно
 * было прогонять в unit-тестах на in-memory store.
 *
 * Публичные операции (все — через `WalletPermissions.ManageAssets`,
 * Суверен обходит проверку):
 *
 *   * `listAssets(stateId)`                — перечень активов State.
 *   * `getAsset(stateId, assetId)`         — один актив.
 *   * `getPrimaryAsset(stateId)`           — национальная валюта.
 *   * `createAsset(stateId, input)`        — зарегистрировать актив.
 *   * `updateAsset(stateId, id, patch)`    — поменять метаданные /
 *                                            курс / сеть.
 *   * `setPrimaryAsset(stateId, assetId)`  — сделать актив флагом
 *                                            государства.
 *   * `retireAsset(stateId, assetId)`      — снять с оборота
 *                                            (только если нет
 *                                            активных кошельков).
 *   * `ensureDefaultAsset(stateId)`        — создать дефолтный KRN
 *                                            при отсутствии активов
 *                                            (вызывается при setup).
 */

import type { PermissionKey } from "@/types/kernel";
import { WalletPermissions } from "./permissions";
import type { WalletAccessContext } from "./service";
import { WalletAccessError } from "./service";

// ------------------------------------------------------------
// Domain types
// ------------------------------------------------------------

export type StateAssetType = "INTERNAL" | "ON_CHAIN";
export type StateAssetMode = "LOCAL" | "EXTERNAL" | "HYBRID";

/**
 * Known on-chain networks. The set is open (any string is
 * accepted) but these labels are normalised and validated by
 * `validateContractAddress`. Solana uses base58, everything
 * else here is assumed EVM.
 */
export type KnownNetwork =
  | "ethereum"
  | "polygon"
  | "arbitrum"
  | "base"
  | "bsc"
  | "optimism"
  | "avalanche"
  | "solana"
  | "tron"
  | "sui";

export interface StateAsset {
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
  /**
   * Эмиссия. When `true`, `wallet.admin_mint` holders may print
   * fresh units. Only meaningful for INTERNAL / HYBRID assets —
   * ON_CHAIN + EXTERNAL is always `false` (we do not own the
   * third-party contract).
   */
  canMint: boolean;
  /**
   * Налог штата. Fractional rate in `[0..1]` auto-withheld on
   * every successful ledger transfer and routed to the State's
   * primary Treasury. ON_CHAIN assets ignore this (we cannot
   * tax a transaction that happens on a foreign chain).
   */
  taxRate: number;
  /**
   * Публичность. When `true`, the circulating supply of this
   * asset is readable without auth via `/api/wallet/supply/:id`.
   */
  publicSupply: boolean;
  metadata: Record<string, unknown>;
  createdAt: Date;
  updatedAt: Date;
}

export interface CreateAssetInput {
  symbol: string;
  name: string;
  type: StateAssetType;
  mode?: StateAssetMode;
  contractAddress?: string | null;
  network?: string | null;
  chainId?: number | null;
  decimals?: number;
  /** Required when `mode = HYBRID`. */
  exchangeRate?: number | null;
  icon?: string | null;
  color?: string | null;
  /**
   * Declare this asset as the State's national currency at creation
   * time. Equivalent to calling `setPrimaryAsset` right after.
   */
  isPrimary?: boolean;
  /** Эмиссия. Defaults to `true` for INTERNAL, `false` for ON_CHAIN. */
  canMint?: boolean;
  /** Налог штата, `[0..1]`. Defaults to 0. */
  taxRate?: number;
  /** Публичность общего объёма. Defaults to `false`. */
  publicSupply?: boolean;
  metadata?: Record<string, unknown>;
}

export interface UpdateAssetPatch {
  name?: string;
  mode?: StateAssetMode;
  contractAddress?: string | null;
  network?: string | null;
  chainId?: number | null;
  decimals?: number;
  exchangeRate?: number | null;
  icon?: string | null;
  color?: string | null;
  canMint?: boolean;
  taxRate?: number;
  publicSupply?: boolean;
  metadata?: Record<string, unknown>;
}

// ------------------------------------------------------------
// Repository contract
// ------------------------------------------------------------

/**
 * Persistence boundary. Implementations MUST:
 *   * keep `symbol` unique per `stateId` (enforced in schema via
 *     `@@unique([stateId, symbol])`),
 *   * expose `countWalletsForAsset` so the service can refuse
 *     destructive operations on actively-used assets,
 *   * run `setPrimaryAsset` in a transaction that clears the old
 *     primary flag before setting the new one — there MUST be at
 *     most one primary per State.
 */
export interface CurrencyFactoryRepository {
  listAssets(stateId: string): Promise<StateAsset[]>;
  findAsset(stateId: string, assetId: string): Promise<StateAsset | null>;
  findAssetBySymbol(stateId: string, symbol: string): Promise<StateAsset | null>;
  findPrimaryAsset(stateId: string): Promise<StateAsset | null>;

  createAsset(input: {
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
    metadata: Record<string, unknown>;
  }): Promise<StateAsset>;

  updateAsset(
    stateId: string,
    assetId: string,
    patch: {
      name?: string;
      mode?: StateAssetMode;
      contractAddress?: string | null;
      network?: string | null;
      chainId?: number | null;
      decimals?: number;
      exchangeRate?: number | null;
      icon?: string | null;
      color?: string | null;
      canMint?: boolean;
      taxRate?: number;
      publicSupply?: boolean;
      metadata?: Record<string, unknown>;
    },
  ): Promise<StateAsset>;

  /**
   * Total circulating supply of `assetId`: sum of all non-negative
   * balances across personal + treasury wallets. Used by the
   * public `/api/wallet/supply/:id` endpoint when `publicSupply`
   * is enabled.
   */
  sumAssetSupply(stateId: string, assetId: string): Promise<number>;

  /**
   * Atomically clear every other asset's `isPrimary` in this State
   * and set the given one. Returns the updated asset.
   */
  setPrimaryAsset(stateId: string, assetId: string): Promise<StateAsset>;

  /** Hard-delete. Caller must check `countWalletsForAsset` first. */
  deleteAsset(stateId: string, assetId: string): Promise<void>;

  /** Count of non-zero / any Wallet rows pointing to this asset. */
  countWalletsForAsset(stateId: string, assetId: string): Promise<number>;
}

// ------------------------------------------------------------
// Service
// ------------------------------------------------------------

export interface CurrencyFactoryDeps {
  repo: CurrencyFactoryRepository;
}

/**
 * Events published by the service. Not wired to the event bus here
 * — the caller is expected to relay them (or the API route that
 * invokes the service does). Kept as named constants so any module
 * can subscribe by key.
 */
export const CURRENCY_FACTORY_EVENTS = {
  AssetCreated: "core.wallet.asset.created",
  AssetUpdated: "core.wallet.asset.updated",
  AssetRetired: "core.wallet.asset.retired",
  PrimaryChanged: "core.wallet.asset.primary_changed",
} as const;

/** Domain-agnostic error; maps 1:1 onto `WalletAccessError` codes. */
export type CurrencyFactoryErrorCode = WalletAccessError["code"] | "conflict";

export class CurrencyFactoryError extends Error {
  constructor(message: string, public readonly code: CurrencyFactoryErrorCode) {
    super(message);
    this.name = "CurrencyFactoryError";
  }
}

export class CurrencyFactoryService {
  private readonly repo: CurrencyFactoryRepository;

  constructor(deps: CurrencyFactoryDeps) {
    this.repo = deps.repo;
  }

  // --------------------------------------------------------
  // Reads — ManageAssets not strictly required; any caller
  // that reached this point has already been authenticated.
  // --------------------------------------------------------

  async listAssets(stateId: string): Promise<StateAsset[]> {
    return this.repo.listAssets(stateId);
  }

  async getAsset(stateId: string, assetId: string): Promise<StateAsset> {
    const asset = await this.repo.findAsset(stateId, assetId);
    if (!asset) {
      throw new CurrencyFactoryError(
        `Asset "${assetId}" not found in this State.`,
        "not_found",
      );
    }
    return asset;
  }

  async getPrimaryAsset(stateId: string): Promise<StateAsset | null> {
    return this.repo.findPrimaryAsset(stateId);
  }

  // --------------------------------------------------------
  // Writes — gated by ManageAssets (Sovereign bypasses).
  // --------------------------------------------------------

  async createAsset(
    stateId: string,
    ctx: WalletAccessContext,
    input: CreateAssetInput,
  ): Promise<StateAsset> {
    this.requireSovereignOrManager(ctx);

    const symbol = normaliseSymbol(input.symbol);
    const name = input.name?.trim();
    if (!name || name.length === 0) {
      throw new CurrencyFactoryError("Asset name is required.", "invalid_input");
    }
    if (name.length > 64) {
      throw new CurrencyFactoryError(
        "Asset name must be ≤ 64 characters.",
        "invalid_input",
      );
    }

    const type: StateAssetType = input.type;
    const mode: StateAssetMode = input.mode ?? defaultModeFor(type);
    ensureTypeModeCompatible(type, mode);

    const decimals = clampDecimals(input.decimals ?? 18);
    const contractAddress = (input.contractAddress ?? null) || null;
    const network = (input.network ?? null) || null;
    const chainId = input.chainId ?? null;

    if (mode === "EXTERNAL" || mode === "HYBRID") {
      if (!contractAddress) {
        throw new CurrencyFactoryError(
          `contractAddress is required for mode "${mode}".`,
          "invalid_input",
        );
      }
      if (!network) {
        throw new CurrencyFactoryError(
          `network is required for mode "${mode}".`,
          "invalid_input",
        );
      }
      validateContractAddress(network, contractAddress);
    } else {
      if (contractAddress || network) {
        throw new CurrencyFactoryError(
          "LOCAL mode does not accept contractAddress / network.",
          "invalid_input",
        );
      }
    }

    const exchangeRate = input.exchangeRate ?? null;
    if (mode === "HYBRID") {
      if (exchangeRate === null || !Number.isFinite(exchangeRate) || exchangeRate <= 0) {
        throw new CurrencyFactoryError(
          "HYBRID mode requires a positive exchangeRate.",
          "invalid_input",
        );
      }
    } else if (exchangeRate !== null) {
      throw new CurrencyFactoryError(
        "exchangeRate is only meaningful in HYBRID mode.",
        "invalid_input",
      );
    }

    const existing = await this.repo.findAssetBySymbol(stateId, symbol);
    if (existing) {
      throw new CurrencyFactoryError(
        `Asset with symbol "${symbol}" already exists in this State.`,
        "conflict",
      );
    }

    const canMint = normaliseCanMint(input.canMint, type, mode);
    const taxRate = normaliseTaxRate(input.taxRate, type);
    const publicSupply = input.publicSupply ?? false;

    const asset = await this.repo.createAsset({
      stateId,
      symbol,
      name,
      type,
      mode,
      contractAddress,
      network,
      chainId,
      decimals,
      exchangeRate,
      icon: input.icon ?? null,
      color: input.color ?? null,
      isPrimary: false,
      canMint,
      taxRate,
      publicSupply,
      metadata: input.metadata ?? {},
    });

    if (input.isPrimary) {
      return this.repo.setPrimaryAsset(stateId, asset.id);
    }

    // If this is the first asset of the State, elevate it to
    // primary automatically — a State must always have one.
    const all = await this.repo.listAssets(stateId);
    if (all.length === 1) {
      return this.repo.setPrimaryAsset(stateId, asset.id);
    }

    return asset;
  }

  async updateAsset(
    stateId: string,
    ctx: WalletAccessContext,
    assetId: string,
    patch: UpdateAssetPatch,
  ): Promise<StateAsset> {
    this.requireSovereignOrManager(ctx);
    const current = await this.getAsset(stateId, assetId);

    const nextMode = patch.mode ?? current.mode;
    ensureTypeModeCompatible(current.type, nextMode);

    const nextContract =
      patch.contractAddress === undefined
        ? current.contractAddress
        : patch.contractAddress;
    const nextNetwork =
      patch.network === undefined ? current.network : patch.network;

    if (nextMode === "EXTERNAL" || nextMode === "HYBRID") {
      if (!nextContract) {
        throw new CurrencyFactoryError(
          `contractAddress is required for mode "${nextMode}".`,
          "invalid_input",
        );
      }
      if (!nextNetwork) {
        throw new CurrencyFactoryError(
          `network is required for mode "${nextMode}".`,
          "invalid_input",
        );
      }
      validateContractAddress(nextNetwork, nextContract);
    } else if (nextMode === "LOCAL") {
      if (nextContract || nextNetwork) {
        throw new CurrencyFactoryError(
          "LOCAL mode does not accept contractAddress / network.",
          "invalid_input",
        );
      }
    }

    const nextRate =
      patch.exchangeRate === undefined ? current.exchangeRate : patch.exchangeRate;
    if (nextMode === "HYBRID") {
      if (nextRate === null || nextRate === undefined || !Number.isFinite(nextRate) || nextRate <= 0) {
        throw new CurrencyFactoryError(
          "HYBRID mode requires a positive exchangeRate.",
          "invalid_input",
        );
      }
    } else if (nextRate !== null && nextRate !== undefined) {
      throw new CurrencyFactoryError(
        "exchangeRate is only meaningful in HYBRID mode.",
        "invalid_input",
      );
    }

    const nextDecimals =
      patch.decimals === undefined ? current.decimals : clampDecimals(patch.decimals);

    // Renaming is fine; changing `symbol` is not — wallets denormalise it.
    const nextName = patch.name?.trim();
    if (patch.name !== undefined) {
      if (!nextName || nextName.length === 0) {
        throw new CurrencyFactoryError("Asset name is required.", "invalid_input");
      }
      if (nextName.length > 64) {
        throw new CurrencyFactoryError(
          "Asset name must be ≤ 64 characters.",
          "invalid_input",
        );
      }
    }

    const nextCanMint =
      patch.canMint === undefined
        ? current.canMint
        : normaliseCanMint(patch.canMint, current.type, nextMode);
    const nextTaxRate =
      patch.taxRate === undefined
        ? current.taxRate
        : normaliseTaxRate(patch.taxRate, current.type);
    const nextPublicSupply =
      patch.publicSupply === undefined ? current.publicSupply : patch.publicSupply;

    return this.repo.updateAsset(stateId, assetId, {
      name: nextName,
      mode: nextMode,
      contractAddress: nextContract,
      network: nextNetwork,
      chainId: patch.chainId,
      decimals: nextDecimals,
      exchangeRate: nextRate ?? null,
      icon: patch.icon,
      color: patch.color,
      canMint: nextCanMint,
      taxRate: nextTaxRate,
      publicSupply: nextPublicSupply,
      metadata: patch.metadata,
    });
  }

  /**
   * Public supply readout. Returns `null` if the asset has
   * `publicSupply = false` — callers should translate that into
   * a 403 to keep the privacy intent explicit.
   */
  async getPublicSupply(
    stateId: string,
    assetId: string,
  ): Promise<{ asset: StateAsset; supply: number } | null> {
    const asset = await this.getAsset(stateId, assetId);
    if (!asset.publicSupply) return null;
    const supply = await this.repo.sumAssetSupply(stateId, assetId);
    return { asset, supply };
  }

  /**
   * Promote `assetId` to the State's primary (national) currency.
   * Exactly one asset may be primary — the repository layer clears
   * the flag on every sibling inside a transaction.
   */
  async setPrimaryAsset(
    stateId: string,
    ctx: WalletAccessContext,
    assetId: string,
  ): Promise<StateAsset> {
    this.requireSovereignOrManager(ctx);
    await this.getAsset(stateId, assetId); // existence check
    return this.repo.setPrimaryAsset(stateId, assetId);
  }

  /**
   * Decommission an asset. Hard-deletes iff no wallets reference
   * it — otherwise throws `conflict`. Returns the deleted asset
   * so the caller can audit.
   */
  async retireAsset(
    stateId: string,
    ctx: WalletAccessContext,
    assetId: string,
  ): Promise<StateAsset> {
    this.requireSovereignOrManager(ctx);
    const asset = await this.getAsset(stateId, assetId);

    if (asset.isPrimary) {
      throw new CurrencyFactoryError(
        "Cannot retire the primary asset — set another asset as primary first.",
        "conflict",
      );
    }

    const refs = await this.repo.countWalletsForAsset(stateId, assetId);
    if (refs > 0) {
      throw new CurrencyFactoryError(
        `Asset is in use by ${refs} wallet(s); withdraw / migrate them first.`,
        "conflict",
      );
    }

    await this.repo.deleteAsset(stateId, assetId);
    return asset;
  }

  /**
   * Guarantees the State has at least one asset by creating a
   * default `KRN` (Local Ledger) row when the registry is empty.
   * Idempotent — returns the existing primary if one is present.
   *
   * Intended to be called during State setup / first-run.
   */
  async ensureDefaultAsset(stateId: string): Promise<StateAsset> {
    const primary = await this.repo.findPrimaryAsset(stateId);
    if (primary) return primary;

    const existing = await this.repo.listAssets(stateId);
    if (existing.length > 0) {
      return this.repo.setPrimaryAsset(stateId, existing[0]!.id);
    }

    const krona = await this.repo.createAsset({
      stateId,
      symbol: "KRN",
      name: "Krona",
      type: "INTERNAL",
      mode: "LOCAL",
      contractAddress: null,
      network: null,
      chainId: null,
      decimals: 18,
      exchangeRate: null,
      icon: "⚜",
      color: "#C9A227",
      isPrimary: true,
      canMint: true,
      taxRate: 0,
      publicSupply: false,
      metadata: { seed: true },
    });
    return krona;
  }

  // --------------------------------------------------------
  // Internals
  // --------------------------------------------------------

  private requireSovereignOrManager(ctx: WalletAccessContext): void {
    if (ctx.isOwner) return;
    if (hasPerm(ctx.permissions, WalletPermissions.ManageAssets)) return;
    if (hasPerm(ctx.permissions, WalletPermissions.AdminMint)) return;
    throw new WalletAccessError(
      `Missing permission "${WalletPermissions.ManageAssets}".`,
      "forbidden",
    );
  }
}

// ------------------------------------------------------------
// Validation helpers (exported for tests)
// ------------------------------------------------------------

export function normaliseSymbol(raw: string): string {
  const s = (raw ?? "").trim().toUpperCase();
  if (!/^[A-Z0-9]{2,16}$/.test(s)) {
    throw new CurrencyFactoryError(
      "Symbol must be 2..16 uppercase letters / digits.",
      "invalid_input",
    );
  }
  return s;
}

export function clampDecimals(n: number): number {
  if (!Number.isFinite(n)) {
    throw new CurrencyFactoryError("decimals must be a finite number.", "invalid_input");
  }
  const int = Math.floor(n);
  if (int < 0 || int > 36) {
    throw new CurrencyFactoryError("decimals must be in [0, 36].", "invalid_input");
  }
  return int;
}

export function defaultModeFor(type: StateAssetType): StateAssetMode {
  return type === "INTERNAL" ? "LOCAL" : "EXTERNAL";
}

/**
 * `canMint` is only meaningful for assets whose supply the State
 * controls. For pure on-chain EXTERNAL tokens (a foreign ERC-20)
 * we force it to `false` — there's no contract-owner key in
 * KrwnOS that could sign a `mint()` call.
 */
export function normaliseCanMint(
  requested: boolean | undefined,
  type: StateAssetType,
  mode: StateAssetMode,
): boolean {
  if (type === "ON_CHAIN" && mode === "EXTERNAL") return false;
  if (requested === undefined) return type === "INTERNAL";
  return Boolean(requested);
}

/**
 * Tax rate must land in `[0..1]`. For pure on-chain EXTERNAL
 * assets we refuse any non-zero rate because the State has no
 * way to intercept a transfer executed by a third-party contract.
 */
export function normaliseTaxRate(
  requested: number | undefined,
  type: StateAssetType,
): number {
  if (requested === undefined) return 0;
  if (!Number.isFinite(requested)) {
    throw new CurrencyFactoryError(
      "taxRate must be a finite number.",
      "invalid_input",
    );
  }
  if (requested < 0 || requested > 1) {
    throw new CurrencyFactoryError(
      "taxRate must be in [0, 1] (fraction, not percent).",
      "invalid_input",
    );
  }
  if (type === "ON_CHAIN" && requested > 0) {
    throw new CurrencyFactoryError(
      "ON_CHAIN assets cannot apply a State tax — the contract is not ours.",
      "invalid_input",
    );
  }
  return requested;
}

export function ensureTypeModeCompatible(
  type: StateAssetType,
  mode: StateAssetMode,
): void {
  if (type === "INTERNAL" && mode === "EXTERNAL") {
    throw new CurrencyFactoryError(
      "INTERNAL assets cannot use EXTERNAL mode.",
      "invalid_input",
    );
  }
  if (type === "ON_CHAIN" && mode === "LOCAL") {
    throw new CurrencyFactoryError(
      "ON_CHAIN assets cannot use LOCAL mode.",
      "invalid_input",
    );
  }
  // INTERNAL + HYBRID  -> ok (ledger with withdraw peg)
  // ON_CHAIN + HYBRID  -> ok (on-chain with optional off-chain mirror)
  // INTERNAL + LOCAL   -> ok (pure virtual)
  // ON_CHAIN + EXTERNAL -> ok (pure passthrough)
}

/**
 * Surface-level sanity check. The real source of truth is the
 * blockchain node / explorer — we only make sure the user didn't
 * paste an obviously malformed address. Full checksum validation
 * (EIP-55, base58 + curve check for Solana) lives in the adapter.
 */
export function validateContractAddress(network: string, address: string): void {
  const trimmed = address.trim();
  if (trimmed.length === 0) {
    throw new CurrencyFactoryError(
      "contractAddress must not be empty.",
      "invalid_input",
    );
  }
  const net = network.trim().toLowerCase();
  if (net === "solana") {
    if (!/^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(trimmed)) {
      throw new CurrencyFactoryError(
        "Invalid Solana base58 address.",
        "invalid_input",
      );
    }
    return;
  }
  if (net === "tron") {
    if (!/^T[1-9A-HJ-NP-Za-km-z]{33}$/.test(trimmed)) {
      throw new CurrencyFactoryError("Invalid Tron base58 address.", "invalid_input");
    }
    return;
  }
  // Default to EVM (ethereum / polygon / arbitrum / base / bsc / …).
  if (!/^0x[a-fA-F0-9]{40}$/.test(trimmed)) {
    throw new CurrencyFactoryError(
      `Invalid EVM address for network "${network}".`,
      "invalid_input",
    );
  }
}

// ------------------------------------------------------------
// Helpers
// ------------------------------------------------------------

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
