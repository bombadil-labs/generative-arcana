import assert from "node:assert/strict";
import { createHash, randomBytes } from "node:crypto";
import { PGlite } from "@electric-sql/pglite";
import { PostgresDialect, type PostgresPoolClient } from "kysely";
import { getMigrations } from "better-auth/db/migration";
import { createArcanaBetterAuth, ARCANA_OAUTH_SCOPES, type ArcanaBetterAuth } from "../src/betterAuth.js";
import type { AuthEmail } from "../src/authEmail.js";

export const AUTH_TEST_ORIGIN = "https://arcana.example";
export const AUTH_TEST_PASSWORD = "correct horse battery staple 123";
export async function createBetterAuthHarness(dependencies: Pick<import("../src/betterAuth.js").BetterAuthDependencies, "fetchClientMetadata"> = {}) {
  const client = await PGlite.create();
  let queue = Promise.resolve();
  const dialect = new PostgresDialect({ pool: {
    async connect() {
      let unlock!: () => void;
      const previous = queue; queue = new Promise<void>((resolve) => { unlock = resolve; });
      await previous;
      const query = async <R>(sql: string, values: readonly unknown[] = []) => {
        const result = await client.query<R>(sql, [...values]);
        return { ...result, rowCount: result.affectedRows ?? result.rows.length, command: result.command ?? "" };
      };
      // Tests use only SQL queries; Kysely cursor streaming is not configured.
      return { query: query as unknown as PostgresPoolClient["query"], release() { unlock(); } };
    }, async end() {}, options: {},
  } });
  const pg = { client, dialect };
  const emails: AuthEmail[] = [];
  const runtime = createArcanaBetterAuth({ baseURL: AUTH_TEST_ORIGIN, resource: `${AUTH_TEST_ORIGIN}/mcp`, secret: "test-only-not-a-production-secret-0123456789" }, {
    ...dependencies, database: { dialect: pg.dialect, type: "postgres", transaction: true }, sendEmail: async (email) => { emails.push(email); },
  });
  await (await getMigrations(runtime.options)).runMigrations();
  await runtime.checkSchema();
  let nextIp = 1;
  const request = async (path: string, options: { method?: string; body?: unknown; cookie?: string; form?: URLSearchParams; headers?: HeadersInit; ip?: string } = {}) => {
    const headers = new Headers(options.headers);
    headers.set("origin", AUTH_TEST_ORIGIN);
    headers.set("x-arcana-client-ip", options.ip ?? `198.51.100.${nextIp++}`);
    if (options.cookie) headers.set("cookie", options.cookie);
    if (options.body !== undefined) headers.set("content-type", "application/json");
    if (options.form) headers.set("content-type", "application/x-www-form-urlencoded");
    return runtime.handler(new Request(new URL(path, AUTH_TEST_ORIGIN), { method: options.method ?? (options.body !== undefined || options.form ? "POST" : "GET"), headers,
      ...(options.body === undefined ? {} : { body: JSON.stringify(options.body) }), ...(options.form ? { body: options.form } : {}),
    }));
  };
  const login = async (email: string, password = AUTH_TEST_PASSWORD) => {
    const response = await request("/api/auth/sign-in/email", { body: { email, password } });
    const body = await response.json();
    assert.equal(response.status, 200, JSON.stringify(body));
    const cookie = response.headers.getSetCookie().map((value) => value.split(";")[0]).join("; ");
    assert.ok(cookie.includes("session_token"));
    return { cookie, body };
  };
  const signupVerify = async (email: string, name = "Arcana Reader") => {
    const response = await request("/api/auth/sign-up/email", { body: { email, name, password: AUTH_TEST_PASSWORD, callbackURL: `${AUTH_TEST_ORIGIN}/#/account/verify-email?verified=1` } });
    assert.equal(response.status, 200, await response.clone().text());
    const user = (await response.json()).user as { id: string; email: string };
    const emailMessage = [...emails].reverse().find((mail) => mail.to === email && mail.subject.startsWith("Verify"));
    assert.ok(emailMessage, "verification email must be sent");
    const verificationUrl = emailMessage.text.match(/https:\/\/\S+/)?.[0];
    assert.ok(verificationUrl);
    const verified = await request(verificationUrl);
    assert.ok([200, 302, 303].includes(verified.status), await verified.text());
    return { ...await login(email), user };
  };
  const registerClient = async (clientId = `client_${randomBytes(6).toString("hex")}`, scopes = [...ARCANA_OAUTH_SCOPES] as string[]) => {
    const context = await runtime.auth.$context;
    // Provisioned public client, same persisted model used by validated CIMD registration.
    await context.adapter.create({ model: "oauthClient", data: {
      clientId, name: `Test ${clientId}`, redirectUris: ["https://client.example/callback"], tokenEndpointAuthMethod: "none", applicationType: "web",
      grantTypes: ["authorization_code", "refresh_token"], responseTypes: ["code"], scopes, requirePKCE: true, skipConsent: false, disabled: false,
      createdAt: new Date(), updatedAt: new Date(),
    } });
    let resource = await context.adapter.findOne({ model: "oauthResource", where: [{ field: "identifier", value: runtime.resource }] });
    if (!resource) await context.adapter.create({ model: "oauthResource", data: { identifier: runtime.resource, name: "Arcana MCP", allowedScopes: [...ARCANA_OAUTH_SCOPES], accessTokenTtl: 300, createdAt: new Date(), updatedAt: new Date() } });
    await context.adapter.create({ model: "oauthClientResource", data: { clientId, resourceId: runtime.resource, createdAt: new Date() } });
    return { clientId, redirectUri: "https://client.example/callback" };
  };
  const startAuthorization = async (cookie: string | undefined, clientId: string, scopes = "decks:read decks:write offline_access", overrides: Record<string, string | null> = {}) => {
    const verifier = randomBytes(32).toString("base64url");
    const query = new URLSearchParams({ client_id: clientId, redirect_uri: "https://client.example/callback", response_type: "code", scope: scopes, state: randomBytes(16).toString("hex"), resource: runtime.resource,
      code_challenge: createHash("sha256").update(verifier).digest("base64url"), code_challenge_method: "S256" });
    for (const [key, value] of Object.entries(overrides)) { if (value === null) query.delete(key); else query.set(key, value); }
    const response = await request(`/api/auth/oauth2/authorize?${query}`, { cookie });
    const location = response.headers.get("location");
    return { verifier, query, response, location, oauthQuery: location ? new URL(location, AUTH_TEST_ORIGIN).search.slice(1) : "" };
  };
  const exchange = async (clientId: string, code: string, verifier: string, overrides: Record<string, string> = {}) => request("/api/auth/oauth2/token", { form: new URLSearchParams({
    grant_type: "authorization_code", client_id: clientId, redirect_uri: "https://client.example/callback", code, code_verifier: verifier, resource: runtime.resource, ...overrides,
  }) });
  const authorize = async (cookie: string, clientId: string, scopes = "decks:read decks:write offline_access") => {
    const start = await startAuthorization(cookie, clientId, scopes, { prompt: "consent" });
    assert.equal(start.response.status, 302, await start.response.clone().text());
    assert.ok(start.location?.includes("/auth/consent?"), start.location ?? "no consent redirect");
    const response = await request("/api/auth/oauth2/consent", { cookie, body: { accept: true, oauth_query: start.oauthQuery } });
    const result = await response.json();
    assert.equal(response.status, 200, JSON.stringify(result));
    const code = new URL(result.url).searchParams.get("code");
    assert.ok(code, JSON.stringify(result));
    const tokenResponse = await exchange(clientId, code, start.verifier);
    const tokens = await tokenResponse.json() as { access_token: string; refresh_token?: string; token_type: string; expires_in: number; scope: string };
    assert.equal(tokenResponse.status, 200, JSON.stringify(tokens));
    return { ...start, tokens, code };
  };
  return { pg, runtime, emails, request, login, signupVerify, registerClient, startAuthorization, exchange, authorize, close: async () => { await runtime.close(); await pg.client.close(); } };
}
export type BetterAuthHarness = Awaited<ReturnType<typeof createBetterAuthHarness>>;
