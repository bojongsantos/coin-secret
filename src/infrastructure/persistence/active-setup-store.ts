import "server-only";

import type { ActiveSetup, ActiveSetupPort } from "@/core/application/ports/active-setup-port";
import { isTerminalSetupStatus } from "@/core/domain/analysis/setup-lifecycle";
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

  async persist(setups: ActiveSetup[]): Promise<void> {
    for (const setup of setups) {
      const signature = setupSignature({
        symbol: setup.symbol,
        timeframe: setup.timeframe,
        direction: setup.direction,
        zoneBaseTime: setup.zoneBaseTime,
      });
      await prisma.trackedSetup.upsert({
        where: { signature },
        create: {
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
          // Recorded once, on the row's first write. The archive needs to know
          // whether a setup was published before it filled, and no later
          // observation can recover that.
          firstStatus: setup.status,
        },
        // Levels are never rewritten: they are the plan the reader was given,
        // and the archive's snapshots are photographs of it. The base time is
        // written because it is part of the signature and therefore cannot
        // differ — rows created before the column existed need it filled in.
        update: { status: setup.status, zoneBaseTime: setup.zoneBaseTime },
      });
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
