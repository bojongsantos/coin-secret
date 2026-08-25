-- CreateEnum
CREATE TYPE "SetupCaptureKind" AS ENUM ('ENTRY', 'RESULT');

-- CreateTable
CREATE TABLE "TrackedSetup" (
    "id" TEXT NOT NULL,
    "symbol" TEXT NOT NULL,
    "timeframe" TEXT NOT NULL,
    "direction" TEXT NOT NULL,
    "entry" DOUBLE PRECISION NOT NULL,
    "target1" DOUBLE PRECISION NOT NULL,
    "target2" DOUBLE PRECISION NOT NULL,
    "stopLoss" DOUBLE PRECISION NOT NULL,
    "riskReward" DOUBLE PRECISION NOT NULL,
    "confidence" INTEGER NOT NULL,
    "zoneTop" DOUBLE PRECISION NOT NULL,
    "zoneBottom" DOUBLE PRECISION NOT NULL,
    "status" TEXT NOT NULL,
    "signature" TEXT NOT NULL,
    "resultAt" TIMESTAMP(3),
    "firstSeenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "TrackedSetup_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SetupSnapshot" (
    "id" TEXT NOT NULL,
    "kind" "SetupCaptureKind" NOT NULL,
    "status" TEXT NOT NULL,
    "price" DOUBLE PRECISION NOT NULL,
    "payload" JSONB NOT NULL,
    "capturedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "setupId" TEXT NOT NULL,

    CONSTRAINT "SetupSnapshot_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "TrackedSetup_signature_key" ON "TrackedSetup"("signature");

-- CreateIndex
CREATE INDEX "TrackedSetup_symbol_updatedAt_idx" ON "TrackedSetup"("symbol", "updatedAt");

-- CreateIndex
CREATE INDEX "TrackedSetup_resultAt_idx" ON "TrackedSetup"("resultAt");

-- CreateIndex
CREATE INDEX "SetupSnapshot_capturedAt_idx" ON "SetupSnapshot"("capturedAt");

-- CreateIndex
CREATE UNIQUE INDEX "SetupSnapshot_setupId_kind_key" ON "SetupSnapshot"("setupId", "kind");

-- AddForeignKey
ALTER TABLE "SetupSnapshot" ADD CONSTRAINT "SetupSnapshot_setupId_fkey" FOREIGN KEY ("setupId") REFERENCES "TrackedSetup"("id") ON DELETE CASCADE ON UPDATE CASCADE;
