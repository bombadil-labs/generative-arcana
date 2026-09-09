import { readFile } from "node:fs/promises";

export interface StaticVisualPackSummary {
  deckId: string;
  id: string;
  label: string;
  description?: string;
  renderer: "static-image";
  mimeType: string;
  complete: boolean;
  cardCount?: number;
}

export interface StaticCardArt {
  deckId: string;
  cardSlug: string;
  packId: string;
  packLabel: string;
  mimeType: string;
  data: Buffer;
}

interface StaticVisualPackDefinition {
  deckId: string;
  id: string;
  label: string;
  description?: string;
  mimeType: string;
  extension: string;
  directory: URL;
  complete: boolean;
  cardCount?: number;
}

const SAFE_CARD_SLUG = /^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/;

/**
 * Server-readable visual packs whose cards already exist as immutable image assets.
 *
 * This deliberately does not import the browser VisualRegistry: kit/raw-p5 packs require a browser
 * renderer, while these assets can be returned directly as MCP image content from any Node host.
 */
export class StaticVisualStore {
  private readonly byDeck = new Map<string, StaticVisualPackDefinition[]>();

  constructor(packs: readonly StaticVisualPackDefinition[]) {
    for (const pack of packs) {
      if (!pack.deckId.trim() || !pack.id.trim() || !pack.label.trim()) {
        throw new Error("Static visual packs require non-empty deck, pack, and label values.");
      }
      const list = this.byDeck.get(pack.deckId) ?? [];
      if (list.some((candidate) => candidate.id === pack.id)) {
        throw new Error(`Duplicate static visual pack ${pack.deckId}/${pack.id}.`);
      }
      list.push(pack);
      this.byDeck.set(pack.deckId, list);
    }
  }

  listPacks(deckId: string): StaticVisualPackSummary[] {
    return (this.byDeck.get(deckId) ?? []).map((pack) => ({
      deckId: pack.deckId,
      id: pack.id,
      label: pack.label,
      ...(pack.description ? { description: pack.description } : {}),
      renderer: "static-image" as const,
      mimeType: pack.mimeType,
      complete: pack.complete,
      ...(pack.cardCount === undefined ? {} : { cardCount: pack.cardCount }),
    }));
  }

  async loadCardArt(deckId: string, cardSlug: string, preferPackId?: string): Promise<StaticCardArt | null> {
    if (!SAFE_CARD_SLUG.test(cardSlug)) throw new Error(`Card slug is not safe for static asset lookup: ${cardSlug}.`);

    const packs = this.byDeck.get(deckId) ?? [];
    const ordered = preferPackId
      ? [...packs.filter((pack) => pack.id === preferPackId), ...packs.filter((pack) => pack.id !== preferPackId)]
      : packs;

    if (preferPackId && !packs.some((pack) => pack.id === preferPackId)) {
      throw new Error(`Unknown server-renderable visual pack “${preferPackId}” for deck “${deckId}”.`);
    }

    for (const pack of ordered) {
      const assetUrl = new URL(`${cardSlug}${pack.extension}`, pack.directory);
      try {
        const data = await readFile(assetUrl);
        return {
          deckId,
          cardSlug,
          packId: pack.id,
          packLabel: pack.label,
          mimeType: pack.mimeType,
          data,
        };
      } catch (error) {
        if (isMissingFile(error)) continue;
        throw error;
      }
    }
    return null;
  }
}

export function createBundledStaticVisualStore(): StaticVisualStore {
  return new StaticVisualStore([
    {
      deckId: "final-fantasy-tarot",
      id: "pixel",
      label: "Pixel",
      description: "Chibi pixel art, each card lit by its element.",
      mimeType: "image/png",
      extension: ".png",
      directory: new URL("../../app/src/decks/finalfantasy/pixel/", import.meta.url),
      complete: true,
      cardCount: 78,
    },
  ]);
}

function isMissingFile(error: unknown): boolean {
  return !!error && typeof error === "object" && "code" in error && (error as { code?: unknown }).code === "ENOENT";
}
