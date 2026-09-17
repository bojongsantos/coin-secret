import { randomUUID } from "node:crypto";
import { requireUser } from "@/infrastructure/auth/current-user";
import { getBillingGateway } from "@/infrastructure/billing/gateway-factory";
import { prisma } from "@/infrastructure/database/prisma";
import { apiError, getRequestIp, HttpError } from "@/shared/server/http";
import { writeAuditLog } from "@/infrastructure/audit/audit-log";
import { billingPlan, billingQuote, isBillingPeriod } from "@/core/domain/billing/plans";

export async function POST(request: Request) {
  try {
    const user = await requireUser();
    // Priced from the catalogue, never from the request. A period name is all
    // the browser gets to choose; the amount is ours.
    const body = (await request.json().catch(() => ({}))) as { period?: unknown };
    const period = isBillingPeriod(body.period) ? body.period : "monthly";
    const plan = billingPlan(period);
    const gateway = getBillingGateway();
    const quote = billingQuote(period, gateway.id, Number(process.env.PREMIUM_PRICE_IDR));
    if (!quote) {
      throw new HttpError(503, "PREMIUM_PRICE_IDR belum dikonfigurasi dengan benar.", "PAYMENT_NOT_CONFIGURED");
    }
    const recent = await prisma.payment.findFirst({
      where: {
        userId: user.id,
        provider: gateway.id,
        planPeriod: period,
        amount: quote.total,
        currency: quote.currency,
        status: "PENDING",
        createdAt: { gt: new Date(Date.now() - 5 * 60 * 1000) },
        checkoutUrl: { not: null },
      },
      orderBy: { createdAt: "desc" },
      select: { orderId: true, amount: true, currency: true, checkoutToken: true, checkoutUrl: true },
    });
    if (recent?.checkoutUrl && recent.checkoutToken) {
      return Response.json({ orderId: recent.orderId, amount: recent.amount, currency: recent.currency, token: recent.checkoutToken, redirectUrl: recent.checkoutUrl });
    }
    const orderId = `CS-${Date.now()}-${randomUUID().slice(0, 8)}`;
    const payment = await prisma.payment.create({
      // Recorded from the gateway itself, so each charge says who processed it.
      data: { orderId, userId: user.id, amount: quote.total, currency: quote.currency, provider: gateway.id, planPeriod: period },
      select: { id: true },
    });
    try {
      const checkout = await gateway.createCheckout({
        orderId,
        amount: quote.total,
        currency: quote.currency,
        description: `Coin Secret Premium — ${plan.label}`,
        customer: { name: user.name, email: user.email },
      });
      await prisma.payment.update({
        where: { id: payment.id },
        data: { checkoutToken: checkout.reference, checkoutUrl: checkout.redirectUrl, expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000) },
      });
      await writeAuditLog({ actorId: user.id, action: "billing.checkout.create", entityType: "Payment", entityId: payment.id, metadata: { orderId, amount: quote.total, currency: quote.currency, provider: gateway.id, period }, ipAddress: getRequestIp(request) });
      return Response.json(
        { orderId, amount: quote.total, currency: quote.currency, token: checkout.reference, redirectUrl: checkout.redirectUrl },
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
