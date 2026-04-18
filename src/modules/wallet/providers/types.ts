/**
 * ChainProvider — контракт Web3-провайдера для core.wallet.
 * ------------------------------------------------------------
 * Абстрагирует конкретную сеть / SDK (viem, @solana/web3.js, …).
 * `WalletService` общается только через этот интерфейс, поэтому
 * добавить новую сеть = положить новый адаптер в `providers/` и
 * зарегистрировать его в `registry`.
 *
 * Правило разделения ответственности:
 *   * ЧТЕНИЕ on-chain состояния (балансы, статус транзакций,
 *     высота блока) — делает СЕРВЕР через RPC.
 *   * ПОДПИСЬ исходящих транзакций — делает КЛИЕНТ (MetaMask /
 *     Phantom / WalletConnect). Сервер лишь строит "intent" —
 *     сырые данные вызова `transfer(to, amount)`, которые потом
 *     клиент подписывает через viem/ethers.
 */

/** Человекочитаемое имя сети. */
export type NetworkId = string;

export interface ChainBalanceRead {
  /** Баланс в minor units (ERC-20 decimals-aware). */
  raw: bigint;
  /** Баланс в целых единицах (display). Может потерять точность
   *  на экзотических числах — первичная истина всегда в `raw`. */
  formatted: number;
  /** Высота блока, на которой прочитан баланс. */
  blockNumber: bigint;
}

export interface OnChainTransferIntent {
  /** Canonical EIP-155 chainId, напр. 1 / 137 / 10. */
  chainId: number | null;
  /** На какой контракт идёт вызов (ERC-20). */
  to: string;
  /** 0x-закодированные calldata (`transfer(address,uint256)`). */
  data: string;
  /** ETH-значение транзакции (всегда "0" для ERC-20 transfer). */
  value: string;
  /** Человекочитаемое описание для UI подтверждения. */
  humanReadable: {
    network: string;
    asset: string;
    recipient: string;
    amount: string;
    decimals: number;
  };
  /**
   * Версионирование payload'а — чтобы клиент мог отклонить
   * непонятный формат. Увеличиваем при любых breaking changes.
   */
  intentVersion: 1;
}

export type OnChainTxStatus = "pending" | "confirmed" | "failed" | "dropped";

export interface OnChainTxStatusRead {
  hash: string;
  status: OnChainTxStatus;
  /** Подтверждений. 0 = ещё mempool, ≥ 1 = в блоке. */
  confirmations: number;
  /** Номер блока, если транзакция уже замайнена. */
  blockNumber: bigint | null;
}

/**
 * Контракт сетевого адаптера. Все методы — idempotent-safe;
 * реализация обязана нормализовать адреса к каноничному виду
 * (EIP-55 для EVM) и защищаться от пустых/невалидных входных
 * данных, бросая `ChainProviderError`.
 */
export interface ChainProvider {
  /** Стабильный id — совпадает с `StateAsset.network`. */
  readonly network: NetworkId;
  /** EIP-155 chainId (null для Solana/совместимых). */
  readonly chainId: number | null;
  /** Человекочитаемое имя — для логов и UI. */
  readonly displayName: string;

  /** Получить баланс ERC-20 (или аналога) на заданном адресе. */
  readTokenBalance(args: {
    contractAddress: string;
    holderAddress: string;
    decimals: number;
  }): Promise<ChainBalanceRead>;

  /**
   * Построить unsigned intent для перевода токена. Сервер НИКОГДА
   * не подписывает — только описывает. Клиент обязан отразить
   * `humanReadable` в UI перед подписью (защита от фишинга).
   */
  buildTransferIntent(args: {
    contractAddress: string;
    fromAddress: string;
    toAddress: string;
    amountMinor: bigint;
    asset: { symbol: string; decimals: number };
  }): OnChainTransferIntent;

  /** Запросить статус уже отправленной транзакции по её хешу. */
  readTransactionStatus(hash: string): Promise<OnChainTxStatusRead>;

  /** Текущий блок — используется watcher'ом как курсор. */
  readLatestBlock(): Promise<bigint>;
}

export class ChainProviderError extends Error {
  constructor(
    message: string,
    public readonly code:
      | "unsupported_network"
      | "rpc_unavailable"
      | "invalid_address"
      | "invalid_payload"
      | "not_found",
  ) {
    super(message);
    this.name = "ChainProviderError";
  }
}
