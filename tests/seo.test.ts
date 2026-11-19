import test from "node:test";
import assert from "node:assert/strict";

import robots from "@/app/robots";
import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";
import ts from "typescript";
import type { MetadataRoute } from "next";

function loadSitemap(articleSitemap: () => Promise<Array<{ slug: string; updatedAt: Date }>>) {
  const exports: { default?: () => Promise<MetadataRoute.Sitemap> } = {};
  runInNewContext(ts.transpileModule(readFileSync("src/app/sitemap.ts", "utf8"), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText, { exports, require: () => ({ articleSitemap }) });
  if (!exports.default) throw new Error("Sitemap not exported");
  return exports.default;
}
const loadSitemapWithArticle = () => loadSitemap(async () => [{ slug: "published-news", updatedAt: new Date("2026-11-19T00:00:00Z") }]);

test("robots.txt produces a valid configuration without throwing", () => {
  const config = robots();
  assert.equal(config.sitemap, "https://coinsecret.io/sitemap.xml");
  const rules = Array.isArray(config.rules) ? config.rules : [config.rules];
  const wildcard = rules.find((rule) => rule.userAgent === "*");
  assert.ok(wildcard, "a wildcard rule is required for every other crawler");
  const disallowed = [wildcard.disallow ?? []].flat();
  assert.ok(disallowed.includes("/api/"), "API routes should not be crawled");
  assert.ok(!disallowed.includes("/admin/") && !disallowed.includes("/account/"), "crawlers must reach page-level noindex directives");
});

test("the sitemap lists public routes and published article URLs with genuine modification dates", async () => {
  const entries = await loadSitemapWithArticle()();
  assert.equal(entries.length, 4);
  const urls = entries.map((entry) => entry.url);
  assert.ok(urls.includes("https://coinsecret.io/"), "landing page must be indexed");
  assert.ok(urls.includes("https://coinsecret.io/pricing"), "pricing must be indexed");
  for (const legal of ["terms", "privacy", "refund", "support"]) {
    assert.ok(!urls.includes(`https://coinsecret.io/${legal}`), `${legal} waits for publishing approval`);
  }
  assert.ok(urls.includes("https://coinsecret.io/news"));
  assert.ok(urls.includes("https://coinsecret.io/news/published-news"));
  assert.ok(entries.filter((entry) => !entry.url.includes("/news/")).every((entry) => entry.lastModified === undefined), "do not claim a content update on every request");
  // /patterns is an internal redirect to /signals (session-gated) and must stay out
  assert.equal(
    urls.some((url) => url.includes("/patterns")),
    false,
    "redirecting stub /patterns must not be submitted to search engines",
  );
  for (const url of urls) {
    const pathname = new URL(url).pathname;
    assert.equal(
      /^\/api\/|^\/admin\/|^\/account\/|^\/signals|^\/dashboard/.test(pathname),
      false,
      `${pathname} is behind a session and must not be advertised`,
    );
  }
});

test("a database outage keeps the static public routes in the sitemap", async () => {
  const entries = await loadSitemap(async () => { throw new Error("database unavailable"); })();
  const urls = [...entries.map((entry) => entry.url)];
  assert.deepEqual(urls, ["https://coinsecret.io/", "https://coinsecret.io/pricing", "https://coinsecret.io/news"],
    "article lookups must degrade to an empty list instead of failing the whole sitemap");
});
