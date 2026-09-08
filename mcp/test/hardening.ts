import assert from "node:assert/strict";
import { FixedWindowRateLimiter, parseContentLength, positiveIntEnv } from "../src/limits";
import { jsonToolCallObserver, opaquePrincipalLogId } from "../src/observability";

const limiter = new FixedWindowRateLimiter(2, 1_000);
assert.deepEqual(limiter.check("a", 0), { allowed: true, retryAfterSeconds: 0 });
assert.deepEqual(limiter.check("a", 100), { allowed: true, retryAfterSeconds: 0 });
assert.deepEqual(limiter.check("a", 200), { allowed: false, retryAfterSeconds: 1 });
assert.deepEqual(limiter.check("b", 200), { allowed: true, retryAfterSeconds: 0 });
assert.deepEqual(limiter.check("a", 1_001), { allowed: true, retryAfterSeconds: 0 });

assert.equal(parseContentLength("123"), 123);
assert.equal(parseContentLength(["42"]), 42);
assert.equal(parseContentLength("nope"), undefined);
assert.equal(parseContentLength(undefined), undefined);
assert.equal(positiveIntEnv(undefined, 5, "X"), 5);
assert.equal(positiveIntEnv("9", 5, "X"), 9);
assert.throws(() => positiveIntEnv("0", 5, "X"), /positive integer/);

const principalId = "private-principal-do-not-log";
let logged = "";
const originalError = console.error;
try {
  console.error = (...args: unknown[]) => { logged = args.map(String).join(" "); };
  jsonToolCallObserver({ transport: "http", principalId })({ tool: "list_decks", ok: true, durationMs: 7 });
} finally {
  console.error = originalError;
}
const event = JSON.parse(logged) as Record<string, unknown>;
assert.equal(event.event, "mcp_tool_call");
assert.equal(event.transport, "http");
assert.equal(event.tool, "list_decks");
assert.equal(event.ok, true);
assert.equal(event.durationMs, 7);
assert.equal(event.principal, opaquePrincipalLogId(principalId));
assert.equal(logged.includes(principalId), false, "logs must not contain raw principal ids");
assert.deepEqual(Object.keys(event).sort(), ["durationMs", "event", "ok", "principal", "tool", "transport", "ts"].sort());
