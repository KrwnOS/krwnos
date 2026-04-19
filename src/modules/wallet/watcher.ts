/**
 * Treasury Watcher — синхронизация казны с блокчейном.
 * ------------------------------------------------------------
 * Опрашивает все TREASURY-кошельки, у которых актив
 * (`StateAsset`) имеет тип `ON_CHAIN` (или режим `HYBRID`) и
 * задан `externalAddress`. На каждом шаге:
 *   1. Достаёт RPC-провайдер для `asset.network` (через
 *      `ChainProviderRegistry`).
 *   2. Читает `balanceOf(externalAddress)` — баланс ERC-20 на
 *      реальном контракте `asset.contractAddress`.
 *   3. Нормализует `bigint → number` через `asset.decimals`.
 *   4. Если значение отличается от `wallet.balance` — пишет
 *      новое в БД и эмитит событие `core.wallet.balance.synced`.
 *   5. Обновляет `lastSyncedAt` / `lastSyncedBlock` как курсор.
 *
 * Дополнительно подтягивает статус незавершённых транзакций
 * (`status = pending`, `externalTxHash != null`): если чейн
 * сообщает `confirmed` или `failed` — переводит запись в
 * терминальное состояние.
 *
 * Запуск:
 *   * `npm run watcher:treasury` — один процесс на ноду.
 *   * В тестах можно дёрнуть `watcher.tick()` руками.
 */

import type { ModuleEventBus } from "@/types/kernel";
import type {
  ChainProvider,
  ChainProviderRegistry,
} from "./providers";
import { ChainProviderError, chainProviders } from "./providers";
import type { Decimal } from "@prisma/client/runtime/library";
import { ledgerDecimal } from "./money";
import type {
  Wallet,
  WalletAssetSummary,
  WalletTransaction,
} from "./service";
import {
  WALLET_EVENTS,
  fromMinorUnits,
  type BalanceSyncedEvent,
  type OnChainSettledEvent,
} from "./service";

// ------------------------------------------------------------
// Interfaces the watcher needs beyond `WalletRepository`.
// Kept narrow so a test can inject an in-memory fake.
// ------------------------------------------------------------

export interface WatcherPersistence {
  /** TREASURY wallets with an ON_CHAIN / HYBRID asset and a set externalAddress. */
  listOnChainTreasuries(opts?: { stateId?: string }): Promise<Wallet[]>;
  /** Assets lookup (stateId-scoped). */
  findAssetById(stateId: string, assetId: string): Promise<WalletAssetSummary | null>;
  /** Persist a new balance + sync cursor atomically. */
  updateWalletSyncedBalance(
    walletId: string,
    args: {
      balance: number | Decimal;
      lastSyncedAt: Date;
      lastSyncedBlock: bigint | null;
    },
  ): Promise<Wallet>;

  /** Pending on-chain transactions — queried by the reconcile pass. */
  listPendingOnChainTransactions(opts?: { stateId?: string }): Promise<WalletTransaction[]>;
  /** Flip a settled on-chain transaction into its terminal state. */
  settleOnChainTransaction(
    transactionId: string,
    args: { status: "completed" | "failed"; externalStatus: string },
  ): Promise<WalletTransaction>;

  /** All users holding a personal wallet linked to `walletId`'s asset. */
  listWatchersForWallet(wallet: Wallet): Promise<string[]>;
}

export interface TreasuryWatcherOptions {
  persistence: WatcherPersistence;
  bus: ModuleEventBus;
  providers?: ChainProviderRegistry;
  /** Poll interval in ms (default 30s). */
  intervalMs?: number;
  /** Ignore diffs smaller than this — avoids sync storms on dust. */
  dustThreshold?: number;
  /** Called on every tick with a compact summary (for logs). */
  onTick?: (report: WatcherTickReport) => void;
  /** Scope the watcher to a single State (default: all). */
  stateId?: string;
}

export interface WatcherTickReport {
  tickAt: Date;
  checkedWallets: number;
  updatedWallets: number;
  reconciledTransactions: number;
  errors: Array<{ walletId?: string; transactionId?: string; message: string }>;
}

// ------------------------------------------------------------
// Watcher
// ------------------------------------------------------------

export class TreasuryWatcher {
  private readonly persistence: WatcherPersistence;
  private readonly bus: ModuleEventBus;
  private readonly providers: ChainProviderRegistry;
  private readonly intervalMs: number;
  private readonly dustThreshold: number;
  private readonly onTick?: (report: WatcherTickReport) => void;
  private readonly stateId?: string;

  private timer: NodeJS.Timeout | null = null;
  private running = false;

  constructor(opts: TreasuryWatcherOptions) {
    this.persistence = opts.persistence;
    this.bus = opts.bus;
    this.providers = opts.providers ?? chainProviders();
    this.intervalMs = Math.max(1000, opts.intervalMs ?? 30_000);
    this.dustThreshold = Math.max(0, opts.dustThreshold ?? 0);
    this.onTick = opts.onTick;
    this.stateId = opts.stateId;
  }

  /** Run forever — stop() resolves the outstanding tick gracefully. */
  start(): void {
    if (this.timer) return;
    this.running = true;
    const loop = async () => {
      if (!this.running) return;
      try {
        await this.tick();
      } catch (err) {
        // Never let the loop die — log & keep going.
        // eslint-disable-next-line no-console
        console.error("[treasury-watcher] tick failed:", err);
      } finally {
        if (this.running) {
          this.timer = setTimeout(loop, this.intervalMs);
        }
      }
    };
    this.timer = setTimeout(loop, 0);
  }

  async stop(): Promise<void> {
    this.running = false;
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = null;
    }
  }

  /**
   * Single synchronization pass: balance sync + tx reconcile.
   * Exposed for tests and for CLI `watcher:treasury -- --once`.
   */
  async tick(): Promise<WatcherTickReport> {
    const report: WatcherTickReport = {
      tickAt: new Date(),
      checkedWallets: 0,
      updatedWallets: 0,
      reconciledTransactions: 0,
      errors: [],
    };

    await this.syncBalances(report);
    await this.reconcileTransactions(report);

    this.onTick?.(report);
    return report;
  }

  // ------------------------------------------------------------
  // Balance sync
  // ------------------------------------------------------------

  private async syncBalances(report: WatcherTickReport): Promise<void> {
    const wallets = await this.persistence.listOnChainTreasuries({
      stateId: this.stateId,
    });
    report.checkedWallets = wallets.length;

    for (const wallet of wallets) {
      if (!wallet.externalAddress || !wallet.assetId) continue;
      try {
        const asset = await this.persistence.findAssetById(
          wallet.stateId,
          wallet.assetId,
        );
        if (!asset || !asset.network || !asset.contractAddress) continue;
        if (asset.type !== "ON_CHAIN" && asset.mode !== "HYBRID") continue;

        const provider = this.providers.require(asset.network);
        const read = await provider.readTokenBalance({
          contractAddress: asset.contractAddress,
          holderAddress: wallet.externalAddress,
          decimals: asset.decimals,
        });

        // Skip dust / no-op diffs to avoid emitting noisy events.
        if (
          ledgerDecimal(read.formatted)
            .minus(wallet.balance)
            .abs()
            .lte(this.dustThreshold)
        ) {
          continue;
        }

        const updated = await this.persistence.updateWalletSyncedBalance(
          wallet.id,
          {
            balance: read.formatted,
            lastSyncedAt: new Date(),
            lastSyncedBlock: read.blockNumber,
          },
        );
        report.updatedWallets++;

        const recipientUserIds = await this.persistence.listWatchersForWallet(
          updated,
        );
        await this.bus.emit(WALLET_EVENTS.BalanceSynced, {
          stateId: updated.stateId,
          walletId: updated.id,
          balanceBefore: wallet.balance,
          balanceAfter: updated.balance,
          blockNumber: read.blockNumber,
          recipientUserIds,
        } satisfies BalanceSyncedEvent);
      } catch (err) {
        report.errors.push({
          walletId: wallet.id,
          message: humanise(err),
        });
      }
    }
  }

  // ------------------------------------------------------------
  // Tx reconciliation
  // ------------------------------------------------------------

  private async reconcileTransactions(report: WatcherTickReport): Promise<void> {
    const pendings = await this.persistence.listPendingOnChainTransactions({
      stateId: this.stateId,
    });

    for (const tx of pendings) {
      if (!tx.externalTxHash || !tx.assetId) continue;
      try {
        const asset = await this.persistence.findAssetById(
          tx.stateId,
          tx.assetId,
        );
        if (!asset || !asset.network) continue;

        const provider = this.providers.require(asset.network);
        const status = await provider.readTransactionStatus(tx.externalTxHash);

        if (status.status === "confirmed") {
          const settled = await this.persistence.settleOnChainTransaction(
            tx.id,
            { status: "completed", externalStatus: "confirmed" },
          );
          report.reconciledTransactions++;
          await this.bus.emit(WALLET_EVENTS.OnChainSettled, {
            stateId: settled.stateId,
            transaction: settled,
          } satisfies OnChainSettledEvent);
        } else if (status.status === "failed" || status.status === "dropped") {
          const settled = await this.persistence.settleOnChainTransaction(
            tx.id,
            { status: "failed", externalStatus: status.status },
          );
          report.reconciledTransactions++;
          await this.bus.emit(WALLET_EVENTS.OnChainSettled, {
            stateId: settled.stateId,
            transaction: settled,
          } satisfies OnChainSettledEvent);
        }
      } catch (err) {
        report.errors.push({
          transactionId: tx.id,
          message: humanise(err),
        });
      }
    }
  }
}

// ------------------------------------------------------------
// Helpers
// ------------------------------------------------------------

function humanise(err: unknown): string {
  if (err instanceof ChainProviderError) return `[${err.code}] ${err.message}`;
  if (err instanceof Error) return err.message;
  return String(err);
}

/**
 * Convenience: convert a `bigint` minor-unit balance into the
 * float display representation used by the ledger. Re-exported
 * from `./service` so consumers don't need a second import.
 */
export { fromMinorUnits };

// Re-export the provider type so the CLI script stays one import away.
export type { ChainProvider };
