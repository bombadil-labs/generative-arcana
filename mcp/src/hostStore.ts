import { DeckRegistry } from "../../app/src/decks/registry";
import { registerBundledDecks } from "../../app/src/decks/bundled";
import { ArcanaEngine } from "../../app/src/engine/ArcanaEngine";
import { ArcanaToolAdapter } from "../../app/src/mcp/ArcanaToolAdapter";
import { PersistingArcanaToolAdapter, restoreArcanaHostState, type ArcanaHostStateRepository } from "./hostState";

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
 * Hosts are cached in-process, but their custom deck manifests are restored from an external
 * repository when first accessed and persisted after successful `import_deck` calls.
 */
export class PersistentArcanaHostStore implements ArcanaHostStore {
  private readonly hosts = new Map<string, Promise<ArcanaToolAdapter>>();

  constructor(
    private readonly repository: ArcanaHostStateRepository,
    private readonly createHost: ArcanaHostFactory = createBundledArcanaAdapter,
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
    return hadCached || hadPersisted;
  }

  clearCache(): void {
    this.hosts.clear();
  }

  get size(): number {
    return this.hosts.size;
  }

  private async loadHost(scopeId: string): Promise<ArcanaToolAdapter> {
    const adapter = this.createHost();
    const persisted = await this.repository.load(scopeId);
    if (persisted !== null) restoreArcanaHostState(adapter, persisted);
    return new PersistingArcanaToolAdapter(adapter, scopeId, this.repository);
  }
}

function requireScopeId(value: string): string {
  if (typeof value !== "string" || !value.trim()) throw new Error("Arcana host scope id must be a non-empty string.");
  return value;
}
