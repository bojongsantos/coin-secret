import test from "node:test";
import assert from "node:assert/strict";
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { tmpdir } from "node:os";
import { basename, dirname, join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { runInNewContext } from "node:vm";
import ts from "typescript";
import { runCaptureCron } from "../scripts/setup-capture-cron.mjs";

const NOW = 1_790_000_000_000;
const publication = (ageSeconds = 0) => ({ status: ageSeconds < 60 ? "fresh" : "stale", durable: true, verified: true,
  ageSeconds, scannedAt: new Date(Date.now() - ageSeconds * 1000).toISOString() });

test("cron CLI runs through a deployment directory symlink and imports remain side-effect free", () => {
  const root = mkdtempSync(join(tmpdir(), "coinsecret-cron-entry-"));
  const deployed = join(root, "version");
  const current = join(root, "current");
  // Next declares NODE_ENV required, but this isolated child deliberately inherits no environment.
  const emptyEnv = {} as NodeJS.ProcessEnv;
  try {
    mkdirSync(deployed);
    copyFileSync("scripts/setup-capture-cron.mjs", join(deployed, "setup-capture-cron.mjs"));
    symlinkSync(deployed, current, process.platform === "win32" ? "junction" : "dir");
    for (const directory of [deployed, current]) {
      const result = spawnSync(process.execPath, [join(directory, "setup-capture-cron.mjs")], {
        env: emptyEnv, encoding: "utf8", timeout: 5000,
      });
      assert.equal(result.error, undefined);
      assert.equal(result.status, 1, "empty configuration must fail visibly even through current's symlink");
      assert.equal(result.stdout, "");
      assert.equal(JSON.parse(result.stderr).code, "CRON_CONFIGURATION_INVALID");
    }
    for (const extraArgs of [[], ["not-a-file"]]) {
      const imported = spawnSync(process.execPath, ["--input-type=module", "--eval",
        `const imported = await import(${JSON.stringify(pathToFileURL(join(current, "setup-capture-cron.mjs")).href)}); if (typeof imported.runCaptureCron !== "function") process.exit(2);`, ...extraArgs], {
        env: emptyEnv, encoding: "utf8", timeout: 5000,
      });
      assert.equal(imported.error, undefined);
      assert.equal(imported.status, 0);
      assert.equal(imported.stdout, "");
      assert.equal(imported.stderr, "", "importing the runner must not execute a request");
    }
  } finally {
    assert.equal(dirname(resolve(root)), resolve(tmpdir()));
    assert.ok(basename(root).startsWith("coinsecret-cron-entry-"));
    rmSync(root, { recursive: true, force: true });
  }
});

test("native/GitHub cron runner requires durable publication and never accepts a bare HTTP200", async () => {
  const env = { NODE_ENV: "production" as const, BETTER_AUTH_URL: "https://coinsecret.invalid", CRON_SECRET: "private-bearer-canary" };
  let requests = 0;
  const good = await runCaptureCron(env, async (url, options) => {
    requests++;
    assert.equal(String(url), "https://coinsecret.invalid/api/cron/setup-capture");
    assert.equal(options?.redirect, "error");
    assert.equal(options?.method, "POST");
    assert.ok(options?.signal instanceof AbortSignal);
    return Response.json({ publication: publication() });
  });
  assert.equal(good.status, "published");
  assert.doesNotMatch(JSON.stringify(good), /private-bearer-canary/);
  for (const body of [{}, { publication: { ...publication(), verified: false } },
    { publication: { ...publication(), durable: false } }, { publication: publication(2701) },
    { publication: { ...publication(), scannedAt: new Date(Date.now() + 60_000).toISOString() } },
    { publication: { ...publication(), scannedAt: new Date(Date.now() - 3_600_000).toISOString() } }]) {
    await assert.rejects(runCaptureCron(env, async () => Response.json(body)), /CRON_PUBLICATION_UNVERIFIED/);
  }
  const busy = await runCaptureCron(env, async () => Response.json({ publication: { status: "in-progress", verified: false } }, { status: 202 }));
  assert.equal(busy.status, "in-progress");
  for (const status of [201, 202, 503]) {
    await assert.rejects(runCaptureCron(env, async () => Response.json({ publication: publication() }, { status })), /CRON_REQUEST_FAILED/);
  }
  await assert.rejects(runCaptureCron({ ...env, BETTER_AUTH_URL: "http://coinsecret.invalid" }, async () => { requests++; return Response.json({}); }), /CRON_CONFIGURATION_INVALID/);
  assert.equal(requests, 1, "invalid configuration never sends the bearer token");
});

async function observe(value: unknown, minimum?: string) {
  const exports: { readSignalsPublication?: (minimum?: string) => Promise<{ status: string; verified: boolean; ageSeconds: number }> } = {};
  const warnings: unknown[][] = [];
  class ClockDate extends Date { constructor(value?: string | number) { super(value ?? NOW); } static now() { return NOW; } }
  runInNewContext(ts.transpileModule(readFileSync("src/infrastructure/monitoring/signals-publication.ts", "utf8"), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText, {
    exports, Date: ClockDate, AbortSignal,
    console: { warn: (...args: unknown[]) => warnings.push(args) },
    require: (name: string) => {
      if (name === "server-only") return {};
      if (name.endsWith("/published-board-service")) return { parseSignalsSnapshot: (input: unknown) => input && typeof input === "object" && "result" in input ? input : undefined };
      if (name.endsWith("/signals-snapshot-store")) return { signalsSnapshotStore: { load: async () => { if (value instanceof Error) throw value; return value; } } };
      if (name.endsWith("/market-data-provider")) return { marketData: {} };
      throw new Error(`Unexpected import ${name}`);
    },
  });
  return { result: await exports.readSignalsPublication!(minimum), warnings };
}

test("durable freshness distinguishes scheduler overdue, expiry, missing and old readback", async () => {
  const board = (ageMs: number) => ({ result: { scannedAt: new Date(NOW - ageMs).toISOString() } });
  for (const [age, expected, verified] of [[0, "fresh", true], [60_000, "stale", true], [2_700_001, "overdue", false], [3_600_001, "expired", false], [-1, "invalid", false]] as const) {
    const { result } = await observe(board(age));
    assert.equal(result.status, expected);
    assert.equal(result.verified, verified);
  }
  assert.equal((await observe(null)).result.status, "missing");
  assert.equal((await observe({})).result.status, "invalid");
  const old = await observe(board(60_000), new Date(NOW).toISOString());
  assert.equal(old.result.verified, false, "a previously valid snapshot cannot prove the new scan was saved");
  const unavailable = await observe(new Error("private-database-canary"));
  assert.equal(unavailable.result.status, "unavailable");
  assert.doesNotMatch(JSON.stringify(unavailable), /private-database-canary/);
});

function cronRoute(capture: { publication?: { verified: boolean; status: string } } | Error) {
  const exports: { GET?: (request: Request) => Promise<Response> } = {};
  let runs = 0;
  const warnings: unknown[][] = [];
  class HttpError extends Error { constructor(public status: number, message: string, public code: string) { super(message); } }
  runInNewContext(ts.transpileModule(readFileSync("src/app/api/cron/setup-capture/route.ts", "utf8"), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText, {
    exports, URL, Response, Error, process: { env: { CRON_SECRET: "private-bearer-canary" } },
    console: { warn: (...args: unknown[]) => warnings.push(args) },
    require: (name: string) => {
      if (name.endsWith("/setup-capture-service")) return { runSetupCapture: async () => { runs++; if (capture instanceof Error) throw capture; return capture; } };
      if (name.endsWith("/signals-publication")) return { readSignalsPublication: async () => ({ verified: false, status: "overdue" }) };
      if (name.endsWith("/http")) return { HttpError, apiError: (error: HttpError) => Response.json({ error: { code: error.code, message: error.message } }, { status: error.status }) };
      throw new Error(`Unexpected import ${name}`);
    },
  });
  return { get: exports.GET!, runs: () => runs, warnings };
}

test("cron authorization stays closed and failed publication is503 while busy202 is explicit", async () => {
  const request = (suffix = "", authorized = true) => new Request(`https://coinsecret.invalid/api/cron/setup-capture${suffix}`, {
    headers: authorized ? { Authorization: "Bearer private-bearer-canary" } : {},
  });
  for (const [verified, status, expected] of [[true, "fresh", 200], [false, "stale", 503], [false, "in-progress", 202]] as const) {
    const f = cronRoute({ publication: { verified, status } });
    assert.equal((await f.get(request("", false))).status, 401);
    assert.equal(f.runs(), 0);
    const response = await f.get(request());
    assert.equal(response.status, expected);
    assert.equal(response.headers.get("cache-control"), "no-store");
  }
  const check = cronRoute({});
  assert.equal((await check.get(request())).status, 503, "missing publication proof must not report a successful capture");
  const readsBeforeCheck = check.runs();
  assert.equal((await check.get(request("?check=1"))).status, 503);
  assert.equal(check.runs(), readsBeforeCheck, "health inspection does not mutate capture records");
  const failed = cronRoute(new Error("private-exception-canary"));
  const response = await failed.get(request());
  assert.equal(response.status, 503);
  assert.doesNotMatch(JSON.stringify({ body: await response.json(), warnings: failed.warnings }), /private-exception-canary/);
});

function captureService(options: {
  kind?: "entry" | "result";
  busy?: boolean;
  published?: boolean;
  scanErrors?: string[];
  verified?: boolean;
  race?: "archive" | "advance";
} = {}) {
  const row = { id: "setup-1", symbol: "TESTUSDT", timeframe: "15m", direction: "long", exchange: "binance",
    firstStatus: "Limit Order", status: "Running", archivedAt: null as Date | null, resultAt: null as Date | null,
    firstSeenAt: new Date(0),
    zoneBaseTime: 1000, entry: 100, stopLoss: 90, target1: 110, target2: 120, confidence: 75,
    riskReward: 2, zoneTop: 100, zoneBottom: 95 };
  let queries = 0;
  let transactions = 0;
  let statusWrites = 0;
  const snapshots: string[] = [];
  const exports: { runSetupCapture?: () => Promise<{ publication: { status: string; verified: boolean }; entrySnapshots: number; resultSnapshots: number }> } = {};
  const update = async ({ where, data }: { where: { status: string }; data: Record<string, unknown> }) => {
    if (row.archivedAt || row.status !== where.status || row.resultAt) return { count: 0 };
    Object.assign(row, data);
    statusWrites++;
    return { count: 1 };
  };
  const mutate = () => {
    if (options.race === "archive") row.archivedAt = new Date();
    if (options.race === "advance") row.status = "Invalidated (SL hit)";
  };
  runInNewContext(ts.transpileModule(readFileSync("src/infrastructure/monitoring/setup-capture-service.ts", "utf8"), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText, {
    exports, Date, AbortSignal,
    require: (name: string) => {
      if (name === "server-only") return {};
      if (name.endsWith("/default-watchlist")) return { DEFAULT_WATCHLIST: [] };
      if (name.endsWith("/published-board-service")) return { refreshPublishedBoard: async () => ({
        result: { demand: [], supply: [], errors: options.scanErrors ?? [], scannedAt: new Date().toISOString() },
        refreshing: options.busy ?? false, snapshotPublished: options.published ?? true,
      }) };
      if (name.endsWith("/supply-demand")) return { publishedBaseIndex: () => 0, publishedScanLimit: () => 1000 };
      if (name.endsWith("/source-selection")) return { fetchPublishedCandles: async () => {
        if (options.kind === "result") mutate();
        return [1000, 1900, 2800].map((time) => ({ time, open: 100, high: 120, low: 95, close: 110, volume: 1 }));
      } };
      if (name.endsWith("/setup-lifecycle")) return {
        isTerminalSetupStatus: (status: string) => ["Target 2 reached", "Invalidated (SL hit)", "Missed"].includes(status),
        traceSetupLifecycle: () => ({ status: "Target 2 reached", filledIndex: 1, target2Index: 2, stopIndex: null }),
      };
      if (name.endsWith("/exchange")) return { isMarketExchange: () => true };
      if (name.endsWith("/capture-trigger")) return { isFilledStatus: () => true };
      if (name.endsWith("/proof-image")) return { proofWindow: () => ({ from: 0, to: 3 }) };
      if (name.endsWith("/active-setup-store")) return { activeSetupStore: {} };
      if (name.endsWith("/signals-snapshot-store")) return { signalsSnapshotStore: {} };
      if (name.endsWith("/market-data-provider")) return { marketData: {}, marketDataSources: [] };
      if (name.endsWith("/signals-publication")) return { readSignalsPublication: async () => ({
        status: options.verified === false ? "missing" : "fresh", durable: options.verified !== false,
        verified: options.verified ?? true,
      }) };
      if (name.endsWith("/prisma")) return { prisma: {
        trackedSetup: {
          findMany: async (query: { where: { firstStatus?: string } }) => {
            queries++;
            return (options.kind === "entry" && query.where.firstStatus || options.kind === "result" && !query.where.firstStatus) ? [{ ...row }] : [];
          },
          updateMany: async (input: Parameters<typeof update>[0]) => {
            const result = await update(input);
            if (options.kind === "entry") mutate();
            return result;
          },
        },
        $transaction: async (work: (tx: unknown) => Promise<unknown>) => {
          transactions++;
          return work({ trackedSetup: { updateMany: update }, setupSnapshot: { upsert: async ({ create }: { create: { kind: string } }) => snapshots.push(create.kind) } });
        },
      } };
      throw new Error(`Unexpected import ${name}`);
    },
  });
  return { run: exports.runSetupCapture!, row, snapshots, counts: () => ({ queries, transactions, statusWrites }) };
}

test("capture only verifies durable readback from a complete successfully saved scan", async () => {
  for (const options of [{ published: false }, { scanErrors: ["TESTUSDT: unavailable"] }, { verified: false }]) {
    const f = captureService(options);
    assert.equal((await f.run()).publication.verified, false);
  }
  const f = captureService();
  assert.equal((await f.run()).publication.verified, true);
});

test("a busy capture returns before any proof queue or transaction is opened", async () => {
  const f = captureService({ busy: true, kind: "entry" });
  const report = await f.run();
  assert.equal(report.publication.status, "in-progress");
  assert.equal(report.publication.verified, false);
  assert.deepEqual(f.counts(), { queries: 0, transactions: 0, statusWrites: 0 });
});

test("capture cannot create entry proof after archival or a concurrent status advance between CAS and transaction", async () => {
  for (const race of ["archive", "advance"] as const) {
    const f = captureService({ kind: "entry", race });
    const report = await f.run();
    assert.equal(report.entrySnapshots, 0);
    assert.deepEqual(f.snapshots, []);
    assert.equal(f.counts().transactions, 1);
    assert.equal(f.row.status, race === "advance" ? "Invalidated (SL hit)" : "Target 2 reached");
  }
});

test("capture result transaction preserves archival and newer status observed during candle fetch", async () => {
  for (const race of ["archive", "advance"] as const) {
    const f = captureService({ kind: "result", race });
    const report = await f.run();
    assert.equal(report.resultSnapshots, 0);
    assert.deepEqual(f.snapshots, []);
    assert.equal(f.row.resultAt, null);
    assert.equal(f.counts().statusWrites, 0);
  }
  const f = captureService({ kind: "result" });
  assert.equal((await f.run()).resultSnapshots, 1);
  assert.deepEqual(f.snapshots, ["RESULT"]);
  assert.equal(f.row.status, "Target 2 reached");
});
