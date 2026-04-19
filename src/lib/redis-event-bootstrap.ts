/**
 * Swaps the process-wide `eventBus` to RedisEventBus when REDIS_URL is set.
 * Must run from `instrumentation.ts` before the first HTTP handler imports
 * modules that publish to the bus (otherwise multi-instance fan-out breaks).
 *
 * Set `KRWN_REDIS_EVENT_BUS=0` to force InMemoryEventBus (tests / special hosts).
 *
 * `ioredis` is loaded via dynamic `import()` so Next.js does not webpack-bundle
 * Node-only deps while analyzing `instrumentation.ts`.
 */
import {
  RedisEventBus,
  getEventBus,
  InMemoryEventBus,
  setEventBus,
} from "@/core/event-bus";

let attempted = false;

export async function configureRedisEventBusIfAvailable(): Promise<void> {
  if (attempted) return;
  attempted = true;

  if (process.env.KRWN_REDIS_EVENT_BUS === "0") return;

  const url = process.env.REDIS_URL?.trim();
  if (!url) return;

  const { default: Redis } = await import(
    /* webpackIgnore: true */
    "ioredis",
  );

  const pub = new Redis(url, {
    lazyConnect: true,
    maxRetriesPerRequest: null,
  });
  const sub = new Redis(url, {
    lazyConnect: true,
    maxRetriesPerRequest: null,
  });

  try {
    await pub.connect();
    await sub.connect();
  } catch (err) {
    // eslint-disable-next-line no-console
    console.warn("[KrwnOS] Redis event bus: connect failed, using in-memory bus", err);
    await pub.quit().catch(() => {});
    await sub.quit().catch(() => {});
    return;
  }

  const current = getEventBus();
  if (!(current instanceof InMemoryEventBus)) {
    await pub.quit().catch(() => {});
    await sub.quit().catch(() => {});
    return;
  }

  setEventBus(
    new RedisEventBus(pub, sub, {
      keyPrefix: "krwn:events",
      alsoDeliverLocally: true,
    }),
  );
}
