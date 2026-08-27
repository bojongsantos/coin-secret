-- AlterTable
ALTER TABLE "TrackedSetup" ADD COLUMN     "zoneBaseTime" INTEGER NOT NULL DEFAULT 0;

-- Backfill from the identity that already encodes it.
-- The signature is `SYMBOL|timeframe|direction|baseTime`; rows written before
-- that format carry prices in the trailing field, so only all-digit values are
-- taken. Anything left at zero is simply not re-read, and a fresh setup is
-- chosen for that symbol instead.
UPDATE "TrackedSetup"
SET "zoneBaseTime" = CAST(split_part("signature", '|', 4) AS INTEGER)
WHERE split_part("signature", '|', 4) ~ '^[0-9]{1,9}$';
