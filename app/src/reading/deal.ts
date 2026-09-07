import type { Spread } from "../decks/spreads";
import type { ReadingCard } from "./types";

function rnd(): number {
  const a = new Uint32Array(1);
  crypto.getRandomValues(a);
  return a[0] / 4294967296;
}

/**
 * Deal a spread from stable card identities: pick N distinct slugs (N = spread positions) and assign
 * each an orientation. Uses crypto randomness so every deal differs; the result is then captured in
 * the URL so a given reading is reproducible/shareable.
 */
export function deal(spread: Spread, cardSlugs: readonly string[], reversalRate = 0.5): ReadingCard[] {
  const n = spread.positions.length;
  if (n < 1 || n > cardSlugs.length) {
    throw new Error("The deck must have enough cards to fill every spread position.");
  }
  if (cardSlugs.some((slug) => typeof slug !== "string" || !slug.trim()) || new Set(cardSlugs).size !== cardSlugs.length) {
    throw new Error("The deck must provide a unique stable identity for every card.");
  }
  if (!Number.isFinite(reversalRate) || reversalRate < 0 || reversalRate > 1) {
    throw new Error("The reversal rate must be between zero and one.");
  }
  const pool = [...cardSlugs];
  for (let i = 0; i < n; i++) {
    const j = i + Math.floor(rnd() * (pool.length - i));
    [pool[i], pool[j]] = [pool[j], pool[i]];
  }
  return pool.slice(0, n).map((slug) => ({ slug, reversed: rnd() < reversalRate }));
}
