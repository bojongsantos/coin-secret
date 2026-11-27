import "server-only";
import { cache } from "react";
import type { NewsArticle, Prisma } from "@/generated/prisma/client";
import type { Article, ArticleFields, ArticleQuery } from "@/core/domain/news/article";
import { articlePublication } from "@/core/domain/news/article";
import { prisma } from "@/infrastructure/database/prisma";
import { withSerializationRetry } from "@/infrastructure/billing/transaction-retry";
import { HttpError } from "@/shared/server/http";

function serialize(row: NewsArticle): Article {
  return {
    id: row.id,
    version: row.version,
    title: row.title,
    slug: row.slug,
    summary: row.summary,
    body: row.body,
    category: row.category,
    coverUrl: row.coverUrl,
    coverAlt: row.coverAlt,
    seoTitle: row.seoTitle,
    seoDescription: row.seoDescription,
    status: row.status,
    authorName: row.authorName,
    publishedAt: row.publishedAt?.toISOString() ?? null,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}
export const publishedArticle = cache(async (slug: string) => {
  const row = await prisma.newsArticle.findFirst({ where: { slug, status: "PUBLISHED", publishedAt: { lte: new Date() } } });
  return row ? serialize(row) : null;
});
export async function adminArticle(id: string) {
  const row = await prisma.newsArticle.findUnique({ where: { id } });
  return row ? serialize(row) : null;
}
export async function articleList(query: ArticleQuery, admin = false, status?: ArticleFields["status"]) {
  const where: Prisma.NewsArticleWhereInput = {
    ...(admin ? (status ? { status } : {}) : { status: "PUBLISHED", publishedAt: { lte: new Date() } }),
    ...(query.category ? { category: query.category } : {}),
    ...(query.q ? { OR: [{ title: { contains: query.q } }, { summary: { contains: query.q } }] } : {}),
  };
  const size = admin ? 20 : 12;
  const rows = await prisma.newsArticle.findMany({ where, orderBy: admin ? [{ updatedAt: "desc" }, { id: "desc" }] : [{ publishedAt: "desc" }, { id: "desc" }],
    skip: (query.page - 1) * size, take: size + 1 });
  return { rows: rows.slice(0, size).map(serialize), page: query.page, hasMore: rows.length > size };
}
export async function newsCategories() {
  const rows = await prisma.newsArticle.findMany({ where: { status: "PUBLISHED", publishedAt: { lte: new Date() } }, distinct: ["category"], select: { category: true }, orderBy: { category: "asc" } });
  return rows.map((row) => row.category);
}
export async function articleSitemap() {
  return prisma.newsArticle.findMany({ where: { status: "PUBLISHED", publishedAt: { lte: new Date() } }, select: { slug: true, updatedAt: true }, orderBy: { publishedAt: "desc" }, take: 45000 });
}
export async function saveArticle(actorId: string, fields: ArticleFields, ipAddress: string | null, existing?: { id: string; version: number }) {
  try {
    return await withSerializationRetry(() => prisma.$transaction(async (tx) => {
      const actor = await tx.user.findUnique({ where: { id: actorId }, select: { role: true, emailVerified: true, name: true } });
      if (actor?.role !== "ADMIN" || !actor.emailVerified) throw new HttpError(403, "Admin access required.", "FORBIDDEN");
      const previous = existing ? await tx.newsArticle.findUnique({ where: { id: existing.id } }) : null;
      if (existing && !previous) throw new HttpError(404, "Article not found.", "NOT_FOUND");
      if (existing && previous?.version !== existing.version) throw new HttpError(409, "This article changed in another session. Reload before saving.", "VERSION_CONFLICT");
      if (previous?.publishedAt && fields.slug !== previous.slug) throw new HttpError(409, "Published article URLs are permanent. Keep the original slug.", "SLUG_LOCKED");
      const data = { ...fields, ...articlePublication(previous, fields, new Date()) };
      const row = previous
        ? await tx.newsArticle.update({ where: { id: previous.id, version: existing?.version }, data: { ...data, version: { increment: 1 } } })
        : await tx.newsArticle.create({ data: { ...data, authorName: actor.name, authorId: actorId } });
      await tx.auditLog.create({ data: { actorId, action: previous ? "admin.news.update" : "admin.news.create", entityType: "NewsArticle", entityId: row.id,
        metadata: { status: row.status, previousStatus: previous?.status ?? null, version: row.version, slug: row.slug }, ipAddress } });
      return serialize(row);
    }, { isolationLevel: "Serializable" }));
  } catch (error) {
    if (error && typeof error === "object" && "code" in error && error.code === "P2002") throw new HttpError(409, "This URL slug is already used. Choose another.", "SLUG_TAKEN");
    throw error;
  }
}
