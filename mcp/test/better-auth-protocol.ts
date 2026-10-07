import assert from "node:assert/strict";
import { decodeJwt, decodeProtectedHeader, importJWK, SignJWT } from "jose";
import { symmetricDecrypt } from "better-auth/crypto";
import { Readable } from "node:stream";
import type { IncomingMessage, ServerResponse } from "node:http";
import { fetchClientMetadataResource } from "@better-auth/cimd/node";
import { Pool, types } from "pg";
import { createArcanaBetterAuth, createArcanaBetterAuthOptions, createBetterAuthConfigurationFromEnv, AUTH_TABLE_NAMES } from "../src/betterAuth.js";
import { createAuthEmailSender } from "../src/authEmail.js";
import { AUTH_POSTGRES_TYPES } from "../src/authPostgres.js";
import { createBetterAuthHarness, AUTH_TEST_ORIGIN, AUTH_TEST_PASSWORD } from "./better-auth-fixtures.js";

const documents = new Map<string, Record<string, unknown>>();
let metadataFetches = 0;
const h = await createBetterAuthHarness({ fetchClientMetadata: async (input) => {
  const url = input instanceof Request ? input.url : input.toString();
  metadataFetches++;
  const document = documents.get(url);
  return document ? Response.json(document, { headers: { "cache-control": "max-age=60" } }) : new Response(null, { status: 404 });
} });
const mustReject = async (token: string) => assert.rejects(() => h.runtime.bearerVerifier.verify(token), /invalid, expired, or revoked/);
const refresh = async (clientId: string, token: string, resource = h.runtime.resource) => h.request("/api/auth/oauth2/token", { form: new URLSearchParams({ grant_type: "refresh_token", client_id: clientId, refresh_token: token, resource }) });
const oauthFailure = async (response: Response, error: string) => {
  if (response.headers.has("location")) assert.equal(new URL(response.headers.get("location")!).searchParams.get("error"), error);
  else { const body = await response.json(); assert.equal(body.error, error, JSON.stringify(body)); }
};
try {
  for (const returnTo of ["/parlor", "/parlor/"]) {
    const response = await h.request(`/auth/login?${new URLSearchParams({ returnTo })}`);
    assert.equal(response.status, 303);
    const destination = new URL(response.headers.get("location")!);
    assert.equal(destination.origin, AUTH_TEST_ORIGIN);
    assert.equal(destination.pathname, "/");
    assert.equal(destination.hash, "#/account/login?returnTo=%2Fparlor");
    assert.equal(response.headers.get("cache-control"), "no-store");
  }
  for (const returnTo of ["/parlor?question=private", "/parlor#private", "/parlor/../elsewhere", "/%70arlor", "//evil.example/parlor", "https://evil.example/parlor", "/parlor\\evil", "/parlor\n"]) {
    const response = await h.request(`/auth/login?${new URLSearchParams({ returnTo })}`);
    assert.equal(response.status, 400, "invalid literal return destination must fail closed");
    assert.equal(response.headers.get("location"), null);
  }
  const ordinaryLogin = await h.request("/auth/login");
  assert.equal(new URL(ordinaryLogin.headers.get("location")!).hash, "#/account/login?returnTo=%2F%23%2Fmy-decks");
  const timestamp = "1790867532395";
  assert.equal(types.getTypeParser(types.builtins.INT8, "text")(timestamp), timestamp, "global pg int8 parser must remain unchanged");
  assert.equal(AUTH_POSTGRES_TYPES.getTypeParser(types.builtins.INT8, "text")(timestamp), BigInt(timestamp));
  assert.equal(AUTH_POSTGRES_TYPES.getTypeParser(types.builtins.INT8)("9223372036854775807"), 9223372036854775807n, "int8 decoding must not lose precision");
  assert.equal(AUTH_POSTGRES_TYPES.getTypeParser(types.builtins.INT4, "text"), types.getTypeParser(types.builtins.INT4, "text"), "count stays a normal integer");
  assert.equal(AUTH_POSTGRES_TYPES.getTypeParser(types.builtins.INT8, "binary"), types.getTypeParser(types.builtins.INT8, "binary"));
  const poolOptions = createArcanaBetterAuthOptions({ baseURL: AUTH_TEST_ORIGIN, resource: `${AUTH_TEST_ORIGIN}/mcp`, secret: "test-only-not-a-production-secret-0123456789", databaseUrl: "postgres://localhost/unused_test" }, { sendEmail: async () => {} });
  assert.ok(poolOptions.database instanceof Pool);
  assert.equal(poolOptions.database.options.types, AUTH_POSTGRES_TYPES, "production auth pool must use the scoped parser");
  await poolOptions.database.end(); // Pool construction does not connect.
  assert.throws(() => createArcanaBetterAuth({ baseURL: AUTH_TEST_ORIGIN, resource: `${AUTH_TEST_ORIGIN}/mcp`, secret: "short" }), /32/);
  assert.throws(() => createArcanaBetterAuth({ baseURL: AUTH_TEST_ORIGIN, resource: `${AUTH_TEST_ORIGIN}/mcp`, secret: "x".repeat(32) }), /SMTP/);
  assert.throws(() => createAuthEmailSender({ host: "smtp.example", from: "arcana@example", port: 587, secure: false, user: "alone" }), /together/);
  assert.throws(() => createBetterAuthConfigurationFromEnv({ BETTER_AUTH_URL: AUTH_TEST_ORIGIN, BETTER_AUTH_SECRET: "x".repeat(32), DATABASE_URL: "postgres://localhost/test" }), /SMTP_HOST/);
  for (const path of ["/.well-known/oauth-authorization-server/api/auth", "/.well-known/oauth-authorization-server", "/api/auth/.well-known/oauth-authorization-server"]) {
    const response = await h.request(path); assert.equal(response.status, 200, path);
    const metadata = await response.json();
    assert.equal(metadata.issuer, h.runtime.issuer);
    assert.deepEqual(metadata.code_challenge_methods_supported, ["S256"]);
    assert.deepEqual(metadata.grant_types_supported, ["authorization_code", "refresh_token"]);
    assert.equal(metadata.registration_endpoint, undefined);
    assert.equal(metadata.client_id_metadata_document_supported, true);
  }
  const protectedMetadata = await (await h.request("/.well-known/oauth-protected-resource/mcp")).json();
  assert.equal(protectedMetadata.resource, h.runtime.resource);
  assert.deepEqual(protectedMetadata.scopes_supported, ["decks:read", "decks:write"]);
  const dcr = await h.request("/api/auth/oauth2/register", { body: { client_name: "No open registration", redirect_uris: ["https://client.example/callback"] } });
  assert.ok(dcr.status >= 400);
  const badOrigin = await h.runtime.handler(new Request(`${AUTH_TEST_ORIGIN}/api/auth/sign-up/email`, { method: "POST", headers: { origin: "https://evil.example", "content-type": "application/json", "x-arcana-client-ip": "203.0.113.9" }, body: JSON.stringify({ email: "blocked@example.test", name: "Blocked", password: AUTH_TEST_PASSWORD }) }));
  assert.equal(badOrigin.status, 403);

  const unverified = await h.request("/api/auth/sign-up/email", { body: { email: "unverified@example.test", name: "Unverified", password: AUTH_TEST_PASSWORD } });
  assert.equal(unverified.status, 200);
  const notLoggedIn = await h.request("/api/auth/sign-in/email", { body: { email: "unverified@example.test", password: AUTH_TEST_PASSWORD } });
  assert.equal(notLoggedIn.status, 403);
  assert.ok(!notLoggedIn.headers.getSetCookie().some((cookie) => cookie.includes("session_token")));
  const alice = await h.signupVerify("alice@example.test");
  assert.deepEqual(await (await h.request("/auth/session")).json(), { authenticated: false });
  const aliceSession = await (await h.request("/auth/session", { cookie: alice.cookie })).json();
  assert.equal(aliceSession.authenticated, true); assert.equal(aliceSession.user.emailVerified, true);
  assert.equal(aliceSession.mcpUrl, h.runtime.resource, "signed-in setup uses the configured canonical resource");

  assert.equal(aliceSession.accountId, alice.user.id, "browser continuity uses account identity, never an email or a session secret");
  const signedIn = await h.request("/api/auth/sign-in/email", { body: { email: alice.user.email, password: AUTH_TEST_PASSWORD } });
  const cookieHeader = signedIn.headers.getSetCookie().find((value) => value.includes("session_token"))!;
  assert.match(cookieHeader, /HttpOnly/i); assert.match(cookieHeader, /Secure/i); assert.match(cookieHeader, /SameSite=Lax/i);
  assert.ok((await h.request("/api/auth/token", { cookie: alice.cookie })).status >= 400);
  const bob = await h.signupVerify("bob@example.test");
  const client = await h.registerClient();
  const start = await h.startAuthorization(undefined, client.clientId);
  assert.equal(start.response.status, 302); assert.ok(start.location?.includes("/auth/login?"));
  const anonymousContext = await h.request(`/auth/oauth/context?${new URLSearchParams({ oauth_query: start.oauthQuery })}`);
  assert.equal(anonymousContext.status, 200, await anonymousContext.clone().text());
  assert.equal((await anonymousContext.json()).redirectUri, client.redirectUri);
  const badContext = await h.request(`/auth/oauth/context?${new URLSearchParams({ oauth_query: start.oauthQuery.replace("decks%3Aread", "decks%3Aroot") })}`);
  assert.equal(badContext.status, 400);
  const continuation = await h.request("/api/auth/sign-in/email", { body: { email: alice.user.email, password: AUTH_TEST_PASSWORD, oauth_query: start.oauthQuery, callbackURL: `${AUTH_TEST_ORIGIN}/#/account/verify-email?verified=1` } });
  assert.equal(continuation.status, 200, await continuation.clone().text());
  const continued = await continuation.json(); assert.equal(continued.redirect, true); assert.ok(continued.url.includes("/auth/consent?"));
  for (const [override, error] of [
    [{ code_challenge: null, code_challenge_method: null }, "invalid_request"],
    [{ code_challenge_method: "plain" }, "invalid_request"],
    [{ resource: "https://wrong.example/mcp" }, "invalid_target"],
    [{ resource: null }, "invalid_target"],
    [{ scope: "decks:admin" }, "invalid_scope"],
    [{ redirect_uri: "https://evil.example/callback" }, "invalid_redirect_uri"],
  ] as const) {
    const result = await h.startAuthorization(alice.cookie, client.clientId, undefined, override);
    if (error === "invalid_redirect_uri") assert.ok(result.response.status >= 400 || !result.location?.startsWith("https://evil.example"));
    else await oauthFailure(result.response, error);
  }
  const deny = await h.startAuthorization(alice.cookie, client.clientId);
  const denial = await h.request("/api/auth/oauth2/consent", { cookie: alice.cookie, body: { accept: false, oauth_query: deny.oauthQuery } });
  assert.equal(new URL((await denial.json()).url).searchParams.get("error"), "access_denied");
  const result = await h.authorize(alice.cookie, client.clientId);
  const claims = decodeJwt(result.tokens.access_token);
  assert.equal(claims.aud, h.runtime.resource); assert.equal(claims.iss, h.runtime.issuer); assert.equal(claims.sub, alice.user.id);
  assert.equal(claims.exp! - claims.iat!, 300); assert.equal(typeof claims.arcana_consent_id, "string");
  assert.deepEqual((await h.runtime.bearerVerifier.verify(result.tokens.access_token)).scopes, ["decks:read", "decks:write", "offline_access"]);
  assert.ok(result.tokens.refresh_token);
  // Mint deliberately bad claims with the real test provider key: issuer/audience/expiry checks
  // must reject even cryptographically valid signatures, rather than merely tampered tokens.
  const signingContext = await h.runtime.auth.$context;
  const kid = decodeProtectedHeader(result.tokens.access_token).kid!;
  const keyRow = await signingContext.adapter.findOne<{ privateKey: string }>({ model: "jwks", where: [{ field: "id", value: kid }] });
  assert.ok(keyRow);
  const privateJwk = JSON.parse(await symmetricDecrypt({ key: "test-only-not-a-production-secret-0123456789", data: JSON.parse(keyRow.privateKey) }));
  const signingKey = await importJWK(privateJwk, "ES256");
  for (const bad of [
    { aud: "https://other.example/mcp" }, { aud: [h.runtime.resource, "https://other.example/mcp"] },
    { iss: "https://other.example/api/auth" }, { iat: claims.iat! - 600, exp: claims.iat! - 300 },
    { exp: claims.iat! + 3600 }, { scope: "decks:admin" },
  ]) await mustReject(await new SignJWT({ ...claims, ...bad }).setProtectedHeader({ alg: "ES256", typ: "at+jwt", kid }).sign(signingKey));

  await mustReject(result.tokens.access_token.slice(0, -8) + "invalid!");
  await oauthFailure(await h.exchange(client.clientId, result.code, result.verifier), "invalid_grant");
  const invalidPkce = await h.startAuthorization(alice.cookie, client.clientId, "decks:read", { prompt: "consent" });
  const consent = await h.request("/api/auth/oauth2/consent", { cookie: alice.cookie, body: { accept: true, oauth_query: invalidPkce.oauthQuery } });
  const code = new URL((await consent.json()).url).searchParams.get("code")!;
  await oauthFailure(await h.exchange(client.clientId, code, "x".repeat(43)), "invalid_request");

  const connections = (await (await h.request("/auth/connections", { cookie: alice.cookie })).json()).clients;
  const consentId = connections.find((value: { clientId: string }) => value.clientId === client.clientId).id;
  const stolenRevoke = await h.request("/auth/connections/revoke", { cookie: bob.cookie, body: { id: consentId } });
  assert.equal(stolenRevoke.status, 404);
  const csrfRevoke = await h.runtime.handler(new Request(`${AUTH_TEST_ORIGIN}/auth/connections/revoke`, { method: "POST", headers: { cookie: alice.cookie, "content-type": "application/json", origin: "https://evil.example" }, body: JSON.stringify({ id: consentId }) }));
  assert.equal(csrfRevoke.status, 403);

  const refreshable = await h.authorize(alice.cookie, client.clientId);
  const rotatedResponse = await refresh(client.clientId, refreshable.tokens.refresh_token!);
  assert.equal(rotatedResponse.status, 200, await rotatedResponse.clone().text());
  const rotated = await rotatedResponse.json(); assert.notEqual(rotated.refresh_token, refreshable.tokens.refresh_token);
  await h.runtime.bearerVerifier.verify(rotated.access_token);
  await oauthFailure(await refresh(client.clientId, refreshable.tokens.refresh_token!), "invalid_grant");
  const fresh = await h.authorize(alice.cookie, client.clientId);
  const revokedJwt = await h.request("/api/auth/oauth2/revoke", { form: new URLSearchParams({ client_id: client.clientId, token: fresh.tokens.access_token, token_type_hint: "access_token" }) });
  assert.equal(revokedJwt.status, 400); assert.equal((await revokedJwt.json()).error, "unsupported_token_type");
  const pendingStart = await h.startAuthorization(alice.cookie, client.clientId, "decks:read offline_access", { prompt: "consent" });
  const pendingApproval = await h.request("/api/auth/oauth2/consent", { cookie: alice.cookie, body: { accept: true, oauth_query: pendingStart.oauthQuery } });
  const pendingCode = new URL((await pendingApproval.json()).url).searchParams.get("code")!;
  const revoke = await h.request("/auth/connections/revoke", { cookie: alice.cookie, body: { id: consentId } }); assert.equal(revoke.status, 200);
  await mustReject(fresh.tokens.access_token);
  await oauthFailure(await refresh(client.clientId, fresh.tokens.refresh_token!), "invalid_grant");
  const reconsent = await h.authorize(alice.cookie, client.clientId);
  assert.notEqual(decodeJwt(reconsent.tokens.access_token).arcana_consent_id, claims.arcana_consent_id);
  await oauthFailure(await h.exchange(client.clientId, pendingCode, pendingStart.verifier), "invalid_grant");
  await mustReject(fresh.tokens.access_token);

  const raceClient = await h.registerClient("refresh_race_client");
  const raceGrant = await h.authorize(alice.cookie, raceClient.clientId);
  const concurrentRefresh = await Promise.all([refresh(raceClient.clientId, raceGrant.tokens.refresh_token!), refresh(raceClient.clientId, raceGrant.tokens.refresh_token!)]);
  assert.deepEqual(concurrentRefresh.map((response) => response.status).sort(), [200, 400]);
  const raceWinner = await concurrentRefresh.find((response) => response.status === 200)!.json();
  await h.runtime.bearerVerifier.verify(raceWinner.access_token);
  const readClient = await h.registerClient("read_client", ["decks:read", "offline_access"]);
  const readOnly = await h.authorize(alice.cookie, readClient.clientId, "decks:read offline_access");
  assert.deepEqual((await h.runtime.bearerVerifier.verify(readOnly.tokens.access_token)).scopes, ["decks:read", "offline_access"]);
  await oauthFailure((await h.startAuthorization(alice.cookie, readClient.clientId, "decks:write")).response, "invalid_scope");
  const beforeRotation = decodeProtectedHeader(reconsent.tokens.access_token).kid;
  const context = await h.runtime.auth.$context;
  await context.adapter.update({ model: "jwks", where: [{ field: "id", value: beforeRotation! }], update: { expiresAt: new Date(Date.now() - 1000) } });
  const afterRotation = await h.authorize(alice.cookie, client.clientId);
  assert.notEqual(decodeProtectedHeader(afterRotation.tokens.access_token).kid, beforeRotation);
  await h.runtime.bearerVerifier.verify(reconsent.tokens.access_token); // retained public key grace
  await context.adapter.update({ model: "oauthClient", where: [{ field: "clientId", value: readClient.clientId }], update: { disabled: true } });
  await mustReject(readOnly.tokens.access_token);

  const reset = await h.request("/api/auth/request-password-reset", { body: { email: alice.user.email, redirectTo: `${AUTH_TEST_ORIGIN}/#/account/reset-password` } }); assert.equal(reset.status, 200);
  const resetEmail = [...h.emails].reverse().find((mail) => mail.to === alice.user.email && mail.subject.startsWith("Reset"))!;
  const resetUrl = resetEmail.text.match(/https:\/\/\S+/)![0];
  const resetPage = await h.request(resetUrl); const resetToken = new URL(resetPage.headers.get("location")!).searchParams.get("token")!;
  const newPassword = "new correct horse battery staple 456";
  const resetResult = await h.request("/api/auth/reset-password", { body: { token: resetToken, newPassword } }); assert.equal(resetResult.status, 200, await resetResult.clone().text());
  assert.equal((await (await h.request("/auth/session", { cookie: alice.cookie })).json()).authenticated, false);
  await mustReject(afterRotation.tokens.access_token);
  assert.ok((await refresh(client.clientId, afterRotation.tokens.refresh_token!)).status >= 400);
  assert.ok((await h.request("/api/auth/reset-password", { body: { token: resetToken, newPassword } })).status >= 400);
  assert.equal((await h.request("/api/auth/sign-in/email", { body: { email: alice.user.email, password: AUTH_TEST_PASSWORD } })).status, 401);
  const relogin = await h.login(alice.user.email, newPassword);
  const logoutGrant = await h.authorize(relogin.cookie, client.clientId);
  assert.equal((await h.request("/api/auth/sign-out", { cookie: relogin.cookie, body: {} })).status, 200);
  await mustReject(logoutGrant.tokens.access_token);
  assert.ok((await refresh(client.clientId, logoutGrant.tokens.refresh_token!)).status >= 400);

  const rateResponses = await Promise.all(Array.from({ length: 8 }, () => h.request("/api/auth/sign-in/email", { ip: "203.0.113.77", body: { email: "absent@example.test", password: AUTH_TEST_PASSWORD } })));
  assert.equal(rateResponses.filter((r) => r.status === 429).length, 3);
  for (const response of rateResponses.filter((r) => r.status === 429)) {
    const retryAfter = Number(response.headers.get("x-retry-after"));
    assert.ok(retryAfter > 0 && retryAfter <= 60, "pg int8 timestamps must yield a duration, not string concatenation");
  }
  const limits = await h.pg.client.query<{ count: number }>(`SELECT count(*) AS count FROM ${AUTH_TABLE_NAMES.rateLimit}`); assert.ok(Number(limits.rows[0].count) > 0);

  const realNow = Date.now;
  const windowStart = realNow();
  let clock = windowStart + 59_999;
  Date.now = () => clock;
  try {
    const key = "203.0.113.77|/sign-in/email";
    await h.pg.client.query(`UPDATE ${AUTH_TABLE_NAMES.rateLimit} SET count = 5, "lastRequest" = $1 WHERE key = $2`, [windowStart, key]);
    const requestAtBoundary = () => h.request("/api/auth/sign-in/email", { ip: "203.0.113.77", body: { email: "absent@example.test", password: AUTH_TEST_PASSWORD } });
    const beforeExpiry = await requestAtBoundary();
    assert.equal(beforeExpiry.status, 429);
    assert.equal(beforeExpiry.headers.get("x-retry-after"), "1", "sub-second remainder rounds up");
    const readCounter = async () => (await h.pg.client.query<{ count: number; lastRequest: bigint }>(`SELECT count, "lastRequest" FROM ${AUTH_TABLE_NAMES.rateLimit} WHERE key = $1`, [key])).rows[0];
    assert.deepEqual(await readCounter(), { count: 5, lastRequest: BigInt(windowStart) }, "rejected requests must not extend the window");
    clock = windowStart + 60_000;
    assert.equal((await requestAtBoundary()).status, 401, "a request at the exact boundary starts a new window");
    assert.deepEqual(await readCounter(), { count: 1, lastRequest: BigInt(clock) }, "expired windows reset the counter and millisecond timestamp");
  } finally { Date.now = realNow; }

  // Real CIMD registration goes through Better Auth; only HTTPS network bytes are deterministic.
  const cimdClient = "https://connector.example/client.json";
  documents.set(cimdClient, { client_id: cimdClient, client_name: "CIMD Test Connector", redirect_uris: ["https://client.example/callback"], token_endpoint_auth_method: "none", application_type: "web", grant_types: ["authorization_code", "refresh_token"] });
  const invalidNativeClient = "https://connector.example/unsupported-native.json";
  documents.set(invalidNativeClient, { client_id: invalidNativeClient, client_name: "Unsupported native host", redirect_uris: ["http://127.0.0.2/callback"], token_endpoint_auth_method: "none", application_type: "native", grant_types: ["authorization_code"], scope: "decks:read" });
  const invalidNative = await h.startAuthorization(undefined, invalidNativeClient, "decks:read", { redirect_uri: "http://127.0.0.2/callback" });
  assert.equal(invalidNative.response.status, 400, "CIMD registration permits only exact native loopback hosts, not arbitrary 127/8 addresses");
  assert.equal((await invalidNative.response.json()).error, "invalid_redirect_uri");
  const cimdGrant = await h.authorize(bob.cookie, cimdClient);
  assert.equal((await h.runtime.bearerVerifier.verify(cimdGrant.tokens.access_token)).subject, bob.user.id);
  assert.ok(metadataFetches > 0);
  assert.equal((await context.adapter.findOne<{ clientDiscoveryId: string }>({ model: "oauthClient", where: [{ field: "clientId", value: cimdClient }] }))?.clientDiscoveryId, "cimd");
  const publicCreate = await h.request("/api/auth/oauth2/create-client", { cookie: bob.cookie, body: { client_name: "Forbidden", redirect_uris: ["https://evil.example/callback"] } });
  assert.ok(publicCreate.status >= 400);
  const adminCreate = await h.request("/api/auth/admin/oauth2/create-client", { cookie: bob.cookie, body: { redirect_uris: ["https://evil.example/callback"] } }); assert.ok(adminCreate.status >= 400);
  for (const url of ["http://127.0.0.1/metadata", "https://127.0.0.1/metadata", "https://10.0.0.1/metadata", "https://169.254.169.254/latest/meta-data"]) await assert.rejects(() => Promise.resolve(fetchClientMetadataResource(url)), /HTTPS|public-routable/);


  const loopbackId = "https://native.example/client.json";
  documents.set(loopbackId, { client_id: loopbackId, client_name: "Native Connector", redirect_uris: ["http://127.0.0.1/callback?mode=mcp"], token_endpoint_auth_method: "none", application_type: "native", scope: "decks:read offline_access" });
  const nativeStart = await h.startAuthorization(bob.cookie, loopbackId, "decks:read offline_access", { redirect_uri: "http://127.0.0.1:49152/callback?mode=mcp" });
  assert.ok(nativeStart.location?.includes("/auth/consent?"), nativeStart.location ?? "no redirect");
  const nativeContext = await h.request(`/auth/oauth/context?${new URLSearchParams({ oauth_query: nativeStart.oauthQuery })}`);
  assert.equal(nativeContext.status, 200, await nativeContext.clone().text());
  assert.equal((await nativeContext.json()).redirectUri, "http://127.0.0.1:49152/callback?mode=mcp");
  const nativeDenied = await h.startAuthorization(bob.cookie, loopbackId, "decks:read", { redirect_uri: "http://127.0.0.1:49152/callback?mode=evil" });
  assert.ok(!nativeDenied.location?.startsWith("http://127.0.0.1:49152/callback?mode=evil"));

  const rotatedRuntime = createArcanaBetterAuth({ baseURL: AUTH_TEST_ORIGIN, resource: h.runtime.resource, secret: "test-only-not-a-production-secret-0123456789", secrets: [{ version: 2, value: "new-keyring-secret-0123456789-abcdefghijklmnopqrstuvwxyz" }, { version: 1, value: "test-only-not-a-production-secret-0123456789" }] }, { database: { dialect: h.pg.dialect, type: "postgres", transaction: true }, sendEmail: async () => { throw new Error("No mail expected during key rotation test"); } });
  const oldCookie = await rotatedRuntime.handler(new Request(`${AUTH_TEST_ORIGIN}/auth/session`, { headers: { cookie: bob.cookie } }));
  // Better Auth 1.7.7 rotates encryption keys but cookie HMACs use only the current secret.
  assert.equal((await oldCookie.json()).authenticated, false);
  const rotatedLogin = await rotatedRuntime.handler(new Request(`${AUTH_TEST_ORIGIN}/api/auth/sign-in/email`, { method: "POST", headers: { origin: AUTH_TEST_ORIGIN, "content-type": "application/json", "x-arcana-client-ip": "203.0.113.99" }, body: JSON.stringify({ email: bob.user.email, password: AUTH_TEST_PASSWORD }) }));
  assert.equal(rotatedLogin.status, 200, await rotatedLogin.clone().text());
  const encryptionProbe = await rotatedRuntime.auth.api.signJWT({ body: { payload: { sub: "rotation-probe" } } });
  assert.equal(typeof encryptionProbe.token, "string"); // decrypts the existing legacy-encrypted private key
  await rotatedRuntime.close();


  const failingMailRuntime = createArcanaBetterAuth({ baseURL: AUTH_TEST_ORIGIN, resource: h.runtime.resource, secret: "test-only-not-a-production-secret-0123456789" }, { database: { dialect: h.pg.dialect, type: "postgres", transaction: true }, sendEmail: async () => { throw new Error("test SMTP delivery failed"); } });
  assert.equal((await failingMailRuntime.bearerVerifier.verify(cimdGrant.tokens.access_token)).subject, bob.user.id, "a fresh runtime must read persisted signing keys, session, and grant state");
  const failingMailRequest = async (path: string, body: unknown, ip: string) => failingMailRuntime.handler(new Request(`${AUTH_TEST_ORIGIN}/api/auth/${path}`, { method: "POST", headers: { origin: AUTH_TEST_ORIGIN, "content-type": "application/json", "x-arcana-client-ip": ip }, body: JSON.stringify(body) }));
  for (const [path, body, ip] of [
    ["sign-up/email", { email: "mail-failure@example.test", name: "Mail failure", password: AUTH_TEST_PASSWORD }, "203.0.113.101"],
    ["send-verification-email", { email: "unverified@example.test" }, "203.0.113.102"],
    ["request-password-reset", { email: bob.user.email, redirectTo: `${AUTH_TEST_ORIGIN}/#/account/reset-password` }, "203.0.113.103"],
  ] as const) {
    const failure = await failingMailRequest(path, body, ip);
    assert.equal(failure.status, 503, `${path} must not report email delivery success`);
    assert.equal((await failure.json()).error, "email_delivery_failed");
    assert.ok(!failure.headers.getSetCookie().some((value) => value.includes("session_token")));
  }
  const unknownReset = await failingMailRequest("request-password-reset", { email: "does-not-exist@example.test" }, "203.0.113.104"); assert.equal(unknownReset.status, 200);
  const horizontalLimits = await Promise.all(Array.from({ length: 8 }, (_, index) => index % 2 === 0
    ? h.request("/api/auth/sign-in/email", { ip: "203.0.113.105", body: { email: "absent@example.test", password: AUTH_TEST_PASSWORD } })
    : failingMailRequest("sign-in/email", { email: "absent@example.test", password: AUTH_TEST_PASSWORD }, "203.0.113.105")));
  assert.equal(horizontalLimits.filter((response) => response.status === 429).length, 3, "two auth instances must share one atomic database rate limit");
  assert.ok(horizontalLimits.filter((response) => response.status === 429).every((response) => {
    const retryAfter = Number(response.headers.get("x-retry-after"));
    return retryAfter > 0 && retryAfter <= 60;
  }), "shared rate limits must return bounded retry durations");
  await failingMailRuntime.close();


  // Exercise the native handler body limit on chunked input, with no Content-Length.
  const oversized = Readable.from([Buffer.alloc(64 * 1024), Buffer.alloc(64 * 1024 + 1)]) as unknown as IncomingMessage;
  oversized.url = "/api/auth/sign-up/email"; oversized.method = "POST"; oversized.headers = { "content-type": "application/json" };
  let oversizedStatus = 0; let oversizedBody = "";
  const oversizedResponse = { writeHead(status: number) { oversizedStatus = status; }, end(body: string | Buffer) { oversizedBody = body.toString(); } } as unknown as ServerResponse;
  await h.runtime.nodeHandler(oversized, oversizedResponse);
  assert.equal(oversizedStatus, 413); assert.equal(JSON.parse(oversizedBody).error, "request_too_large");


  // Deterministically interleave disconnect/re-consent after the code hook read old consent.
  const interleaveClient = await h.registerClient("consent_interleave_client");
  const interleaveStart = await h.startAuthorization(bob.cookie, interleaveClient.clientId, "decks:read offline_access", { prompt: "consent" });
  const interleaveApproval = await h.request("/api/auth/oauth2/consent", { cookie: bob.cookie, body: { accept: true, oauth_query: interleaveStart.oauthQuery } });
  const interleaveCode = new URL((await interleaveApproval.json()).url).searchParams.get("code")!;
  const interleaveConsent = await context.adapter.findOne<{ id: string }>({ model: "oauthConsent", where: [{ field: "userId", value: bob.user.id }, { field: "clientId", value: interleaveClient.clientId }] });
  assert.ok(interleaveConsent);
  const originalFindOne = context.adapter.findOne.bind(context.adapter);
  let swapped = false;
  context.adapter.findOne = (async (query: Parameters<typeof originalFindOne>[0]) => {
    const found = await originalFindOne(query);
    if (!swapped && query.model === "oauthConsent" && query.where?.some((where) => where.field === "id" && where.value === interleaveConsent.id)) {
      swapped = true;
      await h.pg.client.query(`UPDATE ${AUTH_TABLE_NAMES.oauthConsent} SET id=$1 WHERE id=$2`, ["reconsented-generation", interleaveConsent.id]);
    }
    return found;
  }) as typeof context.adapter.findOne;
  try {
    const racedExchange = await h.exchange(interleaveClient.clientId, interleaveCode, interleaveStart.verifier);
    assert.ok(racedExchange.status >= 400, "an old code must never be rebound to new consent during issuance");
    assert.equal(swapped, true);
  } finally { context.adapter.findOne = originalFindOne; }

  const userDeleteGrant = await h.authorize(bob.cookie, client.clientId);
  await context.internalAdapter.deleteUser(bob.user.id);
  await mustReject(userDeleteGrant.tokens.access_token);
  console.log("PASS Better Auth real PostgreSQL: signup, verification, login, reset, discovery, PKCE, consent, scoped audience tokens, refresh rotation/replay, grant revocation/re-consent, session revocation, deleted users, CIMD registration/SSRF rejection, native loopback callbacks, SMTP failure, key/secret rotation, and cross-instance atomic rate limits");
} finally { await h.close(); }
