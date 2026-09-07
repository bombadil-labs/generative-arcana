/** Renderer-independent authored card data. Slugs belong to the deck, not a particular skin. */
export interface CardData {
  slug: string;
  name: string;
  number: string;
  arcana: "major" | "minor";
  station_slug: string;
  suit_slug?: string;
  rank_slug?: string;
  factorization?: {
    character: "identity" | "prime" | "composite";
    factors?: number[];
    gloss: string;
  };
  meaning: { upright: string; inverted: string };
  /** An authored iconographic brief, not executable rendering code. */
  visuals: { detailed_description: string; style_override?: string; content_override?: string };
}
