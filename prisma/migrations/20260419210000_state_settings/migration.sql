-- ============================================================
-- Палата Указов — StateSettings (Sovereign's Decree).
-- ------------------------------------------------------------
-- Creates:
--   * TreasuryTransparency enum — видимость казны (public / council
--                                  / sovereign).
--   * StateSettings — конституциональный свод параметров государства:
--     фискальная политика, правила входа/выхода, динамика Вертикали.
--     1:1 с State; создаётся setup-ом и изменяется только Сувереном
--     (или держателем core `state.configure`).
-- ============================================================

-- CreateEnum
CREATE TYPE "TreasuryTransparency" AS ENUM ('public', 'council', 'sovereign');

-- CreateTable
CREATE TABLE "StateSettings" (
    "id"                         TEXT NOT NULL,
    "stateId"                    TEXT NOT NULL,

    -- Fiscal
    "transactionTaxRate"         DOUBLE PRECISION      NOT NULL DEFAULT 0,
    "incomeTaxRate"              DOUBLE PRECISION      NOT NULL DEFAULT 0,
    "roleTaxRate"                DOUBLE PRECISION      NOT NULL DEFAULT 0,
    "currencyDisplayName"        TEXT,

    -- Entry / exit
    "citizenshipFeeAmount"       DOUBLE PRECISION      NOT NULL DEFAULT 0,
    "rolesPurchasable"           BOOLEAN               NOT NULL DEFAULT false,
    "exitRefundRate"             DOUBLE PRECISION      NOT NULL DEFAULT 0,

    -- Vertical dynamics
    "permissionInheritance"      BOOLEAN               NOT NULL DEFAULT true,
    "autoPromotionEnabled"       BOOLEAN               NOT NULL DEFAULT false,
    "autoPromotionMinBalance"    DOUBLE PRECISION,
    "autoPromotionMinDays"       INTEGER,
    "autoPromotionTargetNodeId"  TEXT,
    "treasuryTransparency"       "TreasuryTransparency" NOT NULL DEFAULT 'council',

    -- Extras
    "extras"                     JSONB                 NOT NULL DEFAULT '{}',

    "createdAt"                  TIMESTAMP(3)          NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt"                  TIMESTAMP(3)          NOT NULL,

    CONSTRAINT "StateSettings_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "StateSettings_stateId_key" ON "StateSettings"("stateId");
CREATE INDEX "StateSettings_stateId_idx" ON "StateSettings"("stateId");

-- AddForeignKey
ALTER TABLE "StateSettings"
    ADD CONSTRAINT "StateSettings_stateId_fkey"
    FOREIGN KEY ("stateId") REFERENCES "State"("id")
    ON DELETE CASCADE ON UPDATE CASCADE;

-- Seed defaults for every existing State so running apps don't
-- have to lazy-provision on first read. New States will get their
-- row from `setup-state.ts`.
INSERT INTO "StateSettings" ("id", "stateId", "updatedAt")
SELECT
  'ss_' || substr(md5(random()::text || clock_timestamp()::text), 1, 24),
  s."id",
  CURRENT_TIMESTAMP
FROM "State" s
WHERE NOT EXISTS (
  SELECT 1 FROM "StateSettings" ex WHERE ex."stateId" = s."id"
);
