import assert from "node:assert/strict";
import { Server } from "node:http";

// Keep production configuration/validation intact. Only this subprocess's real HTTP
// listener gets an OS-owned port; never reserve/release a port before spawning it.
assert.equal(typeof process.send, "function", "Readiness fixture requires an IPC channel");
const listen = Server.prototype.listen;
let bound = false;
Server.prototype.listen = function (this: Server, ...args: unknown[]) {
  assert.equal(bound, false, "Readiness fixture must bind exactly one HTTP server");
  assert.equal(args[0], Number(process.env.PORT));
  assert.equal(args[1], "127.0.0.1");
  assert.equal(typeof args[2], "function");
  assert.equal(args.length, 3);
  bound = true;
  this.once("listening", () => {
    const address = this.address();
    assert.ok(address && typeof address !== "string");
    process.send!({ type: "arcana-test-listening", address: address.address, port: address.port });
  });
  args[0] = 0;
  return Reflect.apply(listen, this, args);
} as typeof listen;

await import("../../src/http");
