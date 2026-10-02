import { registerDeckEditTools } from "./deckEditTools";
import { registerManifestDraftTools } from "./manifestDraftTools";
import { toolResult, summarizeToolResult, ARCANA_RESPONSE_FORMATS } from "./toolResult";
import { registerManifestUploadTools, stageManifest, manifestPermission, nativeManifestFileSchema, type ManifestToolOptions } from "./manifestUploadTools";
import type { NativeManifestFile } from "./nativeManifestFile";
import { ManifestUploadError, stagedManifestReport, UPLOAD_SHA256_BASIS } from "./manifestUploads";
import { registerArtworkTools } from "./artworkTools";
import type { CardArtworkService } from "./cardArtwork";
import { McpServer } from "@modelcontextprotocol/server";
import * as z from "zod/v4";
import { ArcanaToolAdapter, ARCANA_DECK_VIEWS, type ArcanaToolName } from "../../app/src/mcp/ArcanaToolAdapter";
import { MAX_QUESTION_LENGTH } from "../../app/src/reading/encode";
import { CatalogResolvingArcanaToolAdapter } from "./catalogResolvingAdapter";
import { createArcanaAdapter } from "./hostStore";
import type { ArcanaToolCallObserver } from "./observability";
import {
  oauthToolError,
  optionalOAuthSecuritySchemes,
  requiredOAuthSecuritySchemes,
  type ToolSecurityScheme,
} from "./oauthResource";
import { principalHasScopes, type ArcanaPrincipal } from "./principal";
import { ARCANA_MCP_VERSION } from "./version";
import { createStaticVisualStore, type ServerVisualStore } from "./staticVisuals";
import { registerArcanaVisualTools } from "./visualTools";
import { registerArcanaCatalogTools } from "./catalogTools";
import type { UserDeckCatalogRepository } from "./userDeckCatalog";
import { registerAuthoringGuide } from "./authoringGuide";

export { createArcanaAdapter } from "./hostStore";

const MAX_IMPORT_JSON_CHARS = 2_000_000;
const MAX_SPREADS = 64;
const MAX_SPREAD_POSITIONS = 64;

const spreadPosition = z.object({ name: z.string(), prompt: z.string() });
const spread = z.object({
  id: z.string(),
  name: z.string(),
  description: z.string(),
  deckId: z.string().optional(),
  positions: z.array(spreadPosition).max(MAX_SPREAD_POSITIONS),
});

const cardQuery = z.object({
  arcana: z.enum(["major", "minor"]).optional(),
  suit: z.string().optional(),
  rank: z.string().optional(),
  station: z.string().optional(),
  omega: z.number().int().nonnegative().optional(),
  factorizationCharacter: z.string().optional(),
  dialectic: z.object({ axis: z.string().optional(), pole: z.string() }).optional(),
}).optional();

const schemas: Record<ArcanaToolName, z.ZodTypeAny> = {
  list_decks: z.object({}),
  get_deck: z.object({ deckId: z.string().min(1), view: z.enum(ARCANA_DECK_VIEWS).optional(), responseFormat: z.enum(ARCANA_RESPONSE_FORMATS).optional() }),
  get_card: z.object({ deckId: z.string().min(1), cardSlug: z.string().min(1) }),
  analyze_card: z.object({ deckId: z.string().min(1), cardSlug: z.string().min(1) }),
  query_cards: z.object({ deckId: z.string().min(1), query: cardQuery }),
  list_spreads: z.object({ deckId: z.string().min(1) }),
  cast_reading: z.object({
    deckId: z.string().min(1),
    spread: z.union([z.string().min(1), spread]),
    question: z.string().max(MAX_QUESTION_LENGTH).optional(),
    reversalRate: z.number().min(0).max(1).optional(),
  }),
  resolve_reading: z.object({ token: z.string().min(1), deckId: z.string().min(1).optional() }),
  interpretation_context: z.object({ token: z.string().min(1), deckId: z.string().min(1).optional() }),
  get_deck_authoring_spec: z.object({}),
  validate_deck_manifest: z.object({
    manifest: z.unknown().optional(),
    json: z.string().max(MAX_IMPORT_JSON_CHARS).optional(),
    includeNormalizedManifest: z.boolean().optional(),
    uploadId: z.string().uuid().optional(),
    file: nativeManifestFileSchema.optional(),
  }).refine((value) => [value.manifest, value.json, value.uploadId, value.file].filter(v => v !== undefined).length === 1, {
    message: "Provide exactly one of manifest, json, uploadId or file.",
  }),
  import_deck: z.object({
    manifest: z.unknown().optional(),
    data: z.unknown().optional(),
    json: z.string().max(MAX_IMPORT_JSON_CHARS).optional(),
    tagline: z.string().min(1).optional(),
    spreads: z.array(spread).max(MAX_SPREADS).optional(),
    replaceExisting: z.boolean().optional(),
    uploadId: z.string().uuid().optional(),
    deckId: z.string().min(1).optional(),
    expectedRevision: z.number().int().min(1).max(Number.MAX_SAFE_INTEGER).optional(),
  }).refine(
    (value) => [value.manifest, value.data, value.json, value.uploadId].filter((payload) => payload !== undefined).length === 1,
    { message: "Provide exactly one of manifest, data, json, or uploadId." },
  ).refine(
    (value) => value.manifest === undefined || (value.tagline === undefined && value.spreads === undefined),
    { message: "When manifest is provided, tagline and spreads must be authored inside the manifest." },
  ),
};

export interface ArcanaOAuthToolContext {
  principal: ArcanaPrincipal | null;
  resourceMetadataUrl: string;
  readScopes: readonly string[];
  writeScopes: readonly string[];
}

export interface ArcanaMcpServerOptions {
  manifestUploads?: Omit<ManifestToolOptions, "principal" | "oauth">;
  artwork?: CardArtworkService;
  /** Reuse an adapter when the transport provides an appropriate state lifetime. */
  adapter?: ArcanaToolAdapter;
  /** Stateless transports must disable tools whose semantics require persistence across calls. */
  includeStatefulTools?: boolean;
  /** Authenticated principal for account-scoped catalog operations (OAuth or trusted alpha adapters). */
  principal?: ArcanaPrincipal | null;
  /** Optional first-class user deck catalog. When present, sharing/management tools are registered. */
  catalog?: UserDeckCatalogRepository;
  /** Optional OAuth context for mixed public/personal HTTP tools. */
  oauth?: ArcanaOAuthToolContext;
  /** Payload-free observer for alpha diagnostics/metrics. */
  onToolCall?: ArcanaToolCallObserver;
  /** Server-renderable visual assets. No visual packs are installed by default. */
  visuals?: ServerVisualStore;
}

export function createArcanaMcpServer(options: ArcanaMcpServerOptions = {}): McpServer {
  const principal = options.principal ?? options.oauth?.principal ?? null;
  const canReadPrivate = !options.oauth || principalHasScopes(principal, options.oauth.readScopes);
  // Authentication alone must not expose the principal's already-hydrated private deck adapter.
  // A client without decks:read still receives the anonymous public experience.
  const localAdapter = canReadPrivate && options.adapter ? options.adapter : createArcanaAdapter();
  const adapter = options.catalog
    ? new CatalogResolvingArcanaToolAdapter(localAdapter, options.catalog, canReadPrivate ? principal?.id ?? null : null)
    : localAdapter;
  const includeStatefulTools = options.includeStatefulTools ?? true;
  const visuals = options.visuals ?? createStaticVisualStore();
  const server = new McpServer({ name: "generative-arcana", version: ARCANA_MCP_VERSION });
  registerAuthoringGuide(server, options.onToolCall);
  const manifestOptions: ManifestToolOptions = { ...options.manifestUploads, principal, oauth: options.oauth };
  registerManifestUploadTools(server, manifestOptions);
  registerManifestDraftTools(server, manifestOptions);
  registerArtworkTools(server, { artwork: options.artwork, principal, oauth: options.oauth });
  const readSchemes = options.oauth ? optionalOAuthSecuritySchemes(options.oauth.readScopes) : undefined;

  for (const definition of adapter.definitions()) {
    const isImport = definition.name === "import_deck";
    if (isImport && !includeStatefulTools && !options.oauth) continue;

    const requiredImportScopes = options.oauth
      ? [...new Set([...options.oauth.readScopes, ...options.oauth.writeScopes])]
      : [];
    const securitySchemes = options.oauth
      ? (isImport ? requiredOAuthSecuritySchemes(requiredImportScopes) : readSchemes)
      : undefined;

    server.registerTool(
      definition.name,
      {
        description: definition.description + (definition.name === "get_deck" ? " For an owned catalog deck, view=summary returns revision and view=structure returns summary.revision from the same data snapshot, for use as expectedRevision. Built-in/non-catalog and shared non-owned summaries omit it." : "") + (definition.name === "validate_deck_manifest" ? " Prefer uploadId for staged bytes or native file input when available; file input stages privately and returns an immutable uploadId. Inline manifest/json remains available." : isImport ? " Prefer uploadId after file validation. File replacement requires stable deckId and expectedRevision; retries return the same receipt for 24 hours." : ""),
        inputSchema: schemas[definition.name] instanceof z.ZodObject
          ? (schemas[definition.name] as z.ZodObject).safeExtend({ responseFormat: z.enum(ARCANA_RESPONSE_FORMATS).optional() })
          : schemas[definition.name],
        annotations: {
          readOnlyHint: definition.name === "validate_deck_manifest" ? false : definition.name === "cast_reading" ? true : definition.readOnly,
          destructiveHint: isImport,
          idempotentHint: definition.name !== "cast_reading" && definition.name !== "validate_deck_manifest",
          openWorldHint: false,
        },
        ...((securitySchemes || definition.name === "validate_deck_manifest") ? { _meta: { ...(securitySchemes ? { securitySchemes } : {}), ...(definition.name === "validate_deck_manifest" ? { "openai/fileParams": ["file"] } : {}) } } : {}),
      },
      async (input: unknown) => {
        if (isImport && options.oauth && !principalHasScopes(options.oauth.principal, requiredImportScopes)) {
          return oauthToolError({
            resourceMetadataUrl: options.oauth.resourceMetadataUrl,
            scopes: requiredImportScopes,
            description: options.oauth.principal
              ? "Importing a deck requires additional deck write permission."
              : "Sign in to import a deck into your Generative Arcana account.",
          });
        }

        const startedAt = Date.now();
        let ok = false;
        try {
          const args = input as { uploadId?: string; file?: NativeManifestFile; deckId?: string; expectedRevision?: number; replaceExisting?: boolean; tagline?: string; spreads?: unknown; includeNormalizedManifest?: boolean; responseFormat?: "json" | "structured" };
          let result: unknown;
          if ((definition.name === "validate_deck_manifest" || isImport) && (args.uploadId || args.file)) {
            const denied = manifestPermission(manifestOptions); if (denied) return denied;
            if (!manifestOptions.uploads) throw new ManifestUploadError(503, "Private manifest staging is unavailable on this server.");
            if (args.tagline !== undefined || args.spreads !== undefined) throw new ManifestUploadError(400, "File imports use the complete authored manifest; tagline and spreads belong inside it.");
            const staged = args.file ? await stageManifest(manifestOptions, { file: args.file }) : undefined;
            const uploadId = staged?.uploadId ?? args.uploadId!;
            if (isImport) {
              if (args.deckId !== undefined && args.replaceExisting === false) throw new ManifestUploadError(400, "deckId replacement conflicts with replaceExisting:false.");
              if (args.replaceExisting && !args.deckId) throw new ManifestUploadError(400, "File replacement requires stable deckId and expectedRevision.");
              result = await manifestOptions.uploads.import(principal!.id, uploadId, { deckId: args.deckId, expectedRevision: args.expectedRevision });
            } else {
              const artifact = await manifestOptions.uploads.read(principal!.id, uploadId);
              result = { ...stagedManifestReport(artifact.json, args.includeNormalizedManifest), uploadId, sha256: artifact.sha256, sha256Basis: UPLOAD_SHA256_BASIS, byteLength: artifact.byteLength, ...(staged ? { expiresAt: staged.expiresAt } : {}) };
            }
          } else {
            if (isImport && args.expectedRevision !== undefined && !options.catalog) throw new ManifestUploadError(400, "Revision-checked import requires a durable account catalog.");
            if (isImport && args.deckId !== undefined) throw new ManifestUploadError(400, "Stable deckId import targeting requires uploadId. Use edit_deck for small edits.");
            result = await adapter.call(definition.name, input);
          }
          ok = true;
          return toolResult(result, { responseFormat: args.responseFormat, summary: summarizeToolResult(definition.name, result) });
        } catch (error) {
          const fileRequest = input && typeof input === "object" && ("uploadId" in input || "file" in input);
          const message = fileRequest && !(error instanceof ManifestUploadError) ? "Manifest operation failed. Retry later." : error instanceof Error ? error.message : "Arcana tool call failed.";
          return { content: [{ type: "text" as const, text: message }], isError: true };
        } finally {
          options.onToolCall?.({ tool: definition.name, ok, durationMs: Date.now() - startedAt });
        }
      },
    );
  }

  registerArcanaVisualTools(server, {
    adapter,
    visuals,
    artwork: options.artwork,
    viewerId: canReadPrivate ? principal?.id ?? null : null,
    onToolCall: options.onToolCall,
    securitySchemes: readSchemes as readonly ToolSecurityScheme[] | undefined,
  });

  if (options.catalog) {
    registerDeckEditTools(server, { catalog: options.catalog, principal, oauth: options.oauth, onToolCall: options.onToolCall });
    registerArcanaCatalogTools(server, {
      adapter: localAdapter,
      catalog: options.catalog,
      principal,
      ...(options.oauth
        ? {
            oauth: {
              resourceMetadataUrl: options.oauth.resourceMetadataUrl,
              readScopes: options.oauth.readScopes,
              writeScopes: options.oauth.writeScopes,
            },
          }
        : {}),
    });
  }

  return server;
}
