import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";
import ts from "typescript";
import { translate } from "@/shared/i18n/messages";

type UiNode = { type: unknown; props: Record<string, unknown> };
function textOf(node: unknown, visibleOnly = false): string {
  if (Array.isArray(node)) return node.map((child) => textOf(child, visibleOnly)).join(" ");
  if (!node || typeof node === "boolean") return "";
  if (typeof node !== "object") return String(node);
  const props = (node as UiNode).props;
  if (visibleOnly && (props?.["aria-hidden"] || String(props?.className).split(" ").includes("sr-only"))) return "";
  return textOf(props?.children, visibleOnly);
}
function nodesOf(node: unknown): UiNode[] {
  if (Array.isArray(node)) return node.flatMap(nodesOf);
  if (!node || typeof node !== "object") return [];
  return [node as UiNode, ...nodesOf((node as UiNode).props?.children)];
}
const jsx = (type: unknown, props: unknown) => ({ type, props });
function load(path: string, dependencies: Record<string, unknown>) {
  const exports: Record<string, (props: unknown) => unknown> = {};
  runInNewContext(ts.transpileModule(readFileSync(path, "utf8"), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX },
  }).outputText, { exports, require: (name: string) => dependencies[name] });
  return exports;
}
const ui = {
    "react/jsx-runtime": { jsx, jsxs: jsx },
    "lucide-react": { Clock3: "clock", Loader2: "loader", RefreshCw: "refresh" },
    "@/presentation/hooks/use-translate": { useT: () => ({ locale: "en", t: (key: Parameters<typeof translate>[1]) => translate("en", key) }) },
};
const api = load("src/presentation/features/analysis/chart-data-status.tsx", ui);
const base = { connectionState: "polling", exchange: "bybit", lastUpdated: "2026-10-10T01:00:00Z", setupState: "published", setupError: null, retry() {} };
const text = (props: Record<string, unknown>) => textOf(api.ChartDataStatus({ ...base, ...props }));

test("healthy charts have no routine connection, source or timestamp indicators", () => {
  assert.equal(api.ChartDataStatus(base), null);
  assert.equal(api.ChartDataStatus({ ...base, connectionState: "live", exchange: "binance" }), null);
});

test("delayed charts expose retry and never label a stale frame Live", () => {
  const result = api.ChartDataStatus({ ...base, connectionState: "delayed" });
  assert.match(textOf(result), /Data delayed.*Try again/);
  assert.equal(textOf(result, true).trim(), "");
  assert.ok(nodesOf(result).some(({ type }) => type === "clock"));
  assert.ok(nodesOf(result).every(({ props }) => !String(props.className).includes("warning")));
  assert.doesNotMatch(textOf(result), /Last successful update|Updating periodically|Spot|Binance|Bybit|Live/);
});

test("reconnecting and plan checks use a compact spinner with accessible labels", () => {
  for (const props of [{ connectionState: "reconnecting" }, { setupState: "loading" }]) {
    const result = api.ChartDataStatus({ ...base, ...props });
    assert.equal(textOf(result, true).trim(), "");
    assert.match(textOf(result), /Reconnecting|Checking the published trading plan/);
    assert.match(String(nodesOf(result).find(({ type }) => type === "loader")?.props.className), /size-4 animate-spin motion-reduce:animate-none/);
    assert.ok(nodesOf(result).some(({ props }) => typeof props.title === "string"));
    assert.ok(nodesOf(result).every(({ props }) => !String(props.className).includes("warning")));
  }
});

test("optional history failure keeps a neutral accessible status and retry without a failure banner", () => {
  let retries = 0;
  const result = api.ChartDataStatus({ ...base, historyError: "History timed out.", retry() { retries++; } });
  assert.equal(textOf(result, true).trim(), "");
  assert.match(textOf(result), /Historical candles could not finish loading; current chart remains available/);
  assert.ok(nodesOf(result).some(({ type }) => type === "clock"));
  assert.ok(nodesOf(result).some(({ props }) => props.title === translate("en", "chart.historyUnavailable")));
  assert.ok(nodesOf(result).every(({ props }) => !/warning|negative/.test(String(props.className))));
  const retry = nodesOf(result).find(({ type }) => type === "button")!;
  assert.equal(retry.props["aria-label"], "Try again");
  (retry.props.onClick as () => void)();
  assert.equal(retries, 1);
  assert.equal(api.ChartDataStatus({ ...base, historyError: null }), null);
});

test("unknown legacy provenance displays paused outcome evaluation", () => {
  assert.match(text({ setupState: "legacy" }), /no recorded source.*stored status is unverified.*evaluation is paused/);
  assert.match(textOf(api.ChartDataStatus({ ...base, setupState: "legacy", historyError: "History timed out." }), true), /no recorded source.*evaluation is paused/);
});

test("missing and failed plans remain visibly different from verified published plans", () => {
  assert.match(text({ setupState: "missing" }), /Unpublished analysis/);
  const failed = text({ setupState: "unavailable", setupError: "Trading plan temporarily unavailable." });
  assert.match(failed, /Try again.*could not be verified.*hidden until verification/);
  assert.doesNotMatch(failed, /Unpublished analysis/);
  assert.doesNotMatch(text({}), /Unpublished analysis|could not be verified/);
  assert.doesNotThrow(() => text({ lastUpdated: "invalid" }));
});

test("all critical plan notices remain visible even while connection recovery runs", () => {
  for (const [setupState, expected] of [
    ["missing", /Unpublished analysis/],
    ["unavailable", /could not be verified.*hidden until verification/],
    ["mismatched", /uses another timeframe/],
    ["legacy", /no recorded source.*evaluation is paused/],
  ] as const) {
    assert.match(textOf(api.ChartDataStatus({ ...base, connectionState: "reconnecting", setupState }), true), expected);
  }
});

function renderClient(path: string, snapshot: Record<string, unknown>) {
  const dependencies: Record<string, unknown> = {
    ...ui,
    react: { useState: (initial: unknown) => [initial, () => undefined] },
    "@/core/application/market-data/history-plan": { rangeForTimeframe: () => "month" },
    "@/core/domain/market/symbol": { normalizeUsdtSymbol: String, isValidBinanceSymbol: () => true },
    "@/presentation/hooks/use-live-analysis": { useLiveAnalysis: () => snapshot },
    "@/presentation/hooks/use-market-context": { useMarketContext: () => ({}) },
    "@/presentation/hooks/use-scanner": { useDashboardSignals: () => ({ top: [{ hit: { symbol: "BTCUSDT" } }], result: null }) },
  };
  for (const [module, name] of [
    ["features/analysis/analysis-view", "AnalysisView"], ["features/analysis/chart-data-status", "ChartDataStatus"],
    ["features/dashboard/market-overview", "MarketOverview"], ["features/dashboard/top-setups-strip", "TopSetupsStrip"],
    ["features/signals/signals-board", "SignalsBoard"], ["layout/app-shell", "AppShell"], ["ui/reveal", "Reveal"],
  ]) dependencies[`@/presentation/${module}`] = { [name]: name };
  return Object.values(load(path, dependencies))[0]({ initialSymbol: "BTCUSDT", initialTimeframe: "15m" });
}

test("both chart clients keep retained analysis with compact degraded status; zero-data failures stay visible", () => {
  for (const path of ["src/presentation/features/analysis/analysis-client.tsx", "src/presentation/features/dashboard/dashboard-client.tsx"]) {
    const snapshot = { ...base, analysis: {}, error: "Price temporarily unavailable.", history: { error: "History timed out." }, connectionState: "delayed" };
    const retained = renderClient(path, snapshot);
    assert.doesNotMatch(textOf(retained, true), /Price temporarily unavailable/);
    assert.ok(nodesOf(retained).some(({ type }) => type === "AnalysisView"));
    const status = nodesOf(retained).find(({ type }) => type === "ChartDataStatus")!;
    assert.equal(status.props.connectionState, "delayed");
    assert.equal(status.props.historyError, "History timed out.");
    const failed = renderClient(path, { ...snapshot, analysis: null });
    assert.match(textOf(failed, true), /Price temporarily unavailable/);
    assert.ok(nodesOf(failed).every(({ type }) => type !== "AnalysisView"));
    assert.doesNotThrow(() => renderClient(path, { ...snapshot, history: undefined }));
  }
});
