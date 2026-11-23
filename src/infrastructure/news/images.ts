import "server-only";
import { NEWS_IMAGE_STORAGE_BYTES, NEWS_IMAGE_TYPES, newsImagePath, validNewsImageId } from "@/core/domain/news/image";
import { prisma } from "@/infrastructure/database/prisma";
import { getCurrentUser } from "@/infrastructure/auth/current-user";
import { HttpError } from "@/shared/server/http";
import { optimizeNewsImage, readNewsImageBody } from "./image-processing";

export async function uploadNewsImage(actorId: string, request: Request) {
  const contentType = request.headers.get("content-type")?.split(";")[0].trim().toLowerCase() ?? "";
  if (!NEWS_IMAGE_TYPES.some((type) => type === contentType)) throw new HttpError(415, "Choose a JPEG, PNG, WebP, or AVIF image.", "IMAGE_TYPE_UNSUPPORTED");
  const image = await optimizeNewsImage(await readNewsImageBody(request), contentType);
  const row = await prisma.$transaction(async (tx) => {
    // Serialize quota checks across processes, without touching market scanner locks.
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(98321402, 1)`;
    const actor = await tx.user.findUnique({ where: { id: actorId }, select: { role: true, emailVerified: true } });
    if (actor?.role !== "ADMIN" || !actor.emailVerified) throw new HttpError(403, "Admin access required.", "FORBIDDEN");
    const usage = await tx.newsImage.aggregate({ _sum: { bytes: true } });
    if ((usage._sum.bytes ?? 0) + image.bytes > NEWS_IMAGE_STORAGE_BYTES) throw new HttpError(507, "News image storage is full. Use an existing image URL or contact the administrator.", "IMAGE_STORAGE_FULL");
    const created = await tx.newsImage.create({ data: image, select: { id: true, width: true, height: true } });
    await tx.auditLog.create({ data: { actorId, action: "admin.news.image.upload", entityType: "NewsImage", entityId: created.id,
      metadata: { bytes: image.bytes, width: image.width, height: image.height } } });
    return created;
  }, { maxWait: 5_000, timeout: 10_000 });
  return { url: newsImagePath(row.id), width: row.width, height: row.height };
}

export async function readNewsImage(id: string) {
  if (!validNewsImageId(id)) return null;
  const path = newsImagePath(id);
  const published = await prisma.newsArticle.findFirst({ where: {
    status: "PUBLISHED", publishedAt: { lte: new Date() },
    OR: [{ coverUrl: { endsWith: path } }, { body: { contains: path } }],
  }, select: { id: true } });
  if (!published && (await getCurrentUser())?.role !== "ADMIN") return null;
  return prisma.newsImage.findUnique({ where: { id }, select: { data: true } });
}
