-- AlterTable
ALTER TABLE "Payment" ADD COLUMN     "planPeriod" TEXT NOT NULL DEFAULT 'monthly';

-- New charges are priced in dollars. Existing rows keep the currency they were
-- actually taken in; rewriting them would restate what a customer paid.
ALTER TABLE "Payment" ALTER COLUMN "currency" SET DEFAULT 'USD';
