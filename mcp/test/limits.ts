import assert from "node:assert/strict";
import { FixedWindowRateLimiter, parseContentLength, positiveIntEnv } from "../src/limits";

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
