-- Schema only. Approved legacy retirement runs after archive-aware code is live.
ALTER TABLE "TrackedSetup"
  ADD COLUMN "archivedAt" TIMESTAMP(3),
  ADD COLUMN "archiveReason" TEXT;
