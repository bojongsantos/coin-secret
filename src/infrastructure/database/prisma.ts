import "server-only";

import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "@/generated/prisma/client";

const globalForPrisma = globalThis as unknown as {
  prisma?: PrismaClient;
  marketReadPrisma?: PrismaClient;
  signalsWritePrisma?: PrismaClient;
};

function createPrismaClient(mode: "app" | "market-read" | "signals-write" = "app"): PrismaClient {
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) {
    throw new Error("DATABASE_URL belum dikonfigurasi.");
  }

  const marketRead = mode === "market-read";
  const signalsWrite = mode === "signals-write";
  return new PrismaClient({
    // Native driver/server limits end the actual wait. A promise-only timeout
    // would let queries keep running after callers release their scan guard.
    adapter: new PrismaPg({
      connectionString,
      connectionTimeoutMillis: 10_000,
      statement_timeout: 15_000,
      lock_timeout: 5_000,
      // Only standalone SELECTs may abandon a response after pg closes the
      // failed pool connection. Transactional writes retain server cancellation.
      query_timeout: marketRead ? 10_000 : undefined,
      options: marketRead ? "-c default_transaction_read_only=on" : undefined,
      max: marketRead || signalsWrite ? 2 : undefined,
      // A scan and its publication check out fresh connections.
      maxUses: signalsWrite ? 1 : undefined,
      idle_in_transaction_session_timeout: signalsWrite ? 45_000 : undefined,
    }),
  });
}

export const prisma = globalForPrisma.prisma ?? createPrismaClient();
/** Isolated, server-enforced read-only pool; never use for transactions or persistence. */
export const marketReadPrisma = globalForPrisma.marketReadPrisma ?? createPrismaClient("market-read");
export const signalsWritePrisma = globalForPrisma.signalsWritePrisma ?? createPrismaClient("signals-write");

if (process.env.NODE_ENV !== "production") {
  globalForPrisma.prisma = prisma;
  globalForPrisma.marketReadPrisma = marketReadPrisma;
  globalForPrisma.signalsWritePrisma = signalsWritePrisma;
}
