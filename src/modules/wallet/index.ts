/**
 * core.wallet — финансовый модуль KrwnOS.
 * ------------------------------------------------------------
 * Регистрирует шесть прав:
 *   * `wallet.view_own`          — видеть свой кошелёк
 *   * `wallet.view_treasury`     — видеть казну узла (read-only)
 *   * `wallet.transfer`          — инициировать переводы
 *   * `wallet.manage_treasury`   — тратить с казны узла
 *   * `wallet.admin_mint`        — эмитировать валюту (Sovereign)
 *   * `wallet.manage_assets`     — Фабрика Валют (Sovereign)
 *
 * Отвечает за:
 *   * Личные кошельки пользователей (по одному на User × State ×
 *     StateAsset — у гражданина могут быть параллельные балансы
 *     в разных активах).
 *   * Казну узлов Вертикали (TreasuryWallet на каждом VerticalNode).
 *   * Двусторонние транзакции с атомарной проверкой баланса на
 *     уровне БД.
 *   * Mint / burn под контролем Суверена.
 *   * Фабрику Валют (Currency Factory) — Суверен выбирает режим
 *     учёта: LOCAL (виртуальное золото), EXTERNAL (импорт токена
 *     из цепочки) или HYBRID (леджер + on-chain withdraw).
 *   * Web3-слой: при `StateAsset.type = ON_CHAIN` сервис готовит
 *     неподписанный `intent` (viem/ERC-20 `transfer`), клиент
 *     подписывает его в MetaMask / WalletConnect, а Treasury
 *     Watcher синхронизирует балансы и статусы транзакций с
 *     реальным блокчейном.
 *
 * Публичный сервис:
 *   * `WalletService` (из `./wallet-service`) — короткий фасад:
 *     `getBalance(walletId)` и `transfer(from, to, amount)`.
 *   * `WalletCoreService` (из `./service`) — полный сервис со
 *     снапшотом/минтом/историей казны; плюс методы Web3:
 *     `prepareOnChainIntent()` и `confirmOnChainTransfer()`.
 *     Используется API-роутами.
 *   * `CurrencyFactoryService` (из `./settings`) — API Суверена
 *     для настройки национальной валюты и альтернативных активов
 *     государства.
 *   * `TreasuryWatcher` (из `./watcher`) — long-running процесс,
 *     опрашивающий RPC и синхронизирующий казну с on-chain
 *     реальностью.
 *   * `ChainProviderRegistry` (из `./providers`) — абстракция над
 *     viem/EVM и Solana-stub.
 *
 * HTTP-роуты лежат в `src/app/api/wallet/*` и импортируют только
 * публичные символы из этого файла.
 */

import type { KrwnModule } from "@/types/kernel";
import {
  WALLET_MODULE_SLUG,
  WalletPermissions,
  walletPermissionDescriptors,
} from "./permissions";

// --- Compact caller-facing API ---
export {
  WalletService,
  walletService,
  type ActorContext,
  type BalanceReadout,
  type TransferOptions,
  type WalletServiceDeps,
} from "./wallet-service";

// --- Full core service (snapshot-aware, used by /api/wallet/*) ---
export {
  WalletService as WalletCoreService,
  WalletAccessError,
  WALLET_EVENTS,
  DEFAULT_CURRENCY,
  type Wallet,
  type WalletAccessContext,
  type WalletAssetSummary,
  type WalletRepository,
  type WalletServiceDeps as WalletCoreServiceDeps,
  type WalletTransaction,
  type WalletTransactionCreatedEvent,
  type WalletCreatedEvent,
  type BalanceSyncedEvent,
  type OnChainBroadcastedEvent,
  type OnChainIntentPreparedEvent,
  type OnChainSettledEvent,
  type TransactionKind,
  type TransactionStatus,
  type TransferInput,
} from "./service";

export { Decimal, ledgerDecimal, moneyToNumber, roundLedgerAmount } from "./money";

export { WalletPermissions, WALLET_MODULE_SLUG } from "./permissions";
export {
  createPrismaWalletRepository,
  createPrismaCurrencyFactoryRepository,
  createPrismaWatcherPersistence,
} from "./repo";

export {
  applyWalletFine,
  parseWalletFinePayload,
  type WalletFinePayload,
  type ApplyWalletFineInput,
} from "./wallet-fine";

export {
  runNodeSubscriptionTick,
  periodKeyForSubscription,
  utcMondayWeekPeriodKey,
  type NodeSubscriptionTickResult,
} from "./node-subscription-tick";

// --- Currency Factory (Финансовый суверенитет) ---
export {
  CurrencyFactoryService,
  CurrencyFactoryError,
  CURRENCY_FACTORY_EVENTS,
  normaliseSymbol,
  clampDecimals,
  defaultModeFor,
  ensureTypeModeCompatible,
  normaliseCanMint,
  normaliseTaxRate,
  validateContractAddress,
  type CreateAssetInput,
  type CurrencyFactoryDeps,
  type CurrencyFactoryErrorCode,
  type CurrencyFactoryRepository,
  type KnownNetwork,
  type StateAsset,
  type StateAssetMode,
  type StateAssetType,
  type UpdateAssetPatch,
} from "./settings";

// --- Web3 providers (viem / Solana) ---
export {
  ChainProviderRegistry,
  ChainProviderError,
  EvmChainProvider,
  EVM_NETWORKS,
  SolanaChainProvider,
  chainProviders,
  type ChainProvider,
  type ChainBalanceRead,
  type EvmNetworkDescriptor,
  type EvmProviderOptions,
  type OnChainTransferIntent,
  type OnChainTxStatus,
  type OnChainTxStatusRead,
} from "./providers";

// --- Treasury Watcher (on-chain balance synchroniser) ---
export {
  TreasuryWatcher,
  fromMinorUnits,
  type TreasuryWatcherOptions,
  type WatcherPersistence,
  type WatcherTickReport,
} from "./watcher";
export { toMinorUnits } from "./service";

export const coreWalletModule: KrwnModule = {
  slug: WALLET_MODULE_SLUG,
  name: "Core Wallet",
  version: "0.1.0",
  description:
    "Финансовый уровень Государства: личные кошельки граждан, казна " +
    "узлов Вертикали и атомарные переводы внутренней валюты (Крона).",

  init() {
    return { permissions: walletPermissionDescriptors };
  },

  getWidget(ctx) {
    // Every citizen who holds view_own sees a small wallet widget.
    if (
      !ctx.permissions.has(WalletPermissions.ViewOwn) &&
      !ctx.permissions.has("*")
    ) {
      return null;
    }
    return {
      id: "wallet-card",
      title: "Мой кошелёк",
      // Dynamic UI lazy-loads the actual React component.
      component: null,
      requiredPermission: WalletPermissions.ViewOwn,
      defaultSize: "sm",
    };
  },

  getSettings(ctx) {
    // Sovereigns and holders of either ManageAssets or AdminMint
    // see the panel — the Currency Factory sits under the same
    // "monetary policy" umbrella as mint/burn.
    const canSee =
      ctx.permissions.has("*") ||
      ctx.permissions.has(WalletPermissions.ManageAssets) ||
      ctx.permissions.has(WalletPermissions.AdminMint);
    if (!canSee) return null;
    return {
      // Flagship settings title for this module — every other
      // financial knob (mint, treasury caps, withdraw routes) will
      // hang off the same panel in the UI.
      title: "Настройка национальной валюты",
      component: null,
      requiredPermission: WalletPermissions.ManageAssets,
    };
  },
};
