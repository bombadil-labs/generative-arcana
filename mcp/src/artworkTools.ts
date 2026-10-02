import type { McpServer } from "@modelcontextprotocol/server";
import * as z from "zod/v4";
import { ArtworkError, MAX_NATIVE_ARTWORK_INPUT_BYTES, type CardArtworkService } from "./cardArtwork";
import { principalHasScopes, type ArcanaPrincipal } from "./principal";
import { oauthToolError, optionalOAuthSecuritySchemes, requiredOAuthSecuritySchemes } from "./oauthResource";
import type { CatalogOAuthContext } from "./catalogTools";
import { nativeManifestFileSchema } from "./manifestUploadTools";
import { fetchNativeFile } from "./nativeManifestFile";
import { ManifestUploadError } from "./manifestUploads";

export const MAX_MCP_ARTWORK_BYTES = 1_000_000;
const packId = z.string().min(1).max(80).regex(/^[a-z0-9]+(?:[-_.][a-z0-9]+)*$/);
const ids = { deckId: z.string().min(1).max(200), cardSlug: z.string().min(1).max(200), packId: packId.optional() };
export function registerArtworkTools(server: McpServer, options: { artwork?: CardArtworkService; principal: ArcanaPrincipal | null; oauth?: CatalogOAuthContext }) {
  const { principal, oauth, artwork } = options;
  const readScopes = oauth?.readScopes ?? [];
  const writeScopes = [...new Set([...readScopes, ...oauth?.writeScopes ?? []])];
  const denied = () => oauth ? oauthToolError({ resourceMetadataUrl: oauth.resourceMetadataUrl, scopes: writeScopes, description: "Sign in with deck write permission to manage visual sets." }) : { content: [{ type: "text" as const, text: "Sign in to manage visual sets." }], isError: true };
  server.registerTool("get_card_artwork", {
    description: "Retrieve saved card artwork from one named visual set. Omitted packId uses saved-artwork for compatibility. Set includeImage:false for compact metadata and the prior artwork id before upload. Never falls back across sets; current deck visibility applies.",
    inputSchema: z.object({ ...ids, includeImage: z.boolean().optional() }),
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    ...(oauth ? { _meta: { securitySchemes: optionalOAuthSecuritySchemes(readScopes, oauth?.requestOfflineAccess) } } : {}),
  }, async ({ deckId, cardSlug, packId, includeImage }) => {
    try {
      if (!artwork) return unavailable();
      const viewer = principal && (!oauth || principalHasScopes(principal, readScopes)) ? principal.id : null;
      if (includeImage === false) return result(await artwork.metadata(viewer, deckId, cardSlug, packId));
      const { metadata, bytes } = await artwork.image(viewer, deckId, cardSlug, undefined, packId);
      return { content: [{ type: "text" as const, text: JSON.stringify(metadata) }, { type: "image" as const, mimeType: metadata.mediaType, data: Buffer.from(bytes).toString("base64") }], structuredContent: { result: metadata } };
    } catch (error) { return failed(error); }
  });
  if (!principal && !oauth) return;
  server.registerTool("create_visual_pack", {
    description: "Create an independent named static-artwork set on one owned deck, for example Claude or GPT. Stable packId selects the set for subsequent card uploads and reads. Leaves existing images and all deck meanings unchanged. Repeating the same id/name/description is safe; changing an existing set is not supported here.",
    inputSchema: z.object({ deckId: ids.deckId, packId, label: z.string().trim().min(1).max(80), description: z.string().trim().max(500).optional(), expectedDeckRevision: z.number().int().positive() }),
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    ...(oauth ? { _meta: { securitySchemes: requiredOAuthSecuritySchemes(writeScopes, oauth?.requestOfflineAccess) } } : {}),
  }, async input => {
    if (!principal || !principalHasScopes(principal, writeScopes)) return denied();
    try {
      if (!artwork) return unavailable();
      return result(await artwork.createPack({ ...input, ownerId: principal.id }));
    } catch (error) { return failed(error); }
  });
  server.registerTool("set_card_artwork", {
    description: "Save static PNG/JPEG/WebP artwork in one owned deck's named visual set. Supply exactly one host-native file (up to 5 MB) or canonical base64 (up to 1 MB), mediaType, current deck revision and prior artwork id (null for first image in this set). Omitted packId uses saved-artwork. Only this deck/set/card slot is replaced; other sets and meanings stay intact. Native file availability depends on the host; otherwise use base64 or the website (up to 3 MB). No arbitrary URLs, SVG, animation or program execution.",
    inputSchema: z.object({ ...ids, mediaType: z.enum(["image/png", "image/jpeg", "image/webp"]), base64: z.string().min(4).max(4 * Math.ceil(MAX_MCP_ARTWORK_BYTES / 3)).optional(), file: nativeManifestFileSchema.optional(), expectedDeckRevision: z.number().int().positive(), expectedArtworkId: z.string().uuid().nullable() }).refine(input => Number(input.base64 !== undefined) + Number(input.file !== undefined) === 1, { message: "Supply exactly one of file or base64." }),
    annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: false, openWorldHint: false },
    _meta: { ...(oauth ? { securitySchemes: requiredOAuthSecuritySchemes(writeScopes, oauth?.requestOfflineAccess) } : {}), "openai/fileParams": ["file"] },
  }, async ({ base64, file, ...input }) => {
    if (!principal || !principalHasScopes(principal, writeScopes)) return denied();
    try {
      if (!artwork) return unavailable();
      // Reject wrong owners, stale slots and nonexistent packs before downloading or decoding any file.
      await artwork.assertUpload(principal.id, input.deckId, input.cardSlug, input.expectedDeckRevision, input.expectedArtworkId, input.packId);
      if (file) return result(await artwork.upload({ ...input, ownerId: principal.id,
        loadBytes: () => fetchNativeFile(file, { maxBytes: MAX_NATIVE_ARTWORK_INPUT_BYTES, mediaTypes: ["image/png", "image/jpeg", "image/webp", "application/octet-stream"] }),
      }));
      let bytes: Uint8Array;
      {
        if (!base64 || base64.length % 4 !== 0 || !/^[A-Za-z0-9+/]*={0,2}$/.test(base64)) throw new ArtworkError(400, "artwork_base64", "Supply canonical base64 file bytes, without a data URL prefix.");
        const decoded = Buffer.from(base64, "base64");
        if (decoded.length > MAX_MCP_ARTWORK_BYTES || decoded.toString("base64") !== base64) throw new ArtworkError(413, "artwork_size", "Inline artwork uploads must be at most 1 MB. Use a native file for files up to 5 MB or the website for files up to 3 MB.");
        bytes = decoded;
      }
      return result(await artwork.upload({ ...input, ownerId: principal.id, bytes }));
    } catch (error) { return failed(error); }
  });
}
function result(value: object) { return { content: [{ type: "text" as const, text: JSON.stringify(value) }], structuredContent: { result: value } }; }
function unavailable() { return { content: [{ type: "text" as const, text: "Artwork storage is not configured yet." }], isError: true }; }
function failed(error: unknown) { return { content: [{ type: "text" as const, text: error instanceof ArtworkError || error instanceof ManifestUploadError ? error.message : "Artwork is temporarily unavailable. Try again later." }], isError: true }; }
