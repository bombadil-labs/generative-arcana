import type { Spread } from "./spreads";
import { normalizeDeckSpreads } from "./spreads";
import type { DeckModule } from "./types";
import { canonicalCards, validateDeck } from "./validate";
import { immutableJsonSnapshot } from "./jsonSnapshot";

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

/**
 * Stateful validated deck collection for one host/runtime.
 *
 * Creating an instance creates an isolated registry. The browser app uses the exported default
 * instance and function facade; server/MCP hosts can own a registry without sharing process state.
 */
export class DeckRegistry {
  private readonly decks = new Map<string, DeckModule>();

  registerDeck(registration: DeckRegistration, options: RegisterDeckOptions = {}): DeckModule {
    const validation = validateDeck(registration.data);
    if (!validation.ok) throw new Error(validation.error);

    // Validation must remain true after this call. Detach from caller ownership and reject extension
    // metadata that is not actually JSON before constructing any registered domain objects.
    const data = immutableJsonSnapshot(validation.data, "deck");

    if (registration.tagline !== undefined && (typeof registration.tagline !== "string" || !registration.tagline.trim())) {
      throw new Error("tagline: must be a string with content.");
    }

    const normalizedSpreads = normalizeDeckSpreads(registration.spreads, data.slug);
    const spreads = normalizedSpreads === undefined
      ? undefined
      : immutableJsonSnapshot(normalizedSpreads, "spreads");
    const cards = Object.freeze(canonicalCards(data));
    const deck: DeckModule = Object.freeze({
      id: data.slug,
      name: data.name,
      tagline: registration.tagline ?? (firstSentence(data.theme.description) || "A custom deck."),
      data,
      cards,
      ...(spreads ? { spreads } : {}),
      ...(registration.custom ? { custom: true } : {}),
    });

    const existing = this.decks.get(deck.id);
    if (existing && deck.custom && !existing.custom) {
      throw new Error(`The slug “${deck.id}” belongs to a bundled deck. Choose a different slug to import a custom version.`);
    }
    if (existing && !options.replaceExisting) {
      throw new Error(`A deck with id “${deck.id}” is already registered.`);
    }
    this.decks.set(deck.id, deck);
    return deck;
  }

  getDeck(id: string): DeckModule | undefined {
    return this.decks.get(id);
  }

  listDecks(): DeckModule[] {
    return [...this.decks.values()];
  }
}

/** Default registry used by the browser app and bundled deck side-effect modules. */
export const deckRegistry = new DeckRegistry();

// Compatibility/application facade. New hosts may depend on DeckRegistry directly.
export function registerDeck(registration: DeckRegistration, options: RegisterDeckOptions = {}): DeckModule {
  return deckRegistry.registerDeck(registration, options);
}

export function getDeck(id: string): DeckModule | undefined {
  return deckRegistry.getDeck(id);
}

export function listDecks(): DeckModule[] {
  return deckRegistry.listDecks();
}

function firstSentence(text: string): string {
  const m = text.match(/^.*?[.!?](\s|$)/);
  return (m ? m[0] : text).trim();
}
