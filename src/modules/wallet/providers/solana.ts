/**
 * Solana ChainProvider — заглушка (TBD).
 * ------------------------------------------------------------
 * Для первой версии KrwnOS поддерживаем только EVM-сети. Solana
 * требует `@solana/web3.js` + SPL ATA derivation, что ощутимо
 * увеличит bundle. Оставляем скелет, чтобы registry мог честно
 * сообщать "network unsupported" вместо крэша.
 *
 * Когда появится реальная реализация — просто замените методы,
 * ничего в остальном коде править не нужно.
 */

import type {
  ChainProvider,
  ChainBalanceRead,
  OnChainTransferIntent,
  OnChainTxStatusRead,
} from "./types";
import { ChainProviderError } from "./types";

export class SolanaChainProvider implements ChainProvider {
  readonly network = "solana";
  readonly chainId = null;
  readonly displayName = "Solana";

  readTokenBalance(): Promise<ChainBalanceRead> {
    return Promise.reject(
      new ChainProviderError(
        "Solana provider is not implemented yet — use an EVM-compatible network.",
        "unsupported_network",
      ),
    );
  }

  buildTransferIntent(): OnChainTransferIntent {
    throw new ChainProviderError(
      "Solana provider is not implemented yet — use an EVM-compatible network.",
      "unsupported_network",
    );
  }

  readTransactionStatus(): Promise<OnChainTxStatusRead> {
    return Promise.reject(
      new ChainProviderError(
        "Solana provider is not implemented yet — use an EVM-compatible network.",
        "unsupported_network",
      ),
    );
  }

  readLatestBlock(): Promise<bigint> {
    return Promise.reject(
      new ChainProviderError(
        "Solana provider is not implemented yet — use an EVM-compatible network.",
        "unsupported_network",
      ),
    );
  }
}
