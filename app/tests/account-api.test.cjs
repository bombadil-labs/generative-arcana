const test = require("node:test");
const assert = require("node:assert/strict");
const { accountRequest, AccountRequestError, safeAccountReturnTo, parseAccountRoute, accountHref, validatedOAuthRedirect } = require("../.test-build/auth/api.js");

test("account return paths allow only app fragments", () => {
  for (const value of ["/#/", "/#/my-decks", "/#/community", "/#/deck/local-123/read", "/#/account/connections"]) assert.equal(safeAccountReturnTo(value), value);
  for (const value of [undefined, "", "https://evil.test", "//evil.test", "/\\evil.test", "/auth/logout", "/api/auth/oauth2/authorize?redirect_uri=https://evil.test", "/#/account/login?returnTo=https://evil.test", "/#/deck/%5cevil", "/#/deck/%0aevil", "/#/deck/%00evil", "/#/deck/%xx", "/#/communityevil"]) assert.equal(safeAccountReturnTo(value), "/#/my-decks", String(value));
});

test("OAuth continuations are encoded once and recovery parses Better Auth's outer parameters", () => {
  const query = "client_id=test&redirect_uri=https%3A%2F%2Fclient.test%2Fcallback&sig=abc%2Bdef";
  const route = parseAccountRoute(accountHref("login", new URLSearchParams({ oauth_query: query })).slice(2));
  assert.equal(route.page, "login");
  assert.equal(route.params.get("oauth_query"), query);
  const reset = parseAccountRoute("/account/reset-password?returnTo=%2F%23%2Fmy-decks", "?token=one-use&error=expired");
  assert.equal(reset.params.get("token"), "one-use");
  assert.equal(reset.params.get("error"), "expired");
  assert.equal(parseAccountRoute("/deck/local-123/read", "?token=irrelevant"), null);
  assert.equal(parseAccountRoute("/account/not-a-page"), null);
});

test("OAuth response navigation matches the verified client destination", () => {
  const context = { redirectUri: "https://client.test/oauth/callback" };
  const origin = "https://arcana.test";
  assert.equal(validatedOAuthRedirect("/auth/consent?oauth_query=signed", context, origin), "https://arcana.test/auth/consent?oauth_query=signed");
  assert.equal(validatedOAuthRedirect("https://client.test/oauth/callback?code=one-use&state=original", context, origin), "https://client.test/oauth/callback?code=one-use&state=original");
  for (const value of ["https://evil.test/oauth/callback", "https://client.test/other", "https://client.test@evil.test/oauth/callback", "javascript:alert(1)", "data:text/html,unsafe", "https://user:secret@client.test/oauth/callback"]) assert.throws(() => validatedOAuthRedirect(value, context, origin));
});

test("OAuth native callbacks match the exact verified scheme, path and fixed query", () => {
  const origin = "https://arcana.test";
  const context = { redirectUri: "com.example.client:/oauth/callback?tenant=original" };
  assert.equal(validatedOAuthRedirect("com.example.client:/oauth/callback?tenant=original&code=one-use", context, origin), "com.example.client:/oauth/callback?tenant=original&code=one-use");
  for (const value of ["com.evil.client:/oauth/callback?tenant=original&code=x", "com.example.client://oauth/callback?tenant=original", "com.example.client:/other?tenant=original", "com.example.client:/oauth/callback?tenant=other", "com.example.client:/oauth/callback?code=x", "com.example.client:/oauth/callback?tenant=original#code=x", "javascript:alert(1)", "file:/oauth/callback", "myapp:/oauth/callback"]) assert.throws(() => validatedOAuthRedirect(value, context, origin));
  const loopback = { redirectUri: "http://127.0.0.1:4567/callback" };
  assert.equal(validatedOAuthRedirect("http://127.0.0.1:4567/callback?code=x", loopback, origin), "http://127.0.0.1:4567/callback?code=x");
  assert.throws(() => validatedOAuthRedirect("http://127.0.0.1:4568/callback?code=x", loopback, origin));
  assert.throws(() => validatedOAuthRedirect("http://example.com/callback?code=x", { redirectUri: "http://example.com/callback" }, origin));
});

test("account requests post JSON with same-origin cookies and no automatic redirects", async () => {
  const original = global.fetch;
  const controller = new AbortController();
  global.fetch = async (input, init) => {
    assert.equal(input, "/api/auth/sign-in/email");
    assert.equal(init.method, "POST");
    assert.equal(init.credentials, "same-origin");
    assert.equal(init.cache, "no-store");
    assert.equal(init.redirect, "error");
    assert.equal(init.signal, controller.signal);
    assert.equal(init.headers["content-type"], "application/json");
    assert.deepEqual(JSON.parse(init.body), { email: "a@example.test", password: "example passphrase", oauth_query: "signed&query" });
    return Response.json({ user: { name: "A" } });
  };
  try {
    const value = await accountRequest("/api/auth/sign-in/email", { body: { email: "a@example.test", password: "example passphrase", oauth_query: "signed&query" }, signal: controller.signal });
    assert.equal(value.user.name, "A");
    await assert.rejects(accountRequest("https://evil.test/api/auth/sign-in/email", { body: {} }), /Invalid account endpoint/);
    await assert.rejects(accountRequest("//evil.test/auth/sign-out", { body: {} }), /Invalid account endpoint/);
    await assert.rejects(accountRequest("/api/auth/../other", { body: {} }), /Invalid account endpoint/);
  } finally { global.fetch = original; }
});

test("account errors preserve actionable codes and do not mistake static HTML for success", async () => {
  const original = global.fetch;
  try {
    global.fetch = async () => Response.json({ code: "EMAIL_NOT_VERIFIED", message: "Email is not verified" }, { status: 403 });
    await assert.rejects(accountRequest("/api/auth/sign-in/email", { body: {} }), (error) => error instanceof AccountRequestError && error.code === "EMAIL_NOT_VERIFIED" && error.status === 403);
    global.fetch = async () => new Response("<!doctype html><title>Static app</title>", { headers: { "content-type": "text/html" } });
    await assert.rejects(accountRequest("/api/auth/sign-up/email", { body: {} }), /Accounts are not available/);
    global.fetch = async () => Response.json({ message: "Internal details" }, { status: 429 });
    await assert.rejects(accountRequest("/api/auth/request-password-reset", { body: {} }), /Too many attempts/);
    global.fetch = async () => Response.json({ message: "Email delivery is not configured" }, { status: 503 });
    await assert.rejects(accountRequest("/api/auth/send-verification-email", { body: {} }), /Email delivery is not configured/);
  } finally { global.fetch = original; }
});
