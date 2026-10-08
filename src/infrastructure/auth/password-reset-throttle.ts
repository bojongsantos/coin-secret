import "server-only";

import { createHash } from "node:crypto";
import { prisma } from "@/infrastructure/database/prisma";

/** Durable limits survive restarts and apply across IP addresses and app workers. */
export async function passwordResetThrottle(email: string, action: "send" | "verify", now = Date.now()): Promise<number> {
  const key = `password-reset:${action}:${createHash("sha256").update(email.trim().toLowerCase()).digest("hex")}`;
  const windowMs = action === "send" ? 10 * 60_000 : 5 * 60_000;
  const maximum = action === "send" ? 3 : 5;
  return prisma.$transaction(async (tx) => {
    // Serialize the read/check/write across workers without a new table.
    await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtext(${key}))::text`;
    const window = await tx.rateLimit.findUnique({ where: { key } });
    const startedAt = window ? Number(window.lastRequest) : now;
    if (window && now - startedAt < windowMs && window.count >= maximum) {
      return Math.max(1, Math.ceil((startedAt + windowMs - now) / 1_000));
    }
    const cooldownKey = `${key}:cooldown`;
    if (action === "send") {
      const last = await tx.rateLimit.findUnique({ where: { key: cooldownKey } });
      if (last && now - Number(last.lastRequest) < 60_000) {
        return Math.max(1, Math.ceil((Number(last.lastRequest) + 60_000 - now) / 1_000));
      }
      await tx.rateLimit.upsert({ where: { key: cooldownKey }, create: { key: cooldownKey, count: 1, lastRequest: BigInt(now) }, update: { lastRequest: BigInt(now) } });
    }
    const fresh = !window || now - startedAt >= windowMs;
    await tx.rateLimit.upsert({
      where: { key },
      create: { key, count: 1, lastRequest: BigInt(now) },
      update: { count: fresh ? 1 : window.count + 1, lastRequest: BigInt(fresh ? now : startedAt) },
    });
    return 0;
  });
}
