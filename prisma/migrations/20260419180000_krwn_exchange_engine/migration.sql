-- ============================================================
-- Krwn Exchange Engine — Inter-State Swap primitive
-- ------------------------------------------------------------
-- Creates:
--   * CrossStateTxStatus enum
--   * ExchangePair                — pegged rate between two StateAssets
--                                   (usually one per State). Directional:
--                                   the reverse pair must be declared
--                                   separately. `enabled = false` acts
--                                   as an economic blockade.
--   * CrossStateTransaction       — global audit log row spanning both
--                                   sovereign ledgers. Each entry ties
--                                   together the per-State `Transaction`
--                                   rows that actually moved balances
--                                   (burn on source, mint on destination).
-- ============================================================

-- CreateEnum
CREATE TYPE "CrossStateTxStatus" AS ENUM ('pending', 'completed', 'failed', 'reversed');

-- CreateTable
CREATE TABLE "ExchangePair" (
    "id" TEXT NOT NULL,
    "fromAssetId" TEXT NOT NULL,
    "fromStateId" TEXT NOT NULL,
    "toAssetId" TEXT NOT NULL,
    "toStateId" TEXT NOT NULL,
    "rate" DOUBLE PRECISION NOT NULL,
    "isManual" BOOLEAN NOT NULL DEFAULT true,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "createdById" TEXT NOT NULL,
    "metadata" JSONB NOT NULL DEFAULT '{}',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ExchangePair_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CrossStateTransaction" (
    "id" TEXT NOT NULL,
    "pairId" TEXT,
    "fromStateId" TEXT NOT NULL,
    "fromAssetId" TEXT NOT NULL,
    "fromWalletId" TEXT NOT NULL,
    "fromTransactionId" TEXT,
    "toStateId" TEXT NOT NULL,
    "toAssetId" TEXT NOT NULL,
    "toWalletId" TEXT NOT NULL,
    "toTransactionId" TEXT,
    "fromAmount" DOUBLE PRECISION NOT NULL,
    "toAmount" DOUBLE PRECISION NOT NULL,
    "rate" DOUBLE PRECISION NOT NULL,
    "status" "CrossStateTxStatus" NOT NULL DEFAULT 'pending',
    "initiatedById" TEXT NOT NULL,
    "metadata" JSONB NOT NULL DEFAULT '{}',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CrossStateTransaction_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "ExchangePair_fromAssetId_toAssetId_key" ON "ExchangePair"("fromAssetId", "toAssetId");

-- CreateIndex
CREATE INDEX "ExchangePair_fromAssetId_idx" ON "ExchangePair"("fromAssetId");

-- CreateIndex
CREATE INDEX "ExchangePair_toAssetId_idx" ON "ExchangePair"("toAssetId");

-- CreateIndex
CREATE INDEX "ExchangePair_fromStateId_idx" ON "ExchangePair"("fromStateId");

-- CreateIndex
CREATE INDEX "ExchangePair_toStateId_idx" ON "ExchangePair"("toStateId");

-- CreateIndex
CREATE INDEX "ExchangePair_enabled_idx" ON "ExchangePair"("enabled");

-- CreateIndex
CREATE INDEX "CrossStateTransaction_fromStateId_createdAt_idx" ON "CrossStateTransaction"("fromStateId", "createdAt");

-- CreateIndex
CREATE INDEX "CrossStateTransaction_toStateId_createdAt_idx" ON "CrossStateTransaction"("toStateId", "createdAt");

-- CreateIndex
CREATE INDEX "CrossStateTransaction_initiatedById_idx" ON "CrossStateTransaction"("initiatedById");

-- CreateIndex
CREATE INDEX "CrossStateTransaction_pairId_idx" ON "CrossStateTransaction"("pairId");

-- CreateIndex
CREATE INDEX "CrossStateTransaction_status_idx" ON "CrossStateTransaction"("status");

-- AddForeignKey
ALTER TABLE "ExchangePair" ADD CONSTRAINT "ExchangePair_fromAssetId_fkey" FOREIGN KEY ("fromAssetId") REFERENCES "StateAsset"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ExchangePair" ADD CONSTRAINT "ExchangePair_toAssetId_fkey" FOREIGN KEY ("toAssetId") REFERENCES "StateAsset"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ExchangePair" ADD CONSTRAINT "ExchangePair_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CrossStateTransaction" ADD CONSTRAINT "CrossStateTransaction_pairId_fkey" FOREIGN KEY ("pairId") REFERENCES "ExchangePair"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CrossStateTransaction" ADD CONSTRAINT "CrossStateTransaction_fromStateId_fkey" FOREIGN KEY ("fromStateId") REFERENCES "State"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CrossStateTransaction" ADD CONSTRAINT "CrossStateTransaction_fromAssetId_fkey" FOREIGN KEY ("fromAssetId") REFERENCES "StateAsset"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CrossStateTransaction" ADD CONSTRAINT "CrossStateTransaction_toStateId_fkey" FOREIGN KEY ("toStateId") REFERENCES "State"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CrossStateTransaction" ADD CONSTRAINT "CrossStateTransaction_toAssetId_fkey" FOREIGN KEY ("toAssetId") REFERENCES "StateAsset"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CrossStateTransaction" ADD CONSTRAINT "CrossStateTransaction_initiatedById_fkey" FOREIGN KEY ("initiatedById") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
