import assert from "node:assert/strict";
import type { IncomingMessage, ServerResponse } from "node:http";
import { ExternalIdentityBrowserPrincipalResolver } from "../src/browserSession";
import { InMemoryExternalIdentityRepository, OAuthPrincipalResolver } from "../src/oauthIdentity";

// Unit test of the provider-neutral domain boundary. better-auth.ts exercises actual auth.
const identity = { issuer: "https://arcana.example/api/auth", subject: "account-123" };
const identities = new InMemoryExternalIdentityRepository();
const browser = new ExternalIdentityBrowserPrincipalResolver({
  async authenticate(req) {
    return req.headers.cookie === "verified-session" ? { identity, email: "reader@example.test" } : null;
  },
}, identities);
const response = {} as ServerResponse;
assert.equal(await browser.resolve({ headers: {} } as IncomingMessage, response), null);
const principal = await browser.resolve({ headers: { cookie: "verified-session" } } as IncomingMessage, response);
assert.ok(principal?.id);
const bearer = new OAuthPrincipalResolver({async verify() { return { ...identity, scopes: ["decks:read"] }; }}, identities);
const fromMcp = await bearer.resolve({ method:"POST", url:"/mcp", headers:new Headers({authorization:"Bearer test"}) });
assert.equal(fromMcp?.id,principal?.id);
assert.notEqual(await identities.resolveOrCreate({...identity, subject:"different-user"}),principal?.id);
console.log("Provider-neutral browser and MCP principal bridge tests passed.");
