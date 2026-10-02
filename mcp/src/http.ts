import { PostgresManifestUploads } from "./manifestUploads";
import { PostgresManifestDrafts } from "./manifestDrafts";
import type { ManifestToolOptions } from "./manifestUploadTools";
import { createManifestUploadHandler, isManifestUploadPath } from "./webManifestUploads";
import { Pool } from "pg";
import { CardArtworkService } from "./cardArtwork";
import { artworkStorageConfiguration, S3PrivateArtworkStorage } from "./artworkStorage";
import { NeonArtworkRepository } from "./neonArtworkRepository";
import { createWebArtworkHandler, isArtworkPath } from "./webArtworkApi";
import { neon } from "@neondatabase/serverless";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { createMcpHandler } from "@modelcontextprotocol/server";
import { hostHeaderValidation, originValidation, toNodeHandler } from "@modelcontextprotocol/node";
import { createArcanaMcpServer } from "./server";
import { StaticBearerPrincipalResolver } from "./alphaAuth";
import { FileArcanaHostStateRepository } from "./fileHostStateRepository";
import { NeonArcanaHostStateRepository } from "./neonHostStateRepository";
import { NeonExternalIdentityRepository } from "./neonExternalIdentityRepository";
import { NeonUserDeckCatalogRepository } from "./neonUserDeckCatalog";
import type { UserDeckCatalogRepository } from "./userDeckCatalog";
import {
  OAuthPrincipalError,
  OAuthPrincipalResolver,
  OidcJwtBearerIdentityVerifier,
} from "./oauthIdentity";
import {
  bearerChallenge,
  DEFAULT_DECK_READ_SCOPES,
  DEFAULT_DECK_WRITE_SCOPES,
  loadAuthorizationServerMetadata,
  protectedResourceMetadata,
  protectedResourceMetadataPaths,
  protectedResourceMetadataUrl,
  type OAuthResourceConfiguration,
} from "./oauthResource";
import {
  createArcanaAdapter,
  InMemoryArcanaHostStore,
  PersistentArcanaHostStore,
  type ArcanaHostStore,
} from "./hostStore";
import { FixedWindowRateLimiter, parseContentLength, positiveIntEnv } from "./limits";
import { jsonToolCallObserver } from "./observability";
import { resolveArcanaRequestAccess, type PrincipalRequest, type PrincipalResolver } from "./principal";
import { ARCANA_MCP_VERSION } from "./version";
import { createArcanaWebCatalogRequestHandler, isArcanaWebCatalogPath } from "./webCatalogApi";
import { ExternalIdentityBrowserPrincipalResolver } from "./browserSession";
import { createArcanaBetterAuth, createBetterAuthConfigurationFromEnv, isBetterAuthRequestPath } from "./betterAuth";
import { DurableRateLimiter } from "./durableRateLimiter";
import { requestClientIp } from "./requestIp";
import { serveArcanaWebApp } from "./webAppStatic";
import { accountDeploymentReadiness, createDeploymentDependencyMonitor, deploymentBuildIdentity } from "./deploymentReadiness";
import { createArcanaAuthoringRequestHandler, isArcanaAuthoringPath } from "./authoringApi";
import { withArcanaHttpToolAuthorization, type ArcanaHttpOAuthOptions } from "./httpToolAuthorization";

const port = envPort(process.env.PORT, 3000);
const host = process.env.HOST?.trim() || "127.0.0.1";
const allowedHosts = csv(process.env.MCP_ALLOWED_HOSTS) ?? deploymentAllowlist(host);
const allowedOrigins = csv(process.env.MCP_ALLOWED_ORIGINS) ?? allowedHosts;
const alphaToken = optionalEnv(process.env.MCP_ALPHA_TOKEN);
const alphaPrincipalId = optionalEnv(process.env.MCP_ALPHA_PRINCIPAL_ID) ?? "alpha-user-v1";
const stateDir = optionalEnv(process.env.MCP_STATE_DIR);
const databaseUrl = optionalEnv(process.env.DATABASE_URL);
const webAppDistDir = optionalEnv(process.env.ARCANA_WEB_DIST_DIR);
const betterAuthEnabled = [process.env.BETTER_AUTH_URL, process.env.BETTER_AUTH_SECRET, process.env.BETTER_AUTH_SECRETS, process.env.BETTER_AUTH_DATABASE_URL].some(Boolean);
const browserAuth = betterAuthEnabled ? createArcanaBetterAuth(createBetterAuthConfigurationFromEnv()) : undefined;
if (browserAuth && process.env.MCP_OAUTH_ISSUER && process.env.MCP_OAUTH_ISSUER !== browserAuth.issuer) {
  throw new Error("MCP_OAUTH_ISSUER must match the local Better Auth issuer when Better Auth is enabled.");
}
const oauth = oauthRuntimeConfiguration({
  issuer: browserAuth?.issuer ?? optionalEnv(process.env.MCP_OAUTH_ISSUER),
  resource: browserAuth?.resource ?? optionalEnv(process.env.MCP_OAUTH_RESOURCE),
  jwksUri: browserAuth ? undefined : optionalEnv(process.env.MCP_OAUTH_JWKS_URI),
  readScopes: browserAuth ? [...DEFAULT_DECK_READ_SCOPES] : csv(process.env.MCP_OAUTH_READ_SCOPES) ?? [...DEFAULT_DECK_READ_SCOPES],
  writeScopes: browserAuth ? [...DEFAULT_DECK_WRITE_SCOPES] : csv(process.env.MCP_OAUTH_WRITE_SCOPES) ?? [...DEFAULT_DECK_WRITE_SCOPES],
});
const maxRequestBytes = positiveIntEnv(process.env.MCP_MAX_REQUEST_BYTES, 4_000_000, "MCP_MAX_REQUEST_BYTES");
const requestsPerMinute = positiveIntEnv(process.env.MCP_RATE_LIMIT_PER_MINUTE, 120, "MCP_RATE_LIMIT_PER_MINUTE");
const rateLimiter = databaseUrl
  ? new DurableRateLimiter(databaseUrl, requestsPerMinute)
  : new FixedWindowRateLimiter(requestsPerMinute);

if (!allowedHosts.length) {
  throw new Error("Public MCP HTTP binding requires MCP_ALLOWED_HOSTS or a recognized Vercel deployment hostname.");
}
if (alphaToken && oauth) {
  throw new Error("Configure either MCP_ALPHA_TOKEN or MCP_OAUTH_ISSUER/MCP_OAUTH_RESOURCE, not both.");
}
if (oauth && !databaseUrl) {
  throw new Error("OAuth identity requires DATABASE_URL so external identities map to durable Arcana principals.");
}
if (browserAuth && !databaseUrl) {
  throw new Error("Browser account sessions require DATABASE_URL so external identities map to durable Arcana principals.");
}

const identities = databaseUrl ? new NeonExternalIdentityRepository(databaseUrl) : undefined;
const principalResolver = oauth
  ? new OAuthPrincipalResolver(
      browserAuth?.bearerVerifier ?? new OidcJwtBearerIdentityVerifier(oauth.issuer, oauth.resource, oauth.jwksUri),
      identities!,
      [], // Scope authorization is per tool/route; unscoped tokens retain public-only access.
    )
  : alphaToken
    ? new StaticBearerPrincipalResolver(alphaToken, alphaPrincipalId)
    : undefined;
const browserPrincipalResolver = browserAuth && identities
  ? new ExternalIdentityBrowserPrincipalResolver(browserAuth.browserAuthenticator, identities)
  : undefined;
const browserAuthHandler = browserAuth?.nodeHandler;
const { hosts, catalog, stateMode } = createHostStore({ databaseUrl, stateDir });
const artworkConfig = artworkStorageConfiguration();
if (artworkConfig && (!databaseUrl || !catalog)) throw new Error("Artwork requires a durable database catalog.");
const artworkPool = artworkConfig ? new Pool({ connectionString: databaseUrl, max: 3, connectionTimeoutMillis: 10_000 }) : undefined;
const artworkLimiter = artworkConfig ? new DurableRateLimiter(databaseUrl!, 12) : undefined;
const artwork = artworkConfig ? new CardArtworkService(catalog!, new NeonArtworkRepository(artworkPool!), new S3PrivateArtworkStorage(artworkConfig), async ownerId => (await artworkLimiter!.check(`artwork:${ownerId}`)).allowed) : undefined;
const manifestPool = databaseUrl && catalog ? new Pool({ connectionString: databaseUrl, max: 3, connectionTimeoutMillis: 10_000 }) : undefined;
const manifestUploads = manifestPool ? new PostgresManifestUploads(manifestPool) : undefined;
const manifestDrafts = manifestUploads ? new PostgresManifestDrafts(manifestPool!, manifestUploads) : undefined;
const manifestLimiter = manifestUploads ? new DurableRateLimiter(databaseUrl!, 12) : undefined;
const draftOperationLimiter = manifestUploads ? new DurableRateLimiter(databaseUrl!, 60) : undefined;
const uploadOrigin = oauth ? new URL(oauth.resource).origin : undefined;
const manifestTools: Omit<ManifestToolOptions, "principal" | "oauth"> | undefined = manifestUploads ? {
  uploads: manifestUploads,
  drafts: manifestDrafts,
  uploadOrigin,
  allowCreate: async (ownerId: string) => (await manifestLimiter!.check(`manifest:${ownerId}`)).allowed,
  allowDraftOperation: async (ownerId: string) => (await draftOperationLimiter!.check(`manifest-draft:${ownerId}`)).allowed,
} : undefined;
const manifestUploadHandler = manifestUploads ? createManifestUploadHandler(manifestUploads) : undefined;
// Bounded global cleanup, including abandoned uploads from accounts that never return.
const sweepManifestUploads = () => { void manifestUploads?.pruneExpired().catch(() => console.error("[generative-arcana-mcp] manifest cleanup unavailable")); };
const manifestCleanupTimer = manifestUploads ? setInterval(sweepManifestUploads, 60_000) : undefined;
manifestCleanupTimer?.unref();
if (manifestUploads) sweepManifestUploads();
const deploymentFeatures = {
  durableCatalog: stateMode === "neon" && !!catalog,
  mcpOAuth: !!oauth,
  browserAuth: !!browserAuth,
  webApp: !!webAppDistDir,
  alphaAuth: !!alphaToken,
};
const build = deploymentBuildIdentity();
const dependencies = createDeploymentDependencyMonitor({
  // Read-only connectivity, deliberately not a schema migration or access to any user's library.
  ...(databaseUrl ? { databaseConnectivity: async (signal: AbortSignal) => {
    const sql = neon(databaseUrl);
    await sql.query("SELECT principal_id FROM arcana_external_identities LIMIT 0", [], { fetchOptions: { signal } });
    await sql.query("SELECT id, owner_id, manifest FROM arcana_user_decks LIMIT 0", [], { fetchOptions: { signal } });
    await sql.query("SELECT scope_id, state FROM arcana_host_state LIMIT 0", [], { fetchOptions: { signal } });
    await sql.query("SELECT key, bucket, count FROM arcana_rate_limits LIMIT 0", [], { fetchOptions: { signal } });
    if (manifestUploads) await sql.query("SELECT id,owner_id,raw_json,import_result,draft_version,draft_key,draft_history,draft_json FROM arcana_manifest_uploads LIMIT 0", [], { fetchOptions: { signal } });
    if (browserAuth) await browserAuth.checkSchema();
    if (artwork) {
      await sql.query("SELECT deck_id, card_slug, asset FROM arcana_card_artwork LIMIT 0", [], { fetchOptions: { signal } });
      await sql.query("SELECT deck_id,pack_id,label FROM arcana_visual_packs LIMIT 0", [], { fetchOptions: { signal } });
      await sql.query("SELECT deck_id,pack_id,card_slug,asset FROM arcana_visual_pack_artwork LIMIT 0", [], { fetchOptions: { signal } });
    }
  } } : {}),
  ...(oauth ? { issuerDiscovery: async (signal: AbortSignal) => {
    await loadAuthorizationServerMetadata(oauth.issuer, (input, init) => browserAuth
      ? browserAuth.handler(new Request(input, { ...init, signal }))
      : fetch(input, { ...init, signal }));
  } } : {}),
});

if (alphaToken && stateMode === "memory") {
  console.error("[generative-arcana-mcp] MCP_ALPHA_TOKEN enabled without durable storage; authenticated imports are process-lifetime only");
}

const requestHandler = createArcanaHttpRequestHandler({
  manifestUploads: manifestTools,
  artwork,
  maxRequestBytes,
  principalResolver,
  hosts,
  ...(catalog ? { catalog } : {}),
  oauth: oauth
    ? {
        resourceMetadataUrl: oauth.resourceMetadataUrl,
        readScopes: oauth.readScopes,
        writeScopes: oauth.writeScopes,
      }
    : undefined,
});
const authoringHandler = createArcanaAuthoringRequestHandler({ maxRequestBytes });
const webCatalogHandler = catalog ? createArcanaWebCatalogRequestHandler({
  catalog,
  hosts,
  principalResolver,
  browserPrincipalResolver,
  ...(oauth ? { oauth: { resourceMetadataUrl: oauth.resourceMetadataUrl, readScopes: oauth.readScopes, writeScopes: oauth.writeScopes } } : {}),
  maxRequestBytes,
}) : undefined;
const webArtworkHandler = catalog ? createWebArtworkHandler({ catalog, hosts, artwork, principalResolver, browserPrincipalResolver,
  ...(oauth ? { oauth: { resourceMetadataUrl: oauth.resourceMetadataUrl, readScopes: oauth.readScopes, writeScopes: oauth.writeScopes } } : {}) }) : undefined;
const validateHost = hostHeaderValidation(allowedHosts);
const validateOrigin = originValidation(allowedOrigins);

const http = createServer((req, res) => {
  void handleHttpRequest(req, res).catch(() => {
    // Auth/database errors may contain secrets. Expose only a bounded service error.
    if (!res.headersSent && !res.destroyed) {
      res.writeHead(503, { "content-type": "application/json", "cache-control": "no-store" });
      res.end(JSON.stringify({ error: "service_unavailable" }));
    } else if (!res.destroyed) res.end();
  });
});

async function handleHttpRequest(req: IncomingMessage, res: ServerResponse): Promise<void> {
  res.setHeader("referrer-policy", "no-referrer");
  res.setHeader("x-content-type-options", "nosniff");
  // Discard client-supplied auth IP metadata before any Better Auth processing.
  req.headers["x-arcana-client-ip"] = requestClientIp(req);
  const url = new URL(req.url ?? "/", `http://${req.headers.host ?? "localhost"}`);

  if (url.pathname === "/healthz") {
    res.writeHead(200, { "content-type": "application/json", "cache-control": "no-store" });
    res.end(JSON.stringify({
      ok: true,
      service: "generative-arcana-mcp",
      version: ARCANA_MCP_VERSION,
      build,
      runtime: process.env.VERCEL ? "vercel-container" : "node-http",
      auth: oauth ? "oauth-oidc" : principalResolver ? "alpha-bearer" : "anonymous",
      browserAuth: browserAuth ? "better-auth" : "disabled",
      state: stateMode,
      readiness: accountDeploymentReadiness(deploymentFeatures, dependencies.snapshot()),
      limits: { maxRequestBytes, requestsPerMinute },
    }));
    return;
  }

  if (url.pathname === "/readyz") {
    if (!validateHost(req, res)) return;
    void dependencies.check().then((evidence) => {
      if (res.destroyed) return;
      const readiness = accountDeploymentReadiness(deploymentFeatures, evidence);
      res.writeHead(readiness.productionAccounts ? 200 : 503, {
        "content-type": "application/json",
        "cache-control": "no-store",
      });
      res.end(JSON.stringify({ ok: readiness.productionAccounts, build, readiness }));
    });
    return;
  }

  if (!browserAuth && oauth && req.method === "GET" && oauth.metadataPaths.includes(url.pathname)) {
    if (!validateHost(req, res)) return;
    res.writeHead(200, {
      "content-type": "application/json",
      "cache-control": "public, max-age=300",
    });
    res.end(JSON.stringify(protectedResourceMetadata(oauth)));
    return;
  }

  // Compatibility for MCP clients that still look for authorization-server metadata on the
  // resource server instead of following RFC 9728 protected-resource metadata. The upstream
  // issuer remains the source of truth; we validate its exact issuer before proxying the document.
  if (!browserAuth && oauth && req.method === "GET" && url.pathname === "/.well-known/oauth-authorization-server") {
    if (!validateHost(req, res)) return;
    void proxyAuthorizationServerMetadata(oauth.issuer, res);
    return;
  }

  const isManifestUploadRequest = isManifestUploadPath(url.pathname);
  const isAuthoringRequest = isArcanaAuthoringPath(url.pathname);
  const isWebCatalogRequest = isArcanaWebCatalogPath(url.pathname);
  const isBrowserAuthRequest = browserAuth ? isBetterAuthRequestPath(url.pathname)
    : ["/auth/login", "/auth/session", "/auth/logout"].includes(url.pathname);
  if (url.pathname !== "/mcp" && !isAuthoringRequest && !isWebCatalogRequest && !isBrowserAuthRequest && !isManifestUploadRequest) {
    if (webAppDistDir && validateHost(req, res) && serveArcanaWebApp(req, res, webAppDistDir)) return;
    if (res.headersSent) return;
    res.writeHead(404, { "content-type": "application/json" });
    res.end(JSON.stringify({ error: "not_found" }));
    return;
  }

  if (!validateHost(req, res)) return;
  const requiresOrigin = isManifestUploadRequest || url.pathname === "/mcp"
    || isWebCatalogRequest
    || (isAuthoringRequest && req.method === "POST")
    || (isBrowserAuthRequest && url.pathname.startsWith("/auth/") && req.method === "POST");
  if (requiresOrigin && !validateOrigin(req, res)) return;

  const contentLength = parseContentLength(req.headers["content-length"]);
  if (contentLength !== undefined && contentLength > maxRequestBytes) {
    res.writeHead(413, { "content-type": "application/json" });
    res.end(JSON.stringify({ error: "request_too_large" }));
    return;
  }

  const decision = await rateLimiter.check(requestClientIp(req));
  if (!decision.allowed) {
    res.writeHead(429, {
      "content-type": "application/json",
      "retry-after": String(decision.retryAfterSeconds),
    });
    res.end(JSON.stringify({ error: "rate_limited" }));
    return;
  }

  if (isManifestUploadRequest) {
    if (!manifestUploadHandler) { res.writeHead(503, { "content-type": "application/json", "cache-control": "no-store" }); res.end(JSON.stringify({ error: "manifest_staging_unavailable" })); return; }
    await manifestUploadHandler(req, res); return;
  }

  if (isAuthoringRequest) {
    void authoringHandler(req, res);
    return;
  }

  if (isBrowserAuthRequest) {
    if (!browserAuthHandler) {
      res.writeHead(503, { "content-type": "application/json", "cache-control": "no-store" });
      res.end(JSON.stringify({ error: "browser_auth_unavailable" }));
      return;
    }
    await browserAuthHandler(req, res);
    return;
  }

  if (isArtworkPath(url.pathname) && webArtworkHandler) {
    await webArtworkHandler(req, res);
    return;
  }
  if (isWebCatalogRequest) {
    if (!webCatalogHandler) {
      res.writeHead(503, { "content-type": "application/json" });
      res.end(JSON.stringify({ error: "catalog_unavailable" }));
      return;
    }
    void webCatalogHandler(req, res);
    return;
  }

  await requestHandler(req, res);
}

http.listen(port, host, () => {
  console.error(`[generative-arcana-mcp] v${ARCANA_MCP_VERSION} listening on http://${host}:${port}/mcp`);
});

async function proxyAuthorizationServerMetadata(issuer: string, res: ServerResponse): Promise<void> {
  try {
    const metadata = await loadAuthorizationServerMetadata(issuer);
    if (res.headersSent || res.destroyed) return;
    res.writeHead(200, {
      "content-type": "application/json",
      "cache-control": "public, max-age=300",
    });
    res.end(JSON.stringify(metadata));
  } catch (error) {
    if (res.headersSent || res.destroyed) return;
    res.writeHead(502, { "content-type": "application/json" });
    res.end(JSON.stringify({
      error: "authorization_metadata_unavailable",
      message: error instanceof Error ? error.message : "Authorization metadata unavailable.",
    }));
  }
}

async function shutdown(signal: string) {
  console.error(`[generative-arcana-mcp] ${signal}; shutting down`);
  void artworkPool?.end();
  if (manifestCleanupTimer) clearInterval(manifestCleanupTimer);
  void manifestPool?.end();
  http.close(() => { void browserAuth?.close().finally(() => process.exit(0)); if (!browserAuth) process.exit(0); });
}

process.once("SIGINT", () => void shutdown("SIGINT"));
process.once("SIGTERM", () => void shutdown("SIGTERM"));

export type { ArcanaHttpOAuthOptions } from "./httpToolAuthorization";

export interface ArcanaHttpRequestHandlerOptions {
  manifestUploads?: Omit<ManifestToolOptions, "principal" | "oauth">;
  artwork?: CardArtworkService;
  principalResolver?: PrincipalResolver;
  hosts?: ArcanaHostStore;
  catalog?: UserDeckCatalogRepository;
  oauth?: ArcanaHttpOAuthOptions;
  maxRequestBytes?: number;
}

/** Node request handler whose state policy is selected per request. */
export function createArcanaHttpRequestHandler(options: ArcanaHttpRequestHandlerOptions = {}) {
  const anonymousAdapter = createArcanaAdapter();
  const hosts = options.hosts ?? new InMemoryArcanaHostStore();
  const maxRequestBodySize = options.maxRequestBytes ?? 4_000_000;

  return async (req: IncomingMessage, res: ServerResponse) => {
    try {
      const access = await resolveArcanaRequestAccess(
        toPrincipalRequest(req),
        anonymousAdapter,
        hosts,
        options.principalResolver,
      );
      const handler = createMcpHandler(() => createArcanaMcpServer({
        manifestUploads: options.manifestUploads,
        artwork: options.artwork,
        adapter: access.adapter,
        includeStatefulTools: access.includeStatefulTools,
        principal: access.principal,
        ...(options.catalog ? { catalog: options.catalog } : {}),
        oauth: options.oauth
          ? {
              principal: access.principal,
              resourceMetadataUrl: options.oauth.resourceMetadataUrl,
              readScopes: options.oauth.readScopes,
              writeScopes: options.oauth.writeScopes,
            }
          : undefined,
        onToolCall: jsonToolCallObserver({ transport: "http", principalId: access.principal?.id }),
      }), { maxRequestBodySize });
      const nodeHandler = toNodeHandler(
        withArcanaHttpToolAuthorization(handler, access.principal, options.oauth),
        { maxRequestBodySize },
      );
      res.once("finish", () => void handler.close());
      res.once("close", () => void handler.close());
      await nodeHandler(req, res);
    } catch (error) {
      if (res.headersSent) {
        res.end();
        return;
      }

      if (error instanceof OAuthPrincipalError && options.oauth) {
        res.writeHead(error.statusCode, {
          "content-type": "application/json",
          "www-authenticate": bearerChallenge({
            resourceMetadataUrl: options.oauth.resourceMetadataUrl,
            scopes: error.scopes,
            error: error.oauthError,
            description: error.message,
          }),
        });
        res.end(JSON.stringify({
          error: error.oauthError,
          message: error.message,
        }));
        return;
      }

      res.writeHead(401, { "content-type": "application/json" });
      res.end(JSON.stringify({ error: "principal_resolution_failed", message: error instanceof Error ? error.message : "Unauthorized" }));
    }
  };
}

function createHostStore(options: { databaseUrl?: string; stateDir?: string }): {
  hosts: ArcanaHostStore;
  catalog?: UserDeckCatalogRepository;
  stateMode: "neon" | "filesystem" | "memory";
} {
  if (options.databaseUrl) {
    const catalog = new NeonUserDeckCatalogRepository(options.databaseUrl);
    return {
      hosts: new PersistentArcanaHostStore(
        new NeonArcanaHostStateRepository(options.databaseUrl),
        createArcanaAdapter,
        catalog,
      ),
      catalog,
      stateMode: "neon",
    };
  }
  if (options.stateDir) {
    return {
      hosts: new PersistentArcanaHostStore(new FileArcanaHostStateRepository(options.stateDir)),
      stateMode: "filesystem",
    };
  }
  return { hosts: new InMemoryArcanaHostStore(), stateMode: "memory" };
}

interface OAuthRuntimeConfiguration extends OAuthResourceConfiguration {
  jwksUri?: string;
  resourceMetadataUrl: string;
  metadataPaths: string[];
}

function oauthRuntimeConfiguration(input: {
  issuer?: string;
  resource?: string;
  jwksUri?: string;
  readScopes: string[];
  writeScopes: string[];
}): OAuthRuntimeConfiguration | undefined {
  if (!input.issuer && !input.resource && !input.jwksUri) return undefined;
  if (!input.issuer || !input.resource) {
    throw new Error("OAuth requires both MCP_OAUTH_ISSUER and MCP_OAUTH_RESOURCE.");
  }
  const readScopes = requireScopes(input.readScopes, "MCP_OAUTH_READ_SCOPES");
  const writeScopes = requireScopes(input.writeScopes, "MCP_OAUTH_WRITE_SCOPES");
  return {
    issuer: input.issuer,
    resource: input.resource,
    ...(input.jwksUri ? { jwksUri: input.jwksUri } : {}),
    readScopes,
    writeScopes,
    resourceMetadataUrl: protectedResourceMetadataUrl(input.resource),
    metadataPaths: protectedResourceMetadataPaths(input.resource),
  };
}

function requireScopes(scopes: readonly string[], label: string): string[] {
  const normalized = [...new Set(scopes.map((scope) => scope.trim()).filter(Boolean))].sort();
  if (!normalized.length) throw new Error(`${label} must contain at least one scope.`);
  return normalized;
}

function toPrincipalRequest(req: IncomingMessage): PrincipalRequest {
  const headers = new Headers();
  for (const [name, value] of Object.entries(req.headers)) {
    if (Array.isArray(value)) for (const item of value) headers.append(name, item);
    else if (value !== undefined) headers.set(name, value);
  }
  return {
    method: req.method ?? "GET",
    url: req.url ?? "/",
    headers,
  };
}

function csv(value: string | undefined): string[] | undefined {
  if (value === undefined) return undefined;
  return value.split(",").map((part) => part.trim()).filter(Boolean);
}

function optionalEnv(value: string | undefined): string | undefined {
  const trimmed = value?.trim();
  return trimmed ? trimmed : undefined;
}

function deploymentAllowlist(bindHost: string): string[] {
  const hosts = new Set<string>();
  if (["127.0.0.1", "localhost", "::1", "[::1]"].includes(bindHost)) {
    hosts.add("localhost");
    hosts.add("127.0.0.1");
    hosts.add("[::1]");
  }
  for (const value of [process.env.VERCEL_URL, process.env.VERCEL_PROJECT_PRODUCTION_URL, process.env.VERCEL_BRANCH_URL]) {
    const hostname = value?.trim().replace(/^https?:\/\//, "").replace(/\/.*$/, "");
    if (hostname) hosts.add(hostname);
  }
  return [...hosts];
}

function envPort(value: string | undefined, fallback: number): number {
  if (value === undefined) return fallback;
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < 1 || parsed > 65535) throw new Error("PORT must be an integer from 1 to 65535.");
  return parsed;
}
