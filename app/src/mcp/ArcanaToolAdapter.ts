import type { ArcanaEngine } from "../engine/ArcanaEngine";
import type { ArcanaReading, CardQuery, ImportDeckOptions } from "../engine/types";
import type { Spread } from "../decks/spreads";
import { DECK_MANIFEST_SPEC, inspectDeckAuthoringArtifact, invalidDeckAuthoringArtifact } from "../decks/authoring";

export const ARCANA_TOOL_NAMES = [
  "list_decks",
  "get_deck",
  "get_card",
  "analyze_card",
  "query_cards",
  "list_spreads",
  "cast_reading",
  "resolve_reading",
  "interpretation_context",
  "get_deck_authoring_spec",
  "validate_deck_manifest",
  "import_deck",
] as const;

export type ArcanaToolName = typeof ARCANA_TOOL_NAMES[number];

export interface ArcanaToolDefinition {
  name: ArcanaToolName;
  description: string;
  readOnly: boolean;
}

export const ARCANA_TOOL_DEFINITIONS: readonly ArcanaToolDefinition[] = Object.freeze([
  { name: "list_decks", description: "List decks available in this Arcana host.", readOnly: true },
  { name: "get_deck", description: "Get one validated deck and its authored symbolic structure.", readOnly: true },
  { name: "get_card", description: "Get one authored card by stable slug.", readOnly: true },
  { name: "analyze_card", description: "Resolve a card as a point in the deck's factorized symbolic space.", readOnly: true },
  { name: "query_cards", description: "Query exact intersections of authored card axes and numeric structure.", readOnly: true },
  { name: "list_spreads", description: "List generic and deck-native spreads available to a deck.", readOnly: true },
  { name: "cast_reading", description: "Cast a new reading using stable card identities and return its reproducible token.", readOnly: false },
  { name: "resolve_reading", description: "Resolve a reading token into its deck, spread, and placements.", readOnly: true },
  { name: "interpretation_context", description: "Project a resolved reading into authored LLM-ready interpretation context.", readOnly: true },
  { name: "get_deck_authoring_spec", description: "Get the machine-readable canonical DeckManifest authoring contract.", readOnly: true },
  { name: "validate_deck_manifest", description: "Validate a canonical DeckManifest without importing it; legacy raw deck JSON is identified as compatibility input.", readOnly: true },
  { name: "import_deck", description: "Import validated custom deck JSON into this host's isolated deck registry.", readOnly: false },
]);

/** Transport-neutral tool contract. MCP/CLI/HTTP adapters should delegate here instead of rebuilding semantics. */
export class ArcanaToolAdapter {
  constructor(readonly engine: ArcanaEngine) {}

  definitions(): readonly ArcanaToolDefinition[] {
    return ARCANA_TOOL_DEFINITIONS;
  }

  async call(name: ArcanaToolName, input: unknown = {}): Promise<unknown> {
    const args = record(input);
    switch (name) {
      case "list_decks":
        return this.engine.listDecks().map((deck) => ({
          id: deck.id,
          name: deck.name,
          tagline: deck.tagline,
          custom: !!deck.custom,
          cardCount: deck.cards.length,
          spreadCount: this.engine.listSpreads(deck.id).length,
        }));
      case "get_deck": {
        const deck = requireDeck(this.engine, stringArg(args, "deckId"));
        return deck;
      }
      case "get_card": {
        const deckId = stringArg(args, "deckId");
        const slug = stringArg(args, "cardSlug");
        const card = this.engine.getCard(deckId, slug);
        if (!card) throw new Error(`Unknown card “${slug}” in deck “${deckId}”.`);
        return card;
      }
      case "analyze_card":
        return this.engine.analyzeCard(stringArg(args, "deckId"), stringArg(args, "cardSlug"));
      case "query_cards":
        return this.engine.queryCards(stringArg(args, "deckId"), cardQuery(args.query));
      case "list_spreads":
        return this.engine.listSpreads(stringArg(args, "deckId"));
      case "cast_reading": {
        const reading = await this.engine.castReading(
          stringArg(args, "deckId"),
          spreadArg(args.spread),
          optionalString(args.question) ?? "",
          args.reversalRate === undefined ? {} : { reversalRate: numberArg(args.reversalRate, "reversalRate") },
        );
        return readingResult(reading);
      }
      case "resolve_reading": {
        const reading = await this.engine.resolveReading(stringArg(args, "token"), optionalString(args.deckId));
        return readingResult(reading);
      }
      case "interpretation_context": {
        const reading = await this.engine.resolveReading(stringArg(args, "token"), optionalString(args.deckId));
        return { token: reading.token, deckId: reading.deck.id, context: this.engine.buildInterpretationContext(reading) };
      }
      case "get_deck_authoring_spec":
        return DECK_MANIFEST_SPEC;
      case "validate_deck_manifest": {
        const includeNormalizedManifest = args.includeNormalizedManifest === undefined
          ? false
          : booleanArg(args.includeNormalizedManifest, "includeNormalizedManifest");
        if (args.manifest !== undefined && args.json !== undefined) throw new Error("Provide either manifest or json, not both.");
        if (args.manifest === undefined && args.json === undefined) throw new Error("Provide either manifest or json.");
        if (args.json !== undefined) {
          if (typeof args.json !== "string") throw new Error("json must be a string.");
          try {
            return inspectDeckAuthoringArtifact(JSON.parse(args.json), { includeNormalizedManifest });
          } catch {
            return invalidDeckAuthoringArtifact("Manifest JSON could not be parsed.");
          }
        }
        return inspectDeckAuthoringArtifact(args.manifest, { includeNormalizedManifest });
      }
      case "import_deck": {
        const request = parseImportDeckInput(args);
        const deck = this.engine.importDeck(request.data, request.options);
        return { id: deck.id, slug: deck.data.slug, name: deck.name, cardCount: deck.cards.length, custom: true };
      }
    }
  }
}

export interface ParsedImportDeckInput {
  data: unknown;
  options: ImportDeckOptions;
}

/** Parse transport-neutral import input without mutating a runtime registry. */
export function parseImportDeckInput(input: unknown): ParsedImportDeckInput {
  const args = record(input);
  let data: unknown = args.data;
  if (typeof args.json === "string") {
    try {
      data = JSON.parse(args.json);
    } catch {
      throw new Error("Deck JSON could not be parsed.");
    }
  } else if (args.json !== undefined) {
    throw new Error("json must be a string.");
  }
  return { data, options: importOptions(args) };
}

function readingResult(reading: ArcanaReading) {
  return {
    token: reading.token,
    deckId: reading.deck.id,
    deckName: reading.deck.name,
    spread: reading.spread,
    question: reading.question,
    legacy: reading.legacy,
    placements: reading.placements.map((placement) => ({
      position: placement.position,
      card: placement.card,
      reversed: placement.reversed,
      meaning: placement.meaning,
    })),
  };
}

function record(value: unknown): Record<string, unknown> {
  if (value === undefined) return {};
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("Tool input must be an object.");
  return value as Record<string, unknown>;
}

function stringArg(args: Record<string, unknown>, key: string): string {
  const value = args[key];
  if (typeof value !== "string" || !value.trim()) throw new Error(`${key} must be a non-empty string.`);
  return value;
}

function optionalString(value: unknown): string | undefined {
  if (value === undefined) return undefined;
  if (typeof value !== "string") throw new Error("Expected a string.");
  return value;
}

function numberArg(value: unknown, key: string): number {
  if (typeof value !== "number" || !Number.isFinite(value)) throw new Error(`${key} must be a finite number.`);
  return value;
}

function spreadArg(value: unknown): string | Spread {
  if (typeof value === "string" && value.trim()) return value;
  if (value && typeof value === "object" && !Array.isArray(value)) return value as Spread;
  throw new Error("spread must be a spread id or inline spread object.");
}

function cardQuery(value: unknown): CardQuery {
  if (value === undefined) return {};
  return record(value) as CardQuery;
}

function importOptions(args: Record<string, unknown>) {
  return {
    ...(args.tagline === undefined ? {} : { tagline: optionalString(args.tagline) }),
    ...(args.replaceExisting === undefined ? {} : { replaceExisting: booleanArg(args.replaceExisting, "replaceExisting") }),
    ...(args.spreads === undefined ? {} : { spreads: arrayArg(args.spreads, "spreads") as Spread[] }),
  };
}

function booleanArg(value: unknown, key: string): boolean {
  if (typeof value !== "boolean") throw new Error(`${key} must be a boolean.`);
  return value;
}

function arrayArg(value: unknown, key: string): unknown[] {
  if (!Array.isArray(value)) throw new Error(`${key} must be an array.`);
  return value;
}

function requireDeck(engine: ArcanaEngine, deckId: string) {
  const deck = engine.getDeck(deckId);
  if (!deck) throw new Error(`Unknown deck: ${deckId}.`);
  return deck;
}
