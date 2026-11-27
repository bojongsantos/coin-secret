import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";
import ts from "typescript";
import sharp from "sharp";
import * as imageRules from "@/core/domain/news/image";
import * as transactionLocks from "@/infrastructure/database/transaction-lock";

class HttpError extends Error {
  constructor(public status: number, message: string, public code = "REQUEST_ERROR") { super(message); }
}
function moduleSource(path: string, imports: Record<string, unknown>) {
  const exports: Record<string, unknown> = {};
  runInNewContext(ts.transpileModule(readFileSync(path, "utf8"), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true } }).outputText,
    { exports, Uint8Array, Request, Response, URL, Buffer, process, require: (name: string) => imports[name] ?? (name === "@/infrastructure/database/transaction-lock" ? transactionLocks : {}) });
  return exports;
}
function processing() {
  const exports = moduleSource("src/infrastructure/news/image-processing.ts", { sharp, "@/core/domain/news/image": imageRules, "@/shared/server/http": { HttpError } });
  return exports as {
    optimizeNewsImage: (input: Uint8Array, type: string) => Promise<{ data: Uint8Array; width: number; height: number; bytes: number }>;
    readNewsImageBody: (request: Request) => Promise<Uint8Array>;
  };
}
const sample = () => sharp({ create: { width: 2400, height: 1200, channels: 3, background: "red" } }).png().toBuffer();

test("uploaded raster images are resized and reencoded without enlarging or metadata", async () => {
  const { optimizeNewsImage } = processing();
  const output = await optimizeNewsImage(await sample(), "image/png");
  assert.equal(output.width, 1600);
  assert.equal(output.height, 800);
  assert.ok(output.bytes <= imageRules.NEWS_IMAGE_OUTPUT_BYTES);
  const metadata = await sharp(output.data).metadata();
  assert.equal(metadata.format, "webp");
  assert.equal(metadata.exif, undefined);
  const small = await sharp({ create: { width: 200, height: 300, channels: 3, background: "blue" } }).jpeg().toBuffer();
  const portrait = await optimizeNewsImage(small, "image/jpeg");
  assert.equal(portrait.width, 200);
  assert.equal(portrait.height, 300);
});

test("upload rejects SVG, forged MIME types, invalid bytes and excessive decoded pixels", async () => {
  const { optimizeNewsImage } = processing();
  const png = await sample();
  await assert.rejects(optimizeNewsImage(png, "image/svg+xml"), { status: 415 });
  await assert.rejects(optimizeNewsImage(png, "image/jpeg"), { status: 415 });
  await assert.rejects(optimizeNewsImage(new Uint8Array([1, 2, 3]), "image/png"), { status: 400 });
  const svg = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="10" height="10"><script>alert(1)</script></svg>');
  await assert.rejects(optimizeNewsImage(svg, "image/png"), { status: 415 });
  const huge = await sharp({ create: { width: 5000, height: 5000, channels: 3, background: "red" } }).png().toBuffer();
  await assert.rejects(optimizeNewsImage(huge, "image/png"), { status: 400 });
});

test("binary image requests are bounded even with no honest Content-Length", async () => {
  const { readNewsImageBody } = processing();
  const input = new Uint8Array(imageRules.NEWS_IMAGE_INPUT_BYTES + 1);
  await assert.rejects(readNewsImageBody(new Request("https://coinsecret.io/api/admin/news/images", { method: "POST", body: input })), { status: 413 });
  await assert.rejects(readNewsImageBody(new Request("https://coinsecret.io/api/admin/news/images", { method: "POST", headers: { "Content-Length": String(input.byteLength) }, body: "x" })), { status: 413 });
  await assert.rejects(readNewsImageBody(new Request("https://coinsecret.io/api/admin/news/images", { method: "POST" })), { status: 400 });
});

test("image upload route rejects unauthorized or foreign-origin requests before processing", async () => {
  let processed = false;
  const load = (requireAdmin: () => Promise<{ id: string }>, origin: () => void) => moduleSource("src/app/api/admin/news/images/route.ts", {
    "@/infrastructure/auth/current-user": { requireAdmin },
    "@/shared/server/admin-request": { assertAdminOrigin: origin },
    "@/infrastructure/admin/rate-limit": { adminMutationLimiter: { check: () => ({ allowed: true }) } },
    "@/infrastructure/news/images": { uploadNewsImage: () => { processed = true; } },
    "@/shared/server/http": { apiError: (error: HttpError) => Response.json({ error: error.code }, { status: error.status }) },
  }).POST as (request: Request) => Promise<Response>;
  const request = new Request("https://coinsecret.io/api/admin/news/images", { method: "POST", body: "x" });
  assert.equal((await load(async () => { throw new HttpError(401, "Sign in"); }, () => {})(request)).status, 401);
  assert.equal((await load(async () => ({ id: "admin" }), () => { throw new HttpError(403, "Origin"); })(request)).status, 403);
  assert.equal(processed, false);
});

test("persistent images enforce quota after serializing access and rechecking admin", async () => {
  const events: string[] = [];
  let usage = imageRules.NEWS_IMAGE_STORAGE_BYTES;
  let role = "ADMIN";
  const tx = {
    $queryRaw: async () => { events.push("lock"); return [{ key: "news.images.upload" }]; },
    user: { findUnique: async () => { events.push("actor"); return { role, emailVerified: true }; } },
    newsImage: { aggregate: async () => { events.push("quota"); return { _sum: { bytes: usage } }; }, create: async () => { events.push("create"); return { id: "a", width: 10, height: 10 }; } },
    auditLog: { create: async () => { events.push("audit"); } },
  };
  const exports = moduleSource("src/infrastructure/news/images.ts", {
    "@/core/domain/news/image": imageRules,
    "@/infrastructure/database/prisma": { prisma: { $transaction: (work: (tx: unknown) => unknown) => work(tx) } },
    "@/shared/server/http": { HttpError },
    "./image-processing": { readNewsImageBody: async () => new Uint8Array([1]), optimizeNewsImage: async () => ({ data: new Uint8Array([1]), width: 10, height: 10, bytes: 1 }) },
  });
  const upload = exports.uploadNewsImage as (id: string, request: Request) => Promise<unknown>;
  const request = () => new Request("https://coinsecret.io/api/admin/news/images", { method: "POST", headers: { "Content-Type": "image/png" }, body: "x" });
  await assert.rejects(upload("admin", request()), { status: 507 });
  assert.deepEqual(events, ["lock", "actor", "quota"]);
  events.length = 0; usage = 0; role = "USER";
  await assert.rejects(upload("admin", request()), { status: 403 });
  assert.deepEqual(events, ["lock", "actor"]);
  events.length = 0; role = "ADMIN";
  await upload("admin", request());
  assert.deepEqual(events, ["lock", "actor", "quota", "create", "audit"]);
});

test("only published image references are public; draft media requires an admin session", async () => {
  const id = "12345678-1234-4234-8234-123456789abc";
  let published = false;
  let role: string | null = null;
  let imageReads = 0;
  const exports = moduleSource("src/infrastructure/news/images.ts", {
    "@/core/domain/news/image": imageRules,
    "@/infrastructure/auth/current-user": { getCurrentUser: async () => role ? { role } : null },
    "@/infrastructure/database/prisma": { prisma: {
      newsArticle: { findFirst: async () => published ? { id: "article" } : null },
      newsImage: { findUnique: async () => { imageReads++; return { data: new Uint8Array([1]) }; } },
    } },
  });
  const read = exports.readNewsImage as (id: string) => Promise<unknown>;
  assert.equal(await read("bad-id"), null);
  assert.equal(await read(id), null);
  role = "USER"; assert.equal(await read(id), null);
  assert.equal(imageReads, 0);
  role = "ADMIN"; assert.ok(await read(id));
  role = null; published = true; assert.ok(await read(id));
  assert.equal(imageReads, 2);
});
