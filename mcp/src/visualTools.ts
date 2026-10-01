import { ArtworkError, type CardArtworkService } from "./cardArtwork";
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
  const listPacks = async (deckId: string) => {
    const existing = visuals.listPacks(deckId);
    if (!options.artwork) return existing;
    try {
      const cards = await options.artwork.readableCards(options.viewerId ?? null, deckId);
      const count = cards.cards.filter(card => card.artwork).length;
      return count ? [...existing, { deckId, id: "saved-artwork", label: "Saved card artwork", renderer: "static-image" as const, mimeType: "image/webp", complete: count === cards.cards.length, cardCount: count }] : existing;
    } catch (error) {
      if (error instanceof ArtworkError && error.status === 404) return existing;
      throw new Error("Saved artwork is temporarily unavailable.");
    }
  };
  const loadCardArt = async (deckId: string, cardSlug: string, packId?: string) => {
    if (options.artwork && (!packId || packId === "saved-artwork")) {
      try {
        const { metadata, bytes } = await options.artwork.image(options.viewerId ?? null, deckId, cardSlug);
        return { deckId, cardSlug, packId: "saved-artwork", packLabel: "Saved card artwork", mimeType: metadata.mediaType, data: Buffer.from(bytes) };
      } catch (error) {
        if (!(error instanceof ArtworkError && error.status === 404)) throw new Error("Saved artwork is temporarily unavailable.");
      }
    }
    return visuals.loadCardArt(deckId, cardSlug, packId);
  };
  const authMeta = options.securitySchemes ? { securitySchemes: options.securitySchemes } : undefined;
  registerArcanaSpreadWidget(server);

  server.registerTool(
    "list_visual_packs",
    {
      description: "List server-renderable card-art and Living Spread visual packs available for one deck.",
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
      description: "Return actual card artwork as MCP image content when this host has server-renderable card art for the deck.",
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
      if (!art) throw visualLookupError(deckId, visuals);

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
      description: "Render an existing Arcana reading token. A matching Living Spread is preferred when available; otherwise server card art is laid out responsively. This never recasts the reading.",
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

      const spreadScene = visuals.resolveSpreadScene(reading.deckId, reading.spread.id, packId);
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

      const staticPacks = (await listPacks(reading.deckId)).filter((pack) => pack.renderer === "static-image");
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
            layout: { kind: "flow" },
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
