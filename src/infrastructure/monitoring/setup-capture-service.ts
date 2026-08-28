import "server-only";

import { DEFAULT_WATCHLIST } from "@/config/default-watchlist";
import { runSdScan, SD_SCAN_TIMEFRAME } from "@/core/application/scanner/supply-demand-scan-service";
import { setupOutcomeSince } from "@/core/domain/analysis/supply-demand";
import type { Candle, SetupDirection, Timeframe } from "@/core/domain/models";
import { FILLED_STATUSES, owesEntrySnapshot } from "@/core/domain/promo/capture-trigger";
import type { SnapshotInput } from "@/core/domain/promo/result-image";
import { prisma } from "@/infrastructure/database/prisma";
import { activeSetupStore } from "@/infrastructure/persistence/active-setup-store";
import { marketData } from "@/infrastructure/market-data/market-data-provider";

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
/**
 * Keeps the result archive fed.
 *
 * Asks two questions of the database, both about state rather than about a
 * moment that may already have passed:
 *
 *   1. Which published setups have filled but have no entry photograph yet?
 *   2. Which of those have since reached their second target?
 *
 * Nothing here depends on the sweep running at any particular rate, or on it
 * being the only writer of a setup's status. Both assumptions were quietly
 * false and the archive recorded nothing for a day while reporting success on
 * every run.
 */
export async function runSetupCapture(): Promise<SetupCaptureReport> {
  const report: SetupCaptureReport = {
    scanned: 0,
    tracked: 0,
    entrySnapshots: 0,
    resultSnapshots: 0,
    skippedSymbols: [],
  };

  // Refreshes every published setup's status and records new ones.
  const scan = await runSdScan(marketData, DEFAULT_WATCHLIST, { activeSetups: activeSetupStore });
  report.scanned = scan.demand.length + scan.supply.length;
  report.tracked = report.scanned;
  report.skippedSymbols = scan.errors.map((entry) => entry.split(":")[0]);

  const now = new Date();
  report.entrySnapshots = await captureEntries(now, report);
  report.resultSnapshots = await resolveResults(now);
  return report;
}

/** Photographs setups that filled while we were watching but were never shot. */
async function captureEntries(now: Date, report: SetupCaptureReport): Promise<number> {
  const owing = await prisma.trackedSetup.findMany({
    where: {
      firstStatus: "Limit Order",
      status: { in: FILLED_STATUSES },
      snapshots: { none: { kind: "ENTRY" } },
    },
    orderBy: { updatedAt: "desc" },
    take: MAX_CAPTURES_PER_RUN,
  });
  if (owing.length === 0) return 0;

  let captured = 0;
  for (const setup of owing) {
    if (!owesEntrySnapshot({ firstStatus: setup.firstStatus, status: setup.status, hasEntrySnapshot: false })) {
      continue;
    }
    const candles = await marketData
      .fetchKlines({ symbol: setup.symbol, timeframe: setup.timeframe as Timeframe, limit: SNAPSHOT_BARS })
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
      status: setup.status,
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
        status: setup.status,
        price: payload.price,
        payload: JSON.parse(JSON.stringify(payload)),
      },
      update: {},
    });
    captured++;
  }
  return captured;
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
      // Only the losing outcomes are excluded. A setup the live scan has
      // already marked "Target 2 reached" still owes the archive its result
      // photograph, and filtering on "not terminal" skipped exactly those.
      status: { notIn: ["Invalidated (SL hit)", "Missed"] },
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
