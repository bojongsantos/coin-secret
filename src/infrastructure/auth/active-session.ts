import "server-only";

import { auth } from "@/infrastructure/auth/auth";
import { prisma } from "@/infrastructure/database/prisma";
import { sessionDeadline, sessionLimits } from "@/core/domain/identity/session-policy";

export async function getActiveSession(headers: Headers) {
  const result = await auth.api.getSession({
    headers,
    query: { disableCookieCache: true, disableRefresh: true },
  });
  if (!result) return null;
  const now = Date.now();
  if (sessionDeadline(result.session, result.user.role) > now) return result;
  const limits = sessionLimits(result.user.role);
  // Conditional deletion cannot remove a session another tab just renewed.
  const deleted = await prisma.session.deleteMany({ where: {
    id: result.session.id,
    OR: [
      { createdAt: { lte: new Date(now - limits.absoluteMs) } },
      { updatedAt: { lte: new Date(now - limits.idleMs) } },
      { expiresAt: { lte: new Date(now) } },
    ],
  } });
  if (deleted.count === 0) {
    const refreshed = await auth.api.getSession({ headers, query: { disableCookieCache: true, disableRefresh: true } });
    if (refreshed && sessionDeadline(refreshed.session, refreshed.user.role) > Date.now()) return refreshed;
  }
  return null;
}

export async function recordSessionActivity(headers: Headers) {
  const result = await getActiveSession(headers);
  if (!result || !result.user.emailVerified) return null;
  const now = new Date();
  const limits = sessionLimits(result.user.role);
  const updated = await prisma.session.updateMany({
    where: {
      id: result.session.id,
      createdAt: { gt: new Date(now.getTime() - limits.absoluteMs) },
      updatedAt: { gt: new Date(now.getTime() - limits.idleMs) },
      expiresAt: { gt: now },
    },
    data: { updatedAt: now },
  });
  if (updated.count !== 1) return null;
  return { ...result, session: { ...result.session, updatedAt: now } };
}
