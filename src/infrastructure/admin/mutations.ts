import "server-only";
import { prisma } from "@/infrastructure/database/prisma";
import { withSerializationRetry } from "@/infrastructure/billing/transaction-retry";
import { rejectUserChange, subscriptionStatusForPlan, type UserChange } from "@/core/domain/access/admin-actions";
import { HttpError } from "@/shared/server/http";

export async function updateAdminUser(actorId: string, id: string, input: UserChange, ipAddress: string | null) {
  return withSerializationRetry(() => prisma.$transaction(async (tx) => {
    // Recheck authority inside every attempt, including after a concurrent demotion.
    const actor = await tx.user.findUnique({ where: { id: actorId } });
    if (actor?.role !== "ADMIN" || !actor.emailVerified) throw new HttpError(403, "Admin access required.", "FORBIDDEN");
    const rejection = rejectUserChange(actorId, id, input);
    if (rejection) throw new HttpError(400, rejection === "SELF_DEMOTION" ? "You cannot remove your own admin role." : "No changes supplied.", rejection);
    const target = await tx.user.findUnique({ where: { id } });
    if (!target) throw new HttpError(404, "User not found.", "NOT_FOUND");
    if (target.role === "ADMIN" && input.role === "USER" && await tx.user.count({ where: { role: "ADMIN", emailVerified: true } }) <= 1) {
      throw new HttpError(409, "At least one verified admin must remain.", "LAST_ADMIN");
    }
    const user = await tx.user.update({ where: { id }, data: input, select: { id: true, name: true, email: true, role: true, plan: true } });
    if (input.plan) {
      const subscription = { plan: input.plan, status: subscriptionStatusForPlan(input.plan), provider: "admin", currentPeriodStart: new Date(), currentPeriodEnd: null, cancelAtPeriodEnd: false, providerSubscriptionId: null };
      await tx.subscription.upsert({ where: { userId: id }, create: { userId: id, ...subscription }, update: subscription });
    }
    if (input.role === "USER" && target.role === "ADMIN") await tx.session.deleteMany({ where: { userId: id } });
    await tx.auditLog.create({ data: { actorId, action: "admin.user.update", entityType: "User", entityId: id, metadata: { ...input }, ipAddress } });
    return user;
  }, { isolationLevel: "Serializable" }));
}

export async function updateAdminGate(actorId: string, input: { feature: string; free: boolean; premium: boolean }, ipAddress: string | null) {
  return withSerializationRetry(() => prisma.$transaction(async (tx) => {
    const actor = await tx.user.findUnique({ where: { id: actorId } });
    if (actor?.role !== "ADMIN" || !actor.emailVerified) throw new HttpError(403, "Admin access required.", "FORBIDDEN");
    const gate = await tx.featureGate.upsert({ where: { feature: input.feature }, create: input, update: input });
    await tx.auditLog.create({ data: { actorId, action: "admin.feature-gate.update", entityType: "FeatureGate", entityId: gate.id, metadata: input, ipAddress } });
    return gate;
  }, { isolationLevel: "Serializable" }));
}
