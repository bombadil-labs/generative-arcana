import type { CardData } from "./card";
import type { Spread } from "./spreads";

export interface AxisMeaning {
  upright: string[];
  inverted: string[];
}

export interface FactorizationData {
  character: "identity" | "prime" | "composite";
  factors?: number[];
  gloss: string;
}

export interface SymbolData {
  name?: string;
  description?: string;
  svg?: string;
}

export interface AxisEntry {
  name: string;
  index: number;
  slug?: string;
  description?: string;
  visual_style?: string;
  visual_content?: string;
  visual_motif?: string;
  question?: string;
  meaning?: AxisMeaning;
  factorization?: FactorizationData;
  [key: string]: unknown;
}

export interface SuitEntry extends AxisEntry {
  symbol?: SymbolData;
}

export interface RankEntry extends AxisEntry {
  symbol?: string;
  numeric_value?: number;
  arcana?: "minor";
}

export interface StationEntry extends AxisEntry {
  symbol?: SymbolData;
}

export interface TransversalData {
  name: string;
  description: string;
  ordering_rationale?: string;
  suit_stride?: number;
  stations: Record<string, StationEntry>;
  [key: string]: unknown;
}

export interface MajorArcanaData {
  story?: string;
  visual_style?: string;
  symbol?: SymbolData;
  [key: string]: unknown;
}

export interface DeckTheme {
  name: string;
  description: string;
  creator: string;
  [key: string]: unknown;
}

/** One pole-pair axis of the suit cross-product, e.g. { name: "Realm", poles: ["World","Soul"] }. */
export interface DialecticAxis { name: string; poles: [string, string] }
/** Optional, deck-level: present only when the suits are a cross-product of two dialectics. Names the
 *  two axes and places each suit (`cells[suit_slug] = [poleOfAxis0, poleOfAxis1]`). */
export interface SuitDialectic {
  axes: [DialecticAxis, DialecticAxis];
  cells: Record<string, [string, string]>;
}

/**
 * The validated, renderer-independent deck domain model.
 *
 * Raw JSON enters the system as `unknown` and must pass `validateDeck` before becoming this type.
 * Unknown extension fields are intentionally preserved so authoring profiles can evolve independently
 * of the runtime contract.
 */
export interface DeckDataFile {
  name: string;
  slug: string;
  version: string;
  theme: DeckTheme;
  suits: Record<string, SuitEntry>;
  ranks: Record<string, RankEntry>;
  transversal: TransversalData;
  major_arcana: MajorArcanaData;
  /** the suit cross-product axes, if this deck's suits were built dialectically. */
  dialectic?: SuitDialectic;
  cards: Record<string, CardData>;
  [key: string]: unknown;
}

/**
 * A registered deck. A deck folder under src/decks/<id>/ provides:
 *   - deck.json   (the data)
 *   - cards/      (p5 sketches; importing them registers each via registerCard)
 *   - index.ts    (calls registerDeck with this manifest)
 * Spreads (generic + deck-native) attach here in the next pass.
 */
export interface DeckModule {
  id: string;
  name: string;
  tagline: string;
  data: DeckDataFile;
  /** ordered card list for the browser (majors first, then minors by suit/rank). */
  cards: CardData[];
  /** spreads native to this deck, offered alongside the generic ones. */
  spreads?: Spread[];
  /** true for decks loaded from pasted JSON (not bundled). */
  custom?: boolean;
}
