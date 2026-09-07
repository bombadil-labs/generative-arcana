import type { Spread } from "../decks/spreads";
import type { DealtCard } from "./types";

function rnd(): number {
  const a = new Uint32Array(1);
  crypto.getRandomValues(a);
  return a[0] / 4294967296;
}

/**
 * Deal a spread: pick N distinct cards from the deck (N = spread positions) and assign each an
 * orientation. Uses crypto randomness so every deal differs; the result is then captured in the URL
 * so a given reading is reproducible/shareable.
 */
export function deal(spread: Spread, deckCardCount: number, reversalRate = 0.5): DealtCard[] {
  const n = spread.positions.length;
  if (!Number.isSafeInteger(deckCardCount) || deckCardCount < 1 || n < 1 || n > deckCardCount) {
    throw new Error("The deck must have enough cards to fill every spread position.");
  }
  if (!Number.isFinite(reversalRate) || reversalRate < 0 || reversalRate > 1) {
    throw new Error("The reversal rate must be between zero and one.");
  }
  const pool = Array.from({ length: deckCardCount }, (_, i) => i);
  for (let i = 0; i < n; i++) {
    const j = i + Math.floor(rnd() * (pool.length - i));
    [pool[i], pool[j]] = [pool[j], pool[i]];
  }
  return pool.slice(0, n).map((index) => ({ index, reversed: rnd() < reversalRate }));
}
