CREATE TYPE "NewsArticleStatus" AS ENUM ('DRAFT', 'PUBLISHED', 'ARCHIVED');
CREATE TABLE "NewsArticle" (
  "id" TEXT NOT NULL,
  "slug" TEXT NOT NULL,
  "title" TEXT NOT NULL,
  "summary" TEXT NOT NULL DEFAULT '',
  "body" TEXT NOT NULL DEFAULT '',
  "category" TEXT NOT NULL DEFAULT 'News',
  "coverUrl" TEXT NOT NULL DEFAULT '',
  "coverAlt" TEXT NOT NULL DEFAULT '',
  "seoTitle" TEXT NOT NULL DEFAULT '',
  "seoDescription" TEXT NOT NULL DEFAULT '',
  "status" "NewsArticleStatus" NOT NULL DEFAULT 'DRAFT',
  "authorName" TEXT NOT NULL,
  "authorId" TEXT,
  "publishedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  "version" INTEGER NOT NULL DEFAULT 1,
  CONSTRAINT "NewsArticle_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "NewsArticle_slug_key" ON "NewsArticle"("slug");
CREATE INDEX "NewsArticle_status_publishedAt_id_idx" ON "NewsArticle"("status", "publishedAt", "id");
ALTER TABLE "NewsArticle" ADD CONSTRAINT "NewsArticle_authorId_fkey" FOREIGN KEY ("authorId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
