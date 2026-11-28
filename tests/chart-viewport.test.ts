import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";
import ts from "typescript";
import { chartCandleUpdates } from "@/presentation/features/analysis/chart-updates";
import { TIMEFRAMES, TIMEFRAME_SECONDS } from "@/core/domain/market/timeframe";
import type { Candle } from "@/core/domain/models";

type Range = { from: number; to: number };
type Slot = { value?: unknown; dependencies?: readonly unknown[] };

function harness() {
  let cursor = 0;
  const slots: Slot[] = [];
  const effects: Array<() => unknown> = [];
  let visible: Range = { from: 0, to: 0 };
  let rangeListener: ((value: Range) => void) | undefined;
  let automatic = true;
  let manualPriceRanges = 0;
  let overlaySeries = 0;
  let pendingFollow = false;
  const candleKind = Symbol("candles");
  const container = { clientWidth: 700, clientHeight: 420 };
  const timeOptions = { barSpacing: 7, timeVisible: true };
  const priceScale = {
    applyOptions(options: { autoScale?: boolean }) {
      if (options.autoScale !== undefined) automatic = options.autoScale;
    },
    setVisibleRange() { automatic = false; manualPriceRanges++; },
  };
  const setRange = (range: Range) => {
    pendingFollow = false;
    visible = { from: range.from, to: range.to };
    rangeListener?.(visible);
  };
  const timeScale = {
    applyOptions() {},
    getVisibleLogicalRange: () => ({ ...visible }),
    setVisibleLogicalRange: setRange,
    width: () => 700,
    subscribeVisibleLogicalRangeChange(callback: (value: Range) => void) { rangeListener = callback; },
    scrollToRealTime() { pendingFollow = true; },
  };
  const chart = {
    addSeries(kind: symbol) {
      if (kind !== candleKind) overlaySeries++;
      return {
        kind, setData() {}, update() {}, applyOptions() {},
        removePriceLine() {}, createPriceLine: () => ({}),
      };
    },
    removeSeries(series: { kind: symbol }) {
      // SDK overlay changes can change the logical offset while the reader
      // is viewing history. The component must restore the pre-rebuild view.
      if (series.kind !== candleKind && --overlaySeries === 0 && visible.to < 499) {
        setRange({ from: visible.from - 12, to: visible.to - 12 });
      }
    },
    applyOptions() {},
    timeScale: () => timeScale,
    priceScale: () => priceScale,
    options: () => ({ timeScale: timeOptions }),
    panes: () => [{ attachPrimitive() {}, detachPrimitive() {} }],
  };
  function changed(slot: Slot, dependencies: readonly unknown[]) {
    const previous = slot.dependencies;
    slot.dependencies = dependencies;
    return !previous || dependencies.some((value, index) => !Object.is(value, previous[index]));
  }
  const react = {
    useRef(initial: unknown) {
      const index = cursor++;
      return (slots[index] ??= { value: { current: initial } }).value;
    },
    useEffect(run: () => unknown, dependencies: readonly unknown[]) {
      const slot = slots[cursor++] ??= {};
      if (changed(slot, dependencies)) effects.push(run);
    },
    useCallback(callback: unknown, dependencies: readonly unknown[]) {
      const slot = slots[cursor++] ??= {};
      if (changed(slot, dependencies)) slot.value = callback;
      return slot.value;
    },
  };
  const jsx = (type: unknown, props: Record<string, unknown>) => {
    if (props.ref && typeof props.ref === "object" && "current" in props.ref) props.ref.current = container;
    return { type, props };
  };
  const modules: Record<string, unknown> = {
    react,
    "react/jsx-runtime": { jsx, jsxs: jsx },
    "lightweight-charts": {
      CandlestickSeries: candleKind, LineSeries: Symbol("line"), BaselineSeries: Symbol("band"),
      createChart: () => chart, createSeriesMarkers: () => ({ setMarkers() {} }),
      ColorType: { Solid: "solid" }, LineStyle: { Solid: 0, Dashed: 2 }, CrosshairMode: { Normal: 0 },
    },
    "lucide-react": {},
    "@/core/domain/market/timeframe": { TIMEFRAMES, TIMEFRAME_SECONDS },
    "@/presentation/features/analysis/share-image": {},
    "@/shared/lib/format": { formatPrice: () => "100" },
    "@/presentation/features/access/plan-provider": { usePlan: () => ({ canAccess: () => true }) },
    "@/presentation/hooks/use-ui-preference": { useTheme: () => ({ theme: "dark" }) },
    "@/presentation/hooks/use-translate": { useT: () => ({ locale: "en", t: () => "" }) },
    "@/presentation/ui/coin-icon": {},
    "./chart-updates": { chartCandleUpdates },
    "./chart-time": { chartTimeFormatters: () => ({}) },
    "./chart-panel.module.css": { default: { canvas: "canvas" } },
  };
  const api: Record<string, (props: Record<string, unknown>) => unknown> = {};
  runInNewContext(ts.transpileModule(readFileSync("src/presentation/features/analysis/chart-panel.tsx", "utf8"), {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX },
  }).outputText, {
    exports: api, require: (name: string) => modules[name],
    window: { matchMedia: () => ({ addEventListener() {}, removeEventListener() {} }) },
    getComputedStyle: () => ({ getPropertyValue: () => "1" }),
  });
  const candles = Array.from({ length: 500 }, (_, index) => ({
    time: 1_795_000_000 + index * 900,
    open: 100 + index / 10, high: 101 + index / 10, low: 99 + index / 10, close: 100 + index / 10, volume: 10,
  }));
  const pattern = { shape: {
    zones: [{ id: "zone", type: "demand", strength: "fresh", baseTime: candles[480].time, top: 149, bottom: 148 }],
    setup: { zoneId: "zone" },
  } };
  const props: Record<string, unknown> = {
    data: { candles }, symbol: "AWEUSDT", timeframe: "15m", range: "3M", precision: 4,
    price: 150, change24h: 1, pattern, levels: [], onTimeframeChange() {}, onLoadMoreHistory() {},
    history: { reachedStart: false, loading: false, truncated: false },
  };
  const render = () => {
    cursor = 0;
    api.ChartPanel(props);
    for (const effect of effects.splice(0)) effect();
  };
  return { render, props, pan: setRange, range: () => visible,
    pendingFollow: () => pendingFollow,
    grow: (mode: "append" | "prepend") => {
      const edge = mode === "append" ? candles.at(-1) : candles[0];
      if (!edge) throw new Error("Missing fixture candle");
      const added: Candle = { ...edge, time: edge.time + (mode === "append" ? 900 : -900) };
      props.data = { candles: mode === "append" ? [...candles, added] : [added, ...candles] };
    },
    lockPriceScale: () => priceScale.setVisibleRange(),
    autoScale: () => automatic, manualPriceRanges: () => manualPriceRanges };
}

test("new chart views keep automatic price scaling so historical candles remain visible", () => {
  const page = harness();
  page.render();
  assert.equal(page.autoScale(), true);
  assert.equal(page.manualPriceRanges(), 0);
});

test("live overlay rebuilds preserve the reader's historical viewport", () => {
  const page = harness();
  page.render();
  const historical = { from: 150, to: 250 };
  page.pan(historical);
  page.props.data = { ...(page.props.data as Record<string, unknown>) };
  page.render();
  assert.deepEqual(page.range(), historical);
});

test("regular live updates retain deliberate manual vertical zoom", () => {
  const page = harness();
  page.render();
  page.lockPriceScale();
  page.props.data = { ...(page.props.data as Record<string, unknown>) };
  page.render();
  assert.equal(page.autoScale(), false);
  assert.equal(page.manualPriceRanges(), 1);
});

for (const mode of ["append", "prepend"] as const) {
  test(`${mode} at the right edge follows live after overlay rebuilding`, () => {
    const page = harness();
    page.render();
    page.grow(mode);
    page.render();
    assert.equal(page.pendingFollow(), true, "overlay restoration must not cancel live-follow animation");
  });
}
