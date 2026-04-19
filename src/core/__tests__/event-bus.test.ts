/**
 * Unit tests for `src/core/event-bus.ts`.
 *
 * Покрываем обе реализации и синглтон:
 *   * `InMemoryEventBus` — fan-out, `off()`, tolerant to throwing handlers;
 *   * `RedisEventBus`     — publish, subscribe, unsubscribe, round-trip
 *                           через `on("message")`;
 *   * `eventBus` / `setEventBus` / `getEventBus`;
 *   * `KernelEvents` как набор канонических имён.
 */

import { describe, expect, it, vi } from "vitest";
import {
  InMemoryEventBus,
  KernelEvents,
  RedisEventBus,
  eventBus,
  getEventBus,
  setEventBus,
  type RedisLike,
} from "../event-bus";

// ------------------------------------------------------------
// InMemoryEventBus
// ------------------------------------------------------------

describe("InMemoryEventBus", () => {
  it("fans out payloads in registration order", async () => {
    const bus = new InMemoryEventBus();
    const seen: string[] = [];
    bus.on<string>("e", (p) => {
      seen.push(`a:${p}`);
    });
    bus.on<string>("e", (p) => {
      seen.push(`b:${p}`);
    });
    await bus.emit("e", "hi");
    expect(seen).toEqual(["a:hi", "b:hi"]);
  });

  it("emit on an unwired event is a no-op", async () => {
    const bus = new InMemoryEventBus();
    await expect(bus.emit("nothing", 1)).resolves.toBeUndefined();
    expect(bus.listenerCount("nothing")).toBe(0);
  });

  it("off() removes a listener without touching the others", async () => {
    const bus = new InMemoryEventBus();
    const a = vi.fn();
    const b = vi.fn();
    const offA = bus.on("e", a);
    bus.on("e", b);
    offA();
    await bus.emit("e", 1);
    expect(a).not.toHaveBeenCalled();
    expect(b).toHaveBeenCalledOnce();
    expect(bus.listenerCount("e")).toBe(1);
  });

  it("errors inside a handler do not break the pipeline", async () => {
    const bus = new InMemoryEventBus();
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    const second = vi.fn();
    bus.on("e", () => {
      throw new Error("boom");
    });
    bus.on("e", second);
    await bus.emit("e", 1);
    expect(second).toHaveBeenCalledOnce();
    spy.mockRestore();
  });
});

// ------------------------------------------------------------
// RedisEventBus (fake client)
// ------------------------------------------------------------

function makeFakeRedis(): {
  pub: RedisLike;
  sub: RedisLike;
  messageHandler: (channel: string, message: string) => void;
  published: Array<{ channel: string; message: string }>;
  subscribed: Set<string>;
  unsubscribed: string[];
  quits: number;
} {
  const state = {
    published: [] as Array<{ channel: string; message: string }>,
    subscribed: new Set<string>(),
    unsubscribed: [] as string[],
    quits: 0,
  };
  let messageHandler: (channel: string, message: string) => void = () => {};

  const pub: RedisLike = {
    publish: (channel, message) => {
      state.published.push({ channel, message });
      return Promise.resolve(1);
    },
    subscribe: () => Promise.resolve(),
    unsubscribe: () => Promise.resolve(),
    on: () => undefined,
    quit: () => {
      state.quits++;
      return Promise.resolve();
    },
  };
  const sub: RedisLike = {
    publish: () => Promise.resolve(0),
    subscribe: (channel: string) => {
      state.subscribed.add(channel);
      return Promise.resolve();
    },
    unsubscribe: (channel: string) => {
      state.unsubscribed.push(channel);
      state.subscribed.delete(channel);
      return Promise.resolve();
    },
    on: (event: string, listener: (channel: string, message: string) => void) => {
      if (event === "message") messageHandler = listener;
      return undefined;
    },
    quit: () => {
      state.quits++;
      return Promise.resolve();
    },
  };
  return {
    pub,
    sub,
    get messageHandler() {
      return messageHandler;
    },
    published: state.published,
    subscribed: state.subscribed,
    unsubscribed: state.unsubscribed,
    get quits() {
      return state.quits;
    },
  };
}

describe("RedisEventBus", () => {
  it("publishes to prefixed channel + echoes locally by default", async () => {
    const fake = makeFakeRedis();
    const bus = new RedisEventBus(fake.pub, fake.sub, { keyPrefix: "x:ev:" });
    const seen: number[] = [];
    bus.on<number>("wallet.tx", (p) => {
      seen.push(p);
    });
    await bus.emit("wallet.tx", 42);
    expect(fake.published).toEqual([
      { channel: "x:ev:wallet.tx", message: "42" },
    ]);
    expect(seen).toEqual([42]);
    expect(fake.subscribed.has("x:ev:wallet.tx")).toBe(true);
  });

  it("alsoDeliverLocally=false skips local echo", async () => {
    const fake = makeFakeRedis();
    const bus = new RedisEventBus(fake.pub, fake.sub, {
      alsoDeliverLocally: false,
    });
    const seen: number[] = [];
    bus.on<number>("e", (p) => {
      seen.push(p);
    });
    await bus.emit("e", 7);
    expect(seen).toEqual([]);
  });

  it("on('message') dispatches JSON payloads to local handlers", async () => {
    const fake = makeFakeRedis();
    const bus = new RedisEventBus(fake.pub, fake.sub);
    const seen: Array<{ n: number }> = [];
    bus.on<{ n: number }>("e", (p) => {
      seen.push(p);
    });
    fake.messageHandler("krwn:events:e", JSON.stringify({ n: 1 }));
    // micro-task flush
    await Promise.resolve();
    await Promise.resolve();
    expect(seen).toEqual([{ n: 1 }]);
  });

  it("on('message') falls back to raw string on parse error", async () => {
    const fake = makeFakeRedis();
    const bus = new RedisEventBus(fake.pub, fake.sub);
    const seen: unknown[] = [];
    bus.on<unknown>("e", (p) => seen.push(p));
    fake.messageHandler("krwn:events:e", "not-json");
    await Promise.resolve();
    await Promise.resolve();
    expect(seen).toEqual(["not-json"]);
  });

  it("off() unsubscribes when the last handler goes away", async () => {
    const fake = makeFakeRedis();
    const bus = new RedisEventBus(fake.pub, fake.sub);
    const offA = bus.on("e", () => {});
    const offB = bus.on("e", () => {});
    offA();
    expect(fake.unsubscribed).toEqual([]);
    offB();
    expect(fake.unsubscribed).toEqual(["krwn:events:e"]);
  });

  it("ignores messages on foreign channels", async () => {
    const fake = makeFakeRedis();
    const bus = new RedisEventBus(fake.pub, fake.sub, { keyPrefix: "krwn:events" });
    const seen: unknown[] = [];
    bus.on("e", (p) => seen.push(p));
    fake.messageHandler("other:e", JSON.stringify({ n: 1 }));
    await Promise.resolve();
    expect(seen).toEqual([]);
  });

  it("close() calls quit on both connections", async () => {
    const fake = makeFakeRedis();
    const bus = new RedisEventBus(fake.pub, fake.sub);
    await bus.close();
    expect(fake.quits).toBe(2);
  });
});

// ------------------------------------------------------------
// singleton helpers
// ------------------------------------------------------------

describe("eventBus singleton", () => {
  it("setEventBus routes subsequent emits to the new implementation", async () => {
    const initial = getEventBus();
    const custom = new InMemoryEventBus();
    const seen: string[] = [];
    custom.on<string>("custom", (p) => seen.push(p));
    setEventBus(custom);
    try {
      expect(getEventBus()).toBe(custom);
      await eventBus.emit("custom", "hi");
      expect(seen).toEqual(["hi"]);
    } finally {
      setEventBus(initial);
    }
  });
});

describe("KernelEvents", () => {
  it("exposes a stable set of canonical names", () => {
    expect(KernelEvents.StateCreated).toBe("kernel.state.created");
    expect(KernelEvents.MembershipGranted).toBe("kernel.membership.granted");
  });
});
