/** Session reads and market polling never extend these deadlines. */
export function sessionLimits(role: string) {
  return role === "ADMIN"
    ? { idleMs: 15 * 60_000, absoluteMs: 8 * 60 * 60_000 }
    : { idleMs: 30 * 60_000, absoluteMs: 24 * 60 * 60_000 };
}

export function sessionDeadline(
  session: { createdAt: Date; updatedAt: Date; expiresAt: Date },
  role: string,
): number {
  const limits = sessionLimits(role);
  return Math.min(
    session.createdAt.getTime() + limits.absoluteMs,
    session.updatedAt.getTime() + limits.idleMs,
    session.expiresAt.getTime(),
  );
}
