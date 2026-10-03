import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";
import ts from "typescript";
import * as React from "react";
import * as jsxRuntime from "react/jsx-runtime";
import { renderToStaticMarkup } from "react-dom/server";
import * as zod from "zod";
function load(path: string, dependencies: Record<string, unknown>, fetcher?: typeof fetch) {
  const exports: Record<string, unknown> = {};
  runInNewContext(ts.transpileModule(readFileSync(path, "utf8"), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX } }).outputText, {
    exports, fetch: fetcher, Error,
    require(name: string) {
      if (name === "react") return React;
      if (name === "react/jsx-runtime") return jsxRuntime;
      if (name === "zod") return zod;
      if (name in dependencies) return dependencies[name];
      throw new Error(`Unexpected import ${name}`);
    },
  });
  return exports;
}
test("admin JSON requests reject HTTP, network and malformed responses", async () => {
  for (const fetcher of [async () => new Response('{"error":{"message":"Forbidden"}}', { status: 403 }), async () => new Response("invalid"), async () => { throw new Error("Offline"); }]) {
    const json = load("src/presentation/features/admin/admin-data.tsx", {}, fetcher as typeof fetch).adminJson as (url: string) => Promise<unknown>;
    await assert.rejects(json("/api/admin/users"));
  }
});
test("overview errors render a retry action without accessing missing statistics", () => {
  const shared = load("src/presentation/features/admin/admin-data.tsx", {});
  const view = load("src/presentation/features/admin/overview.tsx", {
    "./admin-data": { ...shared, useAdminData: () => ({ data: null, loading: false, error: "Offline", reload() {} }) },
    "@/presentation/hooks/use-translate": { useT: () => ({ t: (v: string) => v }) },
  }).Overview as React.ComponentType;
  const html = renderToStaticMarkup(React.createElement(view));
  assert.match(html, /Offline/); assert.match(html, /Retry/); assert.doesNotMatch(html, /animate-spin/);
});
test("user and payment tables explain genuine empty results", () => {
  const shared = load("src/presentation/features/admin/admin-data.tsx", {});
  for (const [name, key, text] of [["Users", "users", "No users match"], ["Payments", "payments", "No payments match"]]) {
    const path = `src/presentation/features/admin/${key}-module.tsx`;
    const view = load(path, { "./admin-data": { ...shared, useAdminData: () => ({ data: { [key]: [], page: 1, hasMore: false }, loading: false, error: null, reload() {} }) } })[`${name}Module`] as React.ComponentType;
    assert.match(renderToStaticMarkup(React.createElement(view)), new RegExp(text));
  }
});
