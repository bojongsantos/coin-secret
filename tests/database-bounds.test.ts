import test from "node:test";
import assert from "node:assert/strict";
import { databaseAdapterOptions, databaseConnectionString } from "@/infrastructure/database/adapter";

const local = "mysql://test-user:test-password@127.0.0.1:3306/test-database";

test("a staged MySQL connection takes precedence without changing the rollback connection", () => {
  const original = "postgresql://legacy@localhost/legacy";
  const environment = { DATABASE_URL: original, MYSQL_DATABASE_URL: local };
  assert.equal(databaseConnectionString(environment), local);
  assert.equal(environment.DATABASE_URL, original);
  assert.equal(databaseConnectionString({ DATABASE_URL: local }), local);
  assert.throws(() => databaseConnectionString({}));
});

test("MariaDB pool options bound actual connect, checkout, statements and lock waits", () => {
  const options = databaseAdapterOptions(local);
  assert.equal(options.connectTimeout, 10_000);
  assert.equal(options.acquireTimeout, 10_000);
  assert.equal(options.connectionLimit, 5);
  assert.equal(options.timezone, "Z");
  assert.deepEqual(options.initSql, ["SET SESSION max_statement_time=15", "SET SESSION innodb_lock_wait_timeout=5"]);
  assert.equal(options.queryTimeout, undefined, "server cancellation owns write deadlines");
  assert.equal(options.socketTimeout, undefined);
});

test("market SELECTs use a separate server-enforced read-only pool", () => {
  const options = databaseAdapterOptions(local, "market-read");
  assert.equal(options.connectionLimit, 2);
  assert.equal(options.socketTimeout, 20_000);
  assert.ok(Array.isArray(options.initSql));
  assert.ok(options.initSql.includes("SET SESSION TRANSACTION READ ONLY"));
  assert.equal(options.resetAfterUse, true, "native reset reapplies initialization SQL before connection reuse");
});

test("scan transactions retain server idle cancellation and their own small pool", () => {
  const options = databaseAdapterOptions(local, "signals-write");
  assert.equal(options.connectionLimit, 2);
  assert.ok(Array.isArray(options.initSql));
  assert.ok(options.initSql.includes("SET SESSION idle_transaction_timeout=45"));
  assert.equal(options.socketTimeout, undefined);
});

test("remote database connections validate TLS and credentials never enter SQL", () => {
  const options = databaseAdapterOptions("mysql://user:p%40ss%3Aword@srv.example.com:3307/data");
  assert.equal(options.password, "p@ss:word");
  assert.equal(options.port, 3307);
  assert.deepEqual(options.ssl, { rejectUnauthorized: true });
  assert.doesNotMatch(JSON.stringify(options.initSql), /user|p@ss/);
  assert.equal(databaseAdapterOptions(local).ssl, undefined);
  assert.throws(() => databaseAdapterOptions("postgresql://user:secret@127.0.0.1/data"), /MySQL/);
});
