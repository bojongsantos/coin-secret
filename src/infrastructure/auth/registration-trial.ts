import "server-only";
import { registrationTrialPeriod } from "@/core/domain/access/subscription";
import { prisma } from "@/infrastructure/database/prisma";
import { withSerializationRetry } from "@/infrastructure/billing/transaction-retry";

/** Called only after a new auth user is created, never by an account read. */
export async function initializeRegistrationTrial(userId: string): Promise<void> {
  await withSerializationRetry(() => prisma.$transaction(async (tx) => {
    const user = await tx.user.findUnique({ where: { id: userId }, include: { subscription: true } });
    if (!user || user.plan !== "FREE" || user.subscription) return;
    const period = registrationTrialPeriod(user.createdAt);
    if (period.currentPeriodEnd <= new Date()) return;
    await tx.subscription.create({ data: {
      userId, provider: "trial", status: "ACTIVE", plan: "PREMIUM",
      ...period,
    } });
    await tx.user.update({ where: { id: userId }, data: { plan: "PREMIUM" } });
  }, { isolationLevel: "Serializable" }));
}
