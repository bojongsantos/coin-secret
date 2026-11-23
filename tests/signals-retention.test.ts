import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";
import ts from "typescript";
import * as failures from "@/shared/lib/read-failure";

test("a transient signals outage retains the last verified board as stale and access loss clears it", async () => {
  let state: unknown;
  let effect: (() => void) | undefined;
  let started = false;
  let responseStatus = 200;
  let authenticated = false;
  let timer: (() => void) | undefined;
  const trigger = { current: null };
  const board = { result: { demand: [{ symbol: "BTCUSDT" }], supply: [], demandTotal: 1,
    supplyTotal: 0, errors: [], scannedAt: "2026-11-23T03:00:00Z" }, top: [], stale: false, refreshing: false };
  const react = {
    useCallback: (callback: unknown) => callback,
    useState: (initial: unknown) => {
      state ??= initial;
      return [state, (value: unknown) => {
        state = typeof value === "function" ? value(state) : value;
      }];
    },
    useRef: () => trigger,
    useEffect: (callback: () => void) => { if (!started) effect = callback; },
  };
  const dependencies: Record<string, unknown> = {
    react,
    "@/shared/lib/read-failure": failures,
    "@/infrastructure/auth/auth-client": { AUTH_STATE_CHANGED_EVENT: "auth-change" },
    "@/presentation/features/access/plan-provider": {
      usePlan: () => ({ authenticated, plan: "FREE", canAccess: () => false }),
    },
  };
  const load = (path: string) => {
    const exports: Record<string, () => { result: unknown; stale: boolean; loading: boolean }> = {};
    runInNewContext(ts.transpileModule(readFileSync(path, "utf8"), {
      compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
    }).outputText, {
      exports, Date, AbortController, AbortSignal, Error,
      navigator: { onLine: true },
      document: { visibilityState: "visible", addEventListener() {}, removeEventListener() {} },
      window: { setTimeout: (callback: () => void) => { timer = callback; return 1; }, clearTimeout() {},
        addEventListener() {}, removeEventListener() {} },
      fetch: async () => ({ ok: responseStatus === 200, status: responseStatus,
        headers: { get: (name: string) => name === "content-type" ? "application/json" : null }, json: async () => board }),
      require: (name: string) => dependencies[name] ?? (() => { throw new Error(`Unexpected import ${name}`); })(),
    });
    return exports;
  };
  dependencies["@/presentation/hooks/use-polling-read"] = load("src/presentation/hooks/use-polling-read.ts");
  const api = load("src/presentation/hooks/use-scanner.ts");
  api.useDashboardSignals();
  assert.ok(effect);
  effect();
  started = true;
  const tick = async () => { assert.ok(timer); timer(); await new Promise((done) => setImmediate(done)); };
  await tick();
  assert.deepEqual(api.useDashboardSignals().result, board.result);

  responseStatus = 503;
  await tick();
  const retained = api.useDashboardSignals();
  assert.deepEqual(retained.result, board.result);
  assert.equal(retained.stale, true);
  assert.equal(retained.loading, false);

  authenticated = true;
  assert.equal(api.useDashboardSignals().result, null, "a changed access identity must never expose the retained board");
});
