import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { createMcpHandler } from "@modelcontextprotocol/server";
import { hostHeaderValidation, originValidation, toNodeHandler } from "@modelcontextprotocol/node";
import { createArcanaMcpServer } from "./server";
import { StaticBearerPrincipalResolver } from "./alphaAuth";
import { FileArcanaHostStateRepository } from "./fileHostStateRepository";
import {
  createBundledArcanaAdapter,
  InMemoryArcanaHostStore,
  PersistentArcanaHostStore,
  type ArcanaHostStore,
} from "./hostStore";
import { resolveArcanaRequestAccess, type PrincipalRequest, type PrincipalResolver } from "./principal";

const port = envPort(process.env.PORT, 3000);
const host = process.env.HOST?.trim() || "127.0.0.1";
const allowedHosts = csv(process.env.MCP_ALLOWED_HOSTS) ?? loopbackAllowlist(host);
const allowedOrigins = csv(process.env.MCP_ALLOWED_ORIGINS) ?? allowedHosts;
const alphaToken = optionalEnv(process.env.MCP_ALPHA_TOKEN);
const alphaPrincipalId = optionalEnv(process.env.MCP_ALPHA_PRINCIPAL_ID) ?? "alpha-user-v1";
const stateDir = optionalEnv(process.env.MCP_STATE_DIR);

if (!allowedHosts.length) {
  throw new Error("Public MCP HTTP binding requires MCP_ALLOWED_HOSTS (comma-separated hostnames).");
}

const principalResolver = alphaToken ? new StaticBearerPrincipalResolver(alphaToken, alphaPrincipalId) : undefined;
const hosts: ArcanaHostStore = stateDir
  ? new PersistentArcanaHostStore(new FileArcanaHostStateRepository(stateDir))
  : new InMemoryArcanaHostStore();

if (alphaToken && !stateDir) {
  console.error("[generative-arcana-mcp] MCP_ALPHA_TOKEN enabled without MCP_STATE_DIR; authenticated imports are process-lifetime only");
}

const requestHandler = createArcanaHttpRequestHandler({ principalResolver, hosts });
const validateHost = hostHeaderValidation(allowedHosts);
const validateOrigin = originValidation(allowedOrigins);

const http = createServer((req, res) => {
  const url = new URL(req.url ?? "/", `http://${req.headers.host ?? "localhost"}`);

  if (url.pathname === "/healthz") {
    res.writeHead(200, { "content-type": "application/json" });
    res.end(JSON.stringify({
      ok: true,
      service: "generative-arcana-mcp",
      auth: principalResolver ? "alpha-bearer" : "anonymous",
      state: stateDir ? "durable" : "memory",
    }));
    return;
  }

  if (url.pathname !== "/mcp") {
    res.writeHead(404, { "content-type": "application/json" });
    res.end(JSON.stringify({ error: "not_found" }));
    return;
  }

  if (!validateHost(req, res) || !validateOrigin(req, res)) return;
  void requestHandler(req, res);
});

http.listen(port, host, () => {
  console.error(`[generative-arcana-mcp] listening on http://${host}:${port}/mcp`);
});

async function shutdown(signal: string) {
  console.error(`[generative-arcana-mcp] ${signal}; shutting down`);
  http.close(() => process.exit(0));
}

process.once("SIGINT", () => void shutdown("SIGINT"));
process.once("SIGTERM", () => void shutdown("SIGTERM"));

export interface ArcanaHttpRequestHandlerOptions {
  principalResolver?: PrincipalResolver;
  hosts?: ArcanaHostStore;
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
      res.writeHead(401, { "content-type": "application/json" });
      res.end(JSON.stringify({ error: "principal_resolution_failed", message: error instanceof Error ? error.message : "Unauthorized" }));
    }
  };
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

function loopbackAllowlist(bindHost: string): string[] {
  if (["127.0.0.1", "localhost", "::1", "[::1]"].includes(bindHost)) {
    return ["localhost", "127.0.0.1", "[::1]"];
  }
  return [];
}

function envPort(value: string | undefined, fallback: number): number {
  if (value === undefined) return fallback;
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < 1 || parsed > 65535) throw new Error("PORT must be an integer from 1 to 65535.");
  return parsed;
}
