/**
 * Per-state user bans — block registration and citizen API access.
 */

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
  const row = await prisma.stateUserBan.findUnique({
    where: {
      stateId_userId: { stateId, userId },
    },
    select: { revokedAt: true },
  });
  return Boolean(row && row.revokedAt === null);
}
