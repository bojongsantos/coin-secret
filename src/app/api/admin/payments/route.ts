import { requireAdmin } from "@/infrastructure/auth/current-user";
import { prisma } from "@/infrastructure/database/prisma";
import { apiError } from "@/shared/server/http";
import { adminPage } from "@/shared/server/admin-request";

export async function GET(request: Request) {
  try {
    await requireAdmin();
    const status = new URL(request.url).searchParams.get("status");
    const { page, skip, take } = adminPage(request);
    const allowed = ["PENDING", "SETTLED", "FAILED", "EXPIRED", "CANCELED", "REFUNDED"] as const;
    const selected = allowed.find((value) => value === status);
    const payments = await prisma.payment.findMany({
      where: selected ? { status: selected } : undefined,
      orderBy: [{ createdAt: "desc" }, { id: "desc" }], skip, take: take + 1,
      select: { id: true, orderId: true, providerTransactionId: true, amount: true, currency: true, status: true, rawStatus: true, createdAt: true, paidAt: true, user: { select: { id: true, name: true, email: true } } },
    });
    const now = Date.now();
    return Response.json({ payments: payments.slice(0, take).map((payment) => ({ ...payment, needsReconciliation: payment.status === "PENDING" && now - payment.createdAt.getTime() > 86_400_000 })), page, hasMore: payments.length > take }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return apiError(error);
  }
}
