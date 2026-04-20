/**
 * Per-state user bans — block registration and citizen API access.
 */

import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";

export class BannedFromStateError extends Error {
  constructor() {
    super("banned_from_state");
    this.name = "BannedFromStateError";
  }
}

export async function isUserBannedFromState(
  stateId: string,
  userId: string,
): Promise<boolean> {
  const rows = await prisma.$queryRaw<{ c: bigint }[]>`
    SELECT COUNT(*)::bigint AS c
    FROM "StateUserBan"
    WHERE "stateId" = ${stateId}
      AND "userId" = ${userId}
      AND "revokedAt" IS NULL
  `;
  return Number(rows[0]?.c ?? 0) > 0;
}

/** Active bans for a set of users (same state). */
export async function bannedUserIdsInState(
  stateId: string,
  userIds: readonly string[],
): Promise<Set<string>> {
  if (userIds.length === 0) return new Set();
  const rows = await prisma.$queryRaw<{ userId: string }[]>`
    SELECT "userId" FROM "StateUserBan"
    WHERE "stateId" = ${stateId}
      AND "revokedAt" IS NULL
      AND "userId" IN (${Prisma.join(userIds)})
  `;
  return new Set(rows.map((r) => r.userId));
}
