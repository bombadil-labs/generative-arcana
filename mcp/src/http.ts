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
  createBundledArcanaAdapter,
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
import {
  createWorkOSBrowserAuthRequestHandler,
  isArcanaBrowserAuthPath,
  WorkOSBrowserAuthAdapter,
  type WorkOSBrowserAuthConfiguration,
} from "./workosBrowserAuth";
import { serveArcanaWebApp } from "./webAppStatic";

const port = envPort(process.env.PORT, 3000);
const host = process.env.HOST?.trim() || "127.0.0.1";
const allowedHosts = csv(process.env.MCP_ALLOWED_HOSTS) ?? deploymentAllowlist(host);
const allowedOrigins = csv(process.env.MCP_ALLOWED_ORIGINS) ?? allowedHosts;
const alphaToken = optionalEnv(process.env.MCP_ALPHA_TOKEN);
const alphaPrincipalId = optionalEnv(process.env.MCP_ALPHA_PRINCIPAL_ID) ?? "alpha-user-v1";
const stateDir = optionalEnv(process.env.MCP_STATE_DIR);
const databaseUrl = optionalEnv(process.env.DATABASE_URL);
const webAppDistDir = optionalEnv(process.env.ARCANA_WEB_DIST_DIR);
const oauth = oauthRuntimeConfiguration({
  issuer: optionalEnv(process.env.MCP_OAUTH_ISSUER),
  resource: optionalEnv(process.env.MCP_OAUTH_RESOURCE),
  jwksUri: optionalEnv(process.env.MCP_OAUTH_JWKS_URI),
  readScopes: csv(process.env.MCP_OAUTH_READ_SCOPES) ?? [...DEFAULT_DECK_READ_SCOPES],
  writeScopes: csv(process.env.MCP_OAUTH_WRITE_SCOPES) ?? [...DEFAULT_DECK_WRITE_SCOPES],
});
const browserAuthConfig = workosBrowserAuthConfiguration({
  apiKey: optionalEnv(process.env.WORKOS_API_KEY),
  clientId: optionalEnv(process.env.WORKOS_CLIENT_ID),
  cookiePassword: optionalEnv(process.env.WORKOS_COOKIE_PASSWORD),
  redirectUri: optionalEnv(process.env.WORKOS_REDIRECT_URI),
  identityIssuer: optionalEnv(process.env.WORKOS_IDENTITY_ISSUER),
  oauthIssuer: oauth?.issuer,
  cookieName: optionalEnv(process.env.ARCANA_SESSION_COOKIE),
});
const maxRequestBytes = positiveIntEnv(process.env.MCP_MAX_REQUEST_BYTES, 4_000_000, "MCP_MAX_REQUEST_BYTES");
const requestsPerMinute = positiveIntEnv(process.env.MCP_RATE_LIMIT_PER_MINUTE, 120, "MCP_RATE_LIMIT_PER_MINUTE");
const rateLimiter = new FixedWindowRateLimiter(requestsPerMinute);

if (!allowedHosts.length) {
  throw new Error("Public MCP HTTP binding requires MCP_ALLOWED_HOSTS or a recognized Vercel deployment hostname.");
}
if (alphaToken && oauth) {
  throw new Error("Configure either MCP_ALPHA_TOKEN or MCP_OAUTH_ISSUER/MCP_OAUTH_RESOURCE, not both.");
}
if (oauth && !databaseUrl) {
  throw new Error("OAuth identity requires DATABASE_URL so external identities map to durable Arcana principals.");
}
if (browserAuthConfig && !databaseUrl) {
  throw new Error("Browser account sessions require DATABASE_URL so external identities map to durable Arcana principals.");
}

const identities = databaseUrl ? new NeonExternalIdentityRepository(databaseUrl) : undefined;
const principalResolver = oauth
  ? new OAuthPrincipalResolver(
      new OidcJwtBearerIdentityVerifier(oauth.issuer, oauth.resource, oauth.jwksUri),
      identities!,
      oauth.readScopes,
    )
  : alphaToken
    ? new StaticBearerPrincipalResolver(alphaToken, alphaPrincipalId)
    : undefined;
const browserAuth = browserAuthConfig ? new WorkOSBrowserAuthAdapter(browserAuthConfig) : undefined;
const browserPrincipalResolver = browserAuth && identities
  ? new ExternalIdentityBrowserPrincipalResolver(browserAuth, identities)
  : undefined;
const browserAuthHandler = browserAuth ? createWorkOSBrowserAuthRequestHandler(browserAuth) : undefined;
const { hosts, catalog, stateMode } = createHostStore({ databaseUrl, stateDir });

if (alphaToken && stateMode === "memory") {
  console.error("[generative-arcana-mcp] MCP_ALPHA_TOKEN enabled without durable storage; authenticated imports are process-lifetime only");
}

const requestHandler = createArcanaHttpRequestHandler({
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
const webCatalogHandler = catalog ? createArcanaWebCatalogRequestHandler({
  catalog,
  hosts,
  principalResolver,
  browserPrincipalResolver,
  ...(oauth ? { oauth: { resourceMetadataUrl: oauth.resourceMetadataUrl, readScopes: oauth.readScopes, writeScopes: oauth.writeScopes } } : {}),
  maxRequestBytes,
}) : undefined;
const validateHost = hostHeaderValidation(allowedHosts);
const validateOrigin = originValidation(allowedOrigins);

const http = createServer((req, res) => {
  const url = new URL(req.url ?? "/", `http://${req.headers.host ?? "localhost"}`);

  if (url.pathname === "/healthz") {
    res.writeHead(200, { "content-type": "application/json" });
    res.end(JSON.stringify({
      ok: true,
      service: "generative-arcana-mcp",
      version: ARCANA_MCP_VERSION,
      runtime: process.env.VERCEL ? "vercel-container" : "node-http",
      auth: oauth ? "oauth-oidc" : principalResolver ? "alpha-bearer" : "anonymous",
      browserAuth: browserAuth ? "workos-authkit" : "disabled",
      state: stateMode,
      limits: { maxRequestBytes, requestsPerMinute },
    }));
    return;
  }

  if (oauth && req.method === "GET" && oauth.metadataPaths.includes(url.pathname)) {
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
  if (oauth && req.method === "GET" && url.pathname === "/.well-known/oauth-authorization-server") {
    if (!validateHost(req, res)) return;
    void proxyAuthorizationServerMetadata(oauth.issuer, res);
    return;
  }

  const isWebCatalogRequest = isArcanaWebCatalogPath(url.pathname);
  const isBrowserAuthRequest = isArcanaBrowserAuthPath(url.pathname);
  if (url.pathname !== "/mcp" && !isWebCatalogRequest && !isBrowserAuthRequest) {
    if (webAppDistDir && validateHost(req, res) && serveArcanaWebApp(req, res, webAppDistDir)) return;
    if (res.headersSent) return;
    res.writeHead(404, { "content-type": "application/json" });
    res.end(JSON.stringify({ error: "not_found" }));
    return;
  }

  if (!validateHost(req, res)) return;
  const requiresOrigin = url.pathname === "/mcp"
    || isWebCatalogRequest
    || (isBrowserAuthRequest && req.method === "POST");
  if (requiresOrigin && !validateOrigin(req, res)) return;

  const contentLength = parseContentLength(req.headers["content-length"]);
  if (contentLength !== undefined && contentLength > maxRequestBytes) {
    res.writeHead(413, { "content-type": "application/json" });
    res.end(JSON.stringify({ error: "request_too_large" }));
    return;
  }

  const decision = rateLimiter.check(req.socket.remoteAddress ?? "unknown");
  if (!decision.allowed) {
    res.writeHead(429, {
      "content-type": "application/json",
      "retry-after": String(decision.retryAfterSeconds),
    });
    res.end(JSON.stringify({ error: "rate_limited" }));
    return;
  }

  if (isBrowserAuthRequest) {
    if (!browserAuthHandler) {
      res.writeHead(503, { "content-type": "application/json", "cache-control": "no-store" });
      res.end(JSON.stringify({ error: "browser_auth_unavailable" }));
      return;
    }
    void browserAuthHandler(req, res);
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

  void requestHandler(req, res);
});

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
  http.close(() => process.exit(0));
}

process.once("SIGINT", () => void shutdown("SIGINT"));
process.once("SIGTERM", () => void shutdown("SIGTERM"));

export interface ArcanaHttpOAuthOptions {
  resourceMetadataUrl: string;
  readScopes: readonly string[];
  writeScopes: readonly string[];
}

export interface ArcanaHttpRequestHandlerOptions {
  principalResolver?: PrincipalResolver;
  hosts?: ArcanaHostStore;
  catalog?: UserDeckCatalogRepository;
  oauth?: ArcanaHttpOAuthOptions;
}

/** Node request handler whose state policy is selected per request. */
export function createArcanaHttpRequestHandler(options: ArcanaHttpRequestHandlerOptions = {}) {
  const anonymousAdapter = createBundledArcanaAdapter();
  const hosts = options.hosts ?? new InMemoryArcanaHostStore();

  return async (req: IncomingMessage, res: ServerResponse) => {
    try {
      const access = await resolveArcanaRequestAccess(
        toPrincipalRequest(req),
        anonymousAdapter,
        hosts,
        options.principalResolver,
      );
      const handler = createMcpHandler(() => createArcanaMcpServer({
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
      }));
      const nodeHandler = toNodeHandler(handler);
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
        createBundledArcanaAdapter,
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

function workosBrowserAuthConfiguration(input: {
  apiKey?: string;
  clientId?: string;
  cookiePassword?: string;
  redirectUri?: string;
  identityIssuer?: string;
  oauthIssuer?: string;
  cookieName?: string;
}): WorkOSBrowserAuthConfiguration | undefined {
  const configured = [input.apiKey, input.clientId, input.cookiePassword, input.redirectUri, input.identityIssuer]
    .some((value) => value !== undefined);
  if (!configured) return undefined;

  const apiKey = requireConfigValue(input.apiKey, "WORKOS_API_KEY");
  const clientId = requireConfigValue(input.clientId, "WORKOS_CLIENT_ID");
  const cookiePassword = requireConfigValue(input.cookiePassword, "WORKOS_COOKIE_PASSWORD");
  const redirectUri = requireConfigValue(input.redirectUri, "WORKOS_REDIRECT_URI");
  const issuer = requireConfigValue(input.identityIssuer ?? input.oauthIssuer, "WORKOS_IDENTITY_ISSUER or MCP_OAUTH_ISSUER");

  if (input.identityIssuer && input.oauthIssuer && new URL(input.identityIssuer).href !== new URL(input.oauthIssuer).href) {
    throw new Error("WORKOS_IDENTITY_ISSUER must match MCP_OAUTH_ISSUER so browser and MCP sessions resolve the same account.");
  }

  return {
    apiKey,
    clientId,
    cookiePassword,
    redirectUri,
    issuer,
    ...(input.cookieName ? { cookieName: input.cookieName } : {}),
  };
}

function requireConfigValue(value: string | undefined, label: string): string {
  if (!value) throw new Error(`${label} is required when browser AuthKit sessions are configured.`);
  return value;
}

function envPort(value: string | undefined, fallback: number): number {
  if (value === undefined) return fallback;
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < 1 || parsed > 65535) throw new Error("PORT must be an integer from 1 to 65535.");
  return parsed;
}
