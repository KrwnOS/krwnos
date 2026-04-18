-- ============================================================
-- Currency Factory knobs: canMint / taxRate / publicSupply
-- ------------------------------------------------------------
-- Adds the three Sovereign-controlled monetary-policy toggles to
-- `StateAsset`:
--   * canMint       — allow (true) or freeze (false) minting.
--   * taxRate       — fractional rate [0..1] withheld on transfers
--                     and routed to the State's primary treasury.
--   * publicSupply  — whether citizens can read the circulating
--                     supply through `/api/wallet/supply/:assetId`.
-- ============================================================

ALTER TABLE "StateAsset"
  ADD COLUMN "canMint"      BOOLEAN          NOT NULL DEFAULT true,
  ADD COLUMN "taxRate"      DOUBLE PRECISION NOT NULL DEFAULT 0,
  ADD COLUMN "publicSupply" BOOLEAN          NOT NULL DEFAULT false;
