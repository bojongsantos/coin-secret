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
  for (const path of ["/api/", "/admin/", "/account/"]) {
    assert.ok(disallowed.includes(path), `${path} must stay out of the index`);
  }
});

test("the sitemap lists only pages an anonymous visitor can read", () => {
  const entries = sitemap();
  assert.ok(entries.length > 0, "an empty sitemap tells crawlers nothing");
  const urls = entries.map((entry) => entry.url);
  assert.ok(urls.includes("https://coinsecret.io/"), "landing page must be indexed");
  assert.ok(urls.includes("https://coinsecret.io/pricing"), "pricing must be indexed");
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
