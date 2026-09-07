import type { CardData } from "./card";
import type { Spread } from "./spreads";

/** One pole-pair axis of the suit cross-product, e.g. { name: "Realm", poles: ["World","Soul"] }. */
export interface DialecticAxis { name: string; poles: [string, string] }
/** Optional, deck-level: present only when the suits are a cross-product of two dialectics. Names the
 *  two axes and places each suit (`cells[suit_slug] = [poleOfAxis0, poleOfAxis1]`). */
export interface SuitDialectic {
  axes: [DialecticAxis, DialecticAxis];
  cells: Record<string, [string, string]>;
}

/** The raw shape of a deck's deck.json (as emitted by the generative-arcana skill). */
export interface DeckDataFile {
  name: string;
  slug: string;
  version: string;
  theme: { name: string; description: string; creator: string };
  suits: Record<string, unknown>;
  ranks: Record<string, unknown>;
  transversal: unknown;
  major_arcana: unknown;
  /** the suit cross-product axes, if this deck's suits were built dialectically. */
  dialectic?: SuitDialectic;
  cards: Record<string, CardData>;
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
