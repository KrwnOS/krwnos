-- Role tax monthly tick: idempotency ledger (state + user + UTC month).

CREATE TABLE "RoleTaxPeriodCharge" (
    "id" TEXT NOT NULL,
    "stateId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "periodKey" TEXT NOT NULL,
    "amount" DECIMAL(38,18) NOT NULL,
    "transactionId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "RoleTaxPeriodCharge_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "RoleTaxPeriodCharge_transactionId_key" ON "RoleTaxPeriodCharge"("transactionId");

CREATE UNIQUE INDEX "RoleTaxPeriodCharge_stateId_userId_periodKey_key" ON "RoleTaxPeriodCharge"("stateId", "userId", "periodKey");

CREATE INDEX "RoleTaxPeriodCharge_stateId_periodKey_idx" ON "RoleTaxPeriodCharge"("stateId", "periodKey");

ALTER TABLE "RoleTaxPeriodCharge" ADD CONSTRAINT "RoleTaxPeriodCharge_stateId_fkey" FOREIGN KEY ("stateId") REFERENCES "State"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "RoleTaxPeriodCharge" ADD CONSTRAINT "RoleTaxPeriodCharge_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "RoleTaxPeriodCharge" ADD CONSTRAINT "RoleTaxPeriodCharge_transactionId_fkey" FOREIGN KEY ("transactionId") REFERENCES "Transaction"("id") ON DELETE SET NULL ON UPDATE CASCADE;
