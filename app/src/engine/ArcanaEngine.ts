import type { CardData } from "../decks/card";
import { omega } from "../decks/cardMeta";
import { DeckRegistry, deckRegistry } from "../decks/registry";
import { immutableJsonSnapshot } from "../decks/jsonSnapshot";
import { isValidSpread, resolveSpread, spreadsForDeck, type Spread } from "../decks/spreads";
import { deckHasIdentity, type DeckModule } from "../decks/types";
import { deal } from "../reading/deal";
import { decodeReading, encodeReading, resolveReading as resolveReadingTokenData } from "../reading/encode";
import { buildPrompt } from "../reading/prompt";
import type { ReadingCard } from "../reading/types";
import type { ArcanaReading, CardAnalysis, CardQuery, CastReadingOptions, ImportDeckOptions, ReadingPlacement } from "./types";

/**
 * Renderer- and transport-independent application service for Generative Arcana.
 *
 * Browser UI, MCP, CLI, and tests should depend on this semantic surface rather than rebuilding deck,
 * reading, or card-axis behavior independently.
 */
export class ArcanaEngine {
  constructor(readonly decks: DeckRegistry = deckRegistry) {}

  listDecks(): DeckModule[] {
    return this.decks.listDecks();
  }

  getDeck(deckId: string): DeckModule | undefined {
    return this.decks.getDeck(deckId);
  }

  getCard(deckId: string, cardSlug: string): CardData | undefined {
    return this.decks.getDeck(deckId)?.cards.find((card) => card.slug === cardSlug);
  }

  listSpreads(deckId: string): Spread[] {
    const deck = this.requireDeck(deckId);
    return immutableJsonSnapshot(spreadsForDeck(deck.spreads), "spreads");
  }

  importDeck(data: unknown, options: ImportDeckOptions = {}): DeckModule {
    return this.decks.registerDeck(
      {
        data,
        tagline: options.tagline,
        spreads: options.spreads,
        custom: true,
        runtimeId: options.runtimeId,
        aliases: options.aliases,
      },
      { replaceExisting: options.replaceExisting },
    );
  }

  importDeckJson(json: string, options: ImportDeckOptions = {}): DeckModule {
    let data: unknown;
    try {
      data = JSON.parse(json);
    } catch {
      throw new Error("Deck JSON could not be parsed.");
    }
    return this.importDeck(data, options);
  }

  /** Remove a runtime custom deck immediately after its durable catalog resource is deleted. */
  removeCustomDeck(deckId: string): boolean {
    const deck = this.decks.getDeck(deckId);
    if (!deck) return false;
    if (!deck.custom) throw new Error(`Bundled deck “${deck.id}” cannot be removed from the runtime.`);
    return !!this.decks.unregisterDeck(deck.id);
  }

  queryCards(deckId: string, query: CardQuery = {}): readonly CardAnalysis[] {
    if (query.omega !== undefined && (!Number.isSafeInteger(query.omega) || query.omega < 0)) {
      throw new Error("Card query Ω must be a non-negative integer.");
    }
    const deck = this.requireDeck(deckId);
    const results = deck.cards
      .map((card) => this.analyzeCard(deckId, card.slug))
      .filter((analysis) => {
        if (query.arcana !== undefined && analysis.card.arcana !== query.arcana) return false;
        if (query.suit !== undefined && analysis.card.suit_slug !== query.suit) return false;
        if (query.rank !== undefined && analysis.card.rank_slug !== query.rank) return false;
        if (query.station !== undefined && analysis.card.station_slug !== query.station) return false;
        if (query.omega !== undefined && analysis.number.omega !== query.omega) return false;
        if (query.factorizationCharacter !== undefined
          && analysis.number.factorization?.character !== query.factorizationCharacter) return false;
        if (query.dialectic !== undefined) {
          const coordinates = analysis.axes.dialectic ?? [];
          const matched = coordinates.some((coordinate) =>
            coordinate.pole === query.dialectic?.pole
            && (query.dialectic.axis === undefined || coordinate.axis === query.dialectic.axis));
          if (!matched) return false;
        }
        return true;
      });
    return Object.freeze(results);
  }

  analyzeCard(deckId: string, cardSlug: string): CardAnalysis {
    const deck = this.requireDeck(deckId);
    const card = deck.cards.find((candidate) => candidate.slug === cardSlug);
    if (!card) throw new Error(`Unknown card “${cardSlug}” in deck “${deckId}”.`);

    const station = deck.data.transversal.stations[card.station_slug];
    if (!station) throw new Error(`Card “${cardSlug}” references missing station “${card.station_slug}”.`);
    const suit = card.suit_slug ? deck.data.suits[card.suit_slug] : undefined;
    const rank = card.rank_slug ? deck.data.ranks[card.rank_slug] : undefined;

    let dialectic: CardAnalysis["axes"]["dialectic"];
    if (card.suit_slug && deck.data.dialectic) {
      const cell = deck.data.dialectic.cells[card.suit_slug];
      if (cell) {
        dialectic = [
          { axis: deck.data.dialectic.axes[0].name, pole: cell[0] },
          { axis: deck.data.dialectic.axes[1].name, pole: cell[1] },
        ];
      }
    }

    const value = parseCardNumber(card.number);
    const analysis: CardAnalysis = {
      deckId,
      card,
      axes: { ...(suit ? { suit } : {}), ...(rank ? { rank } : {}), station, ...(dialectic ? { dialectic } : {}) },
      number: {
        label: card.number,
        ...(value !== undefined ? { value, omega: omega(value) } : {}),
        ...(card.factorization ? { factorization: card.factorization } : {}),
      },
      authoredMeaning: card.meaning,
    };
    return Object.freeze(analysis);
  }

  async castReading(
    deckId: string,
    spreadIdOrInline: string | Spread,
    question = "",
    options: CastReadingOptions = {},
  ): Promise<ArcanaReading> {
    const deck = this.requireDeck(deckId);
    const resolved = resolveSpread(spreadIdOrInline, deck.spreads);
    if (!isValidSpread(resolved) || (resolved.deckId && !deckHasIdentity(deck, resolved.deckId))) {
      throw new Error("Unknown or invalid spread for this deck.");
    }
    const spread = immutableJsonSnapshot(resolved, "reading spread");
    const cards = deal(spread, deck.cards.map((card) => card.slug), options.reversalRate);
    const token = await encodeReading(deck, spread, question, cards);
    return this.hydrateReading(token, deck, spread, question, cards, false);
  }

  async resolveReading(token: string, expectedDeckId?: string): Promise<ArcanaReading> {
    const decoded = decodeReading(token);
    if (!decoded) throw new Error("This reading token is malformed.");
    const deck = this.decks.getDeck(decoded.d);
    if (!deck) throw new Error(`This reading references an unknown deck: ${decoded.d}.`);
    if (expectedDeckId !== undefined && this.decks.getDeck(expectedDeckId) !== deck) {
      throw new Error("This reading belongs to a different deck than the route.");
    }
    const resolution = await resolveReadingTokenData(decoded, deck);
    if (!resolution.ok) throw new Error(resolution.error);
    return this.hydrateReading(token, deck, resolution.spread, decoded.q, resolution.dealt, resolution.legacy);
  }

  /** LLM-ready prose is one projection of a resolved reading, not the reading's primary representation. */
  buildInterpretationContext(reading: ArcanaReading): string {
    return buildPrompt(reading.deck, reading.spread, [...reading.cards], reading.question);
  }

  private hydrateReading(
    token: string,
    deck: DeckModule,
    rawSpread: Spread,
    question: string,
    rawCards: ReadingCard[],
    legacy: boolean,
  ): ArcanaReading {
    const spread = immutableJsonSnapshot(rawSpread, "reading spread");
    const cards = immutableJsonSnapshot(rawCards, "reading cards");
    const cardsBySlug = new Map(deck.cards.map((card) => [card.slug, card]));
    const placements: ReadingPlacement[] = cards.map((dealtCard, index) => {
      const card = cardsBySlug.get(dealtCard.slug);
      const position = spread.positions[index];
      if (!card || !position) throw new Error("Resolved reading is internally inconsistent.");
      return Object.freeze({
        position,
        card,
        reversed: dealtCard.reversed,
        meaning: dealtCard.reversed ? card.meaning.inverted : card.meaning.upright,
      });
    });
    Object.freeze(placements);
    return Object.freeze({ token, deck, spread, question, cards, placements, legacy });
  }

  private requireDeck(deckId: string): DeckModule {
    const deck = this.decks.getDeck(deckId);
    if (!deck) throw new Error(`Unknown deck: ${deckId}.`);
    return deck;
  }
}

/** Default browser/application service over the default validated deck registry. */
export const arcanaEngine = new ArcanaEngine();

function parseCardNumber(label: string): number | undefined {
  if (!/^(?:0|[1-9]\d*)$/.test(label)) return undefined;
  const value = Number(label);
  return Number.isSafeInteger(value) ? value : undefined;
}
