import { McpServer } from "@modelcontextprotocol/server";
import * as z from "zod/v4";
import type { ArcanaToolAdapter } from "../../app/src/mcp/ArcanaToolAdapter";
import type { ArcanaToolCallObserver } from "./observability";
import { StaticVisualStore } from "./staticVisuals";

export const ARCANA_VISUAL_TOOL_NAMES = [
  "list_visual_packs",
  "get_card_art",
  "render_reading",
] as const;

export type ArcanaVisualToolName = typeof ARCANA_VISUAL_TOOL_NAMES[number];

export interface RegisterArcanaVisualToolsOptions {
  adapter: ArcanaToolAdapter;
  visuals: StaticVisualStore;
  onToolCall?: ArcanaToolCallObserver;
}

const readOnlyAnnotations = {
  readOnlyHint: true,
  destructiveHint: false,
  idempotentHint: true,
  openWorldHint: false,
} as const;

/** Register Node-host visual capabilities without coupling ArcanaEngine to a renderer. */
export function registerArcanaVisualTools(server: McpServer, options: RegisterArcanaVisualToolsOptions): void {
  const { adapter, visuals, onToolCall } = options;

  server.registerTool(
    "list_visual_packs",
    {
      description: "List server-renderable visual packs available for one deck.",
      inputSchema: z.object({ deckId: z.string().min(1) }),
      annotations: readOnlyAnnotations,
    },
    async (input: unknown) => observed("list_visual_packs", onToolCall, async () => {
      const { deckId } = input as { deckId: string };
      requireDeck(adapter, deckId);
      const result = visuals.listPacks(deckId);
      return {
        content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }],
        structuredContent: { result },
      };
    }),
  );

  server.registerTool(
    "get_card_art",
    {
      description: "Return actual card artwork as MCP image content when this host can render the deck.",
      inputSchema: z.object({
        deckId: z.string().min(1),
        cardSlug: z.string().min(1),
        packId: z.string().min(1).optional(),
      }),
      annotations: readOnlyAnnotations,
    },
    async (input: unknown) => observed("get_card_art", onToolCall, async () => {
      const { deckId, cardSlug, packId } = input as { deckId: string; cardSlug: string; packId?: string };
      const card = adapter.engine.getCard(deckId, cardSlug);
      if (!card) throw new Error(`Unknown card “${cardSlug}” in deck “${deckId}”.`);

      const art = await visuals.loadCardArt(deckId, cardSlug, packId);
      if (!art) throw noVisualError(deckId);

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
      description: "Render the cards in a resolved Arcana reading as actual MCP image content when visual assets are available.",
      inputSchema: z.object({
        token: z.string().min(1),
        deckId: z.string().min(1).optional(),
        packId: z.string().min(1).optional(),
      }),
      annotations: readOnlyAnnotations,
    },
    async (input: unknown) => observed("render_reading", onToolCall, async () => {
      const { token, deckId, packId } = input as { token: string; deckId?: string; packId?: string };
      const reading = await adapter.engine.resolveReading(token, deckId);
      if (!visuals.listPacks(reading.deck.id).length) throw noVisualError(reading.deck.id);

      const content: Array<
        | { type: "text"; text: string }
        | { type: "image"; data: string; mimeType: string }
      > = [{
        type: "text",
        text: `${reading.deck.name} · ${reading.spread.name}${reading.question ? `\n${reading.question}` : ""}`,
      }];
      const placements: Array<{
        position: string;
        cardSlug: string;
        cardName: string;
        reversed: boolean;
        packId: string;
        mimeType: string;
      }> = [];

      for (const [index, placement] of reading.placements.entries()) {
        const art = await visuals.loadCardArt(reading.deck.id, placement.card.slug, packId);
        if (!art) {
          throw new Error(`Visual pack for deck “${reading.deck.id}” is missing art for card “${placement.card.slug}”.`);
        }
        content.push({
          type: "text",
          text: `${index + 1}. ${placement.position.name} — ${placement.card.name}${placement.reversed ? " (Reversed)" : ""}`,
        });
        content.push({ type: "image", data: art.data.toString("base64"), mimeType: art.mimeType });
        placements.push({
          position: placement.position.name,
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
            deckId: reading.deck.id,
            deckName: reading.deck.name,
            spreadId: reading.spread.id,
            spreadName: reading.spread.name,
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

function requireDeck(adapter: ArcanaToolAdapter, deckId: string): void {
  if (!adapter.engine.getDeck(deckId)) throw new Error(`Unknown deck: ${deckId}.`);
}

function noVisualError(deckId: string): Error {
  return new Error(`Deck “${deckId}” has no server-renderable visual pack yet. Its symbolic reading tools remain available.`);
}
