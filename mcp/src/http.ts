import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { createMcpHandler } from "@modelcontextprotocol/server";
import { hostHeaderValidation, originValidation, toNodeHandler } from "@modelcontextprotocol/node";
import { createArcanaMcpServer } from "./server";
import { StaticBearerPrincipalResolver } from "./alphaAuth";
import { FileArcanaHostStateRepository } from "./fileHostStateRepository";
import { NeonArcanaHostStateRepository } from "./neonHostStateRepository";
import { NeonExternalIdentityRepository } from "./neonExternalIdentityRepository";
import { NeonUserDeckCatalogRepository } from "./neonUserDeckCatalog";
import {
  OAuthPrincipalError,
  OAuthPrincipalResolver,
  OidcJwtBearerIdentityVerifier,
} from "./oauthIdentity";
import {
  bearerChallenge,
  DEFAULT_DECK_READ_SCOPES,
  DEFAULT_DECK_WRITE_SCOPES,
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

const port = envPort(process.env.PORT, 3000);
const host = process.env.HOST?.trim() || "127.0.0.1";
const allowedHosts = csv(process.env.MCP_ALLOWED_HOSTS) ?? deploymentAllowlist(host);
const allowedOrigins = csv(process.env.MCP_ALLOWED_ORIGINS) ?? allowedHosts;
const alphaToken = optionalEnv(process.env.MCP_ALPHA_TOKEN);
const alphaPrincipalId = optionalEnv(process.env.MCP_ALPHA_PRINCIPAL_ID) ?? "alpha-user-v1";
const stateDir = optionalEnv(process.env.MCP_STATE_DIR);
const databaseUrl = optionalEnv(process.env.DATABASE_URL);
const oauth = oauthRuntimeConfiguration({
  issuer: optionalEnv(process.env.MCP_OAUTH_ISSUER),
  resource: optionalEnv(process.env.MCP_OAUTH_RESOURCE),
  jwksUri: optionalEnv(process.env.MCP_OAUTH_JWKS_URI),
  readScopes: csv(process.env.MCP_OAUTH_READ_SCOPES) ?? [...DEFAULT_DECK_READ_SCOPES],
  writeScopes: csv(process.env.MCP_OAUTH_WRITE_SCOPES) ?? [...DEFAULT_DECK_WRITE_SCOPES],
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

const principalResolver = oauth
  ? new OAuthPrincipalResolver(
      new OidcJwtBearerIdentityVerifier(oauth.issuer, oauth.resource, oauth.jwksUri),
      new NeonExternalIdentityRepository(databaseUrl!),
      oauth.readScopes,
    )
  : alphaToken
    ? new StaticBearerPrincipalResolver(alphaToken, alphaPrincipalId)
    : undefined;
const { hosts, stateMode } = createHostStore({ databaseUrl, stateDir });

if (alphaToken && stateMode === "memory") {
  console.error("[generative-arcana-mcp] MCP_ALPHA_TOKEN enabled without durable storage; authenticated imports are process-lifetime only");
}

const requestHandler = createArcanaHttpRequestHandler({
  principalResolver,
  hosts,
  oauth: oauth
    ? {
        resourceMetadataUrl: oauth.resourceMetadataUrl,
        readScopes: oauth.readScopes,
        writeScopes: oauth.writeScopes,
      }
    : undefined,
});
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

  if (url.pathname !== "/mcp") {
    res.writeHead(404, { "content-type": "application/json" });
    res.end(JSON.stringify({ error: "not_found" }));
    return;
  }

  if (!validateHost(req, res) || !validateOrigin(req, res)) return;

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

  void requestHandler(req, res);
});

http.listen(port, host, () => {
  console.error(`[generative-arcana-mcp] v${ARCANA_MCP_VERSION} listening on http://${host}:${port}/mcp`);
});

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

function createHostStore(options: { databaseUrl?: string; stateDir?: string }): { hosts: ArcanaHostStore; stateMode: "neon" | "filesystem" | "memory" } {
  if (options.databaseUrl) {
    return {
      hosts: new PersistentArcanaHostStore(
        new NeonArcanaHostStateRepository(options.databaseUrl),
        createBundledArcanaAdapter,
        new NeonUserDeckCatalogRepository(options.databaseUrl),
      ),
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
