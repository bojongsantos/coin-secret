import "server-only";

import type {
  ActiveSetup,
  ActiveSetupPort,
  RetiredZone,
} from "@/core/application/ports/active-setup-port";
import { isTerminalSetupStatus } from "@/core/domain/analysis/setup-lifecycle";
import { isBeyondScanReach, ZONE_SCAN_WINDOW } from "@/core/domain/analysis/supply-demand";
import { TIMEFRAME_SECONDS } from "@/core/domain/market/timeframe";
import { isMarketExchange } from "@/core/domain/market/exchange";
import { setupSignature } from "@/core/domain/analysis/setup-signature";
import type { SetupDirection, Timeframe } from "@/core/domain/models";
import { prisma } from "@/infrastructure/database/prisma";
import type { Prisma } from "@/generated/prisma/client";
import { readSetupRows } from "@/infrastructure/database/setup-read";
import { mapConcurrent } from "@/shared/lib/async";

/**
 * Published setups, kept in the same table the result archive reads.
 *
 * One store rather than two: the archive was already remembering every setup
 * it had seen, and having the live scan keep its own copy would have let the
 * dashboard and the proof images drift apart about what a setup's levels even
 * were.
 */
export function createActiveSetupStore(
  database: Pick<Prisma.TransactionClient, "trackedSetup"> = prisma,
  transactional = false,
): ActiveSetupPort {
  const observed = new Map<string, { updatedAt: Date; status: string }>();
  const readRows: typeof readSetupRows = transactional
    ? async (_read, work, signal) => {
      // A lost transaction cannot be retried on another connection.
      signal?.throwIfAborted();
      const rows = await work();
      signal?.throwIfAborted();
      return rows;
    }
    : readSetupRows;
  return {
  async loadActive(symbols: string[], signal?: AbortSignal): Promise<ActiveSetup[]> {
    if (symbols.length === 0) return [];
    const rows = await readRows("active", () => database.trackedSetup.findMany({
      where: { symbol: { in: symbols } },
      // Capture checks also update old rows. Only publication order identifies
      // the current plan; a later check must never bring an older one back.
      orderBy: [{ firstSeenAt: "desc" }, { id: "desc" }],
      distinct: ["symbol"],
      select: {
        signature: true,
        archivedAt: true,
        updatedAt: true,
        firstSeenAt: true,
        exchange: true,
        symbol: true,
        timeframe: true,
        direction: true,
        entry: true,
        target1: true,
        target2: true,
        stopLoss: true,
        confidence: true,
        zoneTop: true,
        zoneBottom: true,
        zoneBaseTime: true,
        status: true,
      },
    }), signal);

    const bySymbol = new Map<string, ActiveSetup>();
    for (const row of rows) {
      if (bySymbol.has(row.symbol)) continue;
      // Select the latest publication before excluding closed rows. Filtering
      // them in SQL would expose an older unfinished plan for the same coin.
      if (row.archivedAt || TERMINAL.includes(row.status)) continue;
      // A row written before the column existed cannot be re-read: its zone
      // has no identity, so it is left to the archive and a fresh setup is
      // chosen instead of pinning the reader to a plan we cannot locate.
      if (row.zoneBaseTime === 0) continue;
      // Nor can one whose zone has scrolled past the deepest window a klines
      // request returns. Held anyway it would sit on the symbol forever:
      // unjudgeable, so never terminal, so never released.
      if (isBeyondScanReach(row.zoneBaseTime, row.timeframe as Timeframe)) continue;
      if (transactional) observed.set(row.signature, { updatedAt: row.updatedAt, status: row.status });
      bySymbol.set(row.symbol, {
        publishedAt: row.firstSeenAt.getTime() / 1000,
        exchange: isMarketExchange(row.exchange) ? row.exchange : null,
        symbol: row.symbol,
        timeframe: row.timeframe as Timeframe,
        direction: row.direction as SetupDirection,
        entry: row.entry,
        target1: row.target1,
        target2: row.target2,
        stopLoss: row.stopLoss,
        confidence: row.confidence,
        zoneTop: row.zoneTop,
        zoneBottom: row.zoneBottom,
        zoneBaseTime: row.zoneBaseTime,
        status: row.status,
      });
    }
    return [...bySymbol.values()];
  },

  async loadRetiredZones(symbols: string[], signal?: AbortSignal): Promise<RetiredZone[]> {
    if (symbols.length === 0) return [];
    // Bounded to what the detector could still offer back. It only ever looks
    // at the last `ZONE_SCAN_WINDOW` bars, so a zone older than that on the
    // slowest timeframe scanned can never be re-detected and does not need
    // remembering here.
    const oldest = Math.floor(Date.now() / 1000) - ZONE_SCAN_WINDOW * TIMEFRAME_SECONDS["1H"];
    const rows = await readRows("retired", () => database.trackedSetup.findMany({
      where: {
        symbol: { in: symbols },
        zoneBaseTime: { gte: oldest },
        OR: [{ status: { in: TERMINAL } }, { archivedAt: { not: null } }],
      },
      select: { symbol: true, timeframe: true, direction: true, zoneBaseTime: true },
    }), signal);
    return rows.map((row) => ({
      symbol: row.symbol,
      timeframe: row.timeframe as Timeframe,
      direction: row.direction as SetupDirection,
      zoneBaseTime: row.zoneBaseTime,
    }));
  },

  async persist(setups: ActiveSetup[], signal?: AbortSignal): Promise<void> {
    signal?.throwIfAborted();
    const bySymbol = new Map<string, ActiveSetup[]>();
    for (const setup of setups) {
      const changes = bySymbol.get(setup.symbol) ?? [];
      changes.push(setup);
      bySymbol.set(setup.symbol, changes);
    }
    // Symbols are independent; each symbol still closes its old setup before
    // publishing its replacement, and every write completes before we respond.
    let failure: { error: unknown } | undefined;
    await mapConcurrent([...bySymbol.values()], async (changes) => {
      try {
        for (const setup of changes) {
          if (failure) return;
          signal?.throwIfAborted();
          const signature = setupSignature({
            symbol: setup.symbol,
            timeframe: setup.timeframe,
            direction: setup.direction,
            zoneBaseTime: setup.zoneBaseTime,
          });
          // A finished setup stays finished. Written as a conditional update
          // rather than an upsert because that is the whole guarantee: the
          // detector re-measures a zone on every pass and keeps offering the same
          // base bar back, and since the base bar *is* the identity, a plain
          // upsert landed on the row that had just closed and reopened it.
          // WALUSDT flip-flopped between released and live on alternating scans
          // for exactly this reason — its stop had gone at 04:00 and the board
          // kept advertising it anyway.
          // The scan fetches candles after reading these rows. Capture can commit
          // meanwhile, so a fenced writer may update only the exact version it read.
          // Running and Filled depend on current price and must not be assigned a rank.
          const version = transactional ? observed.get(signature) : undefined;
          const revived = transactional && !version ? { count: 0 } : await database.trackedSetup.updateMany({
            where: { signature, exchange: setup.exchange ?? null, archivedAt: null,
              ...(version ? { status: version.status, updatedAt: version.updatedAt } : { status: { notIn: TERMINAL } }) },
            // Levels are never rewritten: they are the plan the reader was given,
            // and the archive's snapshots are photographs of it. The base time is
            // written because it is part of the signature and therefore cannot
            // differ — rows created before the column existed need it filled in.
            data: { status: setup.status, zoneBaseTime: setup.zoneBaseTime },
          });
          if (revived.count > 0) continue;
          if (failure) return;
          signal?.throwIfAborted();

          // Nothing was updated: either this zone has never been published, or it
          // has already had its life. Existing signatures are skipped so a
          // finished row stays finished without aborting the transaction.
          const created = await database.trackedSetup.createMany({
              skipDuplicates: true,
              data: [{
                signature,
                exchange: setup.exchange ?? null,
                symbol: setup.symbol,
                timeframe: setup.timeframe,
                direction: setup.direction,
                entry: setup.entry,
                target1: setup.target1,
                target2: setup.target2,
                stopLoss: setup.stopLoss,
                riskReward: 2,
                confidence: Math.round(setup.confidence),
                zoneTop: setup.zoneTop,
                zoneBottom: setup.zoneBottom,
                zoneBaseTime: setup.zoneBaseTime,
                status: setup.status,
                // Recorded once, on the row's first write. The archive needs to
                // know whether a setup was published before it filled, and no
                // later observation can recover that.
                firstStatus: setup.status,
                // PostgreSQL NOW() inside the coordinated scan would use its
                // transaction start, before market reads finished.
                firstSeenAt: new Date(),
              }],
            });
          if (created.count === 0) {
            // ON CONFLICT keeps an interactive transaction usable for this read.
            signal?.throwIfAborted();
            const winner = await database.trackedSetup.findUnique({ where: { signature }, select: { exchange: true, status: true, archivedAt: true } });
            if (!winner) throw new Error("Published setup insert conflict; refresh required");
            if (winner?.archivedAt) throw new Error("Published setup archived; refresh required");
            if (winner && !TERMINAL.includes(winner.status) && winner.exchange !== (setup.exchange ?? null)) {
              throw new Error("Published setup exchange conflict; refresh required");
            }
            // A stale terminal reading cannot release this symbol while the
            // committed plan is still active. Post-commit validation drops its
            // uncommitted replacement from the scanned board.
            if (transactional && !TERMINAL.includes(winner.status)) break;
          }
        }
      } catch (error) {
        // Stop queued writes, but drain the other workers before rejecting so
        // the scan remains in flight until its last database write settles.
        failure ??= { error };
      }
    }, 4);
    if (failure) throw failure.error;
    signal?.throwIfAborted();
  },
  };
}

export const activeSetupStore = createActiveSetupStore();

const TERMINAL = ["Target 2 reached", "Invalidated (SL hit)", "Missed"];

// Guards the list above against drifting from the domain's own definition.
for (const status of TERMINAL) {
  if (!isTerminalSetupStatus(status)) {
    throw new Error(`"${status}" is no longer a terminal status`);
  }
}
