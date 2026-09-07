import "server-only";

import type {
  ActiveSetup,
  ActiveSetupPort,
  RetiredZone,
} from "@/core/application/ports/active-setup-port";
import { isTerminalSetupStatus } from "@/core/domain/analysis/setup-lifecycle";
import { isBeyondScanReach, ZONE_SCAN_WINDOW } from "@/core/domain/analysis/supply-demand";
import { TIMEFRAME_SECONDS } from "@/core/domain/market/timeframe";
import { setupSignature } from "@/core/domain/analysis/setup-signature";
import type { SetupDirection, Timeframe } from "@/core/domain/models";
import { prisma } from "@/infrastructure/database/prisma";

/**
 * Published setups, kept in the same table the result archive reads.
 *
 * One store rather than two: the archive was already remembering every setup
 * it had seen, and having the live scan keep its own copy would have let the
 * dashboard and the proof images drift apart about what a setup's levels even
 * were.
 */
export const activeSetupStore: ActiveSetupPort = {
  async loadActive(symbols: string[]): Promise<ActiveSetup[]> {
    if (symbols.length === 0) return [];
    const rows = await prisma.trackedSetup.findMany({
      where: { symbol: { in: symbols }, status: { notIn: TERMINAL } },
      // Newest first, so the de-duplication below keeps the current one when a
      // symbol somehow carries more than one live row.
      orderBy: { updatedAt: "desc" },
      select: {
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
    });

    const bySymbol = new Map<string, ActiveSetup>();
    for (const row of rows) {
      if (bySymbol.has(row.symbol)) continue;
      // A row written before the column existed cannot be re-read: its zone
      // has no identity, so it is left to the archive and a fresh setup is
      // chosen instead of pinning the reader to a plan we cannot locate.
      if (row.zoneBaseTime === 0) continue;
      // Nor can one whose zone has scrolled past the deepest window a klines
      // request returns. Held anyway it would sit on the symbol forever:
      // unjudgeable, so never terminal, so never released.
      if (isBeyondScanReach(row.zoneBaseTime, row.timeframe as Timeframe)) continue;
      bySymbol.set(row.symbol, {
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

  async loadRetiredZones(symbols: string[]): Promise<RetiredZone[]> {
    if (symbols.length === 0) return [];
    // Bounded to what the detector could still offer back. It only ever looks
    // at the last `ZONE_SCAN_WINDOW` bars, so a zone older than that on the
    // slowest timeframe scanned can never be re-detected and does not need
    // remembering here.
    const oldest = Math.floor(Date.now() / 1000) - ZONE_SCAN_WINDOW * TIMEFRAME_SECONDS["1H"];
    const rows = await prisma.trackedSetup.findMany({
      where: { symbol: { in: symbols }, status: { in: TERMINAL }, zoneBaseTime: { gte: oldest } },
      select: { symbol: true, timeframe: true, direction: true, zoneBaseTime: true },
    });
    return rows.map((row) => ({
      symbol: row.symbol,
      timeframe: row.timeframe as Timeframe,
      direction: row.direction as SetupDirection,
      zoneBaseTime: row.zoneBaseTime,
    }));
  },

  async persist(setups: ActiveSetup[]): Promise<void> {
    for (const setup of setups) {
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
      const revived = await prisma.trackedSetup.updateMany({
        where: { signature, status: { notIn: TERMINAL } },
        // Levels are never rewritten: they are the plan the reader was given,
        // and the archive's snapshots are photographs of it. The base time is
        // written because it is part of the signature and therefore cannot
        // differ — rows created before the column existed need it filled in.
        data: { status: setup.status, zoneBaseTime: setup.zoneBaseTime },
      });
      if (revived.count > 0) continue;

      // Nothing was updated: either this zone has never been published, or it
      // has already had its life. `create` settles which — the signature is
      // unique, so a row that exists rejects it, and that row is a finished
      // one we must leave alone.
      await prisma.trackedSetup
        .create({
          data: {
            signature,
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
          },
        })
        .catch(() => undefined);
    }
  },
};

const TERMINAL = ["Target 2 reached", "Invalidated (SL hit)", "Missed"];

// Guards the list above against drifting from the domain's own definition.
for (const status of TERMINAL) {
  if (!isTerminalSetupStatus(status)) {
    throw new Error(`"${status}" is no longer a terminal status`);
  }
}
