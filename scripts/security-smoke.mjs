import assert from "node:assert/strict";

const baseUrl = (process.env.SECURITY_BASE_URL ?? "http://localhost:3000").replace(/\/$/, "");

const checks = [];

async function request(path, init = {}) {
  const response = await fetch(`${baseUrl}${path}`, {
    redirect: "manual",
    ...init,
  });
  const body = await response.text();
  return { body, response };
}

function record(name, check) {
  checks.push(
    Promise.resolve()
      .then(check)
      .then(() => ({ name, passed: true }))
      .catch((error) => ({ error, name, passed: false })),
  );
}

function assertNoLeak(body) {
  assert.doesNotMatch(
    body,
    /DATABASE_URL|BETTER_AUTH_SECRET|MIDTRANS_SERVER_KEY|NOWPAYMENTS_API_KEY|(?:Error|Exception):\s.*\n\s+at\s/,
  );
}

for (const path of ["/", "/login", "/dashboard"]) {
  record(`security headers on ${path}`, async () => {
    const { response } = await request(path);
    assert.ok([200, 302, 303, 307, 308].includes(response.status));
    assert.equal(response.headers.get("x-content-type-options"), "nosniff");
    assert.equal(response.headers.get("x-frame-options"), "DENY");
    assert.equal(response.headers.get("x-permitted-cross-domain-policies"), "none");
    assert.equal(response.headers.get("cross-origin-resource-policy"), "same-origin");
    assert.equal(response.headers.get("referrer-policy"), "strict-origin-when-cross-origin");
    assert.match(response.headers.get("permissions-policy") ?? "", /camera=\(\)/);
    assert.match(response.headers.get("content-security-policy") ?? "", /frame-ancestors 'none'/);
    assert.match(response.headers.get("strict-transport-security") ?? "", /max-age=63072000/);
  });
}

for (const path of [
  "/api/admin/overview",
  "/api/admin/users",
  "/api/admin/payments",
  "/api/admin/audit-logs",
  "/api/admin/setup-results",
  "/api/admin/feature-gates",
  "/api/billing/history",
]) {
  record(`anonymous access rejected by ${path}`, async () => {
    const { body, response } = await request(path);
    assert.ok([401, 403].includes(response.status), `${path} returned ${response.status}`);
    assertNoLeak(body);
  });
}

for (const path of ["/.env", "/.git/config", "/package.json"]) {
  record(`sensitive file is not served at ${path}`, async () => {
    const { body, response } = await request(path);
    assert.ok([403, 404].includes(response.status), `${path} returned ${response.status}`);
    assertNoLeak(body);
  });
}

record("checkout rejects an anonymous malformed request", async () => {
  const { body, response } = await request("/api/billing/checkout", {
    body: "{}",
    headers: { "content-type": "application/json" },
    method: "POST",
  });
  assert.ok([401, 403].includes(response.status), `checkout returned ${response.status}`);
  assertNoLeak(body);
});

record("an untrusted origin receives no CORS grant", async () => {
  const { response } = await request("/api/admin/overview", {
    headers: { origin: "https://attacker.invalid" },
  });
  assert.equal(response.headers.get("access-control-allow-origin"), null);
});

record("unsupported destructive method cannot bypass authorization", async () => {
  const { body, response } = await request("/api/admin/users/not-a-user", {
    method: "DELETE",
  });
  assert.ok([401, 403, 405].includes(response.status), `DELETE returned ${response.status}`);
  assertNoLeak(body);
});

const results = await Promise.all(checks);
const failures = results.filter((result) => !result.passed);

for (const result of results) {
  if (result.passed) {
    console.log(`PASS ${result.name}`);
  } else {
    console.error(`FAIL ${result.name}: ${result.error.message}`);
  }
}

if (failures.length > 0) {
  process.exitCode = 1;
} else {
  console.log(`Security smoke passed: ${results.length}/${results.length}`);
}
