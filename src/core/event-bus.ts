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
      if (set!.size === 0) this.listeners.delete(event);
    };
  }

  listenerCount(event: string): number {
    return this.listeners.get(event)?.size ?? 0;
  }
}

/**
 * RedisEventBus — fan-out across processes / pods via Redis pub/sub.
 *
 * A single ioredis connection cannot both publish and subscribe, so
 * the bus keeps a dedicated subscriber. Handlers registered via
 * `on()` are invoked on every process that runs this bus instance —
 * this is exactly what lets HTTP/SSE sessions in different workers
 * receive `ChatMessage.created` events regardless of which worker
 * persisted the message.
 *
 * Payloads are JSON-serialised. Non-serialisable values (functions,
 * BigInt, etc.) will be coerced by `JSON.stringify` — keep events
 * flat and primitive.
 */
export interface RedisLike {
  publish(channel: string, message: string): Promise<number> | number;
  subscribe(channel: string): Promise<unknown> | unknown;
  unsubscribe(channel: string): Promise<unknown> | unknown;
  on(event: "message", listener: (channel: string, message: string) => void): unknown;
  quit?(): Promise<unknown> | unknown;
}

export interface RedisEventBusOptions {
  /** Used to namespace pub/sub channels — defaults to "krwn:events". */
  keyPrefix?: string;
  /** Also invoke local handlers synchronously in-process. */
  alsoDeliverLocally?: boolean;
}

export class RedisEventBus implements ModuleEventBus {
  private readonly prefix: string;
  private readonly alsoLocal: boolean;
  private readonly local = new InMemoryEventBus();
  private readonly subscribed = new Set<string>();

  constructor(
    private readonly publisher: RedisLike,
    private readonly subscriber: RedisLike,
    opts: RedisEventBusOptions = {},
  ) {
    this.prefix = (opts.keyPrefix ?? "krwn:events").replace(/:+$/, "");
    this.alsoLocal = opts.alsoDeliverLocally ?? true;

    this.subscriber.on("message", (channel, message) => {
      if (!channel.startsWith(`${this.prefix}:`)) return;
      const event = channel.slice(this.prefix.length + 1);
      let payload: unknown = null;
      try {
        payload = JSON.parse(message);
      } catch {
        // Non-JSON payload — hand it off verbatim.
        payload = message;
      }
      void this.local.emit(event, payload);
    });
  }

  async emit<T>(event: string, payload: T): Promise<void> {
    const channel = `${this.prefix}:${event}`;
    const body = JSON.stringify(payload ?? null);
    // Publish to other workers.
    await Promise.resolve(this.publisher.publish(channel, body));
    // Publish locally only if Redis wouldn't echo it back (it won't,
    // pub/sub does NOT deliver to the publisher connection).
    if (this.alsoLocal) {
      await this.local.emit(event, payload);
    }
  }

  on<T>(event: string, handler: (payload: T) => void | Promise<void>): () => void {
    const channel = `${this.prefix}:${event}`;
    if (!this.subscribed.has(channel)) {
      this.subscribed.add(channel);
      void Promise.resolve(this.subscriber.subscribe(channel));
    }
    const off = this.local.on(event, handler);
    return () => {
      off();
      // Best-effort unsubscribe if no more listeners remain for this event.
      if (this.local.listenerCount(event) === 0 && this.subscribed.has(channel)) {
        this.subscribed.delete(channel);
        void Promise.resolve(this.subscriber.unsubscribe(channel));
      }
    };
  }

  /** Tear down Redis connections. Safe to call in tests / shutdown hooks. */
  async close(): Promise<void> {
    await Promise.resolve(this.publisher.quit?.());
    await Promise.resolve(this.subscriber.quit?.());
  }
}

/**
 * Mutable singleton used by the kernel. Starts as an in-memory bus so
 * that tests and dev-without-Redis keep working; call
 * `setEventBus(new RedisEventBus(...))` at bootstrap to swap it.
 */
let _bus: ModuleEventBus = new InMemoryEventBus();

export const eventBus: ModuleEventBus = {
  emit: (event, payload) => _bus.emit(event, payload),
  on: (event, handler) => _bus.on(event, handler),
};

export function setEventBus(next: ModuleEventBus): void {
  _bus = next;
}

export function getEventBus(): ModuleEventBus {
  return _bus;
}

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
  MembershipMoved: "kernel.membership.moved",
  UserBannedInState: "kernel.user.banned_in_state",
  UserUnbannedInState: "kernel.user.unbanned_in_state",
  UsersMergedInState: "kernel.users.merged_in_state",
  ModuleInstalled: "kernel.module.installed",
  ModuleUninstalled: "kernel.module.uninstalled",
} as const;

export type KernelEvent = (typeof KernelEvents)[keyof typeof KernelEvents];
