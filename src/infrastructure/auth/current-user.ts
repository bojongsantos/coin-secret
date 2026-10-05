import "server-only";

import { cache } from "react";
import { headers } from "next/headers";
import type { CurrentUserDto, SubscriptionPlan, UserRole } from "@/core/domain/identity";
import { auth } from "@/infrastructure/auth/auth";
import { prisma } from "@/infrastructure/database/prisma";
import { effectivePlan } from "@/core/domain/access/subscription";
import { HttpError } from "@/shared/server/http";

export const getCurrentUser = cache(async (): Promise<CurrentUserDto | null> => {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) return null;
  const record = await prisma.user.findUnique({
    where: { id: session.user.id },
    select: { id: true, name: true, email: true, emailVerified: true, role: true, plan: true, subscription: { select: { currentPeriodEnd: true } } },
  });
  if (!record || !record.emailVerified || (process.env.NODE_ENV === "production" && record.email.toLowerCase().endsWith(".local"))) return null;
  // Reading an account must not rewrite it. The previous version downgraded an
  // expired plan here with an unconditional update on the values it had just
  // read, so a settlement landing in between was overwritten and the buyer lost
  // a period they had just paid for. The expiry is now resolved on read (and
  // enforced on every gated request), while the stored row is left to the
  // writer that owns it.
  const plan = effectivePlan(
    record.plan as SubscriptionPlan,
    record.subscription?.currentPeriodEnd,
    new Date(),
  );
  return { id: record.id, name: record.name, email: record.email, emailVerified: record.emailVerified, role: record.role as UserRole, plan };
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
