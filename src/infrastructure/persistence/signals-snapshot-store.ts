import "server-only";
import type { SignalsSnapshotPort } from "@/core/application/ports/signals-snapshot-port";
import { prisma } from "@/infrastructure/database/prisma";
import { readSetupRows } from "@/infrastructure/database/setup-read";
import { createActiveSetupStore } from "@/infrastructure/persistence/active-setup-store";

const SNAPSHOT_KEY = "market.signals.default-board.v1";

export const signalsSnapshotStore: SignalsSnapshotPort = {
  async coordinateRefresh(work) {
    return prisma.$transaction(async (transaction) => {
      const [lock] = await transaction.$queryRaw<Array<{ acquired: boolean }>>`
        SELECT pg_try_advisory_xact_lock(98321401, 1) AS acquired
      `;
      if (!lock?.acquired) return { acquired: false as const };
      // Same transaction fences writes after timeout/disconnect and releases its lock on rollback.
      const value = await work(createActiveSetupStore(transaction, true));
      return { acquired: true as const, value };
    }, { maxWait: 10_000, timeout: 65_000 });
  },
  async load(signal) {
    const row = await readSetupRows("snapshot", () => prisma.appSetting.findUnique({
      where: { key: SNAPSHOT_KEY }, select: { value: true },
    }), signal);
    return row?.value;
  },
  async save(snapshot) {
    // Timestamp comparison is atomic across workers; a delayed write cannot replace a newer board.
    const payload = JSON.stringify(snapshot);
    await prisma.$executeRaw`
      INSERT INTO "AppSetting" ("key", "value", "updatedAt")
      VALUES (${SNAPSHOT_KEY}, ${payload}::jsonb, NOW())
      ON CONFLICT ("key") DO UPDATE
      SET "value" = EXCLUDED."value", "updatedAt" = EXCLUDED."updatedAt"
      WHERE "AppSetting"."value"->'version' IS DISTINCT FROM EXCLUDED."value"->'version'
        OR "AppSetting"."value"->'symbols' IS DISTINCT FROM EXCLUDED."value"->'symbols'
        OR "AppSetting"."value"->'sources' IS DISTINCT FROM EXCLUDED."value"->'sources'
        OR COALESCE("AppSetting"."value"->'result'->>'scannedAt', '')
          > to_char((NOW() AT TIME ZONE 'UTC') + INTERVAL '1 minute', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')
        OR COALESCE("AppSetting"."value"->'result'->>'scannedAt', '')
          < (EXCLUDED."value"->'result'->>'scannedAt')
    `;
  },
};
