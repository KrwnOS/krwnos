/**
 * GET /api/ready — readiness: PostgreSQL + Redis must both answer.
 * Use for orchestrator / k8s readiness; `/api/health` remains DB-only liveness.
 */
import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getRedis } from "@/lib/redis";
import { childLoggerFromRequest } from "@/lib/logger";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const log = childLoggerFromRequest(request);
  const checks: { db: boolean; redis: boolean } = { db: false, redis: false };

  try {
    await prisma.$queryRaw`SELECT 1`;
    checks.db = true;
  } catch (err) {
    log.error({ err }, "ready: database check failed");
  }

  try {
    const redis = getRedis();
    const pong = await redis.ping();
    checks.redis = pong === "PONG";
    if (!checks.redis) {
      log.warn({ pong }, "ready: unexpected Redis PING reply");
    }
  } catch (err) {
    log.error({ err }, "ready: Redis check failed");
  }

  const ready = checks.db && checks.redis;
  const body = {
    status: ready ? "ready" : "not_ready",
    checks,
    ts: new Date().toISOString(),
  };

  return NextResponse.json(body, {
    status: ready ? 200 : 503,
    headers: { "Cache-Control": "no-store" },
  });
}
