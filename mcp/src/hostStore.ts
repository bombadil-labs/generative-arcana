import { DeckRegistry } from "../../app/src/decks/registry";
import { registerBundledDecks } from "../../app/src/decks/bundled";
import { ArcanaEngine } from "../../app/src/engine/ArcanaEngine";
import { ArcanaToolAdapter } from "../../app/src/mcp/ArcanaToolAdapter";

export type ArcanaHostFactory = () => ArcanaToolAdapter;

export interface ArcanaHostStore {
  get(scopeId: string): ArcanaToolAdapter;
  delete(scopeId: string): boolean;
}

/** New isolated host containing the shipped symbolic corpus. */
export function createBundledArcanaAdapter(): ArcanaToolAdapter {
  const registry = new DeckRegistry();
  registerBundledDecks(registry);
  return new ArcanaToolAdapter(new ArcanaEngine(registry));
}

/**
 * Process-lifetime host store keyed by an authenticated/session scope supplied by the caller.
 *
 * This deliberately does not define authentication or durable persistence. Its contract is narrower:
 * one stable scope gets one isolated Arcana host; different scopes never share imported deck state.
 * A future OAuth/session layer can resolve a principal and then delegate to this interface, while a
 * durable implementation can replace this in-memory store without changing ArcanaEngine semantics.
 */
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

function requireScopeId(value: string): string {
  if (typeof value !== "string" || !value.trim()) throw new Error("Arcana host scope id must be a non-empty string.");
  return value;
}
