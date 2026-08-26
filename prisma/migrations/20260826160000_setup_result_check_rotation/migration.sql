-- AlterTable
ALTER TABLE "TrackedSetup" ADD COLUMN     "resultCheckedAt" TIMESTAMP(3);

-- CreateIndex
CREATE INDEX "TrackedSetup_resultCheckedAt_idx" ON "TrackedSetup"("resultCheckedAt");
