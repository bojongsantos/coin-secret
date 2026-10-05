import { requireAdmin } from "@/infrastructure/auth/current-user";
import { prisma } from "@/infrastructure/database/prisma";
import { apiError } from "@/shared/server/http";
import { adminPage } from "@/shared/server/admin-request";

/** Composed proofs, newest first. Admin only — this is marketing material. */
export async function GET(request: Request) {
  try {
    await requireAdmin();
    const { page, skip, take } = adminPage(request);
    const results = await prisma.trackedSetup.findMany({
      where: { resultAt: { not: null } },
      orderBy: [{ resultAt: "desc" }, { id: "desc" }],
      skip,
      take: take + 1,
      select: {
        id: true,
        symbol: true,
        timeframe: true,
        direction: true,
        confidence: true,
        entry: true,
        target2: true,
        resultAt: true,
        firstSeenAt: true,
      },
    });
    return Response.json({ results: results.slice(0, take), page, hasMore: results.length > take }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return apiError(error);
  }
}
