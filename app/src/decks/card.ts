/** Renderer-independent card data. Suit and station vocabularies belong to each deck, not a skin. */
export interface CardData {
  slug: string;
  name: string;
  number: string;
  arcana: "major" | "minor";
  station_slug: string;
  suit_slug?: string;
  rank_slug?: string;
  /** Optional numeric interpretation; construction profiles determine where it originates. */
  factorization?: { character: "identity" | "prime" | "composite"; factors?: number[]; gloss: string };
  meaning: { upright: string; inverted: string };
  visuals: { detailed_description: string; style_override?: string; content_override?: string };
}
