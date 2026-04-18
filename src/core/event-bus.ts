/**
 * Event Bus — шина взаимодействия модулей.
 * ------------------------------------------------------------
 * Две реализации:
 *   * InMemoryEventBus — дефолт для dev / unit-тестов.
 *   * RedisEventBus    — опциональная реализация поверх
 *                        ioredis pub/sub для production.
 *
 * Контракт задан в `types/kernel.ts` (`ModuleEventBus`) —
 * модули никогда не работают с конкретной реализацией напрямую.
 */

import type { ModuleEventBus } from "@/types/kernel";

type Handler = (payload: unknown) => void | Promise<void>;

export class InMemoryEventBus implements ModuleEventBus {
  private readonly listeners = new Map<string, Set<Handler>>();

  async emit<T>(event: string, payload: T): Promise<void> {
    const set = this.listeners.get(event);
    if (!set || set.size === 0) return;
    // Run handlers sequentially to preserve deterministic order in tests.
    for (const handler of set) {
      try {
        await handler(payload);
      } catch (err) {
        // A misbehaving handler must never break the pipeline.
        // eslint-disable-next-line no-console
        console.error(`[KrwnOS] handler for "${event}" threw:`, err);
      }
    }
  }

  on<T>(event: string, handler: (payload: T) => void | Promise<void>): () => void {
    let set = this.listeners.get(event);
    if (!set) {
      set = new Set();
      this.listeners.set(event, set);
    }
    set.add(handler as Handler);
    return () => {
      set!.delete(handler as Handler);
    };
  }
}

/** Default singleton used by the kernel when no other bus is injected. */
export const eventBus: ModuleEventBus = new InMemoryEventBus();

// ------------------------------------------------------------
// Canonical kernel events.
// Modules may publish their own using "<module-slug>.<action>".
// ------------------------------------------------------------
export const KernelEvents = {
  StateCreated: "kernel.state.created",
  StateUpdated: "kernel.state.updated",
  NodeCreated: "kernel.node.created",
  NodeMoved: "kernel.node.moved",
  NodeDeleted: "kernel.node.deleted",
  MembershipGranted: "kernel.membership.granted",
  MembershipRevoked: "kernel.membership.revoked",
  ModuleInstalled: "kernel.module.installed",
  ModuleUninstalled: "kernel.module.uninstalled",
} as const;

export type KernelEvent = (typeof KernelEvents)[keyof typeof KernelEvents];
