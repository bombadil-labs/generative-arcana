import { ArtworkError, DEFAULT_ARTWORK_PACK_ID, type CardArtworkService } from "./cardArtwork";
import { McpServer } from "@modelcontextprotocol/server";
import * as z from "zod/v4";
import type { CardData } from "../../app/src/decks/card";
import type { CardRenderSpec } from "../../app/src/decks/renderSpec";
import type { ArcanaToolAdapter } from "../../app/src/mcp/ArcanaToolAdapter";
import type { ArcanaToolCallObserver } from "./observability";
import type { ToolSecurityScheme } from "./oauthResource";
import { buildLivingSpreadResult, type ResolvedReadingForLivingSpread } from "./livingSpreadPayload";
import { ARCANA_SPREAD_WIDGET_URI, registerArcanaSpreadWidget } from "./spreadWidget";
import type { ServerVisualStore } from "./staticVisuals";

export const ARCANA_VISUAL_TOOL_NAMES = [
  "list_visual_packs",
  "get_card_art",
  "render_reading",
] as const;

export type ArcanaVisualToolName = typeof ARCANA_VISUAL_TOOL_NAMES[number];

export interface RegisterArcanaVisualToolsOptions {
  adapter: ArcanaToolAdapter;
  visuals: ServerVisualStore;
  artwork?: CardArtworkService;
  viewerId?: string | null;
  onToolCall?: ArcanaToolCallObserver;
  securitySchemes?: readonly ToolSecurityScheme[];
}

interface ResolvedReadingView extends ResolvedReadingForLivingSpread {
  placements: Array<{
    position: { name: string; prompt: string };
    card: CardData & { render: CardRenderSpec };
    reversed: boolean;
    meaning: string;
  }>;
}

const readOnlyAnnotations = {
  readOnlyHint: true,
  destructiveHint: false,
  idempotentHint: true,
  openWorldHint: false,
} as const;

/** Register Node-host visual capabilities without coupling presentation to ArcanaEngine internals. */
export function registerArcanaVisualTools(server: McpServer, options: RegisterArcanaVisualToolsOptions): void {
  const { adapter, visuals, onToolCall } = options;
  const savedPacks = async (deckId: string) => {
    if (!options.artwork) return [];
    try { return await options.artwork.listPacks(options.viewerId ?? null, deckId); }
    catch (error) {
      if (error instanceof ArtworkError && error.status === 404) return [];
      throw new Error("Saved artwork is temporarily unavailable.");
    }
  };
  const listPacks = async (deckId: string, includeEmptyDefault = false) => {
    const saved = (await savedPacks(deckId)).filter(pack => includeEmptyDefault || pack.id !== DEFAULT_ARTWORK_PACK_ID || pack.cardCount > 0);
    return [...visuals.listPacks(deckId), ...saved.map(pack => ({ deckId, id: pack.id, label: pack.label, ...(pack.description ? { description: pack.description } : {}), renderer: "static-image" as const, mimeType: "image/webp", complete: pack.complete, cardCount: pack.cardCount }))];
  };
  const loadCardArt = async (deckId: string, cardSlug: string, packId?: string) => {
    const saved = options.artwork ? await savedPacks(deckId) : [];
    const selected = saved.find(pack => pack.id === (packId ?? DEFAULT_ARTWORK_PACK_ID));
    if (options.artwork && selected) {
      try {
        const { metadata, bytes } = await options.artwork.image(options.viewerId ?? null, deckId, cardSlug, undefined, selected.id);
        return { deckId, cardSlug, packId: selected.id, packLabel: selected.label, mimeType: metadata.mediaType, data: Buffer.from(bytes) };
      } catch (error) {
        if (!(error instanceof ArtworkError && error.status === 404)) throw new Error("Saved artwork is temporarily unavailable.");
        // A selected set is a boundary, never a preference that leaks another set's image.
        if (packId) return null;
      }
    }
    const art = await visuals.loadCardArt(deckId, cardSlug, packId);
    return packId && art?.packId !== packId ? null : art;
  };
  const authMeta = options.securitySchemes ? { securitySchemes: options.securitySchemes } : undefined;
  registerArcanaSpreadWidget(server);

  server.registerTool(
    "list_visual_packs",
    {
      description: "List named saved-artwork sets and server-renderable visual packs for one deck, including empty named sets and their coverage. Omitted packId on image tools uses the legacy saved-artwork set.",
      inputSchema: z.object({ deckId: z.string().min(1) }),
      annotations: readOnlyAnnotations,
      ...(authMeta ? { _meta: authMeta } : {}),
    },
    async (input: unknown) => observed("list_visual_packs", onToolCall, async () => {
      const { deckId } = input as { deckId: string };
      await adapter.call("get_deck", { deckId });
      const result = await listPacks(deckId);
      return {
        content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }],
        structuredContent: { result },
      };
    }),
  );

  server.registerTool(
    "get_card_art",
    {
      description: "Return actual card artwork as MCP image content. With packId, resolve strictly within that visual set; missing art never falls back to another set.",
      inputSchema: z.object({
        deckId: z.string().min(1),
        cardSlug: z.string().min(1),
        packId: z.string().min(1).optional(),
      }),
      annotations: readOnlyAnnotations,
      ...(authMeta ? { _meta: authMeta } : {}),
    },
    async (input: unknown) => observed("get_card_art", onToolCall, async () => {
      const { deckId, cardSlug, packId } = input as { deckId: string; cardSlug: string; packId?: string };
      const card = await adapter.call("get_card", { deckId, cardSlug }) as CardData;

      const art = await loadCardArt(deckId, cardSlug, packId);
      if (!art) throw packId ? new Error(`Visual set “${packId}” has no artwork for card “${cardSlug}”.`) : visualLookupError(deckId, visuals);

      const result = {
        deckId,
        cardSlug,
        cardName: card.name,
        packId: art.packId,
        packLabel: art.packLabel,
        mimeType: art.mimeType,
      };
      return {
        content: [
          { type: "text" as const, text: `${card.name} · ${art.packLabel}` },
          { type: "image" as const, data: art.data.toString("base64"), mimeType: art.mimeType },
        ],
        structuredContent: { result },
      };
    }),
  );

  server.registerTool(
    "render_reading",
    {
      title: "Render Arcana spread",
      description: "Render an existing Arcana reading token. An explicit packId is strict: the selected set supplies every image, with no cross-set fallback. Otherwise a matching Living Spread is preferred before static art. This never recasts the reading.",
      inputSchema: z.object({
        token: z.string().min(1),
        deckId: z.string().min(1).optional(),
        packId: z.string().min(1).optional(),
      }),
      annotations: readOnlyAnnotations,
      _meta: {
        ...(authMeta ?? {}),
        ui: { resourceUri: ARCANA_SPREAD_WIDGET_URI },
        "openai/outputTemplate": ARCANA_SPREAD_WIDGET_URI,
        "openai/toolInvocation/invoking": "Laying out the spread…",
        "openai/toolInvocation/invoked": "Spread ready",
      },
    },
    async (input: unknown) => observed("render_reading", onToolCall, async () => {
      const { token, deckId, packId } = input as { token: string; deckId?: string; packId?: string };
      const reading = await adapter.call("resolve_reading", {
        token,
        ...(deckId ? { deckId } : {}),
      }) as ResolvedReadingView;

      const available = await listPacks(reading.deckId, packId === DEFAULT_ARTWORK_PACK_ID);
      const selectedPack = packId ? available.find(pack => pack.id === packId) : undefined;
      if (packId && !selectedPack) throw new Error(`Unknown visual set “${packId}” for this deck.`);
      const selectedSaved = !!packId && (await savedPacks(reading.deckId)).some(pack => pack.id === packId);
      const resolvedScene = selectedSaved ? null : visuals.resolveSpreadScene(reading.deckId, reading.spread.id, packId);
      const spreadScene = packId && resolvedScene?.packId !== packId ? null : resolvedScene;
      if (spreadScene) {
        const result = buildLivingSpreadResult(reading, spreadScene);
        return {
          content: [{
            type: "text" as const,
            text: `${reading.deckName} · ${reading.spread.name}${reading.question ? `\n${reading.question}` : ""}\nLiving Spread · ${spreadScene.packLabel}`,
          }],
          structuredContent: { result },
        };
      }

      const staticPacks = available.filter((pack) => pack.renderer === "static-image");
      if (!staticPacks.length) throw noVisualError(reading.deckId, reading.spread.id);

      const content: Array<
        | { type: "text"; text: string }
        | { type: "image"; data: string; mimeType: string }
      > = [{
        type: "text",
        text: `${reading.deckName} · ${reading.spread.name}${reading.question ? `\n${reading.question}` : ""}`,
      }];
      const placements: Array<{
        position: string;
        positionPrompt: string;
        cardSlug: string;
        cardName: string;
        reversed: boolean;
        packId: string;
        mimeType: string;
      }> = [];

      for (const [index, placement] of reading.placements.entries()) {
        const art = await loadCardArt(reading.deckId, placement.card.slug, packId);
        if (!art) {
          throw new Error(`Visual pack for deck “${reading.deckId}” is missing art for card “${placement.card.slug}”.`);
        }
        content.push({
          type: "text",
          text: `${index + 1}. ${placement.position.name} — ${placement.card.name}${placement.reversed ? " (Reversed)" : ""}`,
        });
        content.push({ type: "image", data: art.data.toString("base64"), mimeType: art.mimeType });
        placements.push({
          position: placement.position.name,
          positionPrompt: placement.position.prompt,
          cardSlug: placement.card.slug,
          cardName: placement.card.name,
          reversed: placement.reversed,
          packId: art.packId,
          mimeType: art.mimeType,
        });
      }

      return {
        content,
        structuredContent: {
          result: {
            token: reading.token,
            deckId: reading.deckId,
            deckName: reading.deckName,
            spreadId: reading.spread.id,
            spreadName: reading.spread.name,
            question: reading.question,
            layout: { kind: "flow", ...(selectedPack ? { packId: selectedPack.id, packLabel: selectedPack.label } : {}) },
            placements,
          },
        },
      };
    }),
  );
}

async function observed<T>(
  tool: ArcanaVisualToolName,
  observer: ArcanaToolCallObserver | undefined,
  call: () => Promise<T>,
): Promise<T | { content: Array<{ type: "text"; text: string }>; isError: true }> {
  const startedAt = Date.now();
  let ok = false;
  try {
    const result = await call();
    ok = true;
    return result;
  } catch (error) {
    const message = error instanceof Error ? error.message : "Arcana visual tool call failed.";
    return { content: [{ type: "text", text: message }], isError: true };
  } finally {
    observer?.({ tool, ok, durationMs: Date.now() - startedAt });
  }
}

function noVisualError(deckId: string, spreadId: string): Error {
  return new Error(`Deck “${deckId}” has no server-renderable visual for spread “${spreadId}” yet. Its symbolic reading tools remain available.`);
}

function visualLookupError(deckId: string, visuals: ServerVisualStore): Error {
  const cardPacks = visuals.listPacks(deckId).filter((pack) => pack.renderer === "static-image");
  if (!cardPacks.length) return new Error(`Deck “${deckId}” has no server-renderable card-art pack yet.`);
  return new Error(`No card art was found in the server-renderable visual packs for deck “${deckId}”.`);
}
