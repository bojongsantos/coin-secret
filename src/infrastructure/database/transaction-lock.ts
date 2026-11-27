import type { Prisma } from "@/generated/prisma/client";

const busyCode = (value: unknown): boolean => value === 1205 || value === 3572 || value === "1205" || value === "3572"
  || value === "ER_LOCK_WAIT_TIMEOUT" || value === "ER_LOCK_NOWAIT";

class MissingCoordinationRow extends Error {
  constructor() { super("Database coordination row is missing"); this.name = "MissingCoordinationRow"; }
}

export function isMariaDbLockBusy(error: unknown): boolean {
  if (!error || typeof error !== "object") return false;
  const direct = "code" in error ? error.code : undefined;
  if (busyCode(direct)) return true;
  const meta = "meta" in error ? error.meta : undefined;
  if (!meta || typeof meta !== "object") return false;
  if ("code" in meta && busyCode(meta.code)) return true;
  const adapter = "driverAdapterError" in meta ? meta.driverAdapterError : undefined;
  const cause = adapter && typeof adapter === "object" && "cause" in adapter ? adapter.cause : undefined;
  return Boolean(cause && typeof cause === "object" && "originalCode" in cause
    && busyCode(cause.originalCode));
}

/** Fixed coordination rows are created by the schema migration, never on the hot path. */
export async function lockTransaction(
  transaction: Pick<Prisma.TransactionClient, "$queryRaw">,
  key: "signals.refresh" | "news.images.upload",
  wait: "none" | "bounded",
): Promise<boolean> {
  try {
    const rows = wait === "none"
      ? await transaction.$queryRaw<Array<{ key: string }>>`SELECT \`key\` FROM \`CoordinationLock\` WHERE \`key\` = ${key} FOR UPDATE NOWAIT`
      : await transaction.$queryRaw<Array<{ key: string }>>`SELECT \`key\` FROM \`CoordinationLock\` WHERE \`key\` = ${key} FOR UPDATE WAIT 5`;
    if (rows.length === 0) throw new MissingCoordinationRow();
    return true;
  } catch (error) {
    if (wait === "none" && isMariaDbLockBusy(error)) return false;
    throw error;
  }
}
