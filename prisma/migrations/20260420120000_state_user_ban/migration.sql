-- Per-state user ban list for citizen moderation (kick/ban flows).

CREATE TABLE "StateUserBan" (
    "id" TEXT NOT NULL,
    "stateId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "reason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdById" TEXT,
    "revokedAt" TIMESTAMP(3),

    CONSTRAINT "StateUserBan_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "StateUserBan_stateId_userId_key" ON "StateUserBan"("stateId", "userId");
CREATE INDEX "StateUserBan_userId_idx" ON "StateUserBan"("userId");
CREATE INDEX "StateUserBan_stateId_idx" ON "StateUserBan"("stateId");

ALTER TABLE "StateUserBan" ADD CONSTRAINT "StateUserBan_stateId_fkey" FOREIGN KEY ("stateId") REFERENCES "State"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "StateUserBan" ADD CONSTRAINT "StateUserBan_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
