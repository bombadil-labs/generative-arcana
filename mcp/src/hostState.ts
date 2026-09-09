import type { Spread } from "../../app/src/decks/spreads.js";
import type { DeckDataFile } from "../../app/src/decks/types.js";
import { immutableJsonSnapshot } from "../../app/src/decks/jsonSnapshot.js";
import { ArcanaToolAdapter, type ArcanaToolName } from "../../app/src/mcp/ArcanaToolAdapter.js";

export interface PersistedCustomDeckManifest {
  data: DeckDataFile;
  tagline: string;
  spreads?: Spread[];
}

export interface ArcanaHostStateV1 {
  v: 1;
  customDecks: PersistedCustomDeckManifest[];
}

export type ArcanaHostState = ArcanaHostStateV1;

/** Durable storage boundary. Loaded values are untrusted and must be revalidated before use. */
export interface ArcanaHostStateRepository {
  load(scopeId: string): Promise<unknown | null>;
  save(scopeId: string, state: ArcanaHostState): Promise<void>;
  delete(scopeId: string): Promise<boolean>;
}

/** Export only user-owned declarative state. Bundled decks and runtime objects are always reconstructed. */
export function snapshotArcanaHostState(adapter: ArcanaToolAdapter): ArcanaHostState {
  const customDecks = adapter.engine.listDecks()
    .filter((deck) => deck.custom)
    .map((deck) => ({
      data: deck.data,
      tagline: deck.tagline,
      ...(deck.spreads ? { spreads: deck.spreads } : {}),
    }));
  return immutableJsonSnapshot({ v: 1 as const, customDecks }, "Arcana host state");
}

/** Restore persisted custom manifests through the ordinary validated import boundary. */
export function restoreArcanaHostState(adapter: ArcanaToolAdapter, raw: unknown): void {
  if (raw === null || raw === undefined) return;
  const state = parseArcanaHostState(raw);
  for (const manifest of state.customDecks) {
    adapter.engine.importDeck(manifest.data, {
      tagline: manifest.tagline,
      ...(manifest.spreads ? { spreads: manifest.spreads } : {}),
    });
  }
}

/** Adapter that persists the complete custom-deck snapshot after successful stateful mutations. */
export class PersistingArcanaToolAdapter extends ArcanaToolAdapter {
  private saveTail: Promise<void> = Promise.resolve();

  constructor(
    adapter: ArcanaToolAdapter,
    private readonly scopeId: string,
    private readonly repository: ArcanaHostStateRepository,
  ) {
    super(adapter.engine);
  }

  override async call(name: ArcanaToolName, input: unknown = {}): Promise<unknown> {
    const result = await super.call(name, input);
    if (name === "import_deck") {
      const state = snapshotArcanaHostState(this);
      this.saveTail = this.saveTail.then(() => this.repository.save(this.scopeId, state));
      await this.saveTail;
    }
    return result;
  }
}

function parseArcanaHostState(raw: unknown): ArcanaHostState {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) throw new Error("Persisted Arcana host state must be an object.");
  const record = raw as Record<string, unknown>;
  if (record.v !== 1) throw new Error("Unsupported persisted Arcana host state version.");
  if (!Array.isArray(record.customDecks)) throw new Error("Persisted Arcana host state customDecks must be an array.");

  const customDecks = record.customDecks.map((value, index) => {
    if (!value || typeof value !== "object" || Array.isArray(value)) {
      throw new Error(`Persisted custom deck ${index} must be an object.`);
    }
    const manifest = value as Record<string, unknown>;
    if (!("data" in manifest)) throw new Error(`Persisted custom deck ${index} is missing data.`);
    if (typeof manifest.tagline !== "string") throw new Error(`Persisted custom deck ${index} tagline must be a string.`);
    if (manifest.spreads !== undefined && !Array.isArray(manifest.spreads)) {
      throw new Error(`Persisted custom deck ${index} spreads must be an array.`);
    }
    return {
      data: manifest.data as DeckDataFile,
      tagline: manifest.tagline,
      ...(manifest.spreads === undefined ? {} : { spreads: manifest.spreads as Spread[] }),
    };
  });

  return { v: 1, customDecks };
}
