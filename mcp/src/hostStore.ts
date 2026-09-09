import { DeckRegistry } from "../../app/src/decks/registry.js";
import { registerBundledDecks } from "../../app/src/decks/bundled.js";
import { ArcanaEngine } from "../../app/src/engine/ArcanaEngine.js";
import { ArcanaToolAdapter } from "../../app/src/mcp/ArcanaToolAdapter.js";
import { PersistingArcanaToolAdapter, restoreArcanaHostState, type ArcanaHostStateRepository } from "./hostState.js";
import { CatalogPersistingArcanaToolAdapter, migrateLegacyCustomDecks, restoreUserDeckRecords, type UserDeckCatalogRepository } from "./userDeckCatalog.js";

export type ArcanaHostFactory = () => ArcanaToolAdapter;

export interface ArcanaHostStore {
  get(scopeId: string): ArcanaToolAdapter | Promise<ArcanaToolAdapter>;
  delete(scopeId: string): boolean | Promise<boolean>;
}

/** New isolated host containing the shipped symbolic corpus. */
export function createBundledArcanaAdapter(): ArcanaToolAdapter {
  const registry = new DeckRegistry();
  registerBundledDecks(registry);
  return new ArcanaToolAdapter(new ArcanaEngine(registry));
}

/** Process-lifetime host store keyed by an authenticated/session scope supplied by the caller. */
export class InMemoryArcanaHostStore implements ArcanaHostStore {
  private readonly hosts = new Map<string, ArcanaToolAdapter>();

  constructor(private readonly createHost: ArcanaHostFactory = createBundledArcanaAdapter) {}

  get(scopeId: string): ArcanaToolAdapter {
    const key = requireScopeId(scopeId);
    const existing = this.hosts.get(key);
    if (existing) return existing;
    const created = this.createHost();
    this.hosts.set(key, created);
    return created;
  }

  delete(scopeId: string): boolean {
    return this.hosts.delete(requireScopeId(scopeId));
  }

  clear(): void {
    this.hosts.clear();
  }

  get size(): number {
    return this.hosts.size;
  }
}

/**
 * Durable principal-scoped host store.
 *
 * Hosts are cached in-process. Legacy callers restore/persist the old host-state snapshot; callers
 * that provide a deck catalog migrate once and thereafter reconstruct custom decks from first-class rows.
 */
export class PersistentArcanaHostStore implements ArcanaHostStore {
  private readonly hosts = new Map<string, Promise<ArcanaToolAdapter>>();

  constructor(
    private readonly repository: ArcanaHostStateRepository,
    private readonly createHost: ArcanaHostFactory = createBundledArcanaAdapter,
    private readonly deckCatalog?: UserDeckCatalogRepository,
  ) {}

  get(scopeId: string): Promise<ArcanaToolAdapter> {
    const key = requireScopeId(scopeId);
    const existing = this.hosts.get(key);
    if (existing) return existing;

    const loading = this.loadHost(key).catch((error) => {
      this.hosts.delete(key);
      throw error;
    });
    this.hosts.set(key, loading);
    return loading;
  }

  async delete(scopeId: string): Promise<boolean> {
    const key = requireScopeId(scopeId);
    const hadCached = this.hosts.delete(key);
    const hadPersisted = await this.repository.delete(key);
    const deletedCatalogDecks = this.deckCatalog ? await this.deckCatalog.deleteAllOwned(key) : 0;
    return hadCached || hadPersisted || deletedCatalogDecks > 0;
  }

  clearCache(): void {
    this.hosts.clear();
  }

  get size(): number {
    return this.hosts.size;
  }

  private async loadHost(scopeId: string): Promise<ArcanaToolAdapter> {
    const adapter = this.createHost();
    if (this.deckCatalog) {
      await migrateLegacyCustomDecks(scopeId, this.repository, this.deckCatalog);
      const records = await this.deckCatalog.listOwned(scopeId);
      restoreUserDeckRecords(adapter, scopeId, records);
      return new CatalogPersistingArcanaToolAdapter(adapter, scopeId, this.deckCatalog);
    }

    const persisted = await this.repository.load(scopeId);
    if (persisted !== null) restoreArcanaHostState(adapter, persisted);
    return new PersistingArcanaToolAdapter(adapter, scopeId, this.repository);
  }
}

function requireScopeId(value: string): string {
  if (typeof value !== "string" || !value.trim()) throw new Error("Arcana host scope id must be a non-empty string.");
  return value;
}
