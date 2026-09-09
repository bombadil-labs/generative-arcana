import type { IncomingMessage, ServerResponse } from "node:http";
import { canResolveUserDeck, type DeckVisibility, type UserDeckRecord } from "../../app/src/decks/catalog.js";
import { createBundledArcanaAdapter, type ArcanaHostStore } from "./hostStore.js";
import { bearerChallenge } from "./oauthResource.js";
import {
  OAuthPrincipalError,
} from "./oauthIdentity.js";
import {
  principalHasScopes,
  resolveArcanaRequestAccess,
  type PrincipalRequest,
  type PrincipalResolver,
} from "./principal.js";
import type { UserDeckCatalogRepository } from "./userDeckCatalog.js";

export interface ArcanaWebCatalogOAuthOptions {
  resourceMetadataUrl: string;
  readScopes: readonly string[];
  writeScopes: readonly string[];
}

export interface ArcanaWebCatalogHandlerOptions {
  catalog: UserDeckCatalogRepository;
  hosts: ArcanaHostStore;
  principalResolver?: PrincipalResolver;
  oauth?: ArcanaWebCatalogOAuthOptions;
  maxRequestBytes?: number;
}

export function isArcanaWebCatalogPath(pathname: string): boolean {
  return pathname === "/api/decks/public" || pathname.startsWith("/api/decks/") || pathname === "/api/me/decks" || pathname.startsWith("/api/me/decks/");
}

export function createArcanaWebCatalogRequestHandler(options: ArcanaWebCatalogHandlerOptions) {
  const anonymousAdapter = createBundledArcanaAdapter();
  const maxRequestBytes = options.maxRequestBytes ?? 4_000_000;
  const writeScopes = options.oauth ? [...new Set([...options.oauth.readScopes, ...options.oauth.writeScopes])] : [];

  return async (req: IncomingMessage, res: ServerResponse) => {
    const url = new URL(req.url ?? "/", `http://${req.headers.host ?? "localhost"}`);
    try {
      if (req.method === "GET" && url.pathname === "/api/decks/public") {
        const limit = parseLimit(url.searchParams.get("limit"));
        const records = await options.catalog.listPublic(limit);
        return json(res, 200, records.map(deckSummary));
      }

      if (req.method === "GET" && url.pathname.startsWith("/api/decks/")) {
        const deckId = decodeURIComponent(url.pathname.slice("/api/decks/".length));
        if (!deckId) return json(res, 404, { error: "not_found" });
        const record = await options.catalog.get(deckId);
        const principal = await optionalPrincipal(req, options, anonymousAdapter);
        const viewerId = principal && (!options.oauth || principalHasScopes(principal, options.oauth.readScopes)) ? principal.id : null;
        if (!record || !canResolveUserDeck(record, viewerId)) return json(res, 404, { error: "not_found" });
        return json(res, 200, sharedDeck(record));
      }

      const access = await resolveArcanaRequestAccess(toPrincipalRequest(req), anonymousAdapter, options.hosts, options.principalResolver);
      if (!access.principal) return unauthorized(res, options.oauth, options.oauth?.readScopes ?? [], "Sign in to access your deck library.");

      if (req.method === "GET" && url.pathname === "/api/me/decks") {
        if (options.oauth && !principalHasScopes(access.principal, options.oauth.readScopes)) {
          return unauthorized(res, options.oauth, options.oauth.readScopes, "Deck read permission is required.", "insufficient_scope");
        }
        const records = await options.catalog.listOwned(access.principal.id);
        return json(res, 200, records.map(deckSummary));
      }

      if (req.method === "POST" && url.pathname === "/api/me/decks") {
        if (options.oauth && !principalHasScopes(access.principal, writeScopes)) {
          return unauthorized(res, options.oauth, writeScopes, "Deck write permission is required.", "insufficient_scope");
        }
        const body = await readJson(req, maxRequestBytes);
        const imported = await access.adapter.call("import_deck", body);
        const id = typeof imported === "object" && imported && "id" in imported ? String((imported as { id: unknown }).id) : "";
        const record = id ? await options.catalog.get(id) : null;
        if (!record || record.ownerId !== access.principal.id) throw new Error("Imported deck was not persisted to the authenticated catalog.");
        return json(res, 201, deckSummary(record));
      }

      const ownedMatch = url.pathname.match(/^\/api\/me\/decks\/([^/]+)$/);
      if (ownedMatch && req.method === "PATCH") {
        if (options.oauth && !principalHasScopes(access.principal, writeScopes)) {
          return unauthorized(res, options.oauth, writeScopes, "Deck write permission is required.", "insufficient_scope");
        }
        const body = await readJson(req, maxRequestBytes) as { visibility?: unknown };
        const visibility = requireVisibility(body.visibility);
        const record = await options.catalog.setVisibility(access.principal.id, decodeURIComponent(ownedMatch[1]), visibility);
        return json(res, 200, deckSummary(record));
      }

      if (ownedMatch && req.method === "DELETE") {
        if (options.oauth && !principalHasScopes(access.principal, writeScopes)) {
          return unauthorized(res, options.oauth, writeScopes, "Deck write permission is required.", "insufficient_scope");
        }
        const deckId = decodeURIComponent(ownedMatch[1]);
        const record = await options.catalog.get(deckId);
        if (!record || record.ownerId !== access.principal.id) return json(res, 404, { error: "not_found" });
        await options.catalog.deleteOwned(access.principal.id, deckId);
        access.adapter.engine.removeCustomDeck(deckId);
        return json(res, 200, { id: deckId, deleted: true });
      }

      return json(res, 404, { error: "not_found" });
    } catch (error) {
      if (error instanceof OAuthPrincipalError && options.oauth) {
        return unauthorized(res, options.oauth, error.scopes, error.message, error.oauthError, error.statusCode);
      }
      const message = error instanceof Error ? error.message : "Web catalog request failed.";
      return json(res, 400, { error: "bad_request", message });
    }
  };
}

async function optionalPrincipal(req: IncomingMessage, options: ArcanaWebCatalogHandlerOptions, anonymousAdapter: ReturnType<typeof createBundledArcanaAdapter>) {
  if (!req.headers.authorization || !options.principalResolver) return null;
  const access = await resolveArcanaRequestAccess(toPrincipalRequest(req), anonymousAdapter, options.hosts, options.principalResolver);
  return access.principal;
}

function deckSummary(record: UserDeckRecord) {
  return {
    id: record.id,
    slug: record.slug,
    name: record.manifest.data.name,
    tagline: record.manifest.tagline,
    visibility: record.visibility,
    revision: record.revision,
    createdAt: record.createdAt,
    updatedAt: record.updatedAt,
    ...(record.publishedAt ? { publishedAt: record.publishedAt } : {}),
  };
}

function sharedDeck(record: UserDeckRecord) {
  return { ...deckSummary(record), manifest: record.manifest };
}

function parseLimit(value: string | null): number {
  if (value === null || value === "") return 50;
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < 1 || parsed > 100) throw new Error("limit must be an integer from 1 to 100.");
  return parsed;
}

function requireVisibility(value: unknown): DeckVisibility {
  if (value !== "private" && value !== "unlisted" && value !== "public") throw new Error("visibility must be private, unlisted, or public.");
  return value;
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
  if (!chunks.length) return {};
  try { return JSON.parse(Buffer.concat(chunks).toString("utf8")); }
  catch { throw new Error("Request body must be valid JSON."); }
}

function unauthorized(
  res: ServerResponse,
  oauth: ArcanaWebCatalogOAuthOptions | undefined,
  scopes: readonly string[],
  description: string,
  error: "invalid_request" | "invalid_token" | "insufficient_scope" = "invalid_token",
  status = error === "insufficient_scope" ? 403 : 401,
) {
  const headers: Record<string, string> = { "content-type": "application/json" };
  if (oauth) headers["www-authenticate"] = bearerChallenge({ resourceMetadataUrl: oauth.resourceMetadataUrl, scopes, error, description });
  res.writeHead(status, headers);
  res.end(JSON.stringify({ error, message: description }));
}

function json(res: ServerResponse, status: number, body: unknown) {
  res.writeHead(status, { "content-type": "application/json", "cache-control": "no-store" });
  res.end(JSON.stringify(body));
}

function toPrincipalRequest(req: IncomingMessage): PrincipalRequest {
  const headers = new Headers();
  for (const [name, value] of Object.entries(req.headers)) {
    if (Array.isArray(value)) for (const item of value) headers.append(name, item);
    else if (value !== undefined) headers.set(name, value);
  }
  return { method: req.method ?? "GET", url: req.url ?? "/", headers };
}
