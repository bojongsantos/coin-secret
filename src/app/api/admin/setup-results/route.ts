import { requireAdmin } from "@/infrastructure/auth/current-user";
import { prisma } from "@/infrastructure/database/prisma";
import { apiError } from "@/shared/server/http";

/** Composed proofs, newest first. Admin only — this is marketing material. */
export async function GET() {
  try {
    await requireAdmin();
    const results = await prisma.trackedSetup.findMany({
      where: { resultAt: { not: null } },
      orderBy: { resultAt: "desc" },
      take: 60,
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
    return Response.json({ results }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return apiError(error);
  }
}
