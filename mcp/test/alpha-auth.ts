import assert from "node:assert/strict";
import { StaticBearerPrincipalResolver } from "../src/alphaAuth";

const resolver = new StaticBearerPrincipalResolver("correct horse battery staple", "principal-alpha");

assert.equal(resolver.resolve(request()), null, "no Authorization header must remain anonymous");
assert.deepEqual(resolver.resolve(request("Bearer correct horse battery staple")), { id: "principal-alpha" });
assert.deepEqual(resolver.resolve(request("bearer correct horse battery staple")), { id: "principal-alpha" });
assert.throws(() => resolver.resolve(request("Basic nope")), /Bearer token/);
assert.throws(() => resolver.resolve(request("Bearer wrong")), /Invalid bearer token/);
assert.throws(() => new StaticBearerPrincipalResolver("   "), /non-empty/);

function request(authorization?: string) {
  const headers = new Headers();
  if (authorization) headers.set("authorization", authorization);
  return { method: "POST", url: "/mcp", headers };
}
