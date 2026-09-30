import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";
import * as zod from "zod";
import ts from "typescript";

const exports: Record<string, (request: Request, maxBytes: number) => Promise<unknown>> = {};
runInNewContext(ts.transpileModule(readFileSync("src/shared/server/http.ts", "utf8"), {
  compilerOptions: { module: ts.ModuleKind.CommonJS },
}).outputText, {
  exports, Response, TextDecoder, Uint8Array,
  require: (name: string) => name === "zod" ? zod : {},
});
const readBoundedJson = (request: Request, maxBytes: number): Promise<unknown> =>
  exports.readBoundedJson(request, maxBytes);
const request = (body: string, headers?: HeadersInit) => new Request("http://localhost/test", { method: "POST", body, headers });

test("bounded JSON preserves payload at the exact byte limit", async () => {
  const body = '{"value":"é"}';
  const result = await readBoundedJson(request(body), new TextEncoder().encode(body).length);
  assert.equal(JSON.stringify(result), body);
});

test("oversized bodies fail with 413 even without an honest Content-Length", async () => {
  for (const headers of [undefined, { "Content-Length": "1" }, { "Content-Length": "999" }]) {
    await assert.rejects(readBoundedJson(request('{"value":"é"}', headers), 12), { status: 413 });
  }
});

test("chunked bodies stop reading at the limit", async () => {
  let canceled = false;
  const stream = new ReadableStream({
    pull(controller) { controller.enqueue(new Uint8Array(8)); },
    cancel() { canceled = true; },
  });
  const req = new Request("http://localhost/test", { method: "POST", body: stream, duplex: "half" } as RequestInit);
  await assert.rejects(readBoundedJson(req, 10), { status: 413 });
  assert.equal(canceled, true);
});

test("invalid and empty JSON fail with 400", async () => {
  for (const body of ["", "not json"]) {
    await assert.rejects(readBoundedJson(request(body), 100), { status: 400 });
  }
});
