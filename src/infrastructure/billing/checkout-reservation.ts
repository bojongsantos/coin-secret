import "server-only";
import { randomUUID } from "node:crypto";
import { prisma } from "@/infrastructure/database/prisma";
import { withSerializationRetry } from "@/infrastructure/billing/transaction-retry";

/** Serialize the read/reserve step so parallel clicks cannot create two invoices. */
export async function reserveCheckout(input: {
  userId: string; provider: string; planPeriod: string; amount: number; currency: string; grantedDays: number;
}) {
  const { grantedDays, ...order } = input;
  return withSerializationRetry(() => prisma.$transaction(async (tx) => {
    const existing = await tx.payment.findFirst({
      where: { ...order, status: "PENDING" },
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      select: { id: true, orderId: true, amount: true, currency: true, checkoutToken: true, checkoutUrl: true, rawStatus: true },
    });
    if (existing) return { payment: existing, existing: true };
    const payment = await tx.payment.create({
      data: { ...order, grantedDays, orderId: `CS-${Date.now()}-${randomUUID().slice(0, 8)}`, rawStatus: "CHECKOUT_CREATING" },
      select: { id: true, orderId: true, amount: true, currency: true, checkoutToken: true, checkoutUrl: true, rawStatus: true },
    });
    return { payment, existing: false };
  }, { isolationLevel: "Serializable" }));
}
