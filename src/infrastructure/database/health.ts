import "server-only";

import { prisma } from "@/infrastructure/database/prisma";

export interface DatabaseHealth {
  status: "ok" | "down";
  latencyMs: number;
  checkedAt: string;
}

const CACHE_MS = 30_000;
let cached: { result: DatabaseHealth; expiresAt: number } | undefined;
let pending: Promise<DatabaseHealth> | undefined;

/** One bounded native SELECT per process per 30 seconds, including failures. */
export function readDatabaseHealth(): Promise<DatabaseHealth> {
  if (cached && performance.now() < cached.expiresAt) return Promise.resolve(cached.result);
  if (pending) return pending;
  pending = (async () => {
    const startedAt = performance.now();
    let status: DatabaseHealth["status"] = "ok";
    try {
      // Connection and statement deadlines are enforced by the native driver.
      await prisma.$queryRaw`SELECT 1`;
    } catch {
      // Provider exceptions can contain connection details and SQL values.
      status = "down";
    }
    const result: DatabaseHealth = {
      status, latencyMs: Math.max(0, Math.round(performance.now() - startedAt)),
      checkedAt: new Date().toISOString(),
    };
    cached = { result, expiresAt: performance.now() + CACHE_MS };
    return result;
  })().finally(() => { pending = undefined; });
  return pending;
}
