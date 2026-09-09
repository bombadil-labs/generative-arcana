import { McpServer } from "@modelcontextprotocol/server";
import * as z from "zod/v4";
import { canResolveUserDeck, type DeckVisibility, type UserDeckRecord } from "../../app/src/decks/catalog.js";
import type { ArcanaToolAdapter } from "../../app/src/mcp/ArcanaToolAdapter.js";
import {
  oauthToolError,
  optionalOAuthSecuritySchemes,
  requiredOAuthSecuritySchemes
} from "./oauthResource.js";
import { principalHasScopes, type ArcanaPrincipal } from "./principal.js";
import type { UserDeckCatalogRepository } from "./userDeckCatalog.js";

export interface CatalogOAuthContext {
  resourceMetadataUrl: string;
  readScopes: readonly string[];
  writeScopes: readonly string[];
}

export interface RegisterArcanaCatalogToolsOptions {
  adapter: ArcanaToolAdapter;
  catalog: UserDeckCatalogRepository;
  principal?: ArcanaPrincipal | null;
  oauth?: CatalogOAuthContext;
}

const visibilitySchema = z.enum(["private", "unlisted", "public"]);

const PUBLIC_LIST_LIMIT = 100;

export function registerArcanaCatalogTools(
  server: McpServer,
  options: RegisterArcanaCatalogToolsOptions,
): void {
  const principal = options.principal ?? null;
  const readSchemes = options.oauth ? optionalOAuthSecuritySchemes(options.oauth.readScopes) : undefined;
  const writeScopes = options.oauth
    ? [...new Set([...options.oauth.readScopes, ...options.oauth.writeScopes])]
    : [];
  const writeSchemes = options.oauth ? requiredOAuthSecuritySchemes(writeScopes) : undefined;

  server.registerTool(
    "list_public_decks",
    {
      description: "List publicly discoverable user-authored decks in the Generative Arcana catalog.",
      inputSchema: z.object({
        limit: z.number().int().min(1).max(PUBLIC_LIST_LIMIT).optional(),
      }),
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: false,
      },
      ...(readSchemes ? { _meta: { securitySchemes: readSchemes } } : {}),
    },
    async (input: unknown) => {
      const { limit } = input as { limit?: number };
      try {
        const records = await options.catalog.listPublic(limit ?? 50);
        return result(records.map(deckSummary));
      } catch (error) {
        return toolError(error);
      }
    },
  );

  server.registerTool(
    "get_shared_deck",
    {
      description: "Resolve a public or unlisted user-authored deck by stable resource id. Owners may also resolve their private decks.",
      inputSchema: z.object({ deckId: z.string().min(1) }),
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: false,
      },
      ...(readSchemes ? { _meta: { securitySchemes: readSchemes } } : {}),
    },
    async (input: unknown) => {
      const { deckId } = input as { deckId: string };
      try {
        const record = await options.catalog.get(deckId);
        const viewerId = principal && (!options.oauth || principalHasScopes(principal, options.oauth.readScopes))
          ? principal.id
          : null;
        if (!record || !canResolveUserDeck(record, viewerId)) {
          return { content: [{ type: "text" as const, text: "Unknown deck resource." }], isError: true };
        }
        return result(sharedDeck(record));
      } catch (error) {
        return toolError(error);
      }
    },
  );

  // In OAuth mode these tools must remain discoverable before login so the client can initiate
  // authorization from their security metadata/challenge. In non-OAuth modes, omit them unless a
  // trusted principal is already present (for example private-alpha dogfooding).
  if (!principal && !options.oauth) return;

  server.registerTool(
    "list_my_decks",
    {
      description: "List the authenticated user's owned Generative Arcana decks and publication state.",
      inputSchema: z.object({}),
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: false,
      },
      ...(options.oauth ? { _meta: { securitySchemes: requiredOAuthSecuritySchemes(options.oauth.readScopes) } } : {}),
    },
    async () => {
      const denied = requirePrincipal(principal, options.oauth, options.oauth?.readScopes ?? [], "Sign in to view your decks.");
      if (denied) return denied;
      try {
        const records = await options.catalog.listOwned(principal!.id);
        return result(records.map(deckSummary));
      } catch (error) {
        return toolError(error);
      }
    },
  );

  server.registerTool(
    "set_deck_visibility",
    {
      description: "Set one owned deck to private, unlisted, or public.",
      inputSchema: z.object({
        deckId: z.string().min(1),
        visibility: visibilitySchema,
      }),
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: false,
      },
      ...(writeSchemes ? { _meta: { securitySchemes: writeSchemes } } : {}),
    },
    async (input: unknown) => {
      const denied = requirePrincipal(
        principal,
        options.oauth,
        writeScopes,
        "Changing deck visibility requires deck write permission.",
      );
      if (denied) return denied;

      const { deckId, visibility } = input as { deckId: string; visibility: DeckVisibility };
      try {
        const updated = await options.catalog.setVisibility(principal!.id, deckId, visibility);
        return result(deckSummary(updated));
      } catch (error) {
        return toolError(error);
      }
    },
  );

  server.registerTool(
    "delete_my_deck",
    {
      description: "Permanently delete one deck owned by the authenticated user.",
      inputSchema: z.object({ deckId: z.string().min(1) }),
      annotations: {
        readOnlyHint: false,
        destructiveHint: true,
        idempotentHint: true,
        openWorldHint: false,
      },
      ...(writeSchemes ? { _meta: { securitySchemes: writeSchemes } } : {}),
    },
    async (input: unknown) => {
      const denied = requirePrincipal(
        principal,
        options.oauth,
        writeScopes,
        "Deleting a deck requires deck write permission.",
      );
      if (denied) return denied;

      const { deckId } = input as { deckId: string };
      try {
        const owned = await options.catalog.get(deckId);
        if (!owned || owned.ownerId !== principal!.id) {
          return { content: [{ type: "text" as const, text: "Unknown owned user deck." }], isError: true };
        }
        const deleted = await options.catalog.deleteOwned(principal!.id, deckId);
        if (!deleted) {
          return { content: [{ type: "text" as const, text: "Unknown owned user deck." }], isError: true };
        }
        options.adapter.engine.removeCustomDeck(deckId);
        return result({ id: deckId, deleted: true });
      } catch (error) {
        return toolError(error);
      }
    },
  );
}

function requirePrincipal(
  principal: ArcanaPrincipal | null,
  oauth: CatalogOAuthContext | undefined,
  scopes: readonly string[],
  description: string,
) {
  if (principal && (!oauth || principalHasScopes(principal, scopes))) return null;
  if (oauth) {
    return oauthToolError({
      resourceMetadataUrl: oauth.resourceMetadataUrl,
      scopes,
      description,
    });
  }
  return { content: [{ type: "text" as const, text: description }], isError: true as const };
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
  return {
    ...deckSummary(record),
    manifest: record.manifest,
  };
}

function result(value: unknown) {
  return {
    content: [{ type: "text" as const, text: JSON.stringify(value, null, 2) }],
    structuredContent: { result: value },
  };
}

function toolError(error: unknown) {
  const message = error instanceof Error ? error.message : "Catalog tool call failed.";
  return { content: [{ type: "text" as const, text: message }], isError: true as const };
}
