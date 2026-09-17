import { requireAdmin } from "@/infrastructure/auth/current-user";
import { prisma } from "@/infrastructure/database/prisma";
import { apiError } from "@/shared/server/http";

export async function GET() {
  try {
    await requireAdmin();
    const [users, premiumUsers, activeSubscriptions, settledRevenue, pendingPayments] = await Promise.all([
      prisma.user.count(),
      prisma.user.count({ where: { plan: "PREMIUM" } }),
      prisma.subscription.count({ where: { status: "ACTIVE" } }),
      prisma.payment.groupBy({ by: ["currency"], where: { status: "SETTLED" }, _sum: { amount: true } }),
      prisma.payment.count({ where: { status: "PENDING" } }),
    ]);
    const revenue = settledRevenue.map((row) => ({
      currency: row.currency,
      amount: row._sum.amount ?? 0,
    }));
    return Response.json({ users, premiumUsers, activeSubscriptions, revenue, pendingPayments });
  } catch (error) {
    return apiError(error);
  }
}
