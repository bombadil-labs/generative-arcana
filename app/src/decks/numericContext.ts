import type { CardData } from "./card";
import type { DeckModule, FactorizationData, MinorNumericOrigin, RankEntry, SuitEntry } from "./types";

export type NumericFactorizationSource = "card" | "rank" | "suit";

export interface ResolvedCardNumberContext {
  label: string;
  value?: number;
  /** The authored layer that owns this minor number; majors always originate on the card. */
  origin: NumericFactorizationSource;
  factorization?: FactorizationData;
  /** May differ from origin only for legacy compatibility data that still stores the gloss on the card. */
  factorizationSource?: NumericFactorizationSource;
}

/**
 * Resolve number ownership independently of any one tarot profile.
 *
 * New decks can declare `minor_numeric_origin`. Legacy decks infer rank when the referenced rank's
 * numeric_value matches, then suit when its numeric_value matches, and finally card-local numbering.
 * Authored factorization is taken from the owning axis first, with card-local factorization retained
 * as a compatibility fallback.
 */
export function resolveCardNumberContext(deck: DeckModule, card: CardData): ResolvedCardNumberContext {
  const value = parseCardNumber(card.number);

  if (card.arcana === "major") {
    return {
      label: card.number,
      ...(value !== undefined ? { value } : {}),
      origin: "card",
      ...(card.factorization ? { factorization: card.factorization, factorizationSource: "card" as const } : {}),
    };
  }

  const rank = card.rank_slug ? deck.data.ranks[card.rank_slug] : undefined;
  const suit = card.suit_slug ? deck.data.suits[card.suit_slug] : undefined;
  const origin = deck.data.minor_numeric_origin ?? inferMinorNumericOrigin(value, rank, suit);
  const owned = origin === "rank"
    ? rank?.factorization
    : origin === "suit"
      ? suit?.factorization
      : card.factorization;
  const compatibilityFactorization = owned ?? card.factorization;
  const factorizationSource = owned
    ? origin
    : card.factorization
      ? "card"
      : undefined;

  return {
    label: card.number,
    ...(value !== undefined ? { value } : {}),
    origin,
    ...(compatibilityFactorization
      ? {
          factorization: compatibilityFactorization,
          ...(factorizationSource ? { factorizationSource } : {}),
        }
      : {}),
  };
}

export function parseCardNumber(label: string): number | undefined {
  if (!/^(?:0|[1-9]\d*)$/.test(label)) return undefined;
  const value = Number(label);
  return Number.isSafeInteger(value) ? value : undefined;
}

function inferMinorNumericOrigin(
  value: number | undefined,
  rank: RankEntry | undefined,
  suit: SuitEntry | undefined,
): MinorNumericOrigin {
  if (value !== undefined && rank?.numeric_value === value) return "rank";
  if (value !== undefined && suit?.numeric_value === value) return "suit";
  return "card";
}
