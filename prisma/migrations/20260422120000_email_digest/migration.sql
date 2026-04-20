-- Email digest opt-in + idempotency ledger for BullMQ digest jobs

ALTER TABLE "User" ADD COLUMN "emailDigestDaily" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "User" ADD COLUMN "emailDigestWeekly" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "User" ADD COLUMN "emailDigestChatMentions" BOOLEAN NOT NULL DEFAULT false;

CREATE TABLE "EmailDigestSend" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "periodKey" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "EmailDigestSend_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "EmailDigestSend_userId_kind_periodKey_key" ON "EmailDigestSend"("userId", "kind", "periodKey");

CREATE INDEX "EmailDigestSend_kind_periodKey_idx" ON "EmailDigestSend"("kind", "periodKey");

ALTER TABLE "EmailDigestSend" ADD CONSTRAINT "EmailDigestSend_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
