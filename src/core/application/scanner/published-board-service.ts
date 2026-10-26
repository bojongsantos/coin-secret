import { z } from "zod";
import { DEFAULT_WATCHLIST } from "@/config/default-watchlist";
import type { ActiveSetup, ActiveSetupPort } from "@/core/application/ports/active-setup-port";
import type { MarketDataPort } from "@/core/application/ports/market-data-port";
import type { SignalsSnapshot, SignalsSnapshotPort } from "@/core/application/ports/signals-snapshot-port";
import { sourcesForMarketData } from "@/core/application/market-data/source-selection";
import { ACTIVE_SETUP_STATUSES } from "@/core/domain/analysis/supply-demand";
import { setupSignature } from "@/core/domain/analysis/setup-signature";
import { runSdScanCached, type SdScanHit, type SdScanResult } from "@/core/application/scanner/supply-demand-scan-service";
import { createScanCache } from "@/core/application/scanner/scan-cache";

const FRESH_MS = 60_000;
const MAX_AGE_MS = 60 * 60_000;
const FAILURE_BACKOFF_MS = 15_000;
const METADATA_READ_BUDGET_MS = 25_000;
const exchange = z.enum(["binance", "bybit"]);
const finite = z.number().finite();
const price = finite.positive();
const hitSchema = z.object({
  publishedAt: finite.positive().optional(),
  exchange,
  symbol: z.string(), base: z.string(), timeframe: z.enum(["15m", "1H"]),
  zoneType: z.enum(["demand", "supply"]), strength: z.string(),
  confidence: finite.min(0).max(100), direction: z.enum(["long", "short"]),
  entry: price, target1: price, target2: price, stopLoss: price,
  zoneBaseTime: finite.int().positive(), zoneTop: price, zoneBottom: price,
  change24h: finite, volume24h: finite.nonnegative(), zones: finite.int().nonnegative(),
  status: z.enum(ACTIVE_SETUP_STATUSES),
});
const snapshotSchema = z.object({
  version: z.literal(1), symbols: z.array(z.string()), sources: z.array(exchange.nullable()),
  result: z.object({
    demand: z.array(hitSchema), supply: z.array(hitSchema),
    market: z.array(z.object({
      exchange, symbol: z.string(), price, change24h: finite,
      volume24h: finite.nonnegative(), sparkline: z.array(price),
    })),
    demandTotal: finite.int().nonnegative(), supplyTotal: finite.int().nonnegative(),
    scannedAt: z.iso.datetime(), errors: z.array(z.string()).length(0),
  }),
});

export interface PublishedBoardInput {
  marketData: MarketDataPort;
  symbols: string[];
  activeSetups: ActiveSetupPort;
  snapshots: SignalsSnapshotPort;
  force?: boolean;
  /** The platform must await this callback after sending the response. */
  scheduleAfter?: (work: () => Promise<void>) => void;
}

export interface PublishedBoard {
  result: SdScanResult;
  stale: boolean;
  refreshing: boolean;
  /** Present on refresh attempts; false never claims the durable board was published. */
  snapshotPublished?: boolean;
}

function sameList(a: readonly unknown[], b: readonly unknown[]): boolean {
  return a.length === b.length && a.every((value, index) => value === b[index]);
}

export function parseSignalsSnapshot(value: unknown, marketData: MarketDataPort): SignalsSnapshot | undefined {
  const parsed = snapshotSchema.safeParse(value);
  if (!parsed.success) return;
  const snapshot = parsed.data;
  if (!sameList(snapshot.symbols, DEFAULT_WATCHLIST)
    || !sameList(snapshot.sources, sourcesForMarketData(marketData).map((source) => source.exchange))) return;
  const market = new Map(snapshot.result.market.map((row) => [row.symbol, row]));
  const hits = [...snapshot.result.demand, ...snapshot.result.supply];
  if (market.size !== DEFAULT_WATCHLIST.length || snapshot.result.market.length !== market.size
    || DEFAULT_WATCHLIST.some((symbol) => !market.has(symbol))
    || snapshot.result.market.some((row) => !snapshot.sources.includes(row.exchange))
    || new Set(hits.map((hit) => hit.symbol)).size !== hits.length
    || hits.some((hit) => market.get(hit.symbol)?.exchange !== hit.exchange)
    || snapshot.result.demand.some((hit) => hit.direction !== "long" || hit.zoneType !== "demand")
    || snapshot.result.supply.some((hit) => hit.direction !== "short" || hit.zoneType !== "supply")
    || snapshot.result.demandTotal !== snapshot.result.demand.length
    || snapshot.result.supplyTotal !== snapshot.result.supply.length) return;
  return snapshot;
}

/** A cached row cannot resurrect an archived, finished, replaced or replanned zone. */
function currentBoard(result: SdScanResult, active: ActiveSetup[]): SdScanResult {
  const current = new Map(active.map((setup) => [setupSignature(setup), setup]));
  const filter = (hits: SdScanHit[]) => hits.flatMap((hit) => {
    const setup = current.get(setupSignature(hit));
    if (!setup || !ACTIVE_SETUP_STATUSES.includes(setup.status as (typeof ACTIVE_SETUP_STATUSES)[number])
      || setup.exchange !== hit.exchange
      || (["entry", "target1", "target2", "stopLoss", "zoneTop", "zoneBottom", "confidence"] as const)
        .some((field) => setup[field] !== hit[field])) return [];
    return [{ ...hit, status: setup.status, ...(setup.publishedAt === undefined ? {} : { publishedAt: setup.publishedAt }) }];
  });
  const demand = filter(result.demand);
  const supply = filter(result.supply);
  return { ...result, demand, supply, demandTotal: demand.length, supplyTotal: supply.length };
}

type Scan = typeof runSdScanCached;
interface Identity {
  marketData: MarketDataPort;
  activeSetups: ActiveSetupPort;
  snapshots: SignalsSnapshotPort;
}
const sameIdentity = (a: Identity, b: Identity) => a.marketData === b.marketData
  && a.activeSetups === b.activeSetups && a.snapshots === b.snapshots;

/** A completed board survives process restarts; access filtering stays at the request boundary. */
export function createPublishedBoardReader(options: { scan?: Scan; now?: () => number } = {}) {
  const scan = options.scan ?? runSdScanCached;
  const now = options.now ?? Date.now;
  const customCache = createScanCache<SdScanResult>(FRESH_MS);
  let latest: { identity: Identity; snapshot: SignalsSnapshot } | undefined;
  let retryAfter = 0;
  let pending: { identity: Identity; completion: Promise<SdScanResult | undefined>; run: () => Promise<void>;
    error?: unknown; busy?: boolean; published?: boolean } | undefined;

  const coordinatedScan = async (input: PublishedBoardInput, force = true) => {
    const work = (activeSetups: ActiveSetupPort) => scan(input.marketData, input.symbols, force, { activeSetups });
    const coordinated = input.snapshots.coordinateRefresh
      ? input.snapshots.coordinateRefresh(work)
      : { acquired: true as const, value: await work(input.activeSetups) };
    const completed = await coordinated;
    if (!completed.acquired) return completed;
    // Capture replay may finish a row between the initial read and the guarded scan write.
    const current = await input.activeSetups.loadActive(input.symbols, AbortSignal.timeout(METADATA_READ_BUDGET_MS));
    return { acquired: true as const, value: currentBoard(completed.value, current) };
  };

  function reserve(input: PublishedBoardInput) {
    if (pending && sameIdentity(pending.identity, input)) return pending;
    let finish!: (result: SdScanResult | undefined) => void;
    const job = {
      identity: input,
      completion: new Promise<SdScanResult | undefined>((resolve) => { finish = resolve; }),
      error: undefined as unknown,
      busy: false,
      published: false,
      run: async () => {},
    };
    let started = false;
    job.run = async () => {
      if (started) { await job.completion; return; }
      started = true;
      let result: SdScanResult | undefined;
      try {
        // A failed/partial completed memory scan must not be reused as a refresh.
        const coordinated = await coordinatedScan(input);
        if (!coordinated.acquired) {
          job.busy = true;
          retryAfter = now() + FAILURE_BACKOFF_MS;
          return;
        }
        result = coordinated.value;
        const snapshot = parseSignalsSnapshot({
          version: 1, symbols: [...input.symbols],
          sources: sourcesForMarketData(input.marketData).map((source) => source.exchange), result,
        }, input.marketData);
        if (snapshot) {
          if (!latest || !sameIdentity(latest.identity, input) || !parseSignalsSnapshot(latest.snapshot, input.marketData)
            || latest.snapshot.result.scannedAt < snapshot.result.scannedAt) latest = { identity: input, snapshot };
          retryAfter = 0;
          try { await input.snapshots.save(snapshot); job.published = true; }
          catch { console.warn("[signals.snapshot]", { operation: "save", status: "failed" }); }
        } else {
          retryAfter = now() + FAILURE_BACKOFF_MS;
          console.warn("[signals.snapshot]", { operation: "refresh", status: "incomplete" });
        }
      } catch (error) {
        job.error = error;
        retryAfter = now() + FAILURE_BACKOFF_MS;
        console.warn("[signals.snapshot]", { operation: "refresh", status: "failed" });
      } finally {
        if (pending === job) pending = undefined;
        finish(result);
      }
    };
    pending = job;
    return job;
  }

  async function refresh(input: PublishedBoardInput): Promise<PublishedBoard> {
    const job = reserve(input);
    await job.run();
    const result = await job.completion;
    if (!result) {
      if (job.busy) {
        const available = await loadBoard(input);
        if (available) return { ...available, refreshing: true, snapshotPublished: false };
      }
      throw job.error ?? new Error("Signals refresh already in progress; retry shortly");
    }
    return { result, stale: false, refreshing: false, snapshotPublished: job.published };
  }

  async function loadBoard(input: PublishedBoardInput): Promise<PublishedBoard | undefined> {
    // Leave room for one native 10s connection failure, bounded backoff and a fresh connection.
    const signal = AbortSignal.timeout(METADATA_READ_BUDGET_MS);
    const memory = latest && sameIdentity(latest.identity, input) ? latest : undefined;
    const usable = (value: unknown): SignalsSnapshot | undefined => {
      const parsed = parseSignalsSnapshot(value, input.marketData);
      const age = parsed ? now() - Date.parse(parsed.result.scannedAt) : Infinity;
      return parsed && age >= 0 && age <= MAX_AGE_MS ? parsed : undefined;
    };
    const local = usable(memory?.snapshot);
    const [stored, active] = await Promise.all([
      local && now() - Date.parse(local.result.scannedAt) < FRESH_MS
        ? Promise.resolve(undefined)
        : input.snapshots.load(signal).catch(() => undefined),
      input.activeSetups.loadActive(input.symbols, signal),
    ]);
    const current = latest && sameIdentity(latest.identity, input) ? latest : undefined;
    const snapshot = [stored, memory?.snapshot, current?.snapshot]
      .map(usable)
      .filter((candidate): candidate is SignalsSnapshot => candidate !== undefined)
      .sort((a, b) => Date.parse(b.result.scannedAt) - Date.parse(a.result.scannedAt))[0];
    if (!snapshot) {
      // A clock rollback must not keep a future-dated memory board ahead of every new scan.
      if (current && latest === current) latest = undefined;
      return;
    }
    if (!current || !usable(current.snapshot) || current.snapshot.result.scannedAt < snapshot.result.scannedAt) {
      latest = { identity: input, snapshot };
    }
    const age = now() - Date.parse(snapshot.result.scannedAt);
    const stale = age >= FRESH_MS;
    const filtered = currentBoard(snapshot.result, active);
    const missing = filtered.demandTotal + filtered.supplyTotal !== snapshot.result.demandTotal + snapshot.result.supplyTotal;
    return { result: filtered, stale: stale || missing, refreshing: false };
  }

  async function read(input: PublishedBoardInput): Promise<PublishedBoard> {
    if (!sameList(input.symbols, DEFAULT_WATCHLIST)) {
      // Cache only after the fenced transaction commits; each transaction has a new store identity.
      const result = await customCache(input.marketData, input.symbols, input.force ?? false, input.activeSetups, async () => {
        const coordinated = await coordinatedScan(input, input.force ?? false);
        if (!coordinated.acquired) throw new Error("Signals refresh already in progress; retry shortly");
        return coordinated.value;
      });
      const current = await input.activeSetups.loadActive(input.symbols, AbortSignal.timeout(METADATA_READ_BUDGET_MS));
      return { result: currentBoard(result, current), stale: false, refreshing: false };
    }
    // There is no usable board yet: keep the first scan's existing bounded deadline.
    if (input.force && !input.scheduleAfter) return refresh(input);
    const board = await loadBoard(input);
    if (!board) return refresh(input);
    if (input.scheduleAfter && (board.stale || input.force) && now() >= retryAfter) {
      if (!pending || !sameIdentity(pending.identity, input)) {
        const job = reserve(input);
        try { input.scheduleAfter(job.run); }
        catch (error) { if (pending === job) pending = undefined; throw error; }
      }
    }
    return { ...board, refreshing: !!pending && sameIdentity(pending.identity, input) };
  }

  return { read, refresh };
}

const publishedBoard = createPublishedBoardReader();
export const readPublishedBoard = publishedBoard.read;
export const refreshPublishedBoard = publishedBoard.refresh;
