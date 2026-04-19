/**
 * Dedicated Redis connections for BullMQ.
 * BullMQ requires `maxRetriesPerRequest: null` (unlike the app-wide
 * `getRedis()` helper used by the Event Bus).
 */
import Redis from "ioredis";

export function createRedisForBullmq(): Redis {
  const url = process.env.REDIS_URL ?? "redis://localhost:6379";
  return new Redis(url, {
    maxRetriesPerRequest: null,
  });
}
