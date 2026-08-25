/*
  Warnings:

  - You are about to drop the `Notification` table. If the table is not empty, all the data it contains will be lost.
  - You are about to drop the `PriceAlert` table. If the table is not empty, all the data it contains will be lost.
  - You are about to drop the `SetupJournalEntry` table. If the table is not empty, all the data it contains will be lost.
  - You are about to drop the `WatchlistItem` table. If the table is not empty, all the data it contains will be lost.

*/
-- DropForeignKey
ALTER TABLE "Notification" DROP CONSTRAINT "Notification_userId_fkey";

-- DropForeignKey
ALTER TABLE "PriceAlert" DROP CONSTRAINT "PriceAlert_userId_fkey";

-- DropForeignKey
ALTER TABLE "SetupJournalEntry" DROP CONSTRAINT "SetupJournalEntry_userId_fkey";

-- DropForeignKey
ALTER TABLE "WatchlistItem" DROP CONSTRAINT "WatchlistItem_userId_fkey";

-- DropTable
DROP TABLE "Notification";

-- DropTable
DROP TABLE "PriceAlert";

-- DropTable
DROP TABLE "SetupJournalEntry";

-- DropTable
DROP TABLE "WatchlistItem";

-- DropEnum
DROP TYPE "AlertCondition";

-- DropEnum
DROP TYPE "AlertStatus";

-- DropEnum
DROP TYPE "NotificationKind";

-- DropEnum
DROP TYPE "SetupOutcome";
