import type { McpServer } from "@modelcontextprotocol/server";
import * as z from "zod/v4";
import { draftReadSchema, draftUpdateSchema } from "./manifestDraftOperations";
import { ManifestDraftVersionConflict, ManifestUploadError } from "./manifestUploads";
import { manifestPermission, type ManifestToolOptions } from "./manifestUploadTools";
import { requiredOAuthSecuritySchemes } from "./oauthResource";

const version = z.number().int().min(1).max(Number.MAX_SAFE_INTEGER);
export const draftStartSchema = z.strictObject({ startKey: z.string().regex(/^[A-Za-z0-9_-]{1,80}$/) });
export const draftValidateSchema = z.strictObject({ draftId: z.string().uuid(), expectedVersion: version });
export const draftCommitSchema = draftValidateSchema.extend({
  deckId: z.string().min(1).max(200).optional(),
  expectedRevision: version.optional(),
}).refine(input => (input.deckId !== undefined) === (input.expectedRevision !== undefined), {
  message: "Replacement requires deckId and expectedRevision together.",
});

/** Authenticated MCP-only assembly for hosts whose sandboxes cannot PUT file bytes. */
export function registerManifestDraftTools(server: McpServer, options: ManifestToolOptions): void {
  if (!options.drafts || (!options.principal && !options.oauth)) return;
  const scopes = options.oauth ? [...new Set([...options.oauth.readScopes, ...options.oauth.writeScopes])] : [];
  const metadata = options.oauth ? { securitySchemes: requiredOAuthSecuritySchemes(scopes) } : {};
  const definitions = [
    {
      name: "start_deck_draft",
      description: "Start a private, resumable DeckManifest draft over MCP when native file input or sandbox HTTP PUT is unavailable (including host_not_allowed). Supply a unique startKey and reuse it after a lost response. No catalog deck is created. Draft expires after a fixed two hours; at most eight active drafts/uploads combined. Add bounded batches with update_deck_draft, then validate and explicitly commit.",
      schema: draftStartSchema,
      readOnly: false,
      destructive: false,
      run: async (input: unknown) => {
        const { startKey } = draftStartSchema.parse(input);
        if (options.allowCreate && !await options.allowCreate(options.principal!.id)) throw new ManifestUploadError(429, "Manifest staging rate limit reached. Retry later.");
        return options.drafts!.start(options.principal!.id, startKey);
      },
    },
    {
      name: "update_deck_draft",
      description: "Apply one atomic batch to a private draft using expectedVersion and a unique mutationId. Retry identical arguments with the same mutationId after a lost response; changed content requires a new mutationId. Typed metadata, axes, cards and spreads support upsert/remove; whole-entity upserts replace their previous value. At most 20 combined operations and 64 KiB of UTF-8 JSON per batch, 512 successful mutations per draft, and 2,000,000 assembled bytes. Omitted fields stay unchanged. Relationships are checked by validation/commit. Returns a compact summary and new version, never the full deck.",
      schema: draftUpdateSchema,
      readOnly: false,
      destructive: true,
      run: async (input: unknown) => {
        const update = draftUpdateSchema.parse(input);
        await allowOperation(options);
        return options.drafts!.update(options.principal!.id, update);
      },
    },
    {
      name: "get_deck_draft",
      description: "Recover a private draft's current version, expiry and counts without returning the whole manifest. Omit section for summary only. Select metadata, transversal, cards, suits, ranks, stations or spreads for a bounded page (up to 20 entries and 64 KiB), optionally filtering keys or using offset/limit. Follow nextOffset. sha256Basis identifies sorted-key compact UTF-8 assembled JSON, not the original local file bytes or proof of semantic equality. Requires the same deck read/write scopes as draft creation.",
      schema: draftReadSchema,
      readOnly: true,
      destructive: false,
      run: async (input: unknown) => {
        const read = draftReadSchema.parse(input);
        await allowOperation(options);
        return options.drafts!.read(options.principal!.id, read);
      },
    },
    {
      name: "validate_deck_draft",
      description: "Run the complete canonical DeckManifest validator on a private draft at expectedVersion. Returns bounded diagnostics and a compact summary without importing, publishing or echoing the whole deck. Incomplete intermediate drafts may fail validation; repair with update_deck_draft and validate the new version. Commit revalidates independently. sha256 hashes the assembled sorted-key compact UTF-8 JSON before import normalization; compare original-file bytes only on the file-upload route.",
      schema: draftValidateSchema,
      readOnly: true,
      destructive: false,
      run: async (input: unknown) => {
        const { draftId, expectedVersion } = draftValidateSchema.parse(input);
        await allowOperation(options);
        return options.drafts!.validate(options.principal!.id, draftId, expectedVersion);
      },
    },
    {
      name: "commit_deck_draft",
      description: "Explicitly import the complete canonical draft at expectedVersion into the owner's private library. Revalidates the whole manifest; incomplete/invalid drafts cannot commit. New create never silently replaces a same-slug deck. Authorized replacement requires stable deckId and expectedRevision together. Deck write and receipt are atomic; retries with identical draftId, version and options return the original receipt for 24 hours. Successful commit discards staged source bytes. No arbitrary patch, URL or local sandbox path is accepted.",
      schema: draftCommitSchema,
      readOnly: false,
      destructive: true,
      run: async (input: unknown) => {
        const { draftId, expectedVersion, deckId, expectedRevision } = draftCommitSchema.parse(input);
        await allowOperation(options);
        return options.drafts!.commit(options.principal!.id, draftId, expectedVersion, { deckId, expectedRevision });
      },
    },
  ];
  for (const definition of definitions) {
    server.registerTool(definition.name, {
      description: definition.description,
      inputSchema: definition.schema,
      annotations: { readOnlyHint: definition.readOnly, destructiveHint: definition.destructive, idempotentHint: true, openWorldHint: false },
      _meta: metadata,
    }, async (input: unknown) => {
      const denied = manifestPermission(options); if (denied) return denied;
      try {
        const value = await definition.run(input);
        return { content: [{ type: "text" as const, text: JSON.stringify(value) }], structuredContent: { result: value } };
      } catch (error) {
        if (error instanceof z.ZodError) {
          const issues = error.issues.slice(0, 20).map(issue => ({ path: issue.path.map(String).join(".").slice(0, 256), message: issue.message.slice(0, 320) }));
          const detail = { code: "invalid_draft_arguments", issues, truncated: error.issues.length > issues.length };
          return { content: [{ type: "text" as const, text: JSON.stringify(detail) }], structuredContent: { error: detail }, isError: true };
        }
        if (error instanceof ManifestDraftVersionConflict) {
          return {
            content: [{ type: "text" as const, text: error.message }],
            structuredContent: { error: { code: "draft_version_conflict", currentVersion: error.currentVersion } },
            isError: true,
          };
        }
        return { content: [{ type: "text" as const, text: error instanceof ManifestUploadError ? error.message : "Draft operation failed. Retry later." }], isError: true };
      }
    });
  }
}

async function allowOperation(options: ManifestToolOptions): Promise<void> {
  if (options.allowDraftOperation && !await options.allowDraftOperation(options.principal!.id)) {
    throw new ManifestUploadError(429, "Draft operation rate limit reached. Retry later.");
  }
}
