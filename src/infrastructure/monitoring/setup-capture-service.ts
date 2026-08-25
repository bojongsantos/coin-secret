import "server-only";

import { DEFAULT_WATCHLIST } from "@/config/default-watchlist";
import { runSdScan, SD_SCAN_TIMEFRAME } from "@/core/application/scanner/supply-demand-scan-service";
import type { SetupStatus } from "@/core/domain/analysis/supply-demand";
import { setupSignature } from "@/core/domain/analysis/setup-signature";
import type { Candle, SetupDirection, Timeframe } from "@/core/domain/models";
import { captureTriggerFor } from "@/core/domain/promo/capture-trigger";
import type { SnapshotInput } from "@/core/domain/promo/result-image";
import { prisma } from "@/infrastructure/database/prisma";
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
  const entryCaptures: { setupId: string; symbol: string; status: SetupStatus }[] = [];

  for (const hit of hits) {
    const signature = setupSignature({
      symbol: hit.symbol,
      timeframe: hit.timeframe,
      direction: hit.direction,
      entry: hit.entry,
      stopLoss: hit.stopLoss,
    });
    const status = (hit.status ?? "Limit Order") as SetupStatus;
    const existing = await prisma.trackedSetup.findUnique({
      where: { signature },
      select: { id: true, status: true },
    });

    const record = await prisma.trackedSetup.upsert({
      where: { signature },
      create: {
        signature,
        symbol: hit.symbol,
        timeframe: hit.timeframe,
        direction: hit.direction,
        entry: hit.entry,
        target1: hit.target1,
        // The scan carries one target; the second is the same distance again,
        // which is how the detector lays them out.
        target2: hit.target1 + (hit.target1 - hit.entry),
        stopLoss: hit.stopLoss,
        riskReward: 2,
        confidence: Math.round(hit.confidence),
        zoneTop: Math.max(hit.entry, hit.stopLoss),
        zoneBottom: Math.min(hit.entry, hit.stopLoss),
        status,
      },
      update: { status },
      select: { id: true },
    });
    report.tracked++;

    const trigger = captureTriggerFor((existing?.status ?? null) as SetupStatus | null, status);
    if (trigger === "ENTRY" && entryCaptures.length < MAX_CAPTURES_PER_RUN) {
      entryCaptures.push({ setupId: record.id, symbol: hit.symbol, status });
    }
  }

  for (const capture of entryCaptures) {
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
 */
async function resolveResults(now: Date): Promise<number> {
  const pending = await prisma.trackedSetup.findMany({
    where: {
      resultAt: null,
      snapshots: { some: { kind: "ENTRY" } },
    },
    orderBy: { updatedAt: "desc" },
    take: MAX_CAPTURES_PER_RUN,
  });
  if (pending.length === 0) return 0;

  let captured = 0;
  for (const setup of pending) {
    const candles = await marketData
      .fetchKlines({ symbol: setup.symbol, timeframe: SD_SCAN_TIMEFRAME, limit: SNAPSHOT_BARS })
      .catch(() => [] as Candle[]);
    if (candles.length === 0) continue;

    const long = setup.direction === "long";
    const reached = candles.some((candle) =>
      long ? candle.high >= setup.target2 : candle.low <= setup.target2,
    );
    if (!reached) continue;

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
      price: candles[candles.length - 1].close,
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
        data: { status: "Target 2 reached", resultAt: now },
      }),
    ]);
    captured++;
  }
  return captured;
}
