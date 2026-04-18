/**
 * Tunneling — публичная доступность State без возни с IP/портами.
 * ------------------------------------------------------------
 * Ядро даёт только ПОРТ: `TunnelAdapter`. Реальные провайдеры
 * (cloudflared, frp, ngrok, tailscale funnel) — в infrastructure
 * layer, потому что требуют сетевых прав и нативных бинарей.
 *
 * Adapter обязан:
 *   * start(config) → hostname — поднять/переиспользовать туннель.
 *   * status()      → { reachable, lastSeenAt } — health-check.
 *   * stop()        — корректно снять туннель.
 *
 * Ядро кэширует активный adapter в памяти процесса и пишет
 * события в шину: `kernel.tunnel.started` / `kernel.tunnel.stopped`.
 */

import type { ModuleEventBus } from "@/types/kernel";

export type TunnelProvider =
  | "cloudflared"
  | "frp"
  | "ngrok"
  | "tailscale_funnel"
  | "none";

export interface TunnelConfig {
  provider: TunnelProvider;
  /** Desired subdomain; provider may ignore or remap. */
  hostname?: string;
  /** Provider-specific credentials. Opaque to core. */
  secrets?: Record<string, string>;
  /** Local upstream, defaults to http://localhost:3000. */
  upstream?: string;
}

export interface TunnelStatus {
  provider: TunnelProvider;
  reachable: boolean;
  hostname: string | null;
  lastSeenAt: Date | null;
}

export interface TunnelAdapter {
  readonly provider: TunnelProvider;
  start(config: TunnelConfig): Promise<{ hostname: string }>;
  stop(): Promise<void>;
  status(): Promise<TunnelStatus>;
}

export const TunnelEvents = {
  Started: "kernel.tunnel.started",
  Stopped: "kernel.tunnel.stopped",
  Degraded: "kernel.tunnel.degraded",
} as const;

export class TunnelManager {
  private adapter: TunnelAdapter | null = null;

  constructor(private readonly bus: ModuleEventBus) {}

  use(adapter: TunnelAdapter): void {
    this.adapter = adapter;
  }

  async start(config: TunnelConfig): Promise<{ hostname: string }> {
    const adapter = this.requireAdapter();
    const result = await adapter.start(config);
    await this.bus.emit(TunnelEvents.Started, {
      provider: adapter.provider,
      hostname: result.hostname,
    });
    return result;
  }

  async stop(): Promise<void> {
    if (!this.adapter) return;
    await this.adapter.stop();
    await this.bus.emit(TunnelEvents.Stopped, { provider: this.adapter.provider });
  }

  async status(): Promise<TunnelStatus> {
    if (!this.adapter) {
      return {
        provider: "none",
        reachable: false,
        hostname: null,
        lastSeenAt: null,
      };
    }
    return this.adapter.status();
  }

  private requireAdapter(): TunnelAdapter {
    if (!this.adapter) {
      throw new Error(
        "[KrwnOS] No TunnelAdapter configured. Call tunnelManager.use(...) during bootstrap.",
      );
    }
    return this.adapter;
  }
}
