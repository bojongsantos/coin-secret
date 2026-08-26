import "server-only";

import { DEFAULT_WATCHLIST } from "@/config/default-watchlist";
import { runSdScan, SD_SCAN_TIMEFRAME } from "@/core/application/scanner/supply-demand-scan-service";
import {
  setupOutcomeSince,
  TERMINAL_SETUP_STATUSES,
  type SetupStatus,
} from "@/core/domain/analysis/supply-demand";
import { setupSignature } from "@/core/domain/analysis/setup-signature";
import type { Candle, SetupDirection, Timeframe } from "@/core/domain/models";
import { captureTriggerFor } from "@/core/domain/promo/capture-trigger";
import type { SnapshotInput } from "@/core/domain/promo/result-image";
import { prisma } from "@/infrastructure/database/prisma";
import { marketData } from "@/infrastructure/market-data/market-data-provider";
import { mapConcurrent } from "@/shared/lib/async";

export interface SetupCaptureReport {
  scanned: number;
  tracked: number;
  entrySnapshots: number;
  resultSnapshots: number;
  skippedSymbols: string[];
}

/**
 * Bars kept with each snapshot.
 *
 * Enough to show the approach and the zone without storing a history nobody
 * looks at: every snapshot is a row in the database, and the archive is meant
 * to grow for as long as the product runs.
 */
const SNAPSHOT_BARS = 90;

/** Ceiling on candle fetches per run, so one sweep cannot fan out unbounded. */
const MAX_CAPTURES_PER_RUN = 8;

/**
 * How many pending setups get their outcome checked per sweep.
 *
 * Higher than the entry ceiling because a check is one klines call and most of
 * them resolve to "not yet". The queue is drained oldest-check-first, so this
 * is a rate, not a cap on how many setups can ever be resolved.
 */
const MAX_RESULT_CHECKS_PER_RUN = 24;

function snapshotPayload(input: {
  symbol: string;
  timeframe: Timeframe;
  candles: Candle[];
  direction: SetupDirection;
  entry: number;
  target1: number;
  target2: number;
  stopLoss: number;
  confidence: number;
  riskReward: number;
  status: string;
  zoneTop: number;
  zoneBottom: number;
  price: number;
  capturedAt: Date;
}): SnapshotInput {
  return {
    symbol: input.symbol,
    timeframe: input.timeframe,
    candles: input.candles.slice(-SNAPSHOT_BARS),
    price: input.price,
    capturedAt: input.capturedAt.toISOString().slice(0, 16).replace("T", " "),
    setup: {
      direction: input.direction,
      entry: input.entry,
      target1: input.target1,
      target2: input.target2,
      stopLoss: input.stopLoss,
      confidence: input.confidence,
      riskReward: input.riskReward,
      status: input.status,
      zoneTop: input.zoneTop,
      zoneBottom: input.zoneBottom,
    },
  };
}

/**
 * Watches the scanner's setups and photographs the two moments worth keeping.
 *
 * Runs on the same schedule as the alert sweep. Status is derived fresh on
 * every scan, so the only way to notice a *change* is to remember what it was
 * last time — which is what the tracking rows are for.
 *
 * The result half is resolved from candles rather than from the scanner. A
 * setup that has reached its second target is no longer active, so the scanner
 * stops reporting it entirely; waiting for it to say "Target 2 reached" would
 * mean waiting forever.
 */
export async function runSetupCapture(): Promise<SetupCaptureReport> {
  const report: SetupCaptureReport = {
    scanned: 0,
    tracked: 0,
    entrySnapshots: 0,
    resultSnapshots: 0,
    skippedSymbols: [],
  };

  const scan = await runSdScan(marketData, DEFAULT_WATCHLIST);
  const hits = [...scan.demand, ...scan.supply];
  report.scanned = hits.length;
  report.skippedSymbols = scan.errors.map((entry) => entry.split(":")[0]);

  const now = new Date();
  const signed = hits.map((hit) => ({
    hit,
    signature: setupSignature({
      symbol: hit.symbol,
      timeframe: hit.timeframe,
      direction: hit.direction,
      zoneBaseTime: hit.zoneBaseTime,
    }),
    status: (hit.status ?? "Limit Order") as SetupStatus,
  }));

  // One query for what the last sweep saw, rather than one per setup. At a
  // hundred live setups the round trips alone were most of the run.
  const known = await prisma.trackedSetup.findMany({
    where: { signature: { in: signed.map((entry) => entry.signature) } },
    select: { id: true, signature: true, status: true },
  });
  const previous = new Map(known.map((row) => [row.signature, row]));

  const entryCaptures: { setupId: string; symbol: string; status: SetupStatus }[] = [];

  await mapConcurrent(
    signed,
    async ({ hit, signature, status }) => {
      const record = await prisma.trackedSetup.upsert({
        where: { signature },
        create: {
          signature,
          symbol: hit.symbol,
          timeframe: hit.timeframe,
          direction: hit.direction,
          entry: hit.entry,
          target1: hit.target1,
          target2: hit.target2,
          stopLoss: hit.stopLoss,
          riskReward: 2,
          confidence: Math.round(hit.confidence),
          // The zone's own bounds. Deriving them from the entry and the stop
          // drew a band reaching down to the stop, which is not where the zone
          // is — the stop sits beyond it, on the far side of a swing.
          zoneTop: hit.zoneTop,
          zoneBottom: hit.zoneBottom,
          status,
        },
        // Only the status is refreshed. The levels are the plan as it stood
        // when the setup was first seen, and the snapshots are photographs of
        // that plan; letting the stop drift here would move the goalposts
        // under a proof that has already been taken.
        update: { status },
        select: { id: true },
      });
      report.tracked++;

      const before = (previous.get(signature)?.status ?? null) as SetupStatus | null;
      if (captureTriggerFor(before, status) === "ENTRY") {
        entryCaptures.push({ setupId: record.id, symbol: hit.symbol, status });
      }
    },
    8,
  );

  // Newest fills first when there are more than one sweep can afford.
  for (const capture of entryCaptures.slice(0, MAX_CAPTURES_PER_RUN)) {
    const setup = await prisma.trackedSetup.findUnique({ where: { id: capture.setupId } });
    if (!setup) continue;
    const candles = await marketData
      .fetchKlines({ symbol: setup.symbol, timeframe: SD_SCAN_TIMEFRAME, limit: SNAPSHOT_BARS })
      .catch(() => [] as Candle[]);
    if (candles.length === 0) {
      if (!report.skippedSymbols.includes(setup.symbol)) report.skippedSymbols.push(setup.symbol);
      continue;
    }

    const payload = snapshotPayload({
      symbol: setup.symbol,
      timeframe: setup.timeframe as Timeframe,
      candles,
      direction: setup.direction as SetupDirection,
      entry: setup.entry,
      target1: setup.target1,
      target2: setup.target2,
      stopLoss: setup.stopLoss,
      confidence: setup.confidence,
      riskReward: setup.riskReward,
      status: capture.status,
      zoneTop: setup.zoneTop,
      zoneBottom: setup.zoneBottom,
      price: candles[candles.length - 1].close,
      capturedAt: now,
    });

    await prisma.setupSnapshot.upsert({
      where: { setupId_kind: { setupId: setup.id, kind: "ENTRY" } },
      create: {
        setupId: setup.id,
        kind: "ENTRY",
        status: capture.status,
        price: payload.price,
        payload: JSON.parse(JSON.stringify(payload)),
      },
      update: {},
    });
    report.entrySnapshots++;
  }

  report.resultSnapshots = await resolveResults(now);
  return report;
}

/**
 * Photographs setups whose second target has since been reached.
 *
 * Only setups that already have an entry snapshot are considered: a result
 * without its before-picture would be a claim with nothing behind it.
 *
 * The queue is drained oldest-check-first. Ordering by `updatedAt` put the
 * most recently *seen* setups at the front — precisely the ones still live in
 * the scan and therefore least likely to be finished — while a setup that had
 * dropped off the board, which is what reaching a target does, sank behind
 * them and was never looked at again.
 */
async function resolveResults(now: Date): Promise<number> {
  const pending = await prisma.trackedSetup.findMany({
    where: {
      resultAt: null,
      status: { notIn: TERMINAL_SETUP_STATUSES },
      snapshots: { some: { kind: "ENTRY" } },
    },
    // Nulls first: a setup never checked before takes priority over one
    // checked an hour ago.
    orderBy: [{ resultCheckedAt: { sort: "asc", nulls: "first" } }],
    take: MAX_RESULT_CHECKS_PER_RUN,
    include: {
      snapshots: { where: { kind: "ENTRY" }, select: { capturedAt: true } },
    },
  });
  if (pending.length === 0) return 0;

  let captured = 0;
  for (const setup of pending) {
    const candles = await marketData
      .fetchKlines({ symbol: setup.symbol, timeframe: SD_SCAN_TIMEFRAME, limit: SNAPSHOT_BARS })
      .catch(() => [] as Candle[]);
    if (candles.length === 0) continue;

    const price = candles[candles.length - 1].close;
    // Measured from the moment the entry was photographed, not from now, and
    // decided by the same rule the rest of the app uses — which is what stops
    // a setup that was stopped out and only later drifted through its target
    // from being filed as a win.
    const outcome = setupOutcomeSince(
      candles,
      {
        direction: setup.direction as SetupDirection,
        stopLoss: setup.stopLoss,
        target2: setup.target2,
        runningSince: (setup.snapshots[0]?.capturedAt ?? setup.firstSeenAt).getTime(),
      },
      price,
    );

    if (outcome === null) {
      await prisma.trackedSetup.update({
        where: { id: setup.id },
        data: { resultCheckedAt: now },
      });
      continue;
    }

    if (outcome === "stopped") {
      // Closed, and closed as a loss. Recorded so the sweep stops re-checking
      // it, and left without a result image: the archive is proof of setups
      // that worked, and a losing trade is not that.
      await prisma.trackedSetup.update({
        where: { id: setup.id },
        data: { status: "Invalidated (SL hit)", resultCheckedAt: now },
      });
      continue;
    }

    const payload = snapshotPayload({
      symbol: setup.symbol,
      timeframe: setup.timeframe as Timeframe,
      candles,
      direction: setup.direction as SetupDirection,
      entry: setup.entry,
      target1: setup.target1,
      target2: setup.target2,
      stopLoss: setup.stopLoss,
      confidence: setup.confidence,
      riskReward: setup.riskReward,
      status: "Target 2 reached",
      zoneTop: setup.zoneTop,
      zoneBottom: setup.zoneBottom,
      price,
      capturedAt: now,
    });

    await prisma.$transaction([
      prisma.setupSnapshot.upsert({
        where: { setupId_kind: { setupId: setup.id, kind: "RESULT" } },
        create: {
          setupId: setup.id,
          kind: "RESULT",
          status: "Target 2 reached",
          price: payload.price,
          payload: JSON.parse(JSON.stringify(payload)),
        },
        update: {},
      }),
      prisma.trackedSetup.update({
        where: { id: setup.id },
        data: { status: "Target 2 reached", resultAt: now, resultCheckedAt: now },
      }),
    ]);
    captured++;
  }
  return captured;
}
