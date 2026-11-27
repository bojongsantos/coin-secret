import "server-only";
import type { SignalsSnapshotPort } from "@/core/application/ports/signals-snapshot-port";
import { marketReadPrisma, signalsWritePrisma } from "@/infrastructure/database/prisma";
import { readSetupRows } from "@/infrastructure/database/setup-read";
import { lockTransaction } from "@/infrastructure/database/transaction-lock";
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
        if (!await lockTransaction(transaction, "signals.refresh", "none")) return { acquired: false as const };
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
      INSERT INTO \`AppSetting\` (\`key\`, \`value\`, \`updatedAt\`)
      VALUES (${SNAPSHOT_KEY}, ${payload}, UTC_TIMESTAMP(3))
      ON DUPLICATE KEY UPDATE
      \`updatedAt\` = IF(
        NOT (JSON_EXTRACT(\`value\`, '$.version') <=> JSON_EXTRACT(VALUES(\`value\`), '$.version'))
        OR NOT (JSON_EXTRACT(\`value\`, '$.symbols') <=> JSON_EXTRACT(VALUES(\`value\`), '$.symbols'))
        OR NOT (JSON_EXTRACT(\`value\`, '$.sources') <=> JSON_EXTRACT(VALUES(\`value\`), '$.sources'))
        OR COALESCE(JSON_UNQUOTE(JSON_EXTRACT(\`value\`, '$.result.scannedAt')), '')
          > CONCAT(LEFT(DATE_FORMAT(UTC_TIMESTAMP(3) + INTERVAL 1 MINUTE, '%Y-%m-%dT%H:%i:%s.%f'), 23), 'Z')
        OR COALESCE(JSON_UNQUOTE(JSON_EXTRACT(\`value\`, '$.result.scannedAt')), '')
          < JSON_UNQUOTE(JSON_EXTRACT(VALUES(\`value\`), '$.result.scannedAt')),
        VALUES(\`updatedAt\`), \`updatedAt\`),
      \`value\` = IF(
        NOT (JSON_EXTRACT(\`value\`, '$.version') <=> JSON_EXTRACT(VALUES(\`value\`), '$.version'))
        OR NOT (JSON_EXTRACT(\`value\`, '$.symbols') <=> JSON_EXTRACT(VALUES(\`value\`), '$.symbols'))
        OR NOT (JSON_EXTRACT(\`value\`, '$.sources') <=> JSON_EXTRACT(VALUES(\`value\`), '$.sources'))
        OR COALESCE(JSON_UNQUOTE(JSON_EXTRACT(\`value\`, '$.result.scannedAt')), '')
          > CONCAT(LEFT(DATE_FORMAT(UTC_TIMESTAMP(3) + INTERVAL 1 MINUTE, '%Y-%m-%dT%H:%i:%s.%f'), 23), 'Z')
        OR COALESCE(JSON_UNQUOTE(JSON_EXTRACT(\`value\`, '$.result.scannedAt')), '')
          < JSON_UNQUOTE(JSON_EXTRACT(VALUES(\`value\`), '$.result.scannedAt')),
        VALUES(\`value\`), \`value\`)
    `;
  },
};
