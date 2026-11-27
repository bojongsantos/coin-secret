import "server-only";

import { PrismaClient } from "@/generated/prisma/client";
import { createDatabaseAdapter, databaseConnectionString, type DatabaseMode } from "@/infrastructure/database/adapter";

const globalForPrisma = globalThis as unknown as {
  prisma?: PrismaClient;
  marketReadPrisma?: PrismaClient;
  signalsWritePrisma?: PrismaClient;
};

function createPrismaClient(mode: DatabaseMode = "app"): PrismaClient {
  const connectionString = databaseConnectionString();

  return new PrismaClient({
    adapter: createDatabaseAdapter(connectionString, mode),
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
