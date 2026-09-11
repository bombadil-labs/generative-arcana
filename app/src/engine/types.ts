import type { CardData } from "../decks/card";
import type { RankEntry, StationEntry, SuitEntry, DeckModule } from "../decks/types";
import type { Spread, SpreadPosition } from "../decks/spreads";
import type { ReadingCard } from "../reading/types";

export interface DialecticCoordinate {
  axis: string;
  pole: string;
}

export interface DialecticQuery {
  pole: string;
  /** Optional axis name; omit to match the pole on either dialectic axis. */
  axis?: string;
}

/** Exact structural filters over the factorized card space. */
export interface CardQuery {
  arcana?: CardData["arcana"];
  suit?: string;
  rank?: string;
  station?: string;
  omega?: number;
  factorizationCharacter?: NonNullable<CardData["factorization"]>["character"];
  dialectic?: DialecticQuery;
}

export interface CardAnalysis {
  deckId: string;
  card: CardData;
  axes: {
    suit?: SuitEntry;
    rank?: RankEntry;
    station: StationEntry;
    /** Present when the deck explicitly defines its suits as a two-axis cross-product. */
    dialectic?: [DialecticCoordinate, DialecticCoordinate];
  };
  number: {
    label: string;
    value?: number;
    /** Ω(n), prime factors with multiplicity, when the card number is a safe non-negative integer. */
    omega?: number;
    /** Authored numeric interpretation resolved from its declared card/rank/suit owner. */
    factorization?: CardData["factorization"];
    factorizationOwner?: "card" | "rank" | "suit";
  };
  authoredMeaning: CardData["meaning"];
}

export interface ReadingPlacement {
  position: SpreadPosition;
  card: CardData;
  reversed: boolean;
  meaning: string;
}

/** Fully resolved reading domain object. Prompt text, UI, and transport are projections of this. */
export interface ArcanaReading {
  token: string;
  deck: DeckModule;
  spread: Spread;
  question: string;
  cards: readonly ReadingCard[];
  placements: readonly ReadingPlacement[];
  /** True only when resolving a historical v1 index-based token. */
  legacy: boolean;
}

export interface CastReadingOptions {
  reversalRate?: number;
}

export interface ImportDeckOptions {
  tagline?: string;
  spreads?: Spread[];
  replaceExisting?: boolean;
  /** Host/resource identity; omitted for ordinary slug-keyed imports. */
  runtimeId?: string;
  /** Resolution-only compatibility identities for migrated/runtime-hosted decks. */
  aliases?: readonly string[];
}
