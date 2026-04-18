/**
 * Public surface of the Web3 providers layer.
 * Import from here, not from individual files.
 */

export type {
  ChainProvider,
  ChainBalanceRead,
  NetworkId,
  OnChainTransferIntent,
  OnChainTxStatus,
  OnChainTxStatusRead,
} from "./types";
export { ChainProviderError } from "./types";

export {
  EvmChainProvider,
  EVM_NETWORKS,
  type EvmNetworkDescriptor,
  type EvmProviderOptions,
} from "./evm";
export { SolanaChainProvider } from "./solana";
export {
  ChainProviderRegistry,
  chainProviders,
  type ChainProviderRegistryOptions,
} from "./registry";
