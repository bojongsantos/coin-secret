ALTER TABLE "Payment"
  ADD COLUMN "grantedDays" INTEGER,
  ADD COLUMN "accessStartsAt" TIMESTAMP(3),
  ADD COLUMN "accessEndsAt" TIMESTAMP(3);

-- Historical grants stay unknown; a refund must request review rather than guess.
