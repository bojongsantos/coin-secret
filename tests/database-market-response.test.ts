import test from "node:test";
import assert from "node:assert/strict";
import { once } from "node:events";
import { createServer, type Socket, type AddressInfo } from "node:net";
import { Pool } from "pg";

function message(type: string, body: Buffer): Buffer {
  const length = Buffer.alloc(4);
  length.writeInt32BE(body.length + 4);
  return Buffer.concat([Buffer.from(type), length, body]);
}

test("native pg evicts a connected server that stops responding and the next market SELECT recovers", async () => {
  const sockets = new Set<Socket>();
  let connections = 0;
  const server = createServer((socket) => {
    sockets.add(socket);
    socket.on("close", () => sockets.delete(socket));
    const connection = ++connections;
    let startup = true;
    let input = Buffer.alloc(0);
    socket.on("data", (bytes) => {
      input = Buffer.concat([input, bytes]);
      if (startup) {
        if (input.length < 4 || input.length < input.readInt32BE(0)) return;
        input = input.subarray(input.readInt32BE(0));
        startup = false;
        socket.write(Buffer.concat([message("R", Buffer.alloc(4)), message("Z", Buffer.from("I"))]));
      }
      // A real socket accepts the first SELECT but never acknowledges it.
      // The replacement connection returns an ordinary empty SELECT result.
      if (input[0] === 81 && connection > 1) {
        socket.write(Buffer.concat([message("C", Buffer.from("SELECT 0\0")), message("Z", Buffer.from("I"))]));
        input = Buffer.alloc(0);
      }
    });
  });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const address = server.address() as AddressInfo;
  const pool = new Pool({ host: "127.0.0.1", port: address.port, user: "test", database: "test", ssl: false,
    max: 1, connectionTimeoutMillis: 1000, query_timeout: 100 });
  try {
    await assert.rejects(pool.query("SELECT 1"), /Query read timeout/);
    assert.equal(pool.totalCount, 0, "the failed native connection must be removed rather than kept busy");
    const recovered = await pool.query("SELECT 1");
    assert.equal(recovered.command, "SELECT");
    assert.equal(connections, 2, "recovery requires a fresh connection");
  } finally {
    await pool.end();
    for (const socket of sockets) socket.destroy();
    await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  }
});
