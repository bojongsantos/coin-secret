import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";
import ts from "typescript";
import { translate } from "@/shared/i18n/messages";

type UiNode = { props: { children?: unknown } };
function textOf(node: unknown): string {
  if (Array.isArray(node)) return node.map(textOf).join(" ");
  if (!node || typeof node === "boolean") return "";
  if (typeof node !== "object") return String(node);
  return textOf((node as UiNode).props?.children);
}
const jsx = (type: unknown, props: unknown) => ({ type, props });
const api: Record<string, (props: unknown) => unknown> = {};
runInNewContext(ts.transpileModule(readFileSync("src/presentation/features/analysis/chart-data-status.tsx", "utf8"), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX },
}).outputText, {
  exports: api, Date,
  require: (name: string) => ({
    "react/jsx-runtime": { jsx, jsxs: jsx },
    "lucide-react": { RefreshCw: "refresh" },
    "@/presentation/hooks/use-translate": { useT: () => ({ locale: "en", t: (key: Parameters<typeof translate>[1]) => translate("en", key) }) },
  })[name],
});
const base = { connectionState: "polling", exchange: "bybit", lastUpdated: "2026-10-10T01:00:00Z", setupState: "published", setupError: null, retry() {} };
const text = (props: Record<string, unknown>) => textOf(api.ChartDataStatus({ ...base, ...props }));

test("healthy charts have no routine connection, source or timestamp indicators", () => {
  assert.equal(api.ChartDataStatus(base), null);
  assert.equal(api.ChartDataStatus({ ...base, connectionState: "live", exchange: "binance" }), null);
});

test("delayed charts expose retry and never label a stale frame Live", () => {
  const result = text({ connectionState: "delayed" });
  assert.match(result, /Data delayed.*Try again/);
  assert.doesNotMatch(result, /Last successful update|Updating periodically|Spot|Binance|Bybit/);
  assert.doesNotMatch(result, /Live/);
});

test("unknown legacy provenance displays paused outcome evaluation", () => {
  assert.match(text({ setupState: "legacy" }), /no recorded source.*stored status is unverified.*evaluation is paused/);
});

test("missing and failed plans remain visibly different from verified published plans", () => {
  assert.match(text({ setupState: "missing" }), /Unpublished analysis/);
  const failed = text({ setupState: "unavailable", setupError: "Trading plan temporarily unavailable." });
  assert.match(failed, /Try again.*could not be verified.*hidden until verification/);
  assert.doesNotMatch(failed, /Unpublished analysis/);
  assert.doesNotMatch(text({}), /Unpublished analysis|could not be verified/);
  assert.doesNotThrow(() => text({ lastUpdated: "invalid" }));
});
