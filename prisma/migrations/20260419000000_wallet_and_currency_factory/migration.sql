-- ============================================================
-- core.wallet + Currency Factory (Финансовый Суверенитет)
-- ------------------------------------------------------------
-- Creates:
--   * StateAsset / StateAssetType / StateAssetMode   — the
--     Currency Factory primitives (Local Ledger, On-Chain, Hybrid).
--   * Wallet / WalletType                            — per-user and
--     per-treasury ledger rows, each pointing at one StateAsset.
--   * Transaction / TransactionKind / TransactionStatus — ledger
--     history, including on-chain confirmation fields used by the
--     Treasury Watcher.
-- ============================================================

-- CreateEnum
CREATE TYPE "StateAssetType" AS ENUM ('INTERNAL', 'ON_CHAIN');

-- CreateEnum
CREATE TYPE "StateAssetMode" AS ENUM ('LOCAL', 'EXTERNAL', 'HYBRID');

-- CreateEnum
CREATE TYPE "WalletType" AS ENUM ('PERSONAL', 'TREASURY');

-- CreateEnum
CREATE TYPE "TransactionStatus" AS ENUM ('pending', 'completed', 'failed', 'reversed');

-- CreateEnum
CREATE TYPE "TransactionKind" AS ENUM ('transfer', 'treasury_allocation', 'mint', 'burn');

-- CreateTable
CREATE TABLE "StateAsset" (
    "id" TEXT NOT NULL,
    "stateId" TEXT NOT NULL,
    "symbol" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "type" "StateAssetType" NOT NULL DEFAULT 'INTERNAL',
    "mode" "StateAssetMode" NOT NULL DEFAULT 'LOCAL',
    "contractAddress" TEXT,
    "network" TEXT,
    "chainId" INTEGER,
    "decimals" INTEGER NOT NULL DEFAULT 18,
    "exchangeRate" DOUBLE PRECISION,
    "icon" TEXT,
    "color" TEXT,
    "isPrimary" BOOLEAN NOT NULL DEFAULT false,
    "metadata" JSONB NOT NULL DEFAULT '{}',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "StateAsset_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Wallet" (
    "id" TEXT NOT NULL,
    "stateId" TEXT NOT NULL,
    "type" "WalletType" NOT NULL DEFAULT 'PERSONAL',
    "userId" TEXT,
    "nodeId" TEXT,
    "address" TEXT NOT NULL,
    "assetId" TEXT,
    "externalAddress" TEXT,
    "lastSyncedAt" TIMESTAMP(3),
    "lastSyncedBlock" BIGINT,
    "balance" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "currency" TEXT NOT NULL DEFAULT 'KRN',
    "metadata" JSONB NOT NULL DEFAULT '{}',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Wallet_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Transaction" (
    "id" TEXT NOT NULL,
    "stateId" TEXT NOT NULL,
    "fromWalletId" TEXT,
    "toWalletId" TEXT,
    "kind" "TransactionKind" NOT NULL DEFAULT 'transfer',
    "status" "TransactionStatus" NOT NULL DEFAULT 'completed',
    "amount" DOUBLE PRECISION NOT NULL,
    "assetId" TEXT,
    "currency" TEXT NOT NULL DEFAULT 'KRN',
    "externalTxHash" TEXT,
    "externalStatus" TEXT,
    "metadata" JSONB NOT NULL DEFAULT '{}',
    "initiatedById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Transaction_pkey" PRIMARY KEY ("id")
);

-- CreateIndex — StateAsset
CREATE UNIQUE INDEX "StateAsset_stateId_symbol_key" ON "StateAsset"("stateId", "symbol");
CREATE INDEX "StateAsset_stateId_idx" ON "StateAsset"("stateId");
CREATE INDEX "StateAsset_stateId_isPrimary_idx" ON "StateAsset"("stateId", "isPrimary");
CREATE INDEX "StateAsset_type_idx" ON "StateAsset"("type");

-- CreateIndex — Wallet
CREATE UNIQUE INDEX "Wallet_address_key" ON "Wallet"("address");
CREATE UNIQUE INDEX "Wallet_nodeId_key" ON "Wallet"("nodeId");
CREATE UNIQUE INDEX "Wallet_stateId_userId_assetId_key" ON "Wallet"("stateId", "userId", "assetId");
CREATE INDEX "Wallet_stateId_idx" ON "Wallet"("stateId");
CREATE INDEX "Wallet_userId_idx" ON "Wallet"("userId");
CREATE INDEX "Wallet_type_idx" ON "Wallet"("type");
CREATE INDEX "Wallet_assetId_idx" ON "Wallet"("assetId");
CREATE INDEX "Wallet_externalAddress_idx" ON "Wallet"("externalAddress");

-- CreateIndex — Transaction
CREATE INDEX "Transaction_stateId_createdAt_idx" ON "Transaction"("stateId", "createdAt");
CREATE INDEX "Transaction_fromWalletId_idx" ON "Transaction"("fromWalletId");
CREATE INDEX "Transaction_toWalletId_idx" ON "Transaction"("toWalletId");
CREATE INDEX "Transaction_initiatedById_idx" ON "Transaction"("initiatedById");
CREATE INDEX "Transaction_kind_idx" ON "Transaction"("kind");
CREATE INDEX "Transaction_assetId_idx" ON "Transaction"("assetId");
CREATE INDEX "Transaction_externalTxHash_idx" ON "Transaction"("externalTxHash");

-- AddForeignKey — StateAsset → State
ALTER TABLE "StateAsset" ADD CONSTRAINT "StateAsset_stateId_fkey"
    FOREIGN KEY ("stateId") REFERENCES "State"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey — Wallet → State / User / VerticalNode / StateAsset
ALTER TABLE "Wallet" ADD CONSTRAINT "Wallet_stateId_fkey"
    FOREIGN KEY ("stateId") REFERENCES "State"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "Wallet" ADD CONSTRAINT "Wallet_userId_fkey"
    FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "Wallet" ADD CONSTRAINT "Wallet_nodeId_fkey"
    FOREIGN KEY ("nodeId") REFERENCES "VerticalNode"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "Wallet" ADD CONSTRAINT "Wallet_assetId_fkey"
    FOREIGN KEY ("assetId") REFERENCES "StateAsset"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey — Transaction → State / Wallet × 2 / User / StateAsset
ALTER TABLE "Transaction" ADD CONSTRAINT "Transaction_stateId_fkey"
    FOREIGN KEY ("stateId") REFERENCES "State"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "Transaction" ADD CONSTRAINT "Transaction_fromWalletId_fkey"
    FOREIGN KEY ("fromWalletId") REFERENCES "Wallet"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "Transaction" ADD CONSTRAINT "Transaction_toWalletId_fkey"
    FOREIGN KEY ("toWalletId") REFERENCES "Wallet"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "Transaction" ADD CONSTRAINT "Transaction_initiatedById_fkey"
    FOREIGN KEY ("initiatedById") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "Transaction" ADD CONSTRAINT "Transaction_assetId_fkey"
    FOREIGN KEY ("assetId") REFERENCES "StateAsset"("id") ON DELETE SET NULL ON UPDATE CASCADE;
