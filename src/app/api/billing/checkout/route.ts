import { requireUser } from "@/infrastructure/auth/current-user";
import { getBillingGateway } from "@/infrastructure/billing/gateway-factory";
import { prisma } from "@/infrastructure/database/prisma";
import { apiError, getRequestIp, HttpError, readBoundedJson, tooManyRequests } from "@/shared/server/http";
import { createFixedWindowLimiter } from "@/core/application/rate-limit/fixed-window";
import { writeAuditLog } from "@/infrastructure/audit/audit-log";
import { billingPlan, billingQuote, isBillingPeriod } from "@/core/domain/billing/plans";
import { reserveCheckout } from "@/infrastructure/billing/checkout-reservation";

const checkoutLimiter = createFixedWindowLimiter({ limit: 5, windowMs: 60_000 });

export async function POST(request: Request) {
  try {
    const user = await requireUser();
    const decision = checkoutLimiter.check(user.id);
    if (!decision.allowed) return tooManyRequests(decision.retryAfterSeconds);
    // Priced from the catalogue, never from the request. A period name is all
    // the browser gets to choose; the amount is ours.
    const body = await readBoundedJson(request, 16_384);
    if (!body || typeof body !== "object" || Array.isArray(body)) {
      throw new HttpError(400, "Body JSON tidak valid.", "INVALID_JSON");
    }
    const requestedPeriod = "period" in body ? body.period : undefined;
    if (!isBillingPeriod(requestedPeriod)) {
      throw new HttpError(400, "Periode paket tidak valid.", "INVALID_PERIOD");
    }
    const period = requestedPeriod;
    const plan = billingPlan(period);
    const gateway = getBillingGateway();
    const quote = billingQuote(period, gateway.id, Number(process.env.PREMIUM_PRICE_IDR));
    if (!quote) {
      throw new HttpError(503, "PREMIUM_PRICE_IDR belum dikonfigurasi dengan benar.", "PAYMENT_NOT_CONFIGURED");
    }
    const reserved = await reserveCheckout({
      userId: user.id, provider: gateway.id, planPeriod: period, amount: quote.total, currency: quote.currency, grantedDays: plan.days,
    });
    const payment = reserved.payment;
    const orderId = payment.orderId;
    if (reserved.existing) {
      if (payment.checkoutUrl && payment.checkoutToken) {
        return Response.json({ orderId, amount: payment.amount, currency: payment.currency, token: payment.checkoutToken, redirectUrl: payment.checkoutUrl });
      }
      throw new HttpError(409, "Permintaan pembayaran ini masih diproses atau perlu diperiksa. Hubungi dukungan sebelum membuat pembayaran ulang.", "PAYMENT_REQUIRES_RECONCILIATION");
    }
    try {
      const checkout = await gateway.createCheckout({
        orderId,
        amount: quote.total,
        currency: quote.currency,
        description: `CoinSecret Premium — ${plan.label}`,
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
      // A callback may already have settled this invoice. Never downgrade it.
      // Timeout/network/bookkeeping errors do not prove invoice creation failed.
      const rejected = error instanceof HttpError && error.code === "PAYMENT_GATEWAY_REJECTED";
      await prisma.payment.updateMany({
        where: { id: payment.id, status: "PENDING" },
        data: { status: rejected ? "FAILED" : "PENDING", rawStatus: rejected ? "CHECKOUT_REJECTED" : "CHECKOUT_UNCERTAIN" },
      });
      throw error;
    }
  } catch (error) {
    return apiError(error);
  }
}
