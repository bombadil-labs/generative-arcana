import type { IncomingMessage, ServerResponse } from "node:http";
import {
  DECK_MANIFEST_SPEC,
  inspectDeckAuthoringArtifact,
} from "../../app/src/decks/authoring.js";

export interface ArcanaAuthoringApiOptions {
  maxRequestBytes?: number;
}

export function isArcanaAuthoringPath(pathname: string): boolean {
  return pathname === "/api/authoring/spec" || pathname === "/api/authoring/validate";
}

/** Public, account-independent authoring API backed by the same deck-domain validator as imports. */
export function createArcanaAuthoringRequestHandler(options: ArcanaAuthoringApiOptions = {}) {
  const maxRequestBytes = options.maxRequestBytes ?? 4_000_000;
  return async (req: IncomingMessage, res: ServerResponse): Promise<void> => {
    const url = new URL(req.url ?? "/", `http://${req.headers.host ?? "localhost"}`);
    try {
      if (req.method === "GET" && url.pathname === "/api/authoring/spec") {
        return json(res, 200, {
          spec: DECK_MANIFEST_SPEC,
          validation: {
            http: "/api/authoring/validate",
            mcpTool: "validate_deck_manifest",
          },
        });
      }

      if (req.method === "POST" && url.pathname === "/api/authoring/validate") {
        const artifact = await readJson(req, maxRequestBytes);
        const includeNormalizedManifest = parseBooleanQuery(url.searchParams.get("includeNormalizedManifest"));
        return json(res, 200, inspectDeckAuthoringArtifact(artifact, { includeNormalizedManifest }));
      }

      if (isArcanaAuthoringPath(url.pathname)) {
        res.writeHead(405, {
          "content-type": "application/json",
          "cache-control": "no-store",
          allow: url.pathname.endsWith("/spec") ? "GET" : "POST",
        });
        res.end(JSON.stringify({ error: "method_not_allowed" }));
        return;
      }

      return json(res, 404, { error: "not_found" });
    } catch (error) {
      return json(res, 400, {
        error: "bad_request",
        message: error instanceof Error ? error.message : "Authoring request failed.",
      });
    }
  };
}

async function readJson(req: IncomingMessage, maxBytes: number): Promise<unknown> {
  let bytes = 0;
  const chunks: Buffer[] = [];
  for await (const chunk of req) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    bytes += buffer.length;
    if (bytes > maxBytes) throw new Error("Request body exceeds the configured size limit.");
    chunks.push(buffer);
  }
  if (!chunks.length) throw new Error("Request body must contain a deck manifest or raw deck JSON.");
  try {
    return JSON.parse(Buffer.concat(chunks).toString("utf8"));
  } catch {
    throw new Error("Request body must be valid JSON.");
  }
}

function parseBooleanQuery(value: string | null): boolean {
  if (value === null || value === "" || value === "false" || value === "0") return false;
  if (value === "true" || value === "1") return true;
  throw new Error("includeNormalizedManifest must be true or false.");
}

function json(res: ServerResponse, status: number, body: unknown): void {
  res.writeHead(status, { "content-type": "application/json", "cache-control": "no-store" });
  res.end(JSON.stringify(body));
}
