import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";
import ts from "typescript";

type UiNode = { type: string; props: Record<string, unknown> };
function find(node: unknown, type: string): UiNode | undefined {
  if (Array.isArray(node)) return node.map((child) => find(child, type)).find(Boolean);
  if (!node || typeof node !== "object") return;
  const element = node as UiNode;
  return element.type === type ? element : find(element.props?.children, type);
}

function harness(path: string) {
  const state: unknown[] = [];
  let cursor = 0;
  let dirty = false;
  const props: Record<string, unknown> = { initialSymbol: "ZECUSDT", initialTimeframe: "15m" };
  const jsx = (type: string, props: Record<string, unknown>) => ({ type, props });
  const modules: Record<string, unknown> = {
    react: { useState(initial: unknown) {
      const index = cursor++;
      if (!(index in state)) state[index] = initial;
      return [state[index], (value: unknown) => { dirty ||= state[index] !== value; state[index] = value; }];
    } },
    "react/jsx-runtime": { jsx, jsxs: jsx },
    "lucide-react": { Loader2: "loader" },
    "@/core/application/market-data/history-plan": { rangeForTimeframe: () => "3M" },
    "@/core/domain/market/symbol": { normalizeUsdtSymbol: (value: string) => value, isValidBinanceSymbol: () => true },
    "@/presentation/hooks/use-translate": { useT: () => ({ t: (key: string) => key }) },
    "@/presentation/hooks/use-market-context": { useMarketContext: () => ({}) },
    "@/presentation/hooks/use-scanner": { useDashboardSignals: () => ({ top: [{ hit: { symbol: "BTCUSDT" } }], result: null }) },
    "@/presentation/hooks/use-live-analysis": { useLiveAnalysis: (symbol: string) => ({ analysis: {}, publishedTimeframe: symbol === "BTCUSDT" ? "1H" : "15m" }) },
  };
  for (const [module, name] of [
    ["features/analysis/analysis-view", "AnalysisView"], ["features/analysis/chart-data-status", "ChartDataStatus"],
    ["features/dashboard/market-overview", "MarketOverview"], ["features/dashboard/top-setups-strip", "TopSetupsStrip"],
    ["features/signals/signals-board", "SignalsBoard"], ["layout/app-shell", "AppShell"], ["ui/reveal", "Reveal"],
  ]) modules[`@/presentation/${module}`] = { [name]: name };
  const api: Record<string, (props: unknown) => unknown> = {};
  runInNewContext(ts.transpileModule(readFileSync(path, "utf8"), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX },
  }).outputText, { exports: api, require: (name: string) => modules[name] });
  const render = () => {
    let tree: unknown;
    for (let tries = 0; tries < 10; tries++) {
      cursor = 0; dirty = false;
      tree = Object.values(api)[0](props);
      if (!dirty) return tree;
    }
    throw new Error("Chart selection did not settle");
  };
  return { render, props };
}

test("a dashboard selection clears the previous coin's manual timeframe override", () => {
  const page = harness("src/presentation/features/dashboard/dashboard-client.tsx");
  let tree = page.render();
  (find(tree, "AnalysisView")!.props.onTimeframeChange as (value: string) => void)("15m");
  tree = page.render();
  assert.equal(find(tree, "AnalysisView")!.props.timeframe, "15m");
  (find(tree, "SignalsBoard")!.props.onSelect as (coin: string, tf?: string) => void)("ETHUSDT", "15m");
  tree = page.render();
  (find(tree, "SignalsBoard")!.props.onSelect as (coin: string, tf?: string) => void)("BTCUSDT");
  assert.equal(find(page.render(), "AnalysisView")!.props.timeframe, "1H");
});

test("standalone navigation resets manual interval choice for the next coin", () => {
  const page = harness("src/presentation/features/analysis/analysis-client.tsx");
  let tree = page.render();
  (find(tree, "AnalysisView")!.props.onTimeframeChange as (value: string) => void)("4H");
  tree = page.render();
  assert.equal(find(tree, "AnalysisView")!.props.timeframe, "4H");
  page.props.initialSymbol = "BTCUSDT";
  assert.equal(find(page.render(), "AnalysisView")!.props.timeframe, "1H");
});
