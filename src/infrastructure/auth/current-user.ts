import "server-only";

import { cache } from "react";
import { headers } from "next/headers";
import type { CurrentUserDto, SubscriptionPlan, UserRole } from "@/core/domain/identity";
import { auth } from "@/infrastructure/auth/auth";
import { prisma } from "@/infrastructure/database/prisma";
import { isSubscriptionExpired } from "@/core/domain/access/subscription";
import { HttpError } from "@/shared/server/http";

export const getCurrentUser = cache(async (): Promise<CurrentUserDto | null> => {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) return null;
  const record = await prisma.user.findUnique({
    where: { id: session.user.id },
    select: { id: true, name: true, email: true, emailVerified: true, role: true, plan: true, subscription: { select: { currentPeriodEnd: true } } },
  });
  if (!record || !record.emailVerified) return null;
  const expired = isSubscriptionExpired(
    record.plan as SubscriptionPlan,
    record.subscription?.currentPeriodEnd,
    new Date(),
  );
  if (expired) {
    await prisma.$transaction([
      prisma.user.update({ where: { id: record.id }, data: { plan: "FREE" } }),
      prisma.subscription.update({ where: { userId: record.id }, data: { plan: "FREE", status: "EXPIRED" } }),
    ]);
  }
  return { id: record.id, name: record.name, email: record.email, emailVerified: record.emailVerified, role: record.role as UserRole, plan: (expired ? "FREE" : record.plan) as SubscriptionPlan };
});

export async function requireUser(): Promise<CurrentUserDto> {
  const user = await getCurrentUser();
  if (!user) throw new HttpError(401, "Silakan login terlebih dahulu.", "UNAUTHORIZED");
  return user;
}

export async function requireAdmin(): Promise<CurrentUserDto> {
  const user = await requireUser();
  if (user.role !== "ADMIN") throw new HttpError(403, "Akses admin diperlukan.", "FORBIDDEN");
  return user;
}
