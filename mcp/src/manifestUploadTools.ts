import { McpServer } from "@modelcontextprotocol/server";
import * as z from "zod/v4";
import { oauthToolError, requiredOAuthSecuritySchemes } from "./oauthResource";
import { principalHasScopes, type ArcanaPrincipal } from "./principal";
import type { CatalogOAuthContext } from "./catalogTools";
import { MAX_MANIFEST_UPLOAD_BYTES, ManifestUploadError, hashBytes, type ManifestUploadRepository } from "./manifestUploads";
import { fetchNativeManifest, type NativeManifestFile } from "./nativeManifestFile";
import type { ManifestDraftRepository } from "./manifestDrafts";

export const nativeManifestFileSchema = z.object({ download_url: z.string().max(8192), file_id: z.string().min(1).max(256), mime_type: z.string().max(128).optional(), file_name: z.string().max(256).optional() }).strict();
export interface ManifestToolOptions {
  uploads?: ManifestUploadRepository;
  drafts?: ManifestDraftRepository;
  uploadOrigin?: string;
  principal?: ArcanaPrincipal | null;
  oauth?: CatalogOAuthContext;
  allowCreate?: (ownerId: string) => Promise<boolean>;
  allowDraftOperation?: (ownerId: string) => Promise<boolean>;
}
export function manifestPermission(options: ManifestToolOptions) {
  const scopes = options.oauth ? [...new Set([...options.oauth.readScopes, ...options.oauth.writeScopes])] : [];
  if (options.principal && (!options.oauth || principalHasScopes(options.principal, scopes))) return null;
  if (options.oauth) return oauthToolError({ resourceMetadataUrl: options.oauth.resourceMetadataUrl, scopes, description: "Sign in with deck write permission to stage or consume a private manifest file." });
  return { content: [{ type: "text" as const, text: "Sign in to stage a private manifest file." }], isError: true as const };
}
export async function stageManifest(options: ManifestToolOptions, input: { file?: NativeManifestFile; json?: string; manifest?: unknown }) {
  if (!options.uploads || !options.principal) throw new ManifestUploadError(503, "Private manifest staging is unavailable on this server.");
  if (options.allowCreate && !await options.allowCreate(options.principal.id)) throw new ManifestUploadError(429, "Manifest staging rate limit reached. Retry later.");
  const bytes = input.file ? await fetchNativeManifest(input.file) : Buffer.from(input.json ?? JSON.stringify(input.manifest), "utf8");
  const ticket = await options.uploads.create(options.principal.id, bytes.byteLength, hashBytes(bytes));
  const result = await options.uploads.finalize(ticket.uploadId, ticket.ticket, bytes);
  return { ...result, expiresAt: ticket.expiresAt };
}
export function registerManifestUploadTools(server: McpServer, options: ManifestToolOptions) {
  if (!options.uploads || (!options.principal && !options.oauth)) return;
  const scopes = options.oauth ? [...new Set([...options.oauth.readScopes, ...options.oauth.writeScopes])] : [];
  const metadata = options.oauth ? { securitySchemes: requiredOAuthSecuritySchemes(scopes, options.oauth?.requestOfflineAccess) } : {};
  server.registerTool("create_manifest_upload", {
    description: "Create a private, one-object, 15-minute JSON upload ticket. Upload exact file bytes with PUT using returned URL and upload-only Authorization header; never use your account OAuth token in a sandbox. Then validate_deck_manifest/import_deck using uploadId. Requires host network egress; if blocked (host_not_allowed), prefer start_deck_draft and bounded update_deck_draft batches over MCP. stage_deck_manifest inline remains a compatibility fallback.",
    inputSchema: z.object({ byteLength: z.number().int().min(1).max(MAX_MANIFEST_UPLOAD_BYTES), sha256: z.string().regex(/^[0-9a-f]{64}$/).optional() }).strict(),
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false },
    _meta: metadata,
  }, async (input: unknown) => {
    const denied = manifestPermission(options); if (denied) return denied;
    try {
      if (!options.uploadOrigin) throw new ManifestUploadError(503, "Upload HTTP endpoint unavailable; use inline staging.");
      if (options.allowCreate && !await options.allowCreate(options.principal!.id)) throw new ManifestUploadError(429, "Manifest staging rate limit reached. Retry later.");
      const { byteLength, sha256 } = input as { byteLength: number; sha256?: string };
      const { ticket, ...created } = await options.uploads!.create(options.principal!.id, byteLength, sha256);
      return result({ ...created, method: "PUT", uploadUrl: `${options.uploadOrigin}/api/manifest-uploads/${created.uploadId}`, headers: { "Content-Type": "application/json", Authorization: `Bearer ${ticket}` }, maxBytes: MAX_MANIFEST_UPLOAD_BYTES });
    } catch (error) { return failure(error); }
  });
  server.registerTool("stage_deck_manifest", {
    description: "Stage exact DeckManifest bytes privately and return an immutable uploadId for repeated validation and one idempotent import. Prefer native file input when the host supplies it; inline json/manifest is a compatibility fallback that need only be sent once. No deck is created yet.",
    inputSchema: z.object({ file: nativeManifestFileSchema.optional(), json: z.string().max(MAX_MANIFEST_UPLOAD_BYTES).optional(), manifest: z.unknown().optional() }).refine(value => [value.file, value.json, value.manifest].filter(v => v !== undefined).length === 1, { message: "Provide exactly one of file, json or manifest." }),
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false },
    _meta: { ...metadata, "openai/fileParams": ["file"] },
  }, async (input: unknown) => {
    const denied = manifestPermission(options); if (denied) return denied;
    try { return result(await stageManifest(options, input as { file?: NativeManifestFile; json?: string; manifest?: unknown })); }
    catch (error) { return failure(error); }
  });
}
function result(value: unknown) { return { content: [{ type: "text" as const, text: JSON.stringify(value) }], structuredContent: { result: value } }; }
function failure(error: unknown) { return { content: [{ type: "text" as const, text: error instanceof ManifestUploadError ? error.message : "Manifest staging failed. Retry later." }], isError: true }; }
