import { createServer, type IncomingMessage } from "node:http";
import { createMcpHandler } from "@modelcontextprotocol/server";
import { hostHeaderValidation, originValidation, toNodeHandler } from "@modelcontextprotocol/node";
import { createArcanaMcpServer } from "./server";
import { createBundledArcanaAdapter, InMemoryArcanaHostStore } from "./hostStore";
import { resolveArcanaRequestAccess, type PrincipalRequest, type PrincipalResolver } from "./principal";

const port = envPort(process.env.PORT, 3000);
const host = process.env.HOST?.trim() || "127.0.0.1";
const allowedHosts = csv(process.env.MCP_ALLOWED_HOSTS) ?? loopbackAllowlist(host);
const allowedOrigins = csv(process.env.MCP_ALLOWED_ORIGINS) ?? allowedHosts;

if (!allowedHosts.length) {
  throw new Error("Public MCP HTTP binding requires MCP_ALLOWED_HOSTS (comma-separated hostnames).");
}

// Anonymous HTTP remains the proven stateless/read-oriented surface. A future auth integration can
// provide a PrincipalResolver and scoped host store to createArcanaHttpRequestHandler without changing
// tool semantics. The executable alpha intentionally supplies no resolver yet.
const requestHandler = createArcanaHttpRequestHandler();
const validateHost = hostHeaderValidation(allowedHosts);
const validateOrigin = originValidation(allowedOrigins);

const http = createServer((req, res) => {
  const url = new URL(req.url ?? "/", `http://${req.headers.host ?? "localhost"}`);

  if (url.pathname === "/healthz") {
    res.writeHead(200, { "content-type": "application/json" });
    res.end(JSON.stringify({ ok: true, service: "generative-arcana-mcp" }));
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
  hosts?: InMemoryArcanaHostStore;
}

/**
 * Node request handler whose state policy is selected per request.
 *
 * Anonymous requests get a shared immutable bundled adapter with stateful tools omitted. Authenticated
 * principals get a stable isolated host and therefore may use stateful tools such as `import_deck`.
 * Each MCP protocol handler still creates fresh McpServer objects per request, as required by the v2
 * stateless HTTP model; persistent state lives only in the Arcana host selected underneath it.
 */
export function createArcanaHttpRequestHandler(options: ArcanaHttpRequestHandlerOptions = {}) {
  const anonymousAdapter = createBundledArcanaAdapter();
  const hosts = options.hosts ?? new InMemoryArcanaHostStore();

  return async (req: IncomingMessage, res: Parameters<ReturnType<typeof toNodeHandler>>[1]) => {
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
