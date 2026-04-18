/**
 * Redis client singleton used by the Event Bus and realtime
 * transports. Constructed lazily so that local dev without a
 * running Redis doesn't crash the app.
 */
import Redis from "ioredis";

let client: Redis | null = null;

export function getRedis(): Redis {
  if (!client) {
    const url = process.env.REDIS_URL ?? "redis://localhost:6379";
    client = new Redis(url, {
      lazyConnect: true,
      maxRetriesPerRequest: 2,
    });
  }
  return client;
}

export async function disconnectRedis(): Promise<void> {
  if (client) {
    await client.quit();
    client = null;
  }
}
