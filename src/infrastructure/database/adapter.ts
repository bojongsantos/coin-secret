import { PrismaMariaDb } from "@prisma/adapter-mariadb";
import type { PoolConfig } from "mariadb";

export type DatabaseMode = "app" | "market-read" | "signals-write";

export function databaseConnectionString(environment: Readonly<Record<string, string | undefined>> = process.env): string {
  const value = environment.MYSQL_DATABASE_URL ?? environment.DATABASE_URL;
  if (!value) throw new Error("DATABASE_URL belum dikonfigurasi.");
  return value;
}

export function databaseAdapterOptions(connectionString: string, mode: DatabaseMode = "app"): PoolConfig {
  const url = new URL(connectionString);
  if (!["mysql:", "mariadb:"].includes(url.protocol)) throw new Error("DATABASE_URL must identify a MySQL database.");
  const marketRead = mode === "market-read";
  const signalsWrite = mode === "signals-write";
  const local = ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname);
  const initSql = ["SET SESSION max_statement_time=15", "SET SESSION innodb_lock_wait_timeout=5"];
  if (marketRead) initSql.push("SET SESSION TRANSACTION READ ONLY");
  if (signalsWrite) initSql.push("SET SESSION idle_transaction_timeout=45");
  return {
    host: url.hostname,
    port: url.port ? Number(url.port) : 3306,
    user: decodeURIComponent(url.username),
    password: decodeURIComponent(url.password),
    database: decodeURIComponent(url.pathname.slice(1)),
    connectTimeout: 10_000,
    acquireTimeout: 10_000,
    initializationTimeout: 10_000,
    connectionLimit: marketRead || signalsWrite ? 2 : 5,
    timezone: "Z",
    initSql,
    resetAfterUse: true,
    idleTimeout: 60,
    ...(marketRead ? { socketTimeout: 20_000 } : {}),
    ...(!local ? { ssl: { rejectUnauthorized: true } } : {}),
  };
}

export function createDatabaseAdapter(connectionString: string, mode: DatabaseMode = "app"): PrismaMariaDb {
  return new PrismaMariaDb(databaseAdapterOptions(connectionString, mode));
}
