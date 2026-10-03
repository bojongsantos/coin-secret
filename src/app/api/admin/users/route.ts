import { requireAdmin } from "@/infrastructure/auth/current-user";
import { prisma } from "@/infrastructure/database/prisma";
import { apiError } from "@/shared/server/http";
import { adminPage } from "@/shared/server/admin-request";

export async function GET(request: Request) {
  try {
    await requireAdmin();
    const url = new URL(request.url);
    const query = url.searchParams.get("q")?.trim().slice(0, 100);
    const { page, skip, take } = adminPage(request);
    const users = await prisma.user.findMany({
      where: query ? { OR: [{ email: { contains: query, mode: "insensitive" } }, { name: { contains: query, mode: "insensitive" } }] } : undefined,
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      skip, take: take + 1,
      select: {
        id: true, name: true, email: true, emailVerified: true, role: true, plan: true, createdAt: true,
        _count: { select: { sessions: true, payments: true } },
        subscription: { select: { status: true, currentPeriodEnd: true } },
      },
    });
    return Response.json({ users: users.slice(0, take), page, hasMore: users.length > take }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return apiError(error);
  }
}
