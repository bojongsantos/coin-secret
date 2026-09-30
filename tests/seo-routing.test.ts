import test from "node:test";
import assert from "node:assert/strict";

import nextConfig from "../next.config";

test("www permanently redirects to the canonical host", async () => {
  const redirects = await nextConfig.redirects?.();
  assert.ok(redirects?.some((redirect) =>
    redirect.source === "/:path*"
    && redirect.destination === "https://coinsecret.io/:path*"
    && redirect.permanent
    && redirect.has?.some((condition) => condition.type === "host" && condition.value === "www.coinsecret.io"),
  ));
});

test("application, auth, and draft legal pages send noindex while approved pages remain indexable", async () => {
  const rules = await nextConfig.headers?.();
  assert.ok(rules);
  const noindexPaths = ["/dashboard", "/signals", "/scanner", "/analysis", "/patterns", "/account", "/admin", "/login", "/register", "/forgot-password", "/reset-password", "/verify-email", "/terms", "/privacy", "/refund", "/support"];
  for (const path of noindexPaths) {
    const match = rules.find((rule) => rule.source === path || (path === "/admin" && rule.source === "/admin/:path*"));
    assert.ok(match?.headers.some((header) => header.key === "X-Robots-Tag" && header.value === "noindex"), path);
  }
  for (const path of ["/", "/pricing"]) {
    assert.ok(!rules.some((rule) => rule.source === path && rule.headers.some((header) => header.key === "X-Robots-Tag")), path);
  }
});
