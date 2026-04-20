-- CreateEnum
CREATE TYPE "NodeSubscriptionSchedule" AS ENUM ('MONTHLY', 'WEEKLY');

-- CreateEnum
CREATE TYPE "WalletFineSource" AS ENUM ('governance', 'decree');

-- CreateTable
CREATE TABLE "NodeSubscription" (
    "id" TEXT NOT NULL,
    "stateId" TEXT NOT NULL,
    "childNodeId" TEXT NOT NULL,
    "parentNodeId" TEXT NOT NULL,
    "amount" DECIMAL(38,18) NOT NULL,
    "assetId" TEXT,
    "schedule" "NodeSubscriptionSchedule" NOT NULL DEFAULT 'MONTHLY',
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "metadata" JSONB NOT NULL DEFAULT '{}',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "NodeSubscription_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "NodeSubscriptionPeriodCharge" (
    "id" TEXT NOT NULL,
    "stateId" TEXT NOT NULL,
    "nodeSubscriptionId" TEXT NOT NULL,
    "periodKey" TEXT NOT NULL,
    "amount" DECIMAL(38,18) NOT NULL,
    "transactionId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "NodeSubscriptionPeriodCharge_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "WalletFine" (
    "id" TEXT NOT NULL,
    "stateId" TEXT NOT NULL,
    "debtorUserId" TEXT NOT NULL,
    "amount" DECIMAL(38,18) NOT NULL,
    "assetId" TEXT,
    "beneficiaryNodeId" TEXT NOT NULL,
    "source" "WalletFineSource" NOT NULL,
    "proposalId" TEXT,
    "decreeByUserId" TEXT,
    "transactionId" TEXT,
    "metadata" JSONB NOT NULL DEFAULT '{}',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "WalletFine_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "NodeSubscription_childNodeId_key" ON "NodeSubscription"("childNodeId");

-- CreateIndex
CREATE INDEX "NodeSubscription_stateId_idx" ON "NodeSubscription"("stateId");

-- CreateIndex
CREATE INDEX "NodeSubscription_parentNodeId_idx" ON "NodeSubscription"("parentNodeId");

-- CreateIndex
CREATE UNIQUE INDEX "NodeSubscriptionPeriodCharge_nodeSubscriptionId_periodKey_key" ON "NodeSubscriptionPeriodCharge"("nodeSubscriptionId", "periodKey");

-- CreateIndex
CREATE UNIQUE INDEX "NodeSubscriptionPeriodCharge_transactionId_key" ON "NodeSubscriptionPeriodCharge"("transactionId");

-- CreateIndex
CREATE INDEX "NodeSubscriptionPeriodCharge_stateId_periodKey_idx" ON "NodeSubscriptionPeriodCharge"("stateId", "periodKey");

-- CreateIndex
CREATE UNIQUE INDEX "WalletFine_proposalId_key" ON "WalletFine"("proposalId");

-- CreateIndex
CREATE UNIQUE INDEX "WalletFine_transactionId_key" ON "WalletFine"("transactionId");

-- CreateIndex
CREATE INDEX "WalletFine_stateId_createdAt_idx" ON "WalletFine"("stateId", "createdAt");

-- CreateIndex
CREATE INDEX "WalletFine_debtorUserId_idx" ON "WalletFine"("debtorUserId");

-- AddForeignKey
ALTER TABLE "NodeSubscription" ADD CONSTRAINT "NodeSubscription_stateId_fkey" FOREIGN KEY ("stateId") REFERENCES "State"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "NodeSubscription" ADD CONSTRAINT "NodeSubscription_childNodeId_fkey" FOREIGN KEY ("childNodeId") REFERENCES "VerticalNode"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "NodeSubscription" ADD CONSTRAINT "NodeSubscription_parentNodeId_fkey" FOREIGN KEY ("parentNodeId") REFERENCES "VerticalNode"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "NodeSubscription" ADD CONSTRAINT "NodeSubscription_assetId_fkey" FOREIGN KEY ("assetId") REFERENCES "StateAsset"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "NodeSubscriptionPeriodCharge" ADD CONSTRAINT "NodeSubscriptionPeriodCharge_stateId_fkey" FOREIGN KEY ("stateId") REFERENCES "State"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "NodeSubscriptionPeriodCharge" ADD CONSTRAINT "NodeSubscriptionPeriodCharge_nodeSubscriptionId_fkey" FOREIGN KEY ("nodeSubscriptionId") REFERENCES "NodeSubscription"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "NodeSubscriptionPeriodCharge" ADD CONSTRAINT "NodeSubscriptionPeriodCharge_transactionId_fkey" FOREIGN KEY ("transactionId") REFERENCES "Transaction"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WalletFine" ADD CONSTRAINT "WalletFine_stateId_fkey" FOREIGN KEY ("stateId") REFERENCES "State"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WalletFine" ADD CONSTRAINT "WalletFine_debtorUserId_fkey" FOREIGN KEY ("debtorUserId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WalletFine" ADD CONSTRAINT "WalletFine_assetId_fkey" FOREIGN KEY ("assetId") REFERENCES "StateAsset"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WalletFine" ADD CONSTRAINT "WalletFine_beneficiaryNodeId_fkey" FOREIGN KEY ("beneficiaryNodeId") REFERENCES "VerticalNode"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WalletFine" ADD CONSTRAINT "WalletFine_proposalId_fkey" FOREIGN KEY ("proposalId") REFERENCES "Proposal"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WalletFine" ADD CONSTRAINT "WalletFine_decreeByUserId_fkey" FOREIGN KEY ("decreeByUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WalletFine" ADD CONSTRAINT "WalletFine_transactionId_fkey" FOREIGN KEY ("transactionId") REFERENCES "Transaction"("id") ON DELETE SET NULL ON UPDATE CASCADE;
