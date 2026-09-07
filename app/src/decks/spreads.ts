/** Spreads are data. Generic spreads ship here; decks may add their own; users may define ad-hoc
 *  spreads that travel inside the reading token. A spread is a named, ordered list of positions. */

export interface SpreadPosition {
  name: string;
  /** what this position asks / represents in the reading. */
  prompt: string;
}

export interface Spread {
  id: string;
  name: string;
  description: string;
  positions: SpreadPosition[];
  /** marks a per-deck spread (vs. generic). */
  deckId?: string;
}

/** Shared safety bound for authored, registered, and serialized spreads. */
export const MAX_SPREAD_POSITIONS = 512;

const isRecord = (value: unknown): value is Record<string, unknown> =>
  value !== null && typeof value === "object" && !Array.isArray(value);
const text = (value: unknown): value is string => typeof value === "string";
const nonempty = (value: unknown): value is string => text(value) && !!value.trim();

/** Renderer- and transport-independent spread validation. */
export function isValidSpread(value: unknown): value is Spread {
  return isRecord(value)
    && nonempty(value.id)
    && nonempty(value.name)
    && text(value.description)
    && (value.deckId === undefined || nonempty(value.deckId))
    && Array.isArray(value.positions)
    && value.positions.length > 0
    && value.positions.length <= MAX_SPREAD_POSITIONS
    && value.positions.every((position) =>
      isRecord(position) && nonempty(position.name) && text(position.prompt));
}

/**
 * Validate and normalize deck-native spreads at the deck construction boundary.
 * Ownership is explicit in the returned snapshots even when a manifest omits `deckId`.
 */
export function normalizeDeckSpreads(value: unknown, deckId: string): Spread[] | undefined {
  if (value === undefined) return undefined;
  if (!Array.isArray(value)) throw new Error("spreads: must be an array.");
  const ids = new Set<string>();
  return value.map((raw, index) => {
    if (!isValidSpread(raw)) throw new Error(`spreads[${index}]: must be a valid spread.`);
    if (raw.deckId !== undefined && raw.deckId !== deckId) {
      throw new Error(`spreads[${index}].deckId: must match the owning deck “${deckId}”.`);
    }
    if (GENERIC_BY_ID.has(raw.id)) throw new Error(`spreads[${index}].id: collides with a generic spread id.`);
    if (ids.has(raw.id)) throw new Error(`spreads[${index}].id: duplicates another native spread id.`);
    ids.add(raw.id);
    return {
      ...raw,
      deckId,
      positions: raw.positions.map((position) => ({ ...position })),
    };
  });
}

export const GENERIC_SPREADS: Spread[] = [
  {
    id: "single",
    name: "Single Card",
    description: "One card for a focused question or a daily draw.",
    positions: [{ name: "The Card", prompt: "the heart of the matter" }],
  },
  {
    id: "three-card",
    name: "Three-Card · Temporal",
    description: "Past, present, and future across the situation.",
    positions: [
      { name: "Past", prompt: "what led here; the root" },
      { name: "Present", prompt: "the current situation" },
      { name: "Future", prompt: "where it tends; the likely outcome" },
    ],
  },
  {
    id: "celtic-cross",
    name: "Celtic Cross",
    description: "A ten-card examination of a situation from many angles.",
    positions: [
      { name: "The Heart", prompt: "the heart of the matter" },
      { name: "The Crossing", prompt: "what crosses or challenges it" },
      { name: "The Foundation", prompt: "the root beneath" },
      { name: "The Recent Past", prompt: "what is passing away" },
      { name: "The Crown", prompt: "what could come; the aim above" },
      { name: "The Near Future", prompt: "what approaches" },
      { name: "The Self", prompt: "your stance and attitude" },
      { name: "The Environment", prompt: "others and surroundings" },
      { name: "Hopes & Fears", prompt: "what you hope or dread" },
      { name: "The Outcome", prompt: "the culmination" },
    ],
  },
];

const GENERIC_BY_ID = new Map(GENERIC_SPREADS.map((s) => [s.id, s]));

/** All spreads available for a deck: generic + any the deck contributes. */
export function spreadsForDeck(deckSpreads?: Spread[]): Spread[] {
  return [...GENERIC_SPREADS, ...(deckSpreads ?? [])];
}

export function resolveSpread(idOrInline: string | Spread, deckSpreads?: Spread[]): Spread | undefined {
  if (typeof idOrInline !== "string") return idOrInline; // inline custom spread
  return GENERIC_BY_ID.get(idOrInline) ?? (deckSpreads ?? []).find((s) => s.id === idOrInline);
}
