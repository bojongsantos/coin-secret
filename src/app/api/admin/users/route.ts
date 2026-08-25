import { requireAdmin } from "@/infrastructure/auth/current-user";
import { prisma } from "@/infrastructure/database/prisma";
import { apiError } from "@/shared/server/http";

export async function GET(request: Request) {
  try {
    await requireAdmin();
    const url = new URL(request.url);
    const query = url.searchParams.get("q")?.trim().slice(0, 100);
    const users = await prisma.user.findMany({
      where: query ? { OR: [{ email: { contains: query, mode: "insensitive" } }, { name: { contains: query, mode: "insensitive" } }] } : undefined,
      orderBy: { createdAt: "desc" },
      take: 100,
      select: {
        id: true, name: true, email: true, emailVerified: true, role: true, plan: true, createdAt: true,
        _count: { select: { sessions: true, payments: true } },
        subscription: { select: { status: true, currentPeriodEnd: true } },
      },
    });
    return Response.json({ users });
  } catch (error) {
    return apiError(error);
  }
}
