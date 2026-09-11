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
  /** Optional formal/compositional consequence of the number's factor structure. */
  visual_logic?: string;
}

/** Shared material vocabulary that makes the whole deck feel made in one visual world. */
export interface DeckVisualLanguage {
  medium?: string;
  surface?: string;
  mark_making?: string;
  signature_accent?: string;
  finish?: string;
  avoid?: string[];
}

/** Family-level rendering grammar. Suits and the Major Arcana may each own one. */
export interface VisualFamilyGrammar {
  medium_handling?: string;
  composition?: string;
  edge_language?: string;
  value_structure?: string;
  camera_and_scale?: string;
  detail_distribution?: string;
  finish?: string;
  avoid?: string[];
}

/** Rank-level formal law: how a rank organizes an image independently of subject matter. */
export interface RankVisualForm {
  composition_law?: string;
  spatial_logic?: string;
  rhythm?: string;
  density?: string;
  figure_ground?: string;
}

/** Station-level environmental modulation. It changes the weather, not the visual family. */
export interface StationVisualEnvironment {
  illumination?: string;
  palette?: string;
  atmosphere?: string;
  motion?: string;
  density?: string;
  material_effects?: string;
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
  /** Structured family grammar; `visual_style` remains accepted as a legacy/general prose field. */
  visual_grammar?: VisualFamilyGrammar;
}

export interface RankEntry extends AxisEntry {
  symbol?: string;
  numeric_value?: number;
  arcana?: "minor";
  /** Formal/compositional identity of the rank, orthogonal to `visual_content`. */
  visual_form?: RankVisualForm;
}

export interface StationEntry extends AxisEntry {
  symbol?: SymbolData;
  /** Environmental modulation only; should not redefine suit/Major medium or composition. */
  visual_environment?: StationVisualEnvironment;
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
  /** Major-Arcana family grammar, parallel to a suit's visual grammar. */
  visual_grammar?: VisualFamilyGrammar;
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
  /** Optional shared visual/material substrate; renderer-independent authored semantics. */
  visual_language?: DeckVisualLanguage;
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
 * A registered runtime deck. `registerDeck` constructs this only after validating raw deck data,
 * choosing a runtime identity, canonicalizing card order, and normalizing native spreads. `id` is the
 * canonical identity for readings and host APIs; `data.slug` remains authored deck metadata.
 * Visual packs are registered independently and meet the deck by stable deck/card identity.
 */
export interface DeckModule {
  id: string;
  /** Resolution-only compatibility ids (for example a pre-catalog custom deck slug). */
  aliases?: readonly string[];
  name: string;
  tagline: string;
  data: DeckDataFile;
  /** ordered card list for the browser (majors first, then minors by suit/rank). */
  cards: CardData[];
  /** validated, deck-owned spread snapshots, offered alongside the generic ones. */
  spreads?: Spread[];
  /** true for decks loaded from pasted JSON (not bundled). */
  custom?: boolean;
}

/** True when `id` is either the canonical runtime identity or one of its compatibility aliases. */
export function deckHasIdentity(deck: DeckModule, id: string): boolean {
  return deck.id === id || !!deck.aliases?.includes(id);
}
