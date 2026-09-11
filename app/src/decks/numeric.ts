import type { CardData } from "./card";
import type { DeckDataFile, FactorizationData, MinorNumberOrigin } from "./types";

export type FactorizationOwner = MinorNumberOrigin;

export interface ResolvedCardFactorization {
  owner: FactorizationOwner;
  factorization: FactorizationData;
}

/**
 * Resolve the authored owner of a card number without assuming the default rank-owned minor profile.
 *
 * Majors always own their number on the card. Minors may explicitly declare rank, suit, or card
 * ownership via `minor_number_origin`. Historical decks without that declaration keep card-level
 * factorization as the first compatibility fallback, then matching rank/suit axes are consulted.
 */
export function resolveCardFactorization(
  deck: DeckDataFile,
  card: CardData,
): ResolvedCardFactorization | undefined {
  if (card.arcana === "major") {
    return card.factorization ? { owner: "card", factorization: card.factorization } : undefined;
  }

  const rank = card.rank_slug ? deck.ranks[card.rank_slug] : undefined;
  const suit = card.suit_slug ? deck.suits[card.suit_slug] : undefined;
  const declared = deck.minor_number_origin;

  if (declared === "rank") {
    return rank?.factorization
      ? { owner: "rank", factorization: rank.factorization }
      : card.factorization
        ? { owner: "card", factorization: card.factorization }
        : undefined;
  }
  if (declared === "suit") {
    return suit?.factorization
      ? { owner: "suit", factorization: suit.factorization }
      : card.factorization
        ? { owner: "card", factorization: card.factorization }
        : undefined;
  }
  if (declared === "card") {
    return card.factorization ? { owner: "card", factorization: card.factorization } : undefined;
  }

  // Legacy inference: preserve historical card-owned semantics first, then use an axis whose authored
  // numeric value actually matches the card number. This lets old imports keep working while new
  // profiles can state ownership explicitly.
  if (card.factorization) return { owner: "card", factorization: card.factorization };
  const value = parseCardNumber(card.number);
  if (value !== undefined && rank?.numeric_value === value && rank.factorization) {
    return { owner: "rank", factorization: rank.factorization };
  }
  if (value !== undefined && suit?.numeric_value === value && suit.factorization) {
    return { owner: "suit", factorization: suit.factorization };
  }
  return undefined;
}

function parseCardNumber(label: string): number | undefined {
  if (!/^(?:0|[1-9]\d*)$/.test(label)) return undefined;
  const value = Number(label);
  return Number.isSafeInteger(value) ? value : undefined;
}
