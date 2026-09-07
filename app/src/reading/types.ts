import type { Spread } from "@/decks/spreads";

/** An in-memory position in the currently loaded deck, never a v2 persisted identity. */
export interface DealtCard { index: number; reversed: boolean }

/** Legacy links cannot detect changes to a deck's order or contents. */
export interface LegacyReadingToken {
  v: 1;
  d: string;
  s: string | Spread;
  q: string;
  c: [number, 0 | 1][];
}

/** New links bind stable card slugs to a content revision and snapshot the spread. */
export interface StableReadingToken {
  v: 2;
  /** Canonical deck slug, independent of the renderer or registry. */
  d: string;
  /** SHA-256 of canonical deck JSON. A change detector, not a signature. */
  r: string;
  s: Spread;
  q: string;
  c: [string, 0 | 1][];
}
export type ReadingToken = LegacyReadingToken | StableReadingToken;
