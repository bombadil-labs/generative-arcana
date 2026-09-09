import { randomUUID } from "node:crypto";
import type { DeckModule } from "../../app/src/decks/types.js";
import type { DeckVisibility, UserDeckManifest, UserDeckRecord } from "../../app/src/decks/catalog.js";
import { immutableJsonSnapshot } from "../../app/src/decks/jsonSnapshot.js";
import { ArcanaToolAdapter, type ArcanaToolName } from "../../app/src/mcp/ArcanaToolAdapter.js";
import { parseArcanaHostState, type ArcanaHostStateRepository } from "./hostState.js";

export interface UserDeckCatalogRepository {
  listOwned(ownerId: string): Promise<UserDeckRecord[]>;
  get(deckId: string): Promise<UserDeckRecord | null>;
  listPublic(limit?: number): Promise<UserDeckRecord[]>;
  ensureImported(ownerId: string, manifest: UserDeckManifest): Promise<UserDeckRecord>;
  upsertImported(ownerId: string, manifest: UserDeckManifest): Promise<UserDeckRecord>;
  setVisibility(ownerId: string, deckId: string, visibility: DeckVisibility): Promise<UserDeckRecord>;
  deleteOwned(ownerId: string, deckId: string): Promise<boolean>;
  deleteAllOwned(ownerId: string): Promise<number>;
}

/** Snapshot one validated runtime custom deck into the renderer-neutral platform manifest. */
export function snapshotUserDeckManifest(deck: DeckModule): UserDeckManifest {
  return immutableJsonSnapshot({
    data: deck.data,
    tagline: deck.tagline,
    ...(deck.spreads ? { spreads: deck.spreads } : {}),
  }, "User deck manifest");
}

/** Restore catalog rows through the ordinary validated import boundary. */
export function restoreUserDeckRecords(adapter: ArcanaToolAdapter, ownerId: string, records: readonly UserDeckRecord[]): void {
  for (const record of records) {
    if (record.ownerId !== ownerId) throw new Error("User deck catalog returned a deck owned by another principal.");
    adapter.engine.importDeck(record.manifest.data, {
      tagline: record.manifest.tagline,
      ...(record.manifest.spreads ? { spreads: record.manifest.spreads } : {}),
    });
  }
}

/**
 * Idempotently migrate the old principal-scoped JSON envelope into first-class catalog rows.
 * Existing catalog rows win, so retrying a partial migration can never overwrite newer content.
 */
export async function migrateLegacyCustomDecks(
  ownerId: string,
  legacy: ArcanaHostStateRepository,
  catalog: UserDeckCatalogRepository,
): Promise<number> {
  const raw = await legacy.load(ownerId);
  if (raw === null) return 0;

  const state = parseArcanaHostState(raw);
  for (const manifest of state.customDecks) {
    await catalog.ensureImported(ownerId, immutableJsonSnapshot(manifest, "Legacy user deck manifest"));
  }
  await legacy.delete(ownerId);
  return state.customDecks.length;
}

/** Persist only the imported deck touched by a successful mutation, rather than snapshotting a whole host. */
export class CatalogPersistingArcanaToolAdapter extends ArcanaToolAdapter {
  private saveTail: Promise<void> = Promise.resolve();

  constructor(
    adapter: ArcanaToolAdapter,
    private readonly ownerId: string,
    private readonly catalog: UserDeckCatalogRepository,
  ) {
    super(adapter.engine);
  }

  override async call(name: ArcanaToolName, input: unknown = {}): Promise<unknown> {
    const result = await super.call(name, input);
    if (name === "import_deck") {
      const deckId = importedDeckId(result);
      const deck = this.engine.getDeck(deckId);
      if (!deck?.custom) throw new Error(`Imported custom deck “${deckId}” could not be resolved for persistence.`);
      const manifest = snapshotUserDeckManifest(deck);
      this.saveTail = this.saveTail.then(() => this.catalog.upsertImported(this.ownerId, manifest)).then(() => undefined);
      await this.saveTail;
    }
    return result;
  }
}

/** Small contract-faithful implementation for tests and non-durable development callers. */
export class InMemoryUserDeckCatalogRepository implements UserDeckCatalogRepository {
  private readonly records = new Map<string, UserDeckRecord>();

  async listOwned(ownerId: string): Promise<UserDeckRecord[]> {
    const owner = requireId(ownerId, "ownerId");
    return snapshots([...this.records.values()]
      .filter((record) => record.ownerId === owner)
      .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)));
  }

  async get(deckId: string): Promise<UserDeckRecord | null> {
    const record = this.records.get(requireId(deckId, "deckId"));
    return record ? snapshot(record) : null;
  }

  async listPublic(limit = 50): Promise<UserDeckRecord[]> {
    const max = requireLimit(limit);
    return snapshots([...this.records.values()]
      .filter((record) => record.visibility === "public")
      .sort((a, b) => (b.publishedAt ?? b.updatedAt).localeCompare(a.publishedAt ?? a.updatedAt))
      .slice(0, max));
  }

  async ensureImported(ownerId: string, manifest: UserDeckManifest): Promise<UserDeckRecord> {
    const owner = requireId(ownerId, "ownerId");
    const clean = snapshotManifest(manifest);
    const existing = this.findOwnedBySlug(owner, clean.data.slug);
    if (existing) return snapshot(existing);
    const now = new Date().toISOString();
    const record: UserDeckRecord = {
      id: randomUUID(),
      ownerId: owner,
      slug: clean.data.slug,
      manifest: clean,
      visibility: "private",
      revision: 1,
      createdAt: now,
      updatedAt: now,
    };
    this.records.set(record.id, record);
    return snapshot(record);
  }

  async upsertImported(ownerId: string, manifest: UserDeckManifest): Promise<UserDeckRecord> {
    const owner = requireId(ownerId, "ownerId");
    const clean = snapshotManifest(manifest);
    const existing = this.findOwnedBySlug(owner, clean.data.slug);
    if (!existing) return this.ensureImported(owner, clean);
    const updated: UserDeckRecord = {
      ...existing,
      manifest: clean,
      revision: existing.revision + 1,
      updatedAt: new Date().toISOString(),
    };
    this.records.set(updated.id, updated);
    return snapshot(updated);
  }

  async setVisibility(ownerId: string, deckId: string, visibility: DeckVisibility): Promise<UserDeckRecord> {
    const owner = requireId(ownerId, "ownerId");
    const id = requireId(deckId, "deckId");
    const nextVisibility = requireVisibility(visibility);
    const existing = this.records.get(id);
    if (!existing || existing.ownerId !== owner) throw new Error("Unknown owned user deck.");
    if (existing.visibility === nextVisibility) return snapshot(existing);
    const now = new Date().toISOString();
    const updated: UserDeckRecord = {
      ...existing,
      visibility: nextVisibility,
      revision: existing.revision + 1,
      updatedAt: now,
      ...(nextVisibility === "public" ? { publishedAt: now } : { publishedAt: undefined }),
    };
    this.records.set(id, updated);
    return snapshot(updated);
  }

  async deleteOwned(ownerId: string, deckId: string): Promise<boolean> {
    const owner = requireId(ownerId, "ownerId");
    const id = requireId(deckId, "deckId");
    const existing = this.records.get(id);
    return existing?.ownerId === owner ? this.records.delete(id) : false;
  }

  async deleteAllOwned(ownerId: string): Promise<number> {
    const owner = requireId(ownerId, "ownerId");
    let count = 0;
    for (const [id, record] of this.records) {
      if (record.ownerId === owner) {
        this.records.delete(id);
        count += 1;
      }
    }
    return count;
  }

  private findOwnedBySlug(ownerId: string, slug: string): UserDeckRecord | undefined {
    return [...this.records.values()].find((record) => record.ownerId === ownerId && record.slug === slug);
  }
}

function importedDeckId(result: unknown): string {
  if (!result || typeof result !== "object" || Array.isArray(result)) throw new Error("Import result must be an object.");
  const id = (result as Record<string, unknown>).id;
  if (typeof id !== "string" || !id.trim()) throw new Error("Import result is missing a deck id.");
  return id;
}

function snapshotManifest(manifest: UserDeckManifest): UserDeckManifest {
  if (!manifest || typeof manifest !== "object" || Array.isArray(manifest)) throw new Error("User deck manifest must be an object.");
  if (!manifest.data || typeof manifest.data !== "object" || Array.isArray(manifest.data)) throw new Error("User deck manifest data must be an object.");
  if (typeof manifest.data.slug !== "string" || !manifest.data.slug.trim()) throw new Error("User deck manifest slug must be non-empty.");
  if (typeof manifest.tagline !== "string") throw new Error("User deck manifest tagline must be a string.");
  if (manifest.spreads !== undefined && !Array.isArray(manifest.spreads)) throw new Error("User deck manifest spreads must be an array.");
  return immutableJsonSnapshot(manifest, "User deck manifest");
}

function snapshot(record: UserDeckRecord): UserDeckRecord {
  return immutableJsonSnapshot(record, "User deck record");
}

function snapshots(records: UserDeckRecord[]): UserDeckRecord[] {
  return records.map(snapshot);
}

function requireId(value: string, label: string): string {
  if (typeof value !== "string" || !value.trim()) throw new Error(`${label} must be a non-empty string.`);
  return value.trim();
}

function requireLimit(value: number): number {
  if (!Number.isSafeInteger(value) || value < 1 || value > 200) throw new Error("catalog limit must be an integer from 1 to 200.");
  return value;
}

function requireVisibility(value: DeckVisibility): DeckVisibility {
  if (value !== "private" && value !== "unlisted" && value !== "public") throw new Error("Invalid deck visibility.");
  return value;
}
