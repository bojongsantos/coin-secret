-- Existing plans retain unknown provenance. No levels or outcomes are changed.
ALTER TABLE "TrackedSetup" ADD COLUMN "exchange" TEXT;
