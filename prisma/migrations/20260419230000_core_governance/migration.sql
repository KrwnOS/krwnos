-- ============================================================
-- Core Governance (Парламент) — Sovereign-Controlled DAO.
-- ------------------------------------------------------------
-- Creates:
--   * StateSettings.governanceRules — JSONB-блок с конституцией
--     самого голосования (режим, кворум, порог, стратегия веса,
--     whitelist изменяемых ключей, право вето).
--   * ProposalStatus / VoteChoice — enum-ы для жизненного цикла
--     предложений и вариантов голоса.
--   * Proposal / Vote — хранение предложений и голосов со
--     snapshot-ом правил на момент создания (правки правил задним
--     числом не должны перелопачивать уже открытые голосования).
-- ============================================================

-- ---- StateSettings: новый столбец governanceRules ----
ALTER TABLE "StateSettings"
    ADD COLUMN "governanceRules" JSONB NOT NULL DEFAULT '{}';

-- ---- Enums ----
CREATE TYPE "ProposalStatus" AS ENUM (
    'active',
    'passed',
    'rejected',
    'executed',
    'vetoed',
    'cancelled',
    'expired'
);

CREATE TYPE "VoteChoice" AS ENUM (
    'for_',
    'against',
    'abstain'
);

-- ---- Proposal ----
CREATE TABLE "Proposal" (
    "id"                       TEXT NOT NULL,
    "stateId"                  TEXT NOT NULL,
    "createdById"              TEXT NOT NULL,

    "title"                    TEXT NOT NULL,
    "description"              TEXT NOT NULL,

    "targetConfigKey"          TEXT NOT NULL,
    "newValue"                 JSONB NOT NULL,

    "status"                   "ProposalStatus" NOT NULL DEFAULT 'active',

    "quorumBps"                INTEGER NOT NULL,
    "thresholdBps"             INTEGER NOT NULL,
    "weightStrategy"           TEXT    NOT NULL,
    "modeAtCreation"           TEXT    NOT NULL,
    "sovereignVetoAtCreation"  BOOLEAN NOT NULL DEFAULT true,

    "totalWeightFor"           DOUBLE PRECISION NOT NULL DEFAULT 0,
    "totalWeightAgainst"       DOUBLE PRECISION NOT NULL DEFAULT 0,
    "totalWeightAbstain"       DOUBLE PRECISION NOT NULL DEFAULT 0,
    "voteCount"                INTEGER NOT NULL DEFAULT 0,

    "executedById"             TEXT,
    "vetoedById"               TEXT,
    "vetoReason"               TEXT,

    "expiresAt"                TIMESTAMP(3) NOT NULL,
    "createdAt"                TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "closedAt"                 TIMESTAMP(3),
    "executedAt"               TIMESTAMP(3),

    "metadata"                 JSONB NOT NULL DEFAULT '{}',

    CONSTRAINT "Proposal_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "Proposal_stateId_status_idx"    ON "Proposal"("stateId", "status");
CREATE INDEX "Proposal_stateId_createdAt_idx" ON "Proposal"("stateId", "createdAt");
CREATE INDEX "Proposal_status_idx"            ON "Proposal"("status");
CREATE INDEX "Proposal_expiresAt_idx"         ON "Proposal"("expiresAt");
CREATE INDEX "Proposal_createdById_idx"       ON "Proposal"("createdById");

ALTER TABLE "Proposal"
    ADD CONSTRAINT "Proposal_stateId_fkey"
    FOREIGN KEY ("stateId") REFERENCES "State"("id")
    ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "Proposal"
    ADD CONSTRAINT "Proposal_createdById_fkey"
    FOREIGN KEY ("createdById") REFERENCES "User"("id")
    ON DELETE CASCADE ON UPDATE CASCADE;

-- ---- Vote ----
CREATE TABLE "Vote" (
    "id"           TEXT NOT NULL,
    "proposalId"   TEXT NOT NULL,
    "stateId"      TEXT NOT NULL,
    "userId"       TEXT NOT NULL,
    "choice"       "VoteChoice" NOT NULL,
    "weight"       DOUBLE PRECISION NOT NULL DEFAULT 1,
    "weightReason" TEXT NOT NULL DEFAULT 'one_person_one_vote',
    "comment"      TEXT,
    "createdAt"    TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Vote_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "Vote_proposalId_userId_key" ON "Vote"("proposalId", "userId");
CREATE INDEX "Vote_proposalId_idx"               ON "Vote"("proposalId");
CREATE INDEX "Vote_userId_idx"                   ON "Vote"("userId");
CREATE INDEX "Vote_stateId_idx"                  ON "Vote"("stateId");

ALTER TABLE "Vote"
    ADD CONSTRAINT "Vote_proposalId_fkey"
    FOREIGN KEY ("proposalId") REFERENCES "Proposal"("id")
    ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "Vote"
    ADD CONSTRAINT "Vote_stateId_fkey"
    FOREIGN KEY ("stateId") REFERENCES "State"("id")
    ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "Vote"
    ADD CONSTRAINT "Vote_userId_fkey"
    FOREIGN KEY ("userId") REFERENCES "User"("id")
    ON DELETE CASCADE ON UPDATE CASCADE;
