import { randomBytes } from "node:crypto";
import { AsyncLocalStorage } from "node:async_hooks";
import { getCurrentAuthEndpointContext } from "@better-auth/core/context";
import { betterAuth, type BetterAuthOptions } from "better-auth";
import { APIError } from "better-auth/api";
import { fromNodeHeaders } from "better-auth/node";
import { jwt } from "better-auth/plugins";
import { mcp } from "@better-auth/mcp";
import { cimd } from "@better-auth/cimd";
import { fetchClientMetadataResource } from "@better-auth/cimd/node";
import { verifyOAuthQueryParams, type OAuthConsent, type SchemaClient, type ClientMetadataResourceFetch } from "@better-auth/oauth-provider";
import { createLocalJWKSet, jwtVerify } from "jose";
import { Pool } from "pg";
import type { IncomingMessage, ServerResponse } from "node:http";
import { getMigrations } from "better-auth/db/migration";
import { createAuthEmailSender, createAuthSmtpConfigurationFromEnv, type AuthEmailSender, type AuthSmtpConfiguration } from "./authEmail.js";
import { AUTH_POSTGRES_TYPES } from "./authPostgres.js";
import type { BrowserSessionAuthenticator } from "./browserSession.js";
import { OAuthPrincipalError, type BearerIdentityVerifier } from "./oauthIdentity.js";

export const BETTER_AUTH_BASE_PATH = "/api/auth";
export const ARCANA_OAUTH_SCOPES = ["decks:read", "decks:write", "offline_access"] as const;
export const ACCESS_TOKEN_TTL_SECONDS = 300;
const emailDeliveryContext = new AsyncLocalStorage<{ failed: boolean }>();
const tokenGrantConsentIds = new WeakMap<object, string>();
export const AUTH_TABLE_NAMES = {
  user: "arcana_auth_user", session: "arcana_auth_session", account: "arcana_auth_account",
  verification: "arcana_auth_verification", rateLimit: "arcana_auth_rate_limit", jwks: "arcana_auth_jwks",
  oauthClient: "arcana_auth_oauth_client", oauthResource: "arcana_auth_oauth_resource",
  oauthClientResource: "arcana_auth_oauth_client_resource", oauthAccessToken: "arcana_auth_oauth_access_token",
  oauthRefreshToken: "arcana_auth_oauth_refresh_token", oauthConsent: "arcana_auth_oauth_consent",
  oauthClientAssertion: "arcana_auth_oauth_client_assertion",
} as const;

export interface BetterAuthConfiguration {
  /** Canonical public origin, without an auth path. */
  baseURL: string;
  secret?: string;
  secrets?: { version: number; value: string }[];
  databaseUrl?: string;
  /** Must be exactly the canonical public origin + /mcp. */
  resource: string;
  smtp?: AuthSmtpConfiguration;
  signingKeyRotationSeconds?: number;
  signingKeyGraceSeconds?: number;
}
export interface BetterAuthDependencies {
  database?: BetterAuthOptions["database"];
  sendEmail?: AuthEmailSender;
  /** Test transport seam; production callers omit this and use DNS-pinned secure Node transport. */
  fetchClientMetadata?: ClientMetadataResourceFetch;
}

export function createBetterAuthConfigurationFromEnv(env: NodeJS.ProcessEnv = process.env): BetterAuthConfiguration {
  const baseURL = canonicalOrigin(required(env.BETTER_AUTH_URL, "BETTER_AUTH_URL"));
  const secrets = env.BETTER_AUTH_SECRETS?.split(",").map((entry) => {
    const colon = entry.indexOf(":");
    return { version: Number(entry.slice(0, colon)), value: entry.slice(colon + 1) };
  });
  const config: BetterAuthConfiguration = {
    baseURL, secret: env.BETTER_AUTH_SECRET, secrets,
    databaseUrl: required(env.BETTER_AUTH_DATABASE_URL || env.DATABASE_URL, "BETTER_AUTH_DATABASE_URL or DATABASE_URL"),
    resource: env.MCP_OAUTH_RESOURCE || `${baseURL}/mcp`,
    smtp: createAuthSmtpConfigurationFromEnv(env),
    signingKeyRotationSeconds: positiveInteger(env.BETTER_AUTH_JWKS_ROTATION_SECONDS, 30 * 86400, "BETTER_AUTH_JWKS_ROTATION_SECONDS"),
    signingKeyGraceSeconds: positiveInteger(env.BETTER_AUTH_JWKS_GRACE_SECONDS, 86400, "BETTER_AUTH_JWKS_GRACE_SECONDS"),
  };
  validateConfiguration(config);
  return config;
}

/** Build configuration only, without initializing Better Auth or seeding resource rows. */
export function createArcanaBetterAuthOptions(config: BetterAuthConfiguration, dependencies: BetterAuthDependencies = {}) {
  validateConfiguration(config);
  const baseURL = canonicalOrigin(config.baseURL);
  const issuer = `${baseURL}${BETTER_AUTH_BASE_PATH}`;
  const sender = dependencies.sendEmail ?? (config.smtp ? createAuthEmailSender(config.smtp) : undefined);
  if (!sender) throw new Error("SMTP configuration is required; authentication email delivery is not configured.");
  const sendEmail: AuthEmailSender = async (message) => {
    try { await sender(message); }
    catch { const state = emailDeliveryContext.getStore(); if (state) state.failed = true; throw new Error("Authentication email delivery failed."); }
  };
  const pool = dependencies.database ? undefined : new Pool({ connectionString: required(config.databaseUrl, "Better Auth database URL"), types: AUTH_POSTGRES_TYPES, max: 5, connectionTimeoutMillis: 10_000, query_timeout: 10_000, statement_timeout: 10_000 });
  const database = dependencies.database ?? pool!;
  const options = {
    appName: "Generative Arcana", baseURL, basePath: BETTER_AUTH_BASE_PATH,
    secret: config.secret, secrets: config.secrets, database,
    trustedOrigins: [baseURL],
    user: { modelName: AUTH_TABLE_NAMES.user },
    account: { modelName: AUTH_TABLE_NAMES.account, accountLinking: { enabled: false } },
    verification: { modelName: AUTH_TABLE_NAMES.verification },
    session: {
      modelName: AUTH_TABLE_NAMES.session, expiresIn: 7 * 86400, updateAge: 86400,
      cookieCache: { enabled: false },
    },
    emailAndPassword: {
      enabled: true, requireEmailVerification: true, autoSignIn: false,
      minPasswordLength: 12, maxPasswordLength: 128, revokeSessionsOnPasswordReset: true,
      resetPasswordTokenExpiresIn: 1800,
      sendResetPassword: async ({ user, url }: { user: { email: string }; url: string }) => {
        await sendEmail({ to: user.email, subject: "Reset your Generative Arcana password", text: `Use this link to reset your password. It expires in 30 minutes.\n\n${url}\n\nIf you did not request this, ignore this email.` });
      },
    },
    emailVerification: {
      sendOnSignUp: true, sendOnSignIn: true, autoSignInAfterVerification: false, expiresIn: 3600,
      sendVerificationEmail: async ({ user, url }: { user: { email: string }; url: string }) => {
        await sendEmail({ to: user.email, subject: "Verify your Generative Arcana email", text: `Verify your email with this link. It expires in one hour.\n\n${url}\n\nIf you did not create this account, ignore this email.` });
      },
    },
    advanced: {
      useSecureCookies: baseURL.startsWith("https:"), cookiePrefix: "arcana-auth",
      defaultCookieAttributes: { httpOnly: true, sameSite: "lax" as const },
      ipAddress: { ipAddressHeaders: ["x-arcana-client-ip"] },
    },
    rateLimit: {
      enabled: true, storage: "database" as const, modelName: AUTH_TABLE_NAMES.rateLimit,
      window: 60, max: 100,
      customRules: {
        "/sign-in/email": { window: 60, max: 5 }, "/sign-up/email": { window: 60, max: 3 },
        "/request-password-reset": { window: 300, max: 3 }, "/send-verification-email": { window: 300, max: 3 },
        "/reset-password": { window: 60, max: 5 }, "/oauth2/token": { window: 60, max: 30 },
      },
    },
    databaseHooks: { verification: { create: { before: async (verification, endpoint) => {
      let value: Record<string, unknown>;
      try { value = JSON.parse(verification.value); } catch { return; }
      if (value.type !== "authorization_code") return;
      const query = value.query as { client_id?: string } | undefined;
      if (!endpoint || typeof value.userId !== "string" || !query?.client_id) throw new APIError("FORBIDDEN", { message: "Invalid authorization grant." });
      const consent = await endpoint.context.adapter.findOne<OAuthConsent<string[]>>({ model: "oauthConsent", where: [{ field: "userId", value: value.userId }, { field: "clientId", value: query.client_id }] });
      if (!consent) throw new APIError("FORBIDDEN", { message: "Active consent required." });
      return { data: { ...verification, value: JSON.stringify({ ...value, arcanaConsentId: consent.id }) } };
    } } } },
    // Session JWTs must not be accepted as delegated MCP tokens. Client/resource admin stays server-only.
    disabledPaths: ["/token", "/oauth2/update-consent", "/oauth2/delete-consent"],
    plugins: [
      jwt({
        schema: { jwks: { modelName: AUTH_TABLE_NAMES.jwks } },
        jwt: { issuer, audience: config.resource, expirationTime: "5m" },
        jwks: { keyPairConfig: { alg: "ES256" }, rotationInterval: config.signingKeyRotationSeconds ?? 30 * 86400, gracePeriod: config.signingKeyGraceSeconds ?? 86400 },
      }),
      mcp({
        resource: config.resource, loginPage: "/auth/login", consentPage: "/auth/consent",
        scopes: [...ARCANA_OAUTH_SCOPES], grantTypes: ["authorization_code", "refresh_token"],
        resources: [{ identifier: config.resource, allowedScopes: [...ARCANA_OAUTH_SCOPES], accessTokenTtl: ACCESS_TOKEN_TTL_SECONDS }],
        accessTokenExpiresIn: ACCESS_TOKEN_TTL_SECONDS, refreshTokenExpiresIn: 30 * 86400, codeExpiresIn: 60,
        refreshTokenReuseInterval: 0,
        allowDynamicClientRegistration: false, allowUnauthenticatedClientRegistration: false,
        clientPrivileges: () => false, resourcePrivileges: () => false,
        schema: {
          oauthClient: { modelName: AUTH_TABLE_NAMES.oauthClient }, oauthResource: { modelName: AUTH_TABLE_NAMES.oauthResource },
          oauthClientResource: { modelName: AUTH_TABLE_NAMES.oauthClientResource }, oauthAccessToken: { modelName: AUTH_TABLE_NAMES.oauthAccessToken },
          oauthRefreshToken: { modelName: AUTH_TABLE_NAMES.oauthRefreshToken }, oauthConsent: { modelName: AUTH_TABLE_NAMES.oauthConsent },
          oauthClientAssertion: { modelName: AUTH_TABLE_NAMES.oauthClientAssertion },
        },
        customTokenResponseFields: async ({ grantType, verificationValue }) => {
          if (grantType !== "authorization_code") return {};
          const boundId = (verificationValue as unknown as { arcanaConsentId?: unknown } | undefined)?.arcanaConsentId;
          const endpoint = getCurrentAuthEndpointContext();
          const consent = typeof boundId === "string" ? await endpoint.context.adapter.findOne<OAuthConsent<string[]>>({ model: "oauthConsent", where: [{ field: "id", value: boundId }] }) : null;
          if (!consent || consent.userId !== verificationValue?.userId || consent.clientId !== verificationValue?.query.client_id) throw new APIError("BAD_REQUEST", { error: "invalid_grant", error_description: "Authorization consent was revoked. Restart authorization." });
          tokenGrantConsentIds.set(endpoint, consent.id);
          return {};
        },
        generateRefreshToken: () => {
          const consentId = tokenGrantConsentIds.get(getCurrentAuthEndpointContext());
          if (!consentId) throw new APIError("FORBIDDEN", { message: "Active consent required." });
          return `arcana_rt_${consentId}.${randomBytes(48).toString("base64url")}`;
        },
        extensions: [{ claims: { accessToken: async ({ ctx, user, client, scopes, sessionId, grantType }) => {
          if (!user?.emailVerified) throw new APIError("FORBIDDEN", { message: "Verified user required." });
          const session = sessionId ? await ctx.context.adapter.findOne<{ userId: string; expiresAt: Date }>({ model: "session", where: [{ field: "id", value: sessionId }] }) : null;
          if (!session || session.userId !== user.id || new Date(session.expiresAt).getTime() <= Date.now()) throw new APIError("FORBIDDEN", { message: "An active user session is required." });
          const endpoint = getCurrentAuthEndpointContext();
          // Bind both code redemption and refresh to the original consent generation.
          // The whole opaque refresh token is hashed and validated by Better Auth before this hook.
          const refreshToken = typeof ctx.body?.refresh_token === "string" ? ctx.body.refresh_token : "";
          const boundId = grantType === "authorization_code" ? tokenGrantConsentIds.get(endpoint)
            : grantType === "refresh_token" ? /^arcana_rt_([A-Za-z0-9_-]+)\.[A-Za-z0-9_-]{64}$/.exec(refreshToken)?.[1] : undefined;
          if (!boundId) throw new APIError("BAD_REQUEST", { error: "invalid_grant", error_description: "Consent binding is missing." });
          const consent = await ctx.context.adapter.findOne<OAuthConsent<string[]>>({ model: "oauthConsent", where: [
            { field: "id", value: boundId }, { field: "userId", value: user.id }, { field: "clientId", value: client.clientId },
          ] });
          if (!consent || !consent.resources?.includes(config.resource) || !scopes.every((scope) => consent.scopes.includes(scope))) throw new APIError("FORBIDDEN", { message: "An active consent is required." });
          tokenGrantConsentIds.set(endpoint, consent.id);
          return { arcana_consent_id: consent.id };
        } } }],
      }),
      cimd({ fetchClientMetadataResource: dependencies.fetchClientMetadata ?? fetchClientMetadataResource, metadataProfile: "mcp-2026-07-28" }),
    ],
  } satisfies BetterAuthOptions;
  return options;
}

/** Construct the runtime. Deployment schema changes remain an explicit reviewed operation. */
export function createArcanaBetterAuth(config: BetterAuthConfiguration, dependencies: BetterAuthDependencies = {}) {
  const options = createArcanaBetterAuthOptions(config, dependencies);
  const baseURL = canonicalOrigin(config.baseURL);
  const issuer = `${baseURL}${BETTER_AUTH_BASE_PATH}`;
  const pool = dependencies.database ? undefined : options.database as Pool;
  const auth = betterAuth(options);
  const browserAuthenticator: BrowserSessionAuthenticator = {
    async authenticate(req) {
      const session = await auth.api.getSession({ headers: fromNodeHeaders(req.headers) });
      if (!session?.user.emailVerified) return null;
      return { identity: { issuer, subject: session.user.id }, email: session.user.email,
        displayName: session.user.name, ...(session.user.image ? { avatarUrl: session.user.image } : {}) };
    },
  };
  const bearerVerifier: BearerIdentityVerifier = {
    async verify(token) {
      try {
        const jwks = await auth.api.getJwks();
        const { payload, protectedHeader } = await jwtVerify(token, createLocalJWKSet(jwks), {
          issuer, audience: config.resource, algorithms: ["ES256"], maxTokenAge: ACCESS_TOKEN_TTL_SECONDS, requiredClaims: ["sub", "client_id", "sid", "exp", "iat", "arcana_consent_id"],
        });
        if (protectedHeader.typ !== "at+jwt" || payload.cnf || typeof payload.sub !== "string" || typeof payload.client_id !== "string" || typeof payload.sid !== "string" || typeof payload.arcana_consent_id !== "string") throw new Error("Invalid delegated bearer token.");
        if (payload.aud !== config.resource || !payload.exp || !payload.iat || payload.exp - payload.iat > ACCESS_TOKEN_TTL_SECONDS) throw new Error("Invalid audience or token lifetime.");
        const context = await auth.$context;
        const [user, session, client, consent] = await Promise.all([
          context.internalAdapter.findUserById(payload.sub),
          context.adapter.findOne<{ userId: string; expiresAt: Date }>({ model: "session", where: [{ field: "id", value: payload.sid }] }),
          context.adapter.findOne<SchemaClient<string[]>>({ model: "oauthClient", where: [{ field: "clientId", value: payload.client_id }] }),
          context.adapter.findOne<OAuthConsent<string[]>>({ model: "oauthConsent", where: [{ field: "id", value: payload.arcana_consent_id }] }),
        ]);
        const scopes = typeof payload.scope === "string" ? payload.scope.split(/\s+/).filter(Boolean) : [];
        if (!user?.emailVerified || !session || session.userId !== payload.sub || new Date(session.expiresAt).getTime() <= Date.now() || !client || client.disabled || (client.scopes && !scopes.every((scope) => client.scopes!.includes(scope))) || !consent || !consent.resources?.includes(config.resource) || consent.userId !== payload.sub || consent.clientId !== payload.client_id || !scopes.every((scope) => consent.scopes.includes(scope))) throw new Error("Token grant or session is no longer active.");
        return { issuer, subject: payload.sub, scopes };
      } catch {
        throw new OAuthPrincipalError(401, "invalid_token", "Access token is invalid, expired, or revoked.");
      }
    },
  };
  const browserHandler = createBrowserHandler(auth, baseURL, config.resource);
  const handler = (request: Request) => emailDeliveryContext.run({ failed: false }, async () => {
    const response = await browserHandler(request);
    // Better Auth 1.7 catches awaited background-email exceptions. Surface truthful delivery status.
    if (emailDeliveryContext.getStore()?.failed) return json(503, { error: "email_delivery_failed", message: "We could not send your email. Please try again shortly." });
    return response;
  });
  return { auth, options, issuer, resource: config.resource, browserAuthenticator, bearerVerifier, handler,
    nodeHandler: boundedNodeHandler(handler, baseURL), checkSchema: async () => {
      const plan = await getMigrations(options, { throwOnUnsafe: false });
      if (plan.toBeCreated.length || plan.toBeAdded.length || plan.toBeAddedIndexes.length || plan.unsafeChanges.length || plan.schemaProblems.length) throw new Error("Better Auth database schema requires reviewed migration.");
    }, close: async () => { await pool?.end(); } };
}
export type ArcanaBetterAuth = ReturnType<typeof createArcanaBetterAuth>;
type Auth = ArcanaBetterAuth["auth"];

export function isBetterAuthRequestPath(pathname: string): boolean {
  return pathname === BETTER_AUTH_BASE_PATH || pathname.startsWith(`${BETTER_AUTH_BASE_PATH}/`) || pathname.startsWith("/.well-known/")
    || ["/auth/login", "/auth/consent", "/auth/session", "/auth/logout", "/auth/oauth/context", "/auth/oauth/continue", "/auth/connections", "/auth/connections/revoke"].includes(pathname);
}

function createBrowserHandler(auth: Auth, baseURL: string, resource: string) {
  return async (request: Request): Promise<Response> => {
    const url = new URL(request.url);
    if (["/.well-known/oauth-authorization-server", "/.well-known/openid-configuration"].includes(url.pathname)) {
      url.pathname += BETTER_AUTH_BASE_PATH;
      return auth.handler(new Request(url, request));
    }
    if (url.pathname === `${BETTER_AUTH_BASE_PATH}/oauth2/authorize`) {
      const resources = url.searchParams.getAll("resource");
      if (resources.length !== 1 || resources[0] !== resource) return json(400, { error: "invalid_target", error_description: "The exact MCP resource is required." });
    }
    if (!url.pathname.startsWith("/auth/")) return auth.handler(request);
    try {
      if (["/auth/login", "/auth/consent"].includes(url.pathname) && request.method === "GET") {
        const page = url.pathname === "/auth/consent" ? "consent" : "login";
        const query = new URLSearchParams();
        if (url.searchParams.has("client_id")) {
          await verifiedOAuthQuery(auth, url.search.slice(1));
          query.set("oauth_query", url.search.slice(1));
        } else if (url.searchParams.has("oauth_query")) {
          await verifiedOAuthQuery(auth, url.searchParams.get("oauth_query")!);
          query.set("oauth_query", url.searchParams.get("oauth_query")!);
        } else if (page === "consent") return json(400, { error: "invalid_oauth_query" });
        query.set("returnTo", safeReturnTo(url.searchParams.get("returnTo")));
        return redirect(`${baseURL}/#/account/${page}?${query}`);
      }
      if (url.pathname === "/auth/oauth/continue" && request.method === "GET") {
        const oauthQuery = url.searchParams.get("oauth_query") ?? "";
        await verifiedOAuthQuery(auth, oauthQuery);
        return redirect(`${baseURL}${BETTER_AUTH_BASE_PATH}/oauth2/authorize?${oauthQuery}`);
      }
      if (url.pathname === "/auth/logout" && request.method === "POST") {
        requireSameOrigin(request, baseURL);
        const response = await auth.handler(new Request(`${baseURL}${BETTER_AUTH_BASE_PATH}/sign-out`, { method: "POST", headers: request.headers }));
        if (!response.ok) return response;
        const headers = new Headers(response.headers); headers.set("location", "/#/"); headers.set("cache-control", "no-store");
        return new Response(null, { status: 303, headers });
      }
      const session = await auth.api.getSession({ headers: request.headers });
      if (url.pathname === "/auth/session" && request.method === "GET") return json(200, session?.user.emailVerified ? {
        authenticated: true, accountId: session.user.id, mcpUrl: resource, user: { email: session.user.email, displayName: session.user.name, emailVerified: session.user.emailVerified, ...(session.user.image ? { avatarUrl: session.user.image } : {}) },
      } : { authenticated: false });
      if (url.pathname === "/auth/oauth/context" && request.method === "GET") {
        const oauthQuery = url.searchParams.get("oauth_query") ?? "";
        const query = await verifiedOAuthQuery(auth, oauthQuery);
        const context = await auth.$context;
        const client = await context.adapter.findOne<SchemaClient<string[]>>({ model: "oauthClient", where: [{ field: "clientId", value: query.get("client_id") ?? "" }] });
        if (!client || client.disabled || !client.redirectUris?.some((registered) => matchesOAuthRedirect(registered, query.get("redirect_uri") ?? ""))) return json(400, { error: "invalid_oauth_query" });
        const scopes = (query.get("scope") ?? "").split(/\s+/).filter(Boolean);
        if (!scopes.length || scopes.some((scope) => !(ARCANA_OAUTH_SCOPES as readonly string[]).includes(scope)) || query.get("resource") !== resource) return json(400, { error: "invalid_oauth_query" });
        return json(200, { client: { clientId: client.clientId, name: client.name || client.clientId, uri: client.uri }, scopes, resource, redirectUri: query.get("redirect_uri"), oauthQuery });
      }
      if (!session?.user.emailVerified) return json(401, { error: "authentication_required" });
      if (url.pathname === "/auth/connections" && request.method === "GET") {
        const consents = await auth.api.getOAuthConsents({ headers: request.headers });
        const context = await auth.$context;
        return json(200, { clients: await Promise.all(consents.map(async (consent) => {
          const client = await context.adapter.findOne<SchemaClient<string[]>>({ model: "oauthClient", where: [{ field: "clientId", value: consent.clientId }] });
          return { id: consent.id, clientId: consent.clientId, name: client?.name || consent.clientId, scopes: consent.scopes, createdAt: consent.createdAt };
        })) });
      }
      if (url.pathname === "/auth/connections/revoke" && request.method === "POST") {
        requireSameOrigin(request, baseURL);
        const body = await request.json() as { id?: unknown };
        if (typeof body.id !== "string" || !body.id) return json(400, { error: "invalid_consent_id" });
        const context = await auth.$context;
        const consent = await context.adapter.findOne<OAuthConsent<string[]>>({ model: "oauthConsent", where: [{ field: "id", value: body.id }, { field: "userId", value: session.user.id }] });
        if (!consent) return json(404, { error: "consent_not_found" });
        // Publish revocation atomically across consent and token state on PostgreSQL.
        await context.adapter.transaction(async (transaction) => {
          await transaction.delete({ model: "oauthConsent", where: [{ field: "id", value: consent.id }] });
          for (const model of ["oauthRefreshToken", "oauthAccessToken"]) await transaction.deleteMany({ model, where: [{ field: "userId", value: session.user.id }, { field: "clientId", value: consent.clientId }] });
        });
        return json(200, { revoked: true });
      }
      return json(405, { error: "method_not_allowed" });
    } catch (error) {
      return json(error instanceof APIError && error.status === "FORBIDDEN" ? 403 : 400, { error: "authentication_request_failed", message: "Authentication request is invalid or could not be completed. Restart the request." });
    }
  };
}
async function verifiedOAuthQuery(auth: Auth, value: string) {
  const { secret } = await auth.$context;
  if (!value || value.length > 16_384 || !await verifyOAuthQueryParams(value, secret)) throw new Error("OAuth request is invalid or expired. Restart the connection from your client.");
  return new URLSearchParams(value);
}
function requireSameOrigin(request: Request, baseURL: string) {
  if (request.headers.get("origin") !== baseURL || request.headers.get("sec-fetch-site") === "cross-site") throw new APIError("FORBIDDEN", { message: "Same-origin request required." });
}
function safeReturnTo(value: string | null) {
  if (!value) return "/#/my-decks";
  if (!value.startsWith("/#/") || value.includes("\\") || /[\r\n]/.test(value)) throw new Error("returnTo must be a same-origin application route.");
  return value;
}
function json(status: number, body: unknown) { return Response.json(body, { status, headers: { "cache-control": "no-store" } }); }
function redirect(location: string) { return new Response(null, { status: 303, headers: { location, "cache-control": "no-store" } }); }
function required(value: string | undefined, name: string) { if (!value?.trim()) throw new Error(`${name} is required.`); return value.trim(); }
function positiveInteger(value: string | undefined, fallback: number, name: string) { const number = value === undefined ? fallback : Number(value); if (!Number.isSafeInteger(number) || number < 1) throw new Error(`${name} must be a positive integer.`); return number; }
function canonicalOrigin(value: string) {
  const url = new URL(value);
  if (url.username || url.password || url.hash || url.search || url.pathname !== "/") throw new Error("BETTER_AUTH_URL must be an origin without a path, query, fragment, or credentials.");
  if (url.protocol !== "https:" && !(url.protocol === "http:" && ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname))) throw new Error("BETTER_AUTH_URL requires HTTPS (HTTP loopback only for development).");
  return url.origin;
}
function validateConfiguration(config: BetterAuthConfiguration) {
  const origin = canonicalOrigin(config.baseURL);
  if (config.resource !== `${origin}/mcp`) throw new Error("MCP_OAUTH_RESOURCE must exactly equal BETTER_AUTH_URL + /mcp.");
  if (!config.secret && !config.secrets?.length) throw new Error("BETTER_AUTH_SECRET or BETTER_AUTH_SECRETS is required.");
  if (config.secret !== undefined && config.secret.length < 32) throw new Error("BETTER_AUTH_SECRET must have at least 32 characters.");
  const versions = new Set<number>();
  for (const secret of config.secrets ?? []) {
    if (!Number.isSafeInteger(secret.version) || secret.version < 1 || versions.has(secret.version) || secret.value.length < 32) throw new Error("BETTER_AUTH_SECRETS requires unique positive versions and secrets of at least 32 characters.");
    versions.add(secret.version);
  }
  if (config.signingKeyGraceSeconds !== undefined && config.signingKeyGraceSeconds < ACCESS_TOKEN_TTL_SECONDS) throw new Error("JWKS grace period must cover the 300 second access token lifetime.");
}

/** Bound chunked bodies too; never rely on an attacker-supplied Content-Length. */
function boundedNodeHandler(handler: (request: Request) => Promise<Response>, origin: string) {
  return async (req: IncomingMessage, res: ServerResponse): Promise<void> => {
    const chunks: Buffer[] = []; let size = 0;
    for await (const chunk of req) {
      const bytes = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
      size += bytes.length;
      if (size > 128 * 1024) { res.writeHead(413, { "content-type": "application/json", "connection": "close" }); res.end(JSON.stringify({ error: "request_too_large" })); return; }
      chunks.push(bytes);
    }
    const headers = fromNodeHeaders(req.headers);
    const method = req.method || "GET";
    const request = new Request(new URL(req.url || "/", origin), { method, headers, ...(method === "GET" || method === "HEAD" ? {} : { body: Buffer.concat(chunks) }) });
    const response = await handler(request);
    res.statusCode = response.status;
    response.headers.forEach((value, key) => { if (key !== "set-cookie") res.setHeader(key, value); });
    const cookies = response.headers.getSetCookie();
    if (cookies.length) res.setHeader("set-cookie", cookies);
    res.end(Buffer.from(await response.arrayBuffer()));
  };
}

/** Native loopback callbacks may vary only their port (RFC 8252); every other byte remains exact. */
function matchesOAuthRedirect(registered: string, requested: string): boolean {
  try {
    const parsed = new URL(requested);
    if (parsed.username || parsed.password || requested.includes("#")) return false;
    if (registered === requested) return true;
    const stripPort = (value: string) => {
      const match = /^(http:\/\/(?:localhost|127\.0\.0\.1|\[::1\]))(?::[0-9]*)?([/?].*|$)/.exec(value);
      if (!match || match[0] !== value || !["localhost", "127.0.0.1", "[::1]"].includes(new URL(value).hostname)) return undefined;
      return `${match[1]}${match[2]}`;
    };
    const expected = stripPort(registered);
    return expected !== undefined && expected === stripPort(requested);
  } catch { return false; }
}
