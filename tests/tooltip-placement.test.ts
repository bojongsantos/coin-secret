import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";
import ts from "typescript";

type Element = { type: string; props: Record<string, unknown> };
type Ref = { current: unknown };

function tooltipHarness() {
  const states: unknown[] = [];
  const refs: Ref[] = [];
  const layoutEffects: Array<() => void | (() => void)> = [];
  const effects: Array<() => void | (() => void)> = [];
  const listeners = new Map<string, () => void>();
  const body = {};
  let stateIndex = 0;
  let refIndex = 0;
  let trigger = { top: 340, bottom: 356, left: 900, width: 16 };
  const tip = { width: 240, height: 80 };
  const jsx = (type: string, props: Record<string, unknown>) => ({ type, props });
  const exported: { Tooltip?: (props: unknown) => Element } = {};
  const dependencies: Record<string, unknown> = {
    "react/jsx-runtime": { jsx, jsxs: jsx },
    react: {
      useState(initial: unknown) {
        const index = stateIndex++;
        if (!(index in states)) states[index] = typeof initial === "function" ? initial() : initial;
        return [states[index], (value: unknown) => { states[index] = value; }];
      },
      useRef() { return refs[refIndex++] ??= { current: null }; },
      useCallback: (callback: unknown) => callback,
      useLayoutEffect: (effect: () => void | (() => void)) => layoutEffects.push(effect),
      useEffect: (effect: () => void | (() => void)) => effects.push(effect),
    },
    "react-dom": { createPortal: (child: Element, target: unknown) => ({ type: "portal", props: { children: child, target } }) },
  };
  runInNewContext(ts.transpileModule(readFileSync("src/presentation/ui/tooltip.tsx", "utf8"), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX },
  }).outputText, {
    exports: exported,
    require: (name: string) => dependencies[name] ?? (() => { throw new Error(`Unexpected import ${name}`); })(),
    window: {
      innerWidth: 1200,
      matchMedia: () => ({ matches: false }),
      addEventListener: (name: string, listener: () => void) => listeners.set(name, listener),
      removeEventListener: (name: string) => listeners.delete(name),
    },
    document: { body, addEventListener() {}, removeEventListener() {} },
  });

  function render() {
    stateIndex = 0;
    refIndex = 0;
    layoutEffects.length = 0;
    effects.length = 0;
    return exported.Tooltip!({ content: "Funding rate help", children: "i" });
  }
  const initial = render();
  const button = (initial.props.children as Element[])[0];
  (button.props.onMouseEnter as () => void)();
  render();
  refs[0].current = { getBoundingClientRect: () => trigger };
  refs[1].current = { getBoundingClientRect: () => tip };
  const cleanup = layoutEffects[0]();
  return {
    body, listeners, cleanup,
    move: (position: typeof trigger) => { trigger = position; },
    portal: () => (render().props.children as Element[]).find((child) => child?.type === "portal")!,
  };
}

test("tooltips escape the zoomed dashboard and position in the trigger's viewport coordinates", () => {
  const harness = tooltipHarness();
  const portal = harness.portal();
  assert.ok(portal, "tooltip must render outside the CSS-zoomed app");
  assert.equal(portal.props.target, harness.body);
  const tooltip = portal.props.children as Element;
  assert.equal(tooltip.props.role, "tooltip");
  const style = tooltip.props.style as { top: number; left: number };
  assert.equal(style.top, 252);
  assert.equal(style.left, 788);
  assert.equal(style.top + 80 + 8, 340, "tooltip must sit eight viewport pixels above the icon");
  assert.equal(style.left + 120, 908, "tooltip and icon must share a horizontal center");
});

test("open tooltips follow scrolling and resize, flip below the top edge, and clamp horizontally", () => {
  const harness = tooltipHarness();
  harness.move({ top: 2, bottom: 18, left: 0, width: 16 });
  harness.listeners.get("scroll")!();
  let style = (harness.portal().props.children as Element).props.style as { top: number; left: number };
  assert.equal(style.top, 26);
  assert.equal(style.left, 8);
  harness.move({ top: 300, bottom: 316, left: 1190, width: 10 });
  harness.listeners.get("resize")!();
  style = (harness.portal().props.children as Element).props.style as { top: number; left: number };
  assert.equal(style.top, 212);
  assert.equal(style.left, 952);
  assert.equal(harness.listeners.size, 2);
  if (typeof harness.cleanup === "function") harness.cleanup();
  assert.equal(harness.listeners.size, 0);
});
