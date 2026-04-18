/**
 * EVM ChainProvider — реализация на viem.
 * ------------------------------------------------------------
 * Поддерживает любой EVM-совместимый чейн: Ethereum mainnet,
 * Polygon, Arbitrum, Optimism, Base, BSC, Avalanche, …
 *
 * Сервер только ЧИТАЕТ и ГОТОВИТ intent; подпись и отправку
 * выполняет клиент (MetaMask / WalletConnect / Coinbase Wallet).
 * Поэтому здесь нет ни private keys, ни `writeContract`.
 *
 * RPC-URL должен быть задан через env. Рекомендуемые переменные:
 *   KRWN_RPC_ETHEREUM   = https://mainnet.infura.io/v3/...
 *   KRWN_RPC_POLYGON    = https://polygon-rpc.com
 *   KRWN_RPC_ARBITRUM   = https://arb1.arbitrum.io/rpc
 *   KRWN_RPC_OPTIMISM   = https://mainnet.optimism.io
 *   KRWN_RPC_BASE       = https://mainnet.base.org
 *   KRWN_RPC_BSC        = https://bsc-dataseed.binance.org
 *   KRWN_RPC_AVALANCHE  = https://api.avax.network/ext/bc/C/rpc
 *
 * Provider `network` = название сети в нижнем регистре, совпадает
 * с `StateAsset.network`.
 */

import {
  createPublicClient,
  encodeFunctionData,
  formatUnits,
  getContract,
  http,
  isAddress,
  type Address,
  type Hex,
  type PublicClient,
} from "viem";

import type {
  ChainProvider,
  ChainBalanceRead,
  OnChainTransferIntent,
  OnChainTxStatusRead,
} from "./types";
import { ChainProviderError } from "./types";

// ------------------------------------------------------------
// Minimal ERC-20 ABI (balanceOf / transfer)
// ------------------------------------------------------------

const ERC20_ABI = [
  {
    type: "function",
    name: "balanceOf",
    stateMutability: "view",
    inputs: [{ name: "owner", type: "address" }],
    outputs: [{ name: "", type: "uint256" }],
  },
  {
    type: "function",
    name: "transfer",
    stateMutability: "nonpayable",
    inputs: [
      { name: "to", type: "address" },
      { name: "amount", type: "uint256" },
    ],
    outputs: [{ name: "", type: "bool" }],
  },
] as const;

// ------------------------------------------------------------
// Known EVM networks
// ------------------------------------------------------------

export interface EvmNetworkDescriptor {
  network: string;
  chainId: number;
  displayName: string;
  /** Default RPC endpoint used when the env override is missing. */
  defaultRpcUrl?: string;
  /** Number of block confirmations to treat a tx as final. */
  finalityBlocks: number;
  /** Env var holding the RPC url (preferred over default). */
  rpcEnvVar: string;
}

export const EVM_NETWORKS: Record<string, EvmNetworkDescriptor> = {
  ethereum: {
    network: "ethereum",
    chainId: 1,
    displayName: "Ethereum",
    finalityBlocks: 12,
    rpcEnvVar: "KRWN_RPC_ETHEREUM",
  },
  polygon: {
    network: "polygon",
    chainId: 137,
    displayName: "Polygon",
    defaultRpcUrl: "https://polygon-rpc.com",
    finalityBlocks: 20,
    rpcEnvVar: "KRWN_RPC_POLYGON",
  },
  arbitrum: {
    network: "arbitrum",
    chainId: 42161,
    displayName: "Arbitrum One",
    defaultRpcUrl: "https://arb1.arbitrum.io/rpc",
    finalityBlocks: 5,
    rpcEnvVar: "KRWN_RPC_ARBITRUM",
  },
  optimism: {
    network: "optimism",
    chainId: 10,
    displayName: "Optimism",
    defaultRpcUrl: "https://mainnet.optimism.io",
    finalityBlocks: 5,
    rpcEnvVar: "KRWN_RPC_OPTIMISM",
  },
  base: {
    network: "base",
    chainId: 8453,
    displayName: "Base",
    defaultRpcUrl: "https://mainnet.base.org",
    finalityBlocks: 5,
    rpcEnvVar: "KRWN_RPC_BASE",
  },
  bsc: {
    network: "bsc",
    chainId: 56,
    displayName: "BNB Smart Chain",
    defaultRpcUrl: "https://bsc-dataseed.binance.org",
    finalityBlocks: 15,
    rpcEnvVar: "KRWN_RPC_BSC",
  },
  avalanche: {
    network: "avalanche",
    chainId: 43114,
    displayName: "Avalanche C-Chain",
    defaultRpcUrl: "https://api.avax.network/ext/bc/C/rpc",
    finalityBlocks: 5,
    rpcEnvVar: "KRWN_RPC_AVALANCHE",
  },
};

export interface EvmProviderOptions {
  rpcUrl?: string;
  /** Override default finality threshold. */
  finalityBlocks?: number;
  /** Inject a pre-built viem client (for tests). */
  client?: PublicClient;
}

export class EvmChainProvider implements ChainProvider {
  readonly network: string;
  readonly chainId: number | null;
  readonly displayName: string;

  private readonly client: PublicClient;
  private readonly finalityBlocks: number;

  constructor(
    descriptor: EvmNetworkDescriptor,
    opts: EvmProviderOptions = {},
  ) {
    this.network = descriptor.network;
    this.chainId = descriptor.chainId;
    this.displayName = descriptor.displayName;
    this.finalityBlocks = opts.finalityBlocks ?? descriptor.finalityBlocks;

    if (opts.client) {
      this.client = opts.client;
    } else {
      const rpcUrl =
        opts.rpcUrl ??
        process.env[descriptor.rpcEnvVar] ??
        descriptor.defaultRpcUrl;
      if (!rpcUrl) {
        throw new ChainProviderError(
          `Missing RPC url for "${descriptor.network}" — set env ${descriptor.rpcEnvVar}.`,
          "rpc_unavailable",
        );
      }
      this.client = createPublicClient({
        transport: http(rpcUrl),
      }) as PublicClient;
    }
  }

  async readTokenBalance(args: {
    contractAddress: string;
    holderAddress: string;
    decimals: number;
  }): Promise<ChainBalanceRead> {
    const contract = requireAddress(args.contractAddress, "contractAddress");
    const holder = requireAddress(args.holderAddress, "holderAddress");

    const erc20 = getContract({
      address: contract,
      abi: ERC20_ABI,
      client: this.client,
    });

    let raw: bigint;
    let blockNumber: bigint;
    try {
      [raw, blockNumber] = await Promise.all([
        erc20.read.balanceOf([holder]),
        this.client.getBlockNumber(),
      ]);
    } catch (err) {
      throw new ChainProviderError(
        `RPC readTokenBalance failed on "${this.network}": ${
          err instanceof Error ? err.message : String(err)
        }`,
        "rpc_unavailable",
      );
    }

    return {
      raw,
      formatted: Number(formatUnits(raw, args.decimals)),
      blockNumber,
    };
  }

  buildTransferIntent(args: {
    contractAddress: string;
    fromAddress: string;
    toAddress: string;
    amountMinor: bigint;
    asset: { symbol: string; decimals: number };
  }): OnChainTransferIntent {
    const contract = requireAddress(args.contractAddress, "contractAddress");
    const from = requireAddress(args.fromAddress, "fromAddress");
    const to = requireAddress(args.toAddress, "toAddress");
    if (args.amountMinor <= 0n) {
      throw new ChainProviderError(
        "amountMinor must be > 0.",
        "invalid_payload",
      );
    }
    if (from.toLowerCase() === to.toLowerCase()) {
      throw new ChainProviderError(
        "Source and destination addresses must differ.",
        "invalid_payload",
      );
    }

    const data = encodeFunctionData({
      abi: ERC20_ABI,
      functionName: "transfer",
      args: [to, args.amountMinor],
    });

    return {
      chainId: this.chainId,
      to: contract,
      data: data as Hex,
      value: "0",
      humanReadable: {
        network: this.displayName,
        asset: args.asset.symbol,
        recipient: to,
        amount: formatUnits(args.amountMinor, args.asset.decimals),
        decimals: args.asset.decimals,
      },
      intentVersion: 1,
    };
  }

  async readTransactionStatus(hash: string): Promise<OnChainTxStatusRead> {
    if (!/^0x[0-9a-fA-F]{64}$/.test(hash)) {
      throw new ChainProviderError(
        "Invalid EVM transaction hash.",
        "invalid_payload",
      );
    }
    try {
      const [receipt, head] = await Promise.all([
        this.client
          .getTransactionReceipt({ hash: hash as Hex })
          .catch(() => null),
        this.client.getBlockNumber(),
      ]);
      if (!receipt) {
        return { hash, status: "pending", confirmations: 0, blockNumber: null };
      }
      const confirmations = Number(head - receipt.blockNumber + 1n);
      const status =
        receipt.status === "success"
          ? confirmations >= this.finalityBlocks
            ? "confirmed"
            : "pending"
          : "failed";
      return {
        hash,
        status,
        confirmations: Math.max(confirmations, 0),
        blockNumber: receipt.blockNumber,
      };
    } catch (err) {
      throw new ChainProviderError(
        `RPC readTransactionStatus failed on "${this.network}": ${
          err instanceof Error ? err.message : String(err)
        }`,
        "rpc_unavailable",
      );
    }
  }

  async readLatestBlock(): Promise<bigint> {
    try {
      return await this.client.getBlockNumber();
    } catch (err) {
      throw new ChainProviderError(
        `RPC getBlockNumber failed on "${this.network}": ${
          err instanceof Error ? err.message : String(err)
        }`,
        "rpc_unavailable",
      );
    }
  }
}

// ------------------------------------------------------------
// Helpers
// ------------------------------------------------------------

function requireAddress(raw: string, label: string): Address {
  if (!raw || !isAddress(raw)) {
    throw new ChainProviderError(
      `Invalid EVM ${label}: "${raw}".`,
      "invalid_address",
    );
  }
  return raw as Address;
}
