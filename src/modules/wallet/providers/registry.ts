/**
 * ChainProviderRegistry — reverse index "network → provider".
 * ------------------------------------------------------------
 * Единая точка входа: сервис просит провайдера по имени сети,
 * реестр возвращает либо кэшированный singleton, либо бросает
 * `ChainProviderError(unsupported_network)`.
 *
 * Поведение:
 *   * Имя сети приводится к lower-case.
 *   * EVM-сети из `EVM_NETWORKS` создаются лениво.
 *   * Тесты могут подменять провайдер через `register()`.
 */

import { EVM_NETWORKS, EvmChainProvider, type EvmProviderOptions } from "./evm";
import { SolanaChainProvider } from "./solana";
import type { ChainProvider } from "./types";
import { ChainProviderError } from "./types";

export interface ChainProviderRegistryOptions {
  /** Per-network RPC / finality overrides (forwarded to EVM). */
  evm?: Record<string, EvmProviderOptions>;
}

export class ChainProviderRegistry {
  private readonly cache = new Map<string, ChainProvider>();
  private readonly evmOpts: Record<string, EvmProviderOptions>;

  constructor(opts: ChainProviderRegistryOptions = {}) {
    this.evmOpts = opts.evm ?? {};
  }

  /** Explicitly pin a provider (e.g. an in-memory fake in tests). */
  register(provider: ChainProvider): void {
    this.cache.set(provider.network.toLowerCase(), provider);
  }

  /** Returns the provider or throws `unsupported_network`. */
  require(network: string): ChainProvider {
    const key = network.trim().toLowerCase();
    const cached = this.cache.get(key);
    if (cached) return cached;

    const evmDescriptor = EVM_NETWORKS[key];
    if (evmDescriptor) {
      const provider = new EvmChainProvider(evmDescriptor, this.evmOpts[key]);
      this.cache.set(key, provider);
      return provider;
    }
    if (key === "solana") {
      const provider = new SolanaChainProvider();
      this.cache.set(key, provider);
      return provider;
    }

    throw new ChainProviderError(
      `Unsupported network "${network}". Known: ${[
        ...Object.keys(EVM_NETWORKS),
        "solana",
      ].join(", ")}.`,
      "unsupported_network",
    );
  }

  /** Soft lookup — returns null instead of throwing. */
  find(network: string): ChainProvider | null {
    try {
      return this.require(network);
    } catch {
      return null;
    }
  }

  /** Known network ids (for settings UI / docs). */
  knownNetworks(): string[] {
    return [...Object.keys(EVM_NETWORKS), "solana"];
  }
}

// ------------------------------------------------------------
// Default (singleton) — used by the service when no override is
// injected. Reads RPC urls from env on first use.
// ------------------------------------------------------------

let _singleton: ChainProviderRegistry | null = null;

export function chainProviders(): ChainProviderRegistry {
  if (!_singleton) _singleton = new ChainProviderRegistry();
  return _singleton;
}
