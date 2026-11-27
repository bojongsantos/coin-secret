import test from "node:test";
import assert from "node:assert/strict";
import { createSharedSetupReads } from "@/infrastructure/persistence/shared-setup-reads";
import type { ActiveSetupPort } from "@/core/application/ports/active-setup-port";

function fixture() {
  let time = 100;
  let reads = 0;
  let fail = false;
  const source: ActiveSetupPort = {
    async loadActive() { reads++; if (fail) throw new Error("offline"); return []; },
    async loadPublished() { reads++; if (fail) throw new Error("offline"); return null; },
    async loadRetiredZones() { return []; }, async persist() {},
  };
  const shared = createSharedSetupReads(source, () => time);
  return { ...shared, reads: () => reads, advance: () => { time += 15_001; }, fail: () => { fail = true; } };
}

test("simultaneous and repeated public setup reads share one bounded query", async () => {
  const f = fixture();
  await Promise.all(Array.from({ length: 30 }, () => f.store.loadActive(["BTCUSDT", "ETHUSDT"])));
  await f.store.loadActive(["ETHUSDT", "BTCUSDT"]);
  assert.equal(f.reads(), 1);
  f.advance(); await f.store.loadActive(["BTCUSDT", "ETHUSDT"]);
  assert.equal(f.reads(), 2);
});

test("publication identities stay isolated and writes invalidate cached misses", async () => {
  const f = fixture();
  await f.store.loadPublished?.("BTCUSDT", "first");
  await f.store.loadPublished?.("BTCUSDT", "second");
  await f.store.loadPublished?.("BTCUSDT", "first");
  assert.equal(f.reads(), 2);
  await f.store.persist([]);
  await f.store.loadPublished?.("BTCUSDT", "first");
  assert.equal(f.reads(), 3);
  f.clear(); await f.store.loadPublished?.("BTCUSDT", "first");
  assert.equal(f.reads(), 4);
});

test("failures are retried and aborted readers never receive cached success", async () => {
  const f = fixture(); f.fail();
  await assert.rejects(f.store.loadActive(["BTCUSDT"]));
  await assert.rejects(f.store.loadActive(["BTCUSDT"]));
  assert.equal(f.reads(), 2);
  const controller = new AbortController(); controller.abort();
  await assert.rejects(f.store.loadActive(["BTCUSDT"], controller.signal));
  assert.equal(f.reads(), 2);
});

test("one caller aborts promptly without cancelling another caller's shared query", async () => {
  let release: () => void = () => {};
  let calls = 0;
  const store: ActiveSetupPort = {
    async loadActive(_symbols, signal) {
      calls++; await new Promise<void>(resolve => { release = resolve; });
      signal?.throwIfAborted(); return [];
    }, async loadRetiredZones() { return []; }, async persist() {},
  };
  const shared = createSharedSetupReads(store);
  const controller = new AbortController();
  const cancelled = shared.store.loadActive(["BTCUSDT"], controller.signal);
  const waiting = shared.store.loadActive(["BTCUSDT"]);
  await Promise.resolve(); controller.abort();
  await assert.rejects(cancelled);
  release(); assert.deepEqual(await waiting, []);
  assert.equal(calls, 1);
});

test("invalidation during a read prevents late results repopulating the cache", async () => {
  let release: () => void = () => {};
  let calls = 0;
  const store: ActiveSetupPort = {
    async loadActive() { calls++; if (calls === 1) await new Promise<void>(resolve => { release = resolve; }); return []; },
    async loadRetiredZones() { return []; }, async persist() {},
  };
  const shared = createSharedSetupReads(store);
  const pending = shared.store.loadActive(["BTCUSDT"]);
  await Promise.resolve(); shared.clear(); release(); await pending;
  await shared.store.loadActive(["BTCUSDT"]);
  assert.equal(calls, 2);
});

test("a slow pending query stays shared until completion then receives its full TTL", async () => {
  let time = 0;
  let calls = 0;
  let release: () => void = () => {};
  const store: ActiveSetupPort = {
    async loadActive() { calls++; if (calls === 1) await new Promise<void>(resolve => { release = resolve; }); return []; },
    async loadRetiredZones() { return []; }, async persist() {},
  };
  const shared = createSharedSetupReads(store, () => time);
  const first = shared.store.loadActive(["BTCUSDT"]);
  await Promise.resolve(); time = 20_000;
  const second = shared.store.loadActive(["BTCUSDT"]);
  await Promise.resolve(); assert.equal(calls, 1);
  release(); await Promise.all([first, second]);
  time = 30_000; await shared.store.loadActive(["BTCUSDT"]);
  assert.equal(calls, 1);
  time = 35_001; await shared.store.loadActive(["BTCUSDT"]);
  assert.equal(calls, 2);
});
