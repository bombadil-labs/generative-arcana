import type { Spread } from "./spreads";
import { normalizeDeckSpreads } from "./spreads";
import type { DeckModule } from "./types";
import { canonicalCards, validateDeck } from "./validate";

/** Global deck registry. Each deck's index.ts registers itself on import. */
const DECKS = new Map<string, DeckModule>();

/**
 * Untrusted registration input. The registry is the construction boundary: data is validated,
 * identity/name are derived from that data, card ordering is canonicalized, and native spreads are
 * checked before a DeckModule can enter the runtime.
 */
export interface DeckRegistration {
  data: unknown;
  tagline?: string;
  spreads?: Spread[];
  /** true for decks loaded dynamically rather than bundled with the app. */
  custom?: boolean;
}

export interface RegisterDeckOptions {
  /** Replacement is a deliberate state transition (used by validated custom-deck re-imports). */
  replaceExisting?: boolean;
}

export function registerDeck(registration: DeckRegistration, options: RegisterDeckOptions = {}): DeckModule {
  const validation = validateDeck(registration.data);
  if (!validation.ok) throw new Error(validation.error);
  const data = validation.data;

  if (registration.tagline !== undefined && (typeof registration.tagline !== "string" || !registration.tagline.trim())) {
    throw new Error("tagline: must be a string with content.");
  }

  const spreads = normalizeDeckSpreads(registration.spreads, data.slug);
  const deck: DeckModule = {
    id: data.slug,
    name: data.name,
    tagline: registration.tagline ?? (firstSentence(data.theme.description) || "A custom deck."),
    data,
    cards: canonicalCards(data),
    ...(spreads ? { spreads } : {}),
    ...(registration.custom ? { custom: true } : {}),
  };

  const existing = DECKS.get(deck.id);
  if (existing && deck.custom && !existing.custom) {
    throw new Error(`The slug “${deck.id}” belongs to a bundled deck. Choose a different slug to import a custom version.`);
  }
  if (existing && !options.replaceExisting) {
    throw new Error(`A deck with id “${deck.id}” is already registered.`);
  }
  DECKS.set(deck.id, deck);
  return deck;
}

export function getDeck(id: string): DeckModule | undefined {
  return DECKS.get(id);
}

export function listDecks(): DeckModule[] {
  return [...DECKS.values()];
}

function firstSentence(text: string): string {
  const m = text.match(/^.*?[.!?](\s|$)/);
  return (m ? m[0] : text).trim();
}
