import { DeckRegistry, deckRegistry } from "../decks/registry";
import type { DeckModule } from "../decks/types";
import { getSharedDeck, type SharedCatalogDeck } from "./api";

type CatalogSource = Pick<SharedCatalogDeck, "id" | "visibility" | "revision">;
type FetchDeck = (id: string, signal?: AbortSignal) => Promise<SharedCatalogDeck>;

/** Browser catalog snapshots are disposable, not local imports. Provenance follows the exact
 * registered object so replacing a catalog deck with a local import never inherits its source. */
export class CatalogDeckRuntime {
  private readonly sources = new WeakMap<DeckModule, CatalogSource>();
  private readonly loaded = new Map<string, DeckModule>();
  private readonly requests = new Map<string, symbol>();
  private generation = 0;
  // Retain only routing identities across eviction so interrupted/failed alias routes can retry.
  private readonly resourceIds = new Set<string>();
  private readonly aliases = new Map<string, string | null>();

  constructor(private readonly registry: DeckRegistry, private readonly fetchDeck: FetchDeck = getSharedDeck) {}

  source(deck: DeckModule): CatalogSource | undefined {
    return this.sources.get(deck);
  }

  localDeck(id: string): DeckModule | undefined {
    const deck = this.registry.getDeck(id);
    return deck && !this.source(deck) ? deck : undefined;
  }

  /** Used on every session transition, including logout/account switching off a deck route. */
  clear(): void {
    this.generation++;
    this.requests.clear();
    for (const deck of this.loaded.values()) this.evict(deck);
    this.loaded.clear();
  }

  /** Revoke only this exact catalog snapshot; never evict a newer request or local replacement. */
  invalidate(deck: DeckModule): void {
    if (!this.source(deck) || this.registry.getDeck(deck.id) !== deck) return;
    this.requests.delete(deck.id);
    this.evict(deck);
  }

  /** Always revalidate catalog content. A failed/aborted refresh must not expose the old snapshot. */
  async resolve(id: string, signal: AbortSignal): Promise<DeckModule> {
    const previous = this.registry.getDeck(id);
    if (previous && !this.source(previous)) return previous;

    // Compatibility aliases must refresh their canonical catalog resource, not a manifest slug.
    const resourceId = previous ? this.source(previous)!.id
      : this.resourceIds.has(id) ? id : this.aliases.get(id) ?? id;
    const generation = this.generation;
    const request = Symbol(resourceId);
    this.requests.set(resourceId, request);
    if (previous) this.evict(previous);

    const remote = await this.fetchDeck(resourceId, signal);
    if (signal.aborted || generation !== this.generation || this.requests.get(resourceId) !== request) {
      throw new DOMException("Deck request was superseded.", "AbortError");
    }
    if (remote.id !== resourceId) throw new Error("The catalog returned a different deck identity.");

    // A local import made while the request was in flight takes precedence over its response.
    const local = this.localDeck(resourceId);
    if (local) return local;
    const deck = this.registry.registerDeck({
      data: remote.manifest.data,
      tagline: remote.manifest.tagline,
      spreads: remote.manifest.spreads,
      custom: true,
      runtimeId: remote.id,
    }, { replaceExisting: true });
    this.sources.set(deck, { id: remote.id, visibility: remote.visibility, revision: remote.revision });
    this.resourceIds.add(deck.id);
    for (const alias of deck.aliases ?? []) {
      const known = this.aliases.get(alias);
      this.aliases.set(alias, known === undefined || known === deck.id ? deck.id : null);
    }
    this.loaded.set(deck.id, deck);
    return deck;
  }

  private evict(deck: DeckModule): void {
    // Never delete a later browser-local replacement with the same id.
    if (this.registry.getDeck(deck.id) === deck) this.registry.unregisterDeck(deck.id);
    if (this.loaded.get(deck.id) === deck) this.loaded.delete(deck.id);
  }
}

export const catalogDeckRuntime = new CatalogDeckRuntime(deckRegistry);
