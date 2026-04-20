/**
 * Redis-backed fixed-window rate limiting (ioredis + Lua INCR + EXPIRE).
 * Used from Node Route Handlers — not Edge `middleware` (ioredis is Node-only).
 */
import { NextResponse, type NextRequest } from "next/server";
import { getRedis } from "@/lib/redis";
import { logger } from "@/lib/logger";
import { getClientIp } from "@/lib/request-ip";

export type RateLimitScope =
  | "api_register"
  | "api_invite_accept"
  | "api_setup_get"
  | "api_setup_post"
  | "api_cli"
  | "api_push_subscribe"
  | "api_push_unsubscribe"
  | "api_telegram_link_start"
  | "api_telegram_webhook";

const LIMITS: Record<RateLimitScope, { windowSec: number; max: number }> = {
  api_register: { windowSec: 60, max: 20 },
  api_invite_accept: { windowSec: 60, max: 30 },
  api_setup_get: { windowSec: 60, max: 120 },
  api_setup_post: { windowSec: 60, max: 5 },
  api_cli: { windowSec: 60, max: 200 },
  api_push_subscribe: { windowSec: 60, max: 30 },
  api_push_unsubscribe: { windowSec: 60, max: 30 },
  api_telegram_link_start: { windowSec: 60, max: 20 },
  api_telegram_webhook: { windowSec: 60, max: 600 },
};

/** Atomic: INCR, set TTL on first hit, return 1 if allowed else 0. */
const LUA = `
local c = redis.call('INCR', KEYS[1])
if c == 1 then
  redis.call('EXPIRE', KEYS[1], tonumber(ARGV[1]))
end
if c > tonumber(ARGV[2]) then
  return 0
end
return 1
`;

async function allow(scope: RateLimitScope, ip: string): Promise<boolean> {
  const { windowSec, max } = LIMITS[scope];
  const key = `krwn:rl:v1:${scope}:${ip}`;
  try {
    const redis = getRedis();
    const n = (await redis.eval(
      LUA,
      1,
      key,
      String(windowSec),
      String(max),
    )) as number;
    return n === 1;
  } catch (err) {
    logger.warn(
      { err, scope },
      "rate_limit: Redis unavailable — allowing request (fail open)",
    );
    return true;
  }
}

/**
 * Returns a 429 JSON response if limited, or `null` when the request may proceed.
 */
export async function rateLimitedResponse(
  req: NextRequest,
  scope: RateLimitScope,
): Promise<NextResponse | null> {
  const ip = getClientIp(req);
  const ok = await allow(scope, ip);
  if (ok) return null;
  const { windowSec } = LIMITS[scope];
  return NextResponse.json(
    { error: "rate_limited", message: "Too many requests" },
    {
      status: 429,
      headers: {
        "Retry-After": String(windowSec),
        "Cache-Control": "no-store",
      },
    },
  );
}
