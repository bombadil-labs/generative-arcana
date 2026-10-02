import type { McpServer } from "@modelcontextprotocol/server";
import * as z from "zod/v4";
import { validateDeckManifest, type DeckManifest } from "../../app/src/decks/manifest.js";
import type { UserDeckRecord } from "../../app/src/decks/catalog.js";
import type { CatalogOAuthContext } from "./catalogTools.js";
import type { ArcanaToolCallObserver } from "./observability.js";
import { oauthToolError, requiredOAuthSecuritySchemes } from "./oauthResource.js";
import { principalHasScopes, type ArcanaPrincipal } from "./principal.js";
import { UserDeckRevisionConflictError, type UserDeckCatalogRepository } from "./userDeckCatalog.js";

export const MAX_DECK_EDIT_OPERATIONS = 20;
export const MAX_DECK_EDIT_BYTES = 64 * 1024;
const MAX_EDIT_TEXT_CHARS = 8_192;
const MAX_EDIT_SPREAD_POSITIONS = 64;
const storageSafe = (value: string) => !value.includes("\0") && !/\p{Surrogate}/u.test(value);
const storageTextError = "Must not contain NUL or unpaired Unicode surrogates.";
const text = z.string().max(MAX_EDIT_TEXT_CHARS).refine(storageSafe, storageTextError);
const content = text.refine((value) => !!value.trim(), "Must contain non-whitespace text.");
const name = z.string().min(1).max(256).refine(storageSafe, storageTextError).refine((value) => !!value.trim(), "Must contain non-whitespace text.");
const slug = z.string().min(1).max(200).regex(/^[a-z0-9]+(?:[-_][a-z0-9]+)*$/);
const id = z.string().min(1).max(200).refine(storageSafe, storageTextError).refine((value) => !!value.trim(), "Must contain non-whitespace text.");

const factorization = z.strictObject({
  character: z.enum(["identity", "prime", "composite"]),
  factors: z.array(z.number().int().min(2).max(Number.MAX_SAFE_INTEGER)).max(64).optional(),
  gloss: text,
  visual_logic: content.optional(),
});
const cardFields = {
  slug,
  name,
  number: z.string().max(16).regex(/^(0|[1-9]\d*)$/).refine((value) => Number.isSafeInteger(Number(value)), "Must be a safe integer written in decimal."),
  station_slug: slug,
  factorization: factorization.optional(),
  meaning: z.strictObject({ upright: content, inverted: content }),
  visuals: z.strictObject({ detailed_description: text, style_override: text.optional(), content_override: text.optional() }),
};

/** Whole-card replacement: no arbitrary paths, extension fields, or implicit partial merges. */
export const deckEditCardSchema = z.discriminatedUnion("arcana", [
  z.strictObject({ ...cardFields, arcana: z.literal("major") }),
  z.strictObject({ ...cardFields, arcana: z.literal("minor"), suit_slug: slug, rank_slug: slug }),
]);

/** Spread ownership is derived from the deck; callers cannot inject a different deckId. */
export const deckEditSpreadSchema = z.strictObject({
  id,
  name,
  description: text,
  positions: z.array(z.strictObject({ name, prompt: text })).min(1).max(MAX_EDIT_SPREAD_POSITIONS),
});

const theme = z.strictObject({ name: name.optional(), description: text.optional(), creator: text.optional() })
  .refine((value) => Object.values(value).some((entry) => entry !== undefined), "Supply at least one theme field.");
const metadata = z.strictObject({
  name: name.optional(),
  version: name.optional(),
  tagline: content.optional(),
  theme: theme.optional(),
}).refine((value) => Object.values(value).some((entry) => entry !== undefined), "Supply at least one metadata field.");

export const deckEditInputSchema = z.strictObject({
  deckId: id,
  expectedRevision: z.number().int().positive().max(Number.MAX_SAFE_INTEGER),
  metadata: metadata.optional(),
  cards: z.strictObject({
    upsert: z.array(deckEditCardSchema).max(MAX_DECK_EDIT_OPERATIONS).optional(),
    remove: z.array(slug).max(MAX_DECK_EDIT_OPERATIONS).optional(),
  }).optional(),
  spreads: z.strictObject({
    upsert: z.array(deckEditSpreadSchema).max(MAX_DECK_EDIT_OPERATIONS).optional(),
    remove: z.array(id).max(MAX_DECK_EDIT_OPERATIONS).optional(),
  }).optional(),
}).superRefine((value, ctx) => {
  const operationCount = (value.cards?.upsert?.length ?? 0) + (value.cards?.remove?.length ?? 0)
    + (value.spreads?.upsert?.length ?? 0) + (value.spreads?.remove?.length ?? 0);
  if (operationCount > MAX_DECK_EDIT_OPERATIONS) {
    ctx.addIssue({ code: "custom", message: `At most ${MAX_DECK_EDIT_OPERATIONS} combined card/spread edits are allowed per call.` });
  }
  if (!value.metadata && operationCount === 0) ctx.addIssue({ code: "custom", message: "Supply at least one edit." });
  for (const [section, upserts, removes] of [
    ["cards", value.cards?.upsert?.map((card) => card.slug) ?? [], value.cards?.remove ?? []],
    ["spreads", value.spreads?.upsert?.map((spread) => spread.id) ?? [], value.spreads?.remove ?? []],
  ] as const) {
    const all = [...upserts, ...removes];
    if (new Set(all).size !== all.length) {
      ctx.addIssue({ code: "custom", path: [section], message: "Each card/spread may appear only once, across upsert and remove." });
    }
  }
  if (Buffer.byteLength(JSON.stringify(value), "utf8") > MAX_DECK_EDIT_BYTES) {
    ctx.addIssue({ code: "custom", message: `Edits must be at most ${MAX_DECK_EDIT_BYTES} UTF-8 JSON bytes. Use file import for larger changes.` });
  }
});

export type DeckEditInput = z.infer<typeof deckEditInputSchema>;

export interface RegisterDeckEditToolsOptions {
  catalog: UserDeckCatalogRepository;
  principal?: ArcanaPrincipal | null;
  oauth?: CatalogOAuthContext;
  onToolCall?: ArcanaToolCallObserver;
}

export function registerDeckEditTools(server: McpServer, options: RegisterDeckEditToolsOptions): void {
  const principal = options.principal ?? null;
  if (!principal && !options.oauth) return;
  const scopes = options.oauth ? [...new Set([...options.oauth.readScopes, ...options.oauth.writeScopes])] : [];
  server.registerTool("edit_deck", {
    description: "Apply small typed edits to an owned deck by stable id and expectedRevision. Patch name/version/tagline/theme or replace/remove complete cards and native spreads. Upsert replaces the entire card/spread; omitted optional fields are removed. Each identity may occur once; removals must exist. At most 20 combined card/spread operations and 64 KiB of JSON. The complete result is validated and saved atomically; stale revisions fail without changing the deck. Read current revision before editing. Use manifest file import for large changes or other fields.",
    inputSchema: deckEditInputSchema,
    annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: false, openWorldHint: false },
    ...(options.oauth ? { _meta: { securitySchemes: requiredOAuthSecuritySchemes(scopes, options.oauth?.requestOfflineAccess) } } : {}),
  }, async (input) => {
    const startedAt = Date.now();
    let ok = false;
    try {
      if (!principal || (options.oauth && !principalHasScopes(principal, scopes))) {
        return options.oauth ? oauthToolError({
          resourceMetadataUrl: options.oauth.resourceMetadataUrl,
          scopes,
          description: "Sign in with deck read and write permission to edit an owned deck.",
        }) : failed("Sign in to edit an owned deck.");
      }
      const updated = await editOwnedDeck(options.catalog, principal.id, input);
      const summary = {
        id: updated.id,
        slug: updated.slug,
        name: updated.manifest.data.name,
        revision: updated.revision,
        visibility: updated.visibility,
        cardCount: Object.keys(updated.manifest.data.cards).length,
        spreadCount: updated.manifest.spreads?.length ?? 0,
      };
      ok = true;
      return { content: [{ type: "text" as const, text: JSON.stringify(summary) }], structuredContent: { result: summary } };
    } catch (error) {
      if (error instanceof UserDeckRevisionConflictError) {
        return {
          ...failed(error.message),
          structuredContent: { error: { code: error.code, expectedRevision: error.expectedRevision, currentRevision: error.currentRevision } },
        };
      }
      return failed(error instanceof Error ? error.message : "Deck edit failed.");
    } finally {
      options.onToolCall?.({ tool: "edit_deck", ok, durationMs: Date.now() - startedAt });
    }
  });
}

/** Parse even for direct callers: the edit boundary never trusts a TypeScript cast as validation. */
export async function editOwnedDeck(catalog: UserDeckCatalogRepository, ownerId: string, input: unknown): Promise<UserDeckRecord> {
  const edit = deckEditInputSchema.parse(input);
  const current = await catalog.get(edit.deckId);
  if (!current || current.ownerId !== ownerId) throw new Error("Unknown owned user deck.");
  if (current.revision !== edit.expectedRevision) throw new UserDeckRevisionConflictError(edit.expectedRevision, current.revision);
  const manifest = applyDeckEdit(current.manifest, edit);
  // The repository repeats revision and ownership checks inside the write to close the read/write race.
  return catalog.replaceOwned(ownerId, current.id, edit.expectedRevision, manifest);
}

function applyDeckEdit(original: DeckManifest, edit: DeckEditInput): DeckManifest {
  const next = structuredClone(original);
  if (edit.metadata) {
    const update = edit.metadata;
    if (update.name !== undefined) next.data.name = update.name;
    if (update.version !== undefined) next.data.version = update.version;
    if (update.tagline !== undefined) next.tagline = update.tagline;
    if (update.theme?.name !== undefined) next.data.theme.name = update.theme.name;
    if (update.theme?.description !== undefined) next.data.theme.description = update.theme.description;
    if (update.theme?.creator !== undefined) next.data.theme.creator = update.theme.creator;
  }
  for (const cardSlug of edit.cards?.remove ?? []) {
    if (!Object.hasOwn(next.data.cards, cardSlug)) throw new Error(`Unknown card “${cardSlug}” in owned deck.`);
    delete next.data.cards[cardSlug];
  }
  for (const card of edit.cards?.upsert ?? []) next.data.cards[card.slug] = card;
  if ((edit.spreads?.upsert?.length ?? 0) + (edit.spreads?.remove?.length ?? 0) > 0) {
    const spreads = new Map((next.spreads ?? []).map((spread) => [spread.id, spread]));
    for (const spreadId of edit.spreads?.remove ?? []) {
      if (!spreads.delete(spreadId)) throw new Error(`Unknown native spread “${spreadId}” in owned deck.`);
    }
    for (const spread of edit.spreads?.upsert ?? []) spreads.set(spread.id, spread);
    next.spreads = [...spreads.values()];
  }
  const validation = validateDeckManifest(next);
  if (!validation.ok) throw new Error(validation.error);
  return validation.manifest;
}

function failed(message: string) {
  return { content: [{ type: "text" as const, text: message }], isError: true as const };
}
