import type { Spread } from "../decks/spreads";

/** Stable domain identity for a card placed in a reading. */
export interface ReadingCard {
  slug: string;
  reversed: boolean;
}

/** Historical payload. It cannot establish the identity of the original deck revision. */
export interface LegacyReadingToken {
  v: 1;
  d: string;
  s: string | Spread;
  q: string;
  c: [number, 0 | 1][];
}

/** A content-bound reading, stored entirely in the URL fragment. */
export interface StableReadingToken {
  v: 2;
  /** Deck id, also checked against the route. */
  d: string;
  /** SHA-256 of canonical deck JSON (identity, not author authentication). */
  h: string;
  /** Snapshot the spread so later changes to position prompts cannot reinterpret the reading. */
  s: Spread;
  q: string;
  /** Ordered [cardSlug, reversed(0|1)] tuples. */
  c: [string, 0 | 1][];
}

export type ReadingToken = LegacyReadingToken | StableReadingToken;

export type ReadingResolution =
  | { ok: true; dealt: ReadingCard[]; spread: Spread; legacy: boolean }
  | { ok: false; error: string };
