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

export interface LivingSpreadPackSummary {
  deckId: string;
  id: string;
  label: string;
  description?: string;
  renderer: "living-spread";
  /** Trusted widget-side renderer format. This names capability; it is not executable source. */
  format: string;
  spreadIds: string[];
  interactive: true;
}

export type ServerVisualPackSummary = StaticVisualPackSummary | LivingSpreadPackSummary;

export interface ServerCardArt {
  deckId: string;
  cardSlug: string;
  packId: string;
  packLabel: string;
  mimeType: string;
  data: Buffer;
}

export interface ServerSpreadScene {
  deckId: string;
  spreadId: string;
  packId: string;
  packLabel: string;
  format: string;
}

export interface ServerVisualStore {
  listPacks(deckId: string): ServerVisualPackSummary[];
  loadCardArt(deckId: string, cardSlug: string, preferPackId?: string): Promise<ServerCardArt | null>;
  resolveSpreadScene(deckId: string, spreadId: string, preferPackId?: string): ServerSpreadScene | null;
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

interface LivingSpreadPackDefinition {
  deckId: string;
  id: string;
  label: string;
  description?: string;
  /** Stable trusted format understood by the MCP spread widget. */
  format: string;
  spreadIds: readonly string[];
}

const SAFE_CARD_SLUG = /^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/;

/**
 * Server-readable visual capabilities.
 *
 * Static card images can be returned directly as MCP image content. Living Spread entries contain
 * only trusted format metadata: the MCP widget owns the browser-side implementation and receives a
 * resolved semantic scene payload. No p5 closure or executable program source crosses this boundary.
 */
export class StaticVisualStore implements ServerVisualStore {
  private readonly byDeck = new Map<string, StaticVisualPackDefinition[]>();
  private readonly spreadByDeck = new Map<string, LivingSpreadPackDefinition[]>();

  constructor(
    packs: readonly StaticVisualPackDefinition[],
    spreadPacks: readonly LivingSpreadPackDefinition[] = [],
  ) {
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

    for (const pack of spreadPacks) {
      if (!pack.deckId.trim() || !pack.id.trim() || !pack.label.trim() || !pack.format.trim() || !pack.spreadIds.length) {
        throw new Error("Living Spread packs require non-empty deck, pack, label, format, and spread ids.");
      }
      if (new Set(pack.spreadIds).size !== pack.spreadIds.length || pack.spreadIds.some((spreadId) => !spreadId.trim())) {
        throw new Error(`Living Spread pack ${pack.deckId}/${pack.id} contains invalid or duplicate spread ids.`);
      }
      const list = this.spreadByDeck.get(pack.deckId) ?? [];
      if (list.some((candidate) => candidate.id === pack.id)) {
        throw new Error(`Duplicate Living Spread pack ${pack.deckId}/${pack.id}.`);
      }
      list.push(pack);
      this.spreadByDeck.set(pack.deckId, list);
    }
  }

  listPacks(deckId: string): ServerVisualPackSummary[] {
    const cardPacks: StaticVisualPackSummary[] = (this.byDeck.get(deckId) ?? []).map((pack) => ({
      deckId: pack.deckId,
      id: pack.id,
      label: pack.label,
      ...(pack.description ? { description: pack.description } : {}),
      renderer: "static-image" as const,
      mimeType: pack.mimeType,
      complete: pack.complete,
      ...(pack.cardCount === undefined ? {} : { cardCount: pack.cardCount }),
    }));
    const spreadPacks: LivingSpreadPackSummary[] = (this.spreadByDeck.get(deckId) ?? []).map((pack) => ({
      deckId: pack.deckId,
      id: pack.id,
      label: pack.label,
      ...(pack.description ? { description: pack.description } : {}),
      renderer: "living-spread" as const,
      format: pack.format,
      spreadIds: [...pack.spreadIds],
      interactive: true as const,
    }));
    return [...cardPacks, ...spreadPacks];
  }

  async loadCardArt(deckId: string, cardSlug: string, preferPackId?: string): Promise<ServerCardArt | null> {
    if (!SAFE_CARD_SLUG.test(cardSlug)) throw new Error(`Card slug is not safe for static asset lookup: ${cardSlug}.`);

    const packs = this.byDeck.get(deckId) ?? [];
    const spreadPacks = this.spreadByDeck.get(deckId) ?? [];
    const ordered = preferPackId
      ? [...packs.filter((pack) => pack.id === preferPackId), ...packs.filter((pack) => pack.id !== preferPackId)]
      : packs;

    if (preferPackId
      && !packs.some((pack) => pack.id === preferPackId)
      && !spreadPacks.some((pack) => pack.id === preferPackId)) {
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

  resolveSpreadScene(deckId: string, spreadId: string, preferPackId?: string): ServerSpreadScene | null {
    const packs = this.spreadByDeck.get(deckId) ?? [];
    const ordered = preferPackId
      ? [...packs.filter((pack) => pack.id === preferPackId), ...packs.filter((pack) => pack.id !== preferPackId)]
      : packs;

    if (preferPackId
      && !packs.some((pack) => pack.id === preferPackId)
      && !(this.byDeck.get(deckId) ?? []).some((pack) => pack.id === preferPackId)) {
      throw new Error(`Unknown server-renderable visual pack “${preferPackId}” for deck “${deckId}”.`);
    }

    for (const pack of ordered) {
      if (!pack.spreadIds.includes(spreadId)) continue;
      return {
        deckId,
        spreadId,
        packId: pack.id,
        packLabel: pack.label,
        format: pack.format,
      };
    }
    return null;
  }
}

export function createBundledStaticVisualStore(): StaticVisualStore {
  return new StaticVisualStore(
    [
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
    ],
    [
      {
        deckId: "deep-time",
        id: "core-sample",
        label: "Core Sample",
        description: "A Living Spread that composes the five dealt layers into one animated geological column.",
        format: "generative-arcana/deep-time-core-sample@1",
        spreadIds: ["core-sample"],
      },
    ],
  );
}

function isMissingFile(error: unknown): boolean {
  return !!error && typeof error === "object" && "code" in error && (error as { code?: unknown }).code === "ENOENT";
}
