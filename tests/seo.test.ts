import test from "node:test";
import assert from "node:assert/strict";

import robots from "@/app/robots";
import sitemap from "@/app/sitemap";

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

test("the sitemap lists only pages an anonymous visitor can read", () => {
  const entries = sitemap();
  assert.equal(entries.length, 2, "only approved public pages are submitted");
  const urls = entries.map((entry) => entry.url);
  assert.ok(urls.includes("https://coinsecret.io/"), "landing page must be indexed");
  assert.ok(urls.includes("https://coinsecret.io/pricing"), "pricing must be indexed");
  for (const legal of ["terms", "privacy", "refund", "support"]) {
    assert.ok(!urls.includes(`https://coinsecret.io/${legal}`), `${legal} waits for publishing approval`);
  }
  assert.ok(entries.every((entry) => entry.lastModified === undefined), "do not claim a content update on every request");
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
