import type { DeckModule } from "./types";

/** Global deck registry. Each deck's index.ts registers itself on import. */
const DECKS = new Map<string, DeckModule>();

export interface RegisterDeckOptions {
  /** Replacement is a deliberate state transition (used by validated custom-deck re-imports). */
  replaceExisting?: boolean;
}

export function registerDeck(deck: DeckModule, options: RegisterDeckOptions = {}): DeckModule {
  const existing = DECKS.get(deck.id);
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
