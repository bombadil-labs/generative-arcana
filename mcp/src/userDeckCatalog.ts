import { randomUUID } from "node:crypto";
import type { DeckModule } from "../../app/src/decks/types.js";
import { createDeckManifest, snapshotDeckManifest, validateDeckManifest } from "../../app/src/decks/manifest.js";
import type { ImportDeckOptions } from "../../app/src/engine/types.js";
import type { DeckVisibility, UserDeckManifest, UserDeckRecord } from "../../app/src/decks/catalog.js";
import { immutableJsonSnapshot } from "../../app/src/decks/jsonSnapshot.js";
import { ArcanaToolAdapter, parseImportDeckInput, type ArcanaToolName } from "../../app/src/mcp/ArcanaToolAdapter.js";
import { parseArcanaHostState, type ArcanaHostStateRepository } from "./hostState.js";

export interface UserDeckCatalogRepository {
  listOwned(ownerId: string): Promise<UserDeckRecord[]>;
  get(deckId: string): Promise<UserDeckRecord | null>;
  listPublic(limit?: number): Promise<UserDeckRecord[]>;
  /** Migration-only insert-if-absent: an existing row wins unchanged. */
  ensureImported(ownerId: string, manifest: UserDeckManifest): Promise<UserDeckRecord>;
  /** User-facing create: duplicate owner+slug is an error. */
  createImported(ownerId: string, manifest: UserDeckManifest): Promise<UserDeckRecord>;
  /** User-facing replace/create: preserves an existing stable resource id and publication state. */
  upsertImported(ownerId: string, manifest: UserDeckManifest): Promise<UserDeckRecord>;
  setVisibility(ownerId: string, deckId: string, visibility: DeckVisibility): Promise<UserDeckRecord>;
  deleteOwned(ownerId: string, deckId: string): Promise<boolean>;
  deleteAllOwned(ownerId: string): Promise<number>;
}

/** Compatibility facade for older catalog callers; canonical implementation lives in the deck domain. */
export function snapshotUserDeckManifest(deck: DeckModule): UserDeckManifest {
  return snapshotDeckManifest(deck);
}

/** Compatibility facade for raw-deck import callers; canonical construction lives in the deck domain. */
export function validateUserDeckManifest(data: unknown, options: ImportDeckOptions = {}): UserDeckManifest {
  return createDeckManifest(data, {
    tagline: options.tagline,
    spreads: options.spreads,
  });
}

/** Restore catalog rows through the ordinary validated import boundary. */
export function restoreUserDeckRecords(adapter: ArcanaToolAdapter, ownerId: string, records: readonly UserDeckRecord[]): void {
  for (const record of records) {
    if (record.ownerId !== ownerId) throw new Error("User deck catalog returned a deck owned by another principal.");
    adapter.engine.importDeck(record.manifest.data, {
      tagline: record.manifest.tagline,
      ...(record.manifest.spreads ? { spreads: record.manifest.spreads } : {}),
      runtimeId: record.id,
      aliases: [record.slug],
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

/**
 * Catalog-backed imports validate first, persist second, then enter the runtime under the catalog's
 * stable resource id. This avoids briefly treating the mutable authored slug as canonical identity.
 */
export class CatalogPersistingArcanaToolAdapter extends ArcanaToolAdapter {
  private importTail: Promise<void> = Promise.resolve();

  constructor(
    adapter: ArcanaToolAdapter,
    private readonly ownerId: string,
    private readonly catalog: UserDeckCatalogRepository,
  ) {
    super(adapter.engine);
  }

  override async call(name: ArcanaToolName, input: unknown = {}): Promise<unknown> {
    if (name !== "import_deck") return super.call(name, input);

    const operation = this.importTail.then(() => this.importCatalogDeck(input));
    // Keep later imports serialized even when one operation fails.
    this.importTail = operation.then(() => undefined, () => undefined);
    return operation;
  }

  private async importCatalogDeck(input: unknown): Promise<unknown> {
    const request = parseImportDeckInput(input);
    const manifest = validateUserDeckManifest(request.data, request.options);
    const record = request.options.replaceExisting
      ? await this.catalog.upsertImported(this.ownerId, manifest)
      : await this.catalog.createImported(this.ownerId, manifest);

    const deck = this.engine.importDeck(record.manifest.data, {
      tagline: record.manifest.tagline,
      ...(record.manifest.spreads ? { spreads: record.manifest.spreads } : {}),
      runtimeId: record.id,
      aliases: [record.slug],
      replaceExisting: !!request.options.replaceExisting,
    });
    return {
      id: deck.id,
      slug: deck.data.slug,
      name: deck.name,
      cardCount: deck.cards.length,
      custom: true,
    };
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

  async createImported(ownerId: string, manifest: UserDeckManifest): Promise<UserDeckRecord> {
    const owner = requireId(ownerId, "ownerId");
    const clean = snapshotManifest(manifest);
    if (this.findOwnedBySlug(owner, clean.data.slug)) {
      throw new Error(`A deck with slug “${clean.data.slug}” is already owned by this account.`);
    }
    return this.ensureImported(owner, clean);
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
    };
    if (nextVisibility === "public") updated.publishedAt = now;
    else delete updated.publishedAt;
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

function snapshotManifest(manifest: UserDeckManifest): UserDeckManifest {
  const validation = validateDeckManifest(manifest);
  if (!validation.ok) throw new Error(validation.error);
  return validation.manifest;
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
