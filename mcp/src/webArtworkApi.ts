import type { IncomingMessage, ServerResponse } from "node:http";
import { ArtworkError, MAX_ARTWORK_INPUT_BYTES, artworkPackId, packAssetSlot, type CardArtworkService } from "./cardArtwork";
import { principalHasScopes } from "./principal";
import { OAuthPrincipalError } from "./oauthIdentity";
import { createArcanaAdapter } from "./hostStore";
import { resolveWebAccess, type ArcanaWebCatalogHandlerOptions } from "./webCatalogApi";
import { bearerChallenge } from "./oauthResource";

export function isArtworkPath(path: string) { return /^\/api\/(?:me\/)?decks\/[^/]+\/(?:artwork(?:\/sets|\/assets\/(?:cover|cardBack)(?:\/image)?)?|cards\/[^/]+\/artwork(?:\/image)?)$/.test(path); }
export function createWebArtworkHandler(options: ArcanaWebCatalogHandlerOptions & { artwork?: CardArtworkService }) {
  const anonymous = createArcanaAdapter();
  return async (req: IncomingMessage, res: ServerResponse) => {
    try {
      const url = new URL(req.url ?? "/", "http://arcana.invalid");
      const access = await resolveWebAccess(req, res, options, anonymous);
      const owned = url.pathname.startsWith("/api/me/");
      const write = req.method === "PUT" || req.method === "POST";
      const scopes = options.oauth ? [...new Set([...options.oauth.readScopes, ...(write ? options.oauth.writeScopes : [])])] : [];
      if ((owned || write) && (!access.principal || !principalHasScopes(access.principal, scopes))) {
        const status = access.principal ? 403 : 401;
        if (options.oauth) res.setHeader("www-authenticate", bearerChallenge({ resourceMetadataUrl: options.oauth.resourceMetadataUrl, scopes, error: status === 401 ? "invalid_token" : "insufficient_scope", description: "Sign in with deck permission to manage artwork." }));
        return json(res, status, { error: status === 401 ? "invalid_token" : "insufficient_scope", message: "Sign in with deck permission to manage artwork." });
      }
      if (!options.artwork) return json(res, 503, { error: "artwork_unavailable", message: "Artwork storage is not configured yet." });
      const match = url.pathname.match(/^\/api\/(?:me\/)?decks\/([^/]+)\/(?:artwork(?:\/sets|\/assets\/(cover|cardBack)(\/image)?)?|cards\/([^/]+)\/artwork(\/image)?)$/);
      if (!match) return json(res, 404, { error: "not_found" });
      const deckId = decodeURIComponent(match[1]);
      const packId = artworkPackId(url.searchParams.get("packId") ?? undefined);
      const setsPath = url.pathname.endsWith("/artwork/sets");
      const cardSlug = match[4] ? decodeURIComponent(match[4]) : undefined;
      const slot = match[2] ? packAssetSlot(match[2]) : undefined;
      const imagePath = !!(match[3] || match[5]);
      const viewer = access.principal && (!options.oauth || principalHasScopes(access.principal, options.oauth.readScopes)) ? access.principal.id : null;
      if (req.method === "POST" && setsPath && owned) {
        if ((req.headers["content-type"] ?? "").split(";")[0] !== "application/json") throw new ArtworkError(415, "artwork_pack", "Send visual set metadata as JSON.");
        let body: unknown;
        try { body = JSON.parse((await readBytes(req, 8192)).toString("utf8")); } catch (error) { if (error instanceof ArtworkError) throw error; throw new ArtworkError(400, "artwork_pack", "Send valid visual set metadata."); }
        if (!body || typeof body !== "object" || Array.isArray(body)) throw new ArtworkError(400, "artwork_pack", "Send visual set metadata.");
        const input = body as Record<string, unknown>;
        if (typeof input.id !== "string" || typeof input.label !== "string" || (input.description !== undefined && typeof input.description !== "string") || !Number.isSafeInteger(input.expectedDeckRevision) || Number(input.expectedDeckRevision) < 1) throw new ArtworkError(400, "artwork_pack", "Supply a set id, name and current deck revision.");
        return json(res, 201, await options.artwork.createPack({ ownerId: access.principal!.id, deckId, packId: input.id, label: input.label, description: input.description as string | undefined, expectedDeckRevision: Number(input.expectedDeckRevision) }));
      }
      if (setsPath) return json(res, 405, { error: "method_not_allowed" });
      if (slot && req.method === "GET" && !owned) {
        if (!imagePath) return json(res, 200, await options.artwork.packAssetMetadata(viewer, deckId, slot, packId));
        const { metadata, bytes } = await options.artwork.packAssetImage(viewer, deckId, slot, url.searchParams.get("version") ?? undefined, packId);
        res.writeHead(200, { "content-type": metadata.mediaType, "content-length": bytes.byteLength, "cache-control": "private, no-store", "x-content-type-options": "nosniff", "content-security-policy": "default-src 'none'; sandbox", "content-disposition": 'inline; filename="pack-artwork.webp"' });
        res.end(bytes); return;
      }
      if (req.method === "GET" && !cardSlug && !slot) return json(res, 200, owned ? await options.artwork.ownedCards(access.principal!.id, deckId, packId) : await options.artwork.readableCards(viewer, deckId, packId));
      if (req.method === "GET" && cardSlug && !owned) {
        if (!imagePath) return json(res, 200, await options.artwork.metadata(viewer, deckId, cardSlug, packId));
        const { metadata, bytes } = await options.artwork.image(viewer, deckId, cardSlug, url.searchParams.get("version") ?? undefined, packId);
        res.writeHead(200, { "content-type": metadata.mediaType, "content-length": bytes.byteLength, "cache-control": "private, no-store", "x-content-type-options": "nosniff", "content-security-policy": "default-src 'none'; sandbox", "content-disposition": 'inline; filename="card-artwork.webp"' });
        res.end(bytes); return;
      }
      if (req.method === "PUT" && owned && (cardSlug || slot) && !imagePath) {
        const revision = Number(req.headers["x-arcana-deck-revision"]);
        const rawVersion = req.headers["x-arcana-artwork-version"];
        if (!Number.isSafeInteger(revision) || revision < 1 || typeof rawVersion !== "string" || !/^(none|[0-9a-f-]{36})$/.test(rawVersion)) {
          throw new ArtworkError(400, "artwork_version", "Supply the current deck revision and artwork version.");
        }
        const expectedArtworkId = rawVersion === "none" ? null : rawVersion;
        if (slot) await options.artwork.assertPackAssetUpload(access.principal!.id, deckId, slot, revision, expectedArtworkId, packId);
        else await options.artwork.assertUpload(access.principal!.id, deckId, cardSlug!, revision, expectedArtworkId, packId);
        const bytes = await readBytes(req);
        const input = { ownerId: access.principal!.id, deckId, packId, expectedDeckRevision: revision, expectedArtworkId, mediaType: req.headers["content-type"] ?? "", bytes };
        return json(res, 201, slot ? await options.artwork.uploadPackAsset({ ...input, slot }) : await options.artwork.upload({ ...input, cardSlug: cardSlug! }));
      }
      return json(res, 405, { error: "method_not_allowed" });
    } catch (error) {
      if (error instanceof OAuthPrincipalError && options.oauth) {
        res.setHeader("www-authenticate", bearerChallenge({ resourceMetadataUrl: options.oauth.resourceMetadataUrl, scopes: error.scopes, error: error.oauthError, description: error.message }));
        return json(res, error.statusCode, { error: error.oauthError });
      }
      if (error instanceof ArtworkError) return json(res, error.status, { error: error.code, message: error.message });
      // Provider/DB errors can contain credentials, endpoints and object keys.
      return json(res, 503, { error: "artwork_unavailable", message: "Artwork is temporarily unavailable. Try again later." });
    }
  };
}
async function readBytes(req: IncomingMessage, maxBytes = MAX_ARTWORK_INPUT_BYTES) {
  const chunks: Buffer[] = []; let size = 0;
  for await (const chunk of req) {
    const bytes = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    size += bytes.length;
    if (size > maxBytes) throw new ArtworkError(413, "artwork_size", "Request is too large.");
    chunks.push(bytes);
  }
  return Buffer.concat(chunks);
}
function json(res: ServerResponse, status: number, data: unknown) { res.writeHead(status, { "content-type": "application/json", "cache-control": "private, no-store" }); res.end(JSON.stringify(data)); }
