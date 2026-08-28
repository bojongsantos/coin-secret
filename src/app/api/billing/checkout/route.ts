import { randomUUID } from "node:crypto";
import { requireUser } from "@/infrastructure/auth/current-user";
import { getBillingGateway } from "@/infrastructure/billing/gateway-factory";
import { prisma } from "@/infrastructure/database/prisma";
import { apiError, getRequestIp } from "@/shared/server/http";
import { writeAuditLog } from "@/infrastructure/audit/audit-log";
import { billingPlan, isBillingPeriod } from "@/core/domain/billing/plans";

const CURRENCY = "USD";

export async function POST(request: Request) {
  try {
    const user = await requireUser();
    // Priced from the catalogue, never from the request. A period name is all
    // the browser gets to choose; the amount is ours.
    const body = (await request.json().catch(() => ({}))) as { period?: unknown };
    const period = isBillingPeriod(body.period) ? body.period : "monthly";
    const amount = billingPlan(period).totalUsd;
    const recent = await prisma.payment.findFirst({
      where: { userId: user.id, status: "PENDING", createdAt: { gt: new Date(Date.now() - 5 * 60 * 1000) }, checkoutUrl: { not: null } },
      orderBy: { createdAt: "desc" },
      select: { orderId: true, amount: true, checkoutToken: true, checkoutUrl: true },
    });
    if (recent?.checkoutUrl && recent.checkoutToken) {
      return Response.json({ orderId: recent.orderId, amount: recent.amount, currency: CURRENCY, token: recent.checkoutToken, redirectUrl: recent.checkoutUrl });
    }
    const gateway = getBillingGateway();
    const orderId = `CS-${Date.now()}-${randomUUID().slice(0, 8)}`;
    const payment = await prisma.payment.create({
      // Recorded from the gateway itself, so each charge says who processed it.
      data: { orderId, userId: user.id, amount, provider: gateway.id, planPeriod: period },
      select: { id: true },
    });
    try {
      const checkout = await gateway.createCheckout({
        orderId,
        amount,
        currency: CURRENCY,
        customer: { name: user.name, email: user.email },
      });
      await prisma.payment.update({
        where: { id: payment.id },
        data: { checkoutToken: checkout.reference, checkoutUrl: checkout.redirectUrl, expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000) },
      });
      await writeAuditLog({ actorId: user.id, action: "billing.checkout.create", entityType: "Payment", entityId: payment.id, metadata: { orderId, amount, provider: gateway.id, period }, ipAddress: getRequestIp(request) });
      return Response.json(
        { orderId, amount, currency: CURRENCY, token: checkout.reference, redirectUrl: checkout.redirectUrl },
        { status: 201 },
      );
    } catch (error) {
      await prisma.payment.update({ where: { id: payment.id }, data: { status: "FAILED" } });
      throw error;
    }
  } catch (error) {
    return apiError(error);
  }
}
