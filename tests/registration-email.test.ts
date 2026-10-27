import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";
import ts from "typescript";
import blocklist from "@/config/disposable-email-domains.json";
import { registrationDomainRisk } from "@/core/domain/identity/registration-email";

const domains = new Set(blocklist.domains);
test("registration rejects reserved and disposable parents without blocking ordinary or business domains", () => {
  for (const email of ["a@example.com", "A@Sub.Example.org", "a@example.net", "a@demo.invalid", "a@demo.local", "a@demo.test"]) assert.equal(registrationDomainRisk(email, domains), "reserved", email);
  for (const email of ["a@maxxspace.com", " A@SUB.MAXXSPACE.COM ", "a@mailinator.com", "a@10minutemail.com"]) assert.equal(registrationDomainRisk(email, domains), "disposable", email);
  for (const email of ["a@gmail.com", "a@yahoo.com", "a@outlook.com", "a@proton.me", "a@coinsecret.io", "a@business.co.id", "a@example.com.business.co.id", "a@notmaxxspace.com"]) assert.equal(registrationDomainRisk(email, domains), null, email);
  assert.ok(domains.size > 5000);
  assert.match(blocklist.commit, /^[a-f0-9]{40}$/);
});

function fixture(options: { mx?: Array<{ exchange: string; priority: number }>; mxError?: string; ipv4?: string[]; ipv6?: string[]; addressError?: string; pending?: boolean } = {}) {
  const calls: string[] = [];
  let cancelled = 0;
  let expire!: () => void;
  const error = (code: string) => Object.assign(new Error("DNS fixture"), { code });
  class Resolver {
    async resolveMx() { calls.push("MX"); if (options.pending) return new Promise<never>(() => {}); if (options.mxError) throw error(options.mxError); return options.mx ?? [{ exchange: "mx.business.co.id", priority: 10 }]; }
    async resolve4() { calls.push("A"); if (options.addressError) throw error(options.addressError); return options.ipv4 ?? []; }
    async resolve6() { calls.push("AAAA"); if (options.addressError) throw error(options.addressError); return options.ipv6 ?? []; }
    cancel() { cancelled++; }
  }
  const dependencies: Record<string, unknown> = { "server-only": {}, "node:dns/promises": { Resolver }, "@/config/disposable-email-domains.json": { default: blocklist }, "@/core/domain/identity/registration-email": { registrationDomainRisk } };
  const exports: { registrationEmailIssue?: (email: string) => Promise<string | null> } = {};
  runInNewContext(ts.transpileModule(readFileSync("src/infrastructure/auth/registration-email.ts", "utf8"), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText, {
    exports, setTimeout: (callback: () => void, delay: number) => { assert.equal(delay, 4000); expire = callback; return 1; }, clearTimeout() {},
    require(name: string) { if (name in dependencies) return dependencies[name]; throw new Error(`Unexpected import ${name}`); },
  });
  return { check: exports.registrationEmailIssue!, calls, expire: () => expire(), cancelled: () => cancelled };
}

test("blocked registration domains make no DNS or external validation requests", async () => {
  const f = fixture();
  assert.equal(await f.check("a@example.com"), "reserved");
  assert.equal(await f.check("a@maxxspace.com"), "disposable");
  assert.equal(f.calls.length, 0);
});

test("email DNS accepts MX and SMTP implicit MX while rejecting null MX and missing domains", async () => {
  assert.equal(await fixture().check("a@business.co.id"), null);
  assert.equal(await fixture({ mxError: "ENODATA", ipv4: ["192.0.2.1"] }).check("a@business.co.id"), null);
  assert.equal(await fixture({ mx: [], ipv6: ["2001:db8::1"] }).check("a@business.co.id"), null);
  assert.equal(await fixture({ mx: [{ exchange: "", priority: 0 }], ipv4: ["192.0.2.1"] }).check("a@business.co.id"), "undeliverable");
  assert.equal(await fixture({ mxError: "ENOTFOUND" }).check("a@missing.co.id"), "undeliverable");
  assert.equal(await fixture({ mxError: "ENODATA", addressError: "ENODATA" }).check("a@missing.co.id"), "undeliverable");
});

test("transient DNS failures and the four second deadline remain retryable and cancel the resolver", async () => {
  assert.equal(await fixture({ mxError: "ESERVFAIL" }).check("a@business.co.id"), "unavailable");
  assert.equal(await fixture({ mxError: "ENODATA", addressError: "ETIMEOUT" }).check("a@business.co.id"), "unavailable");
  const f = fixture({ pending: true }); const pending = f.check("a@business.co.id"); f.expire();
  assert.equal(await pending, "unavailable"); assert.equal(f.cancelled(), 1);
});
