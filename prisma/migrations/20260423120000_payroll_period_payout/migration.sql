-- Payroll automation: StateSettings knobs + idempotent period ledger (treasury → PERSONAL).

ALTER TABLE "StateSettings" ADD COLUMN "payrollEnabled" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "StateSettings" ADD COLUMN "payrollAmountPerCitizen" DOUBLE PRECISION NOT NULL DEFAULT 0;

CREATE TABLE "PayrollPeriodPayout" (
    "id" TEXT NOT NULL,
    "stateId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "periodKey" TEXT NOT NULL,
    "amount" DECIMAL(38,18) NOT NULL,
    "transactionId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PayrollPeriodPayout_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "PayrollPeriodPayout_transactionId_key" ON "PayrollPeriodPayout"("transactionId");

CREATE UNIQUE INDEX "PayrollPeriodPayout_stateId_userId_periodKey_key" ON "PayrollPeriodPayout"("stateId", "userId", "periodKey");

CREATE INDEX "PayrollPeriodPayout_stateId_periodKey_idx" ON "PayrollPeriodPayout"("stateId", "periodKey");

ALTER TABLE "PayrollPeriodPayout" ADD CONSTRAINT "PayrollPeriodPayout_stateId_fkey" FOREIGN KEY ("stateId") REFERENCES "State"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "PayrollPeriodPayout" ADD CONSTRAINT "PayrollPeriodPayout_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "PayrollPeriodPayout" ADD CONSTRAINT "PayrollPeriodPayout_transactionId_fkey" FOREIGN KEY ("transactionId") REFERENCES "Transaction"("id") ON DELETE SET NULL ON UPDATE CASCADE;
