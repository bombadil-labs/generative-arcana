import type { McpServer } from "@modelcontextprotocol/server";
import * as z from "zod/v4";
import { ArtworkError, type CardArtworkService } from "./cardArtwork";
import { principalHasScopes, type ArcanaPrincipal } from "./principal";
import { oauthToolError, optionalOAuthSecuritySchemes, requiredOAuthSecuritySchemes } from "./oauthResource";
import type { CatalogOAuthContext } from "./catalogTools";

export const MAX_MCP_ARTWORK_BYTES = 1_000_000;
const ids = { deckId: z.string().min(1).max(200), cardSlug: z.string().min(1).max(200) };
export function registerArtworkTools(server: McpServer, options: { artwork?: CardArtworkService; principal: ArcanaPrincipal | null; oauth?: CatalogOAuthContext }) {
  const { principal, oauth, artwork } = options;
  const readScopes = oauth?.readScopes ?? [];
  const writeScopes = [...new Set([...readScopes, ...oauth?.writeScopes ?? []])];
  server.registerTool("get_card_artwork", {
    description: "Retrieve a saved static card image and separate visual-pack metadata by stable deck id and card slug. Current deck visibility applies. Does not execute visual programs.",
    inputSchema: z.object(ids),
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    ...(oauth ? { _meta: { securitySchemes: optionalOAuthSecuritySchemes(readScopes) } } : {}),
  }, async ({ deckId, cardSlug }) => {
    try {
      if (!artwork) return unavailable();
      const viewer = principal && (!oauth || principalHasScopes(principal, readScopes)) ? principal.id : null;
      const { metadata, bytes } = await artwork.image(viewer, deckId, cardSlug);
      return { content: [{ type: "text" as const, text: JSON.stringify(metadata) }, { type: "image" as const, mimeType: metadata.mediaType, data: Buffer.from(bytes).toString("base64") }], structuredContent: { result: metadata } };
    } catch (error) { return failed(error); }
  });
  if (!principal && !oauth) return;
  server.registerTool("set_card_artwork", {
    description: "Save and attach a static PNG/JPEG/WebP image to one owned card. Supply actual base64 file bytes (up to 1 MB), current deck revision and prior artwork id (null for first upload). Reencodes to WebP; replaces only visual artwork, never card meaning. The image follows the deck’s current private/unlisted/public visibility. No URLs, SVG, animation or executable programs. If your host cannot provide file bytes, use the signed-in website Artwork page instead; generated-file transfer is not automatic.",
    inputSchema: z.object({ ...ids, mediaType: z.enum(["image/png", "image/jpeg", "image/webp"]), base64: z.string().min(4).max(4 * Math.ceil(MAX_MCP_ARTWORK_BYTES / 3)), expectedDeckRevision: z.number().int().positive(), expectedArtworkId: z.string().uuid().nullable() }),
    annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: false, openWorldHint: false },
    ...(oauth ? { _meta: { securitySchemes: requiredOAuthSecuritySchemes(writeScopes) } } : {}),
  }, async ({ base64, ...input }) => {
    if (!principal || !principalHasScopes(principal, writeScopes)) return oauth ? oauthToolError({ resourceMetadataUrl: oauth.resourceMetadataUrl, scopes: writeScopes, description: "Sign in with deck write permission to save card artwork." }) : { content: [{ type: "text" as const, text: "Sign in to save card artwork." }], isError: true };
    try {
      if (!artwork) return unavailable();
      if ((base64.length % 4 !== 0 || !/^[A-Za-z0-9+/]*={0,2}$/.test(base64))) throw new ArtworkError(400, "artwork_base64", "Supply canonical base64 file bytes, without a data URL prefix.");
      const bytes = Buffer.from(base64, "base64");
      if (bytes.length > MAX_MCP_ARTWORK_BYTES || bytes.toString("base64") !== base64) throw new ArtworkError(413, "artwork_size", "MCP artwork uploads must be at most 1 MB. Use the website for files up to 3 MB.");
      const metadata = await artwork.upload({ ...input, ownerId: principal.id, bytes });
      return { content: [{ type: "text" as const, text: JSON.stringify(metadata) }], structuredContent: { result: metadata } };
    } catch (error) { return failed(error); }
  });
}
function unavailable() { return { content: [{ type: "text" as const, text: "Artwork storage is not configured yet." }], isError: true }; }
function failed(error: unknown) { return { content: [{ type: "text" as const, text: error instanceof ArtworkError ? error.message : "Artwork is temporarily unavailable. Try again later." }], isError: true }; }
