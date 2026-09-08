import { createServer } from "node:http";
import { createMcpHandler } from "@modelcontextprotocol/server";
import { hostHeaderValidation, originValidation, toNodeHandler } from "@modelcontextprotocol/node";
import { createArcanaMcpServer, createBundledArcanaAdapter } from "./server";

const port = envPort(process.env.PORT, 3000);
const host = process.env.HOST?.trim() || "127.0.0.1";
const allowedHosts = csv(process.env.MCP_ALLOWED_HOSTS) ?? loopbackAllowlist(host);
const allowedOrigins = csv(process.env.MCP_ALLOWED_ORIGINS) ?? allowedHosts;

if (!allowedHosts.length) {
  throw new Error("Public MCP HTTP binding requires MCP_ALLOWED_HOSTS (comma-separated hostnames).");
}

// Modern createMcpHandler builds a fresh McpServer per request. Share only the immutable bundled
// Arcana host underneath it, and omit tools (currently import_deck) whose semantics require state to
// persist between tool calls. Stateful custom-deck import remains available over stdio.
const adapter = createBundledArcanaAdapter();
const handler = createMcpHandler(() => createArcanaMcpServer({ adapter, includeStatefulTools: false }));
const nodeHandler = toNodeHandler(handler);
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
  void nodeHandler(req, res);
});

http.listen(port, host, () => {
  console.error(`[generative-arcana-mcp] listening on http://${host}:${port}/mcp`);
});

async function shutdown(signal: string) {
  console.error(`[generative-arcana-mcp] ${signal}; shutting down`);
  await handler.close();
  http.close(() => process.exit(0));
}

process.once("SIGINT", () => void shutdown("SIGINT"));
process.once("SIGTERM", () => void shutdown("SIGTERM"));

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
