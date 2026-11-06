import "server-only";

import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "@/generated/prisma/client";

const globalForPrisma = globalThis as unknown as { prisma?: PrismaClient; marketReadPrisma?: PrismaClient };

function createPrismaClient(marketRead = false): PrismaClient {
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) {
    throw new Error("DATABASE_URL belum dikonfigurasi.");
  }

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
      max: marketRead ? 2 : undefined,
    }),
  });
}

export const prisma = globalForPrisma.prisma ?? createPrismaClient();
/** Isolated, server-enforced read-only pool; never use for transactions or persistence. */
export const marketReadPrisma = globalForPrisma.marketReadPrisma ?? createPrismaClient(true);

if (process.env.NODE_ENV !== "production") {
  globalForPrisma.prisma = prisma;
  globalForPrisma.marketReadPrisma = marketReadPrisma;
}
