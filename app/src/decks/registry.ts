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
  /** Canonical runtime/resource identity. Defaults to the authored manifest slug. */
  runtimeId?: string;
  /** Extra compatibility identities accepted for lookup/token resolution. */
  aliases?: readonly string[];
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
  /** alias -> canonical id; null means the alias is ambiguous and must not resolve. */
  private readonly aliases = new Map<string, string | null>();

  registerDeck(registration: DeckRegistration, options: RegisterDeckOptions = {}): DeckModule {
    const validation = validateDeck(registration.data);
    if (!validation.ok) throw new Error(validation.error);

    // Validation must remain true after this call. Detach from caller ownership and reject extension
    // metadata that is not actually JSON before constructing any registered domain objects.
    const data = immutableJsonSnapshot(validation.data, "deck");

    if (registration.tagline !== undefined && (typeof registration.tagline !== "string" || !registration.tagline.trim())) {
      throw new Error("tagline: must be a string with content.");
    }

    const id = runtimeId(registration.runtimeId ?? data.slug);
    const compatibilityIds = compatibilityAliases(id, data.slug, registration.aliases);
    const normalizedSpreads = normalizeDeckSpreads(registration.spreads, id, [data.slug, ...compatibilityIds]);
    const spreads = normalizedSpreads === undefined
      ? undefined
      : immutableJsonSnapshot(normalizedSpreads, "spreads");
    // Freeze the concrete array in place while keeping DeckModule's existing mutable-array type.
    // A broader readonly API migration is separate from this runtime immutability guarantee.
    const cards = canonicalCards(data);
    Object.freeze(cards);
    const aliases = compatibilityIds.length ? Object.freeze([...compatibilityIds]) : undefined;
    const deck: DeckModule = Object.freeze({
      id,
      ...(aliases ? { aliases } : {}),
      name: data.name,
      tagline: registration.tagline ?? (firstSentence(data.theme.description) || "A custom deck."),
      data,
      cards,
      ...(spreads ? { spreads } : {}),
      ...(registration.custom ? { custom: true } : {}),
    });

    const existing = this.decks.get(deck.id);
    if (existing && deck.custom && !existing.custom) {
      throw new Error(`The id “${deck.id}” belongs to a bundled deck. Choose a different runtime id for this custom deck.`);
    }
    if (existing && !options.replaceExisting) {
      throw new Error(`A deck with id “${deck.id}” is already registered.`);
    }
    this.decks.set(deck.id, deck);
    this.rebuildAliases();
    return deck;
  }

  getDeck(id: string): DeckModule | undefined {
    const direct = this.decks.get(id);
    if (direct) return direct;
    const canonical = this.aliases.get(id);
    return typeof canonical === "string" ? this.decks.get(canonical) : undefined;
  }

  listDecks(): DeckModule[] {
    return [...this.decks.values()];
  }

  /** Remove a registered deck by canonical id or an unambiguous compatibility alias. */
  unregisterDeck(id: string): DeckModule | undefined {
    const deck = this.getDeck(id);
    if (!deck) return undefined;
    if (!this.decks.delete(deck.id)) return undefined;
    this.rebuildAliases();
    return deck;
  }

  private rebuildAliases(): void {
    this.aliases.clear();
    for (const deck of this.decks.values()) {
      for (const alias of deck.aliases ?? []) {
        // Canonical ids always win direct lookup. The alias remains non-resolving in that case.
        if (this.decks.has(alias)) continue;
        if (!this.aliases.has(alias)) {
          this.aliases.set(alias, deck.id);
        } else if (this.aliases.get(alias) !== deck.id) {
          this.aliases.set(alias, null);
        }
      }
    }
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

function runtimeId(value: string): string {
  if (typeof value !== "string" || !value.trim()) throw new Error("runtimeId: must be a non-empty string.");
  return value.trim();
}

function compatibilityAliases(id: string, authoredSlug: string, aliases: readonly string[] | undefined): string[] {
  const values = id === authoredSlug ? [...(aliases ?? [])] : [authoredSlug, ...(aliases ?? [])];
  const unique = new Set<string>();
  for (const value of values) {
    if (typeof value !== "string" || !value.trim()) throw new Error("aliases: entries must be non-empty strings.");
    const normalized = value.trim();
    if (normalized !== id) unique.add(normalized);
  }
  return [...unique];
}

function firstSentence(text: string): string {
  const m = text.match(/^.*?[.!?](\s|$)/);
  return (m ? m[0] : text).trim();
}
