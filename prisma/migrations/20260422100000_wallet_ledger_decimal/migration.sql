-- Ledger money: IEEE-754 double → fixed decimal (денежный контур).
ALTER TABLE "Wallet"
  ALTER COLUMN "balance" TYPE DECIMAL(38, 18)
  USING "balance"::double precision::numeric;

ALTER TABLE "Transaction"
  ALTER COLUMN "amount" TYPE DECIMAL(38, 18)
  USING "amount"::double precision::numeric;
