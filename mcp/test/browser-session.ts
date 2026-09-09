import assert from "node:assert/strict";
import { createServer } from "node:http";
import { ExternalIdentityBrowserPrincipalResolver } from "../src/browserSession";
import { InMemoryExternalIdentityRepository } from "../src/oauthIdentity";
import { WorkOSBrowserAuthAdapter, createWorkOSBrowserAuthRequestHandler, type WorkOSBrowserClient } from "../src/workosBrowserAuth";

async function main(): Promise<void> {
  const user = {
    id: "user_01_browser",
    email: "reader@example.test",
    firstName: "Arcana",
    lastName: "Reader",
    profilePictureUrl: "https://images.example.test/avatar.png",
  };
  const client: WorkOSBrowserClient = {
    getAuthorizationUrl({ state }) {
      const url = new URL("https://login.example.test/authorize");
      url.searchParams.set("state", state);
      return url.href;
    },
    async authenticateWithCode({ code }) {
      assert.equal(code, "good-code");
      return { user, sealedSession: "sealed-1" };
    },
    async loadSealedSession({ sessionData }) {
      return {
        async authenticate() {
          if (sessionData === "sealed-1" || sessionData === "sealed-2") return { authenticated: true, user };
          return { authenticated: false, reason: "invalid_jwt" };
        },
        async refresh() {
          if (sessionData === "expired") return { authenticated: true, user, sealedSession: "sealed-2" };
          return { authenticated: false, reason: "invalid_grant", retryable: false };
        },
        async getLogOutUrl() {
          return "https://login.example.test/logout";
        },
      };
    },
  };

  const adapter = new WorkOSBrowserAuthAdapter({
    apiKey: "sk_test_browser",
    clientId: "client_browser",
    cookiePassword: "0123456789abcdef0123456789abcdef",
    redirectUri: "http://127.0.0.1/auth/callback",
    issuer: "https://issuer.example.test/",
    secureCookies: false,
  }, client);
  const handler = createWorkOSBrowserAuthRequestHandler(adapter);
  const identities = new InMemoryExternalIdentityRepository();
  const expectedPrincipal = await identities.resolveOrCreate({ issuer: "https://issuer.example.test/", subject: user.id });
  const browserPrincipalResolver = new ExternalIdentityBrowserPrincipalResolver(adapter, identities);
  const server = createServer((req, res) => {
    const pathname = new URL(req.url ?? "/", `http://${req.headers.host ?? "localhost"}`).pathname;
    if (pathname === "/test/principal") {
      void browserPrincipalResolver.resolve(req, res).then((principal) => {
        res.writeHead(200, { "content-type": "application/json" });
        res.end(JSON.stringify(principal));
      });
      return;
    }
    void handler(req, res);
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("test server did not bind");
  const base = `http://127.0.0.1:${address.port}`;

  try {
    let response = await fetch(`${base}/auth/login?returnTo=${encodeURIComponent("/#/my-decks")}`, { redirect: "manual" });
    assert.equal(response.status, 302);
    const authUrl = new URL(response.headers.get("location")!);
    assert.equal(authUrl.origin, "https://login.example.test");
    const state = authUrl.searchParams.get("state");
    assert.ok(state);

    response = await fetch(`${base}/auth/callback?code=good-code&state=${encodeURIComponent(state!)}`, { redirect: "manual" });
    assert.equal(response.status, 303);
    assert.equal(response.headers.get("location"), "/#/my-decks");
    const setCookie = response.headers.get("set-cookie") ?? "";
    assert.match(setCookie, /^arcana-session=sealed-1;/);
    assert.match(setCookie, /HttpOnly/);
    assert.match(setCookie, /SameSite=Lax/);
    assert.doesNotMatch(setCookie, /Secure/);

    response = await fetch(`${base}/test/principal`, { headers: { cookie: "arcana-session=sealed-1" } });
    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), { id: expectedPrincipal }, "browser session and bearer identity mapping share the same opaque principal table");

    response = await fetch(`${base}/auth/session`, { headers: { cookie: "arcana-session=sealed-1" } });
    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), {
      authenticated: true,
      user: {
        displayName: "Arcana Reader",
        email: "reader@example.test",
        avatarUrl: "https://images.example.test/avatar.png",
      },
    });

    response = await fetch(`${base}/auth/session`, { headers: { cookie: "arcana-session=expired" } });
    assert.equal(response.status, 200);
    assert.equal((await response.json() as { authenticated: boolean }).authenticated, true);
    assert.match(response.headers.get("set-cookie") ?? "", /^arcana-session=sealed-2;/);

    const tampered = `${state!.slice(0, -1)}x`;
    response = await fetch(`${base}/auth/callback?code=good-code&state=${encodeURIComponent(tampered)}`, { redirect: "manual" });
    assert.equal(response.status, 400);

    response = await fetch(`${base}/auth/logout`, {
      method: "POST",
      headers: { cookie: "arcana-session=sealed-1" },
      redirect: "manual",
    });
    assert.equal(response.status, 303);
    assert.equal(response.headers.get("location"), "https://login.example.test/logout");
    assert.match(response.headers.get("set-cookie") ?? "", /Max-Age=0/);
  } finally {
    await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
