import "server-only";
import type { SignalsSnapshotPort } from "@/core/application/ports/signals-snapshot-port";
import { marketReadPrisma, signalsWritePrisma } from "@/infrastructure/database/prisma";
import { readSetupRows } from "@/infrastructure/database/setup-read";
import { clearSetupReadCache, createActiveSetupStore } from "@/infrastructure/persistence/active-setup-store";

const SNAPSHOT_KEY = "market.signals.default-board.v1";

export const signalsSnapshotStore: SignalsSnapshotPort = {
  async coordinateRefresh(work) {
    const started = performance.now();
    let stage = "begin";
    console.info("[signals.transaction]", { stage });
    try {
      const result = await signalsWritePrisma.$transaction(async (transaction) => {
        stage = "lock";
        console.info("[signals.transaction]", { stage, elapsedMs: Math.round(performance.now() - started) });
        const [lock] = await transaction.$queryRaw<Array<{ acquired: boolean }>>`
          SELECT pg_try_advisory_xact_lock(98321401, 1) AS acquired
        `;
        if (!lock?.acquired) return { acquired: false as const };
        stage = "scan";
        // Same transaction fences writes after timeout/disconnect and releases its lock on rollback.
        const value = await work(createActiveSetupStore(transaction, true));
        stage = "commit";
        return { acquired: true as const, value };
      }, { maxWait: 10_000, timeout: 65_000 });
      if (result.acquired) clearSetupReadCache();
      return result;
    } catch (error) {
      console.warn("[signals.transaction]", { stage, status: "failed", elapsedMs: Math.round(performance.now() - started) });
      throw error;
    }
  },
  async load(signal) {
    const row = await readSetupRows("snapshot", () => marketReadPrisma.appSetting.findUnique({
      where: { key: SNAPSHOT_KEY }, select: { value: true },
    }), signal);
    return row?.value;
  },
  async save(snapshot) {
    // Timestamp comparison is atomic across workers; a delayed write cannot replace a newer board.
    const payload = JSON.stringify(snapshot);
    await signalsWritePrisma.$executeRaw`
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
