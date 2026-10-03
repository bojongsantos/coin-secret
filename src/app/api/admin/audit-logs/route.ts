import { requireAdmin } from "@/infrastructure/auth/current-user";
import { prisma } from "@/infrastructure/database/prisma";
import { apiError } from "@/shared/server/http";
import { adminPage } from "@/shared/server/admin-request";

export async function GET(request: Request) {
  try {
    await requireAdmin();
    const { page, skip, take } = adminPage(request);
    const logs = await prisma.auditLog.findMany({
      orderBy: [{ createdAt: "desc" }, { id: "desc" }], skip, take: take + 1,
      select: { id: true, action: true, entityType: true, entityId: true, metadata: true, ipAddress: true, createdAt: true, actor: { select: { id: true, email: true, name: true } } },
    });
    return Response.json({ logs: logs.slice(0, take), page, hasMore: logs.length > take }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return apiError(error);
  }
}
