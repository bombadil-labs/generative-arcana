import type { DeckDataFile } from "./types";

/** Roman/initial form for the compact corner badge. */
export const RANK_ROMAN: Record<string, string> = {
  ace: "A", two: "II", three: "III", four: "IV", five: "V", six: "VI", seven: "VII",
  eight: "VIII", nine: "IX", ten: "X", seeker: "S", knight: "K", oracle: "O", paragon: "P",
};

/** Full word form for prose / detail tables. */
export const RANK_NAME: Record<string, string> = {
  ace: "Ace", two: "Two", three: "Three", four: "Four", five: "Five", six: "Six", seven: "Seven",
  eight: "Eight", nine: "Nine", ten: "Ten", seeker: "Seeker", knight: "Knight", oracle: "Oracle", paragon: "Paragon",
};

export const SUIT_LABEL: Record<string, string> = {
  crowns: "Crowns", blades: "Blades", runes: "Runes", moongates: "Moongates",
};

/** Deck-supplied suit glyph SVG, if authored. */
export function suitGlyphSvg(deck: DeckDataFile | undefined, slug?: string): string | undefined {
  return slug ? deck?.suits[slug]?.symbol?.svg : undefined;
}

/** Deck-supplied Major Arcana glyph SVG, if authored. */
export function majorGlyphSvg(deck?: DeckDataFile): string | undefined {
  return deck?.major_arcana.symbol?.svg;
}

/** Full rank name for prose / detail tables (e.g. "Two", "Homecoming"). */
export function rankLabel(deck: DeckDataFile | undefined, slug?: string): string {
  if (!slug) return "";
  return deck?.ranks[slug]?.name ?? RANK_NAME[slug] ?? slug;
}

/** Compact rank badge token (e.g. "II", "A"); falls back to the supplied card number. */
export function rankBadge(deck: DeckDataFile | undefined, slug?: string, fallback = ""): string {
  if (!slug) return fallback;
  return deck?.ranks[slug]?.symbol ?? RANK_ROMAN[slug] ?? fallback ?? slug;
}

/** Suit display name (e.g. "Crowns", "Structures"). */
export function suitLabel(deck: DeckDataFile | undefined, slug?: string): string {
  if (!slug) return "";
  return deck?.suits[slug]?.name ?? SUIT_LABEL[slug] ?? slug;
}

// ── the fourth axis: Ω, the count of prime factors (invariant across every deck) ──

/** Ω(n): prime factors with multiplicity. 0/1 → 0 (identity); a prime → 1; composites deepen. */
export function omega(n: number): number {
  if (!Number.isFinite(n) || n <= 1) return 0;
  let c = 0, d = 2;
  while (d * d <= n) { while (n % d === 0) { n /= d; c++; } d++; }
  if (n > 1) c++;
  return c;
}

const FAC_VARS = ["--fac-identity", "--fac-prime", "--fac-c2", "--fac-c3", "--fac-c4"];

/** The CSS custom property for a card's Ω band, e.g. `var(facVar(omega(n)))`. */
export function facVar(o: number): string { return FAC_VARS[Math.min(o, 4)]; }
export function facWord(o: number): string { return o === 0 ? "identity" : o === 1 ? "prime" : "composite"; }

/** A station's display name from the deck's transversal (falls back to the slug). */
export function stationName(deck: DeckDataFile | undefined, slug?: string): string {
  if (!slug) return "";
  return deck?.transversal.stations[slug]?.name ?? slug;
}
