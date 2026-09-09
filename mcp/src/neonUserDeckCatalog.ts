import { randomUUID } from "node:crypto";
import { neon } from "@neondatabase/serverless";
import type { DeckVisibility, UserDeckManifest, UserDeckRecord } from "../../app/src/decks/catalog.js";
import { validateDeckManifest } from "../../app/src/decks/manifest.js";
import { immutableJsonSnapshot } from "../../app/src/decks/jsonSnapshot.js";
import type { UserDeckCatalogRepository } from "./userDeckCatalog.js";

type NeonSql = (strings: TemplateStringsArray, ...params: unknown[]) => Promise<Array<Record<string, unknown>>>;

export class NeonUserDeckCatalogRepository implements UserDeckCatalogRepository {
  private readonly sql: NeonSql;
  private ready?: Promise<void>;

  constructor(connectionString: string, sql?: NeonSql) {
    if (!connectionString.trim()) throw new Error("DATABASE_URL must be non-empty.");
    this.sql = sql ?? (neon(connectionString) as unknown as NeonSql);
  }

  async listOwned(ownerId: string): Promise<UserDeckRecord[]> {
    await this.ensureSchema();
    const owner = requireText(ownerId, "ownerId");
    const rows = await this.sql`
      SELECT id, owner_id, slug, manifest, visibility, revision, created_at, updated_at, published_at
      FROM arcana_user_decks
      WHERE owner_id = ${owner}
      ORDER BY updated_at DESC, id ASC
    `;
    return rows.map(parseRow);
  }

  async get(deckId: string): Promise<UserDeckRecord | null> {
    await this.ensureSchema();
    const id = requireText(deckId, "deckId");
    const rows = await this.sql`
      SELECT id, owner_id, slug, manifest, visibility, revision, created_at, updated_at, published_at
      FROM arcana_user_decks
      WHERE id = ${id}
      LIMIT 1
    `;
    return rows.length ? parseRow(rows[0]!) : null;
  }

  async listPublic(limit = 50): Promise<UserDeckRecord[]> {
    await this.ensureSchema();
    const max = requireLimit(limit);
    const rows = await this.sql`
      SELECT id, owner_id, slug, manifest, visibility, revision, created_at, updated_at, published_at
      FROM arcana_user_decks
      WHERE visibility = 'public'
      ORDER BY published_at DESC NULLS LAST, updated_at DESC, id ASC
      LIMIT ${max}
    `;
    return rows.map(parseRow);
  }

  async ensureImported(ownerId: string, manifest: UserDeckManifest): Promise<UserDeckRecord> {
    await this.ensureSchema();
    const owner = requireText(ownerId, "ownerId");
    const clean = snapshotManifest(manifest);
    const id = randomUUID();
    const json = JSON.stringify(clean);
    const rows = await this.sql`
      INSERT INTO arcana_user_decks (id, owner_id, slug, manifest, visibility, revision, created_at, updated_at)
      VALUES (${id}, ${owner}, ${clean.data.slug}, ${json}::jsonb, 'private', 1, now(), now())
      ON CONFLICT (owner_id, slug) DO NOTHING
      RETURNING id, owner_id, slug, manifest, visibility, revision, created_at, updated_at, published_at
    `;
    if (rows.length) return parseRow(rows[0]!);
    const existing = await this.sql`
      SELECT id, owner_id, slug, manifest, visibility, revision, created_at, updated_at, published_at
      FROM arcana_user_decks
      WHERE owner_id = ${owner} AND slug = ${clean.data.slug}
      LIMIT 1
    `;
    if (!existing.length) throw new Error("User deck insert conflicted but no existing row could be resolved.");
    return parseRow(existing[0]!);
  }

  async createImported(ownerId: string, manifest: UserDeckManifest): Promise<UserDeckRecord> {
    await this.ensureSchema();
    const owner = requireText(ownerId, "ownerId");
    const clean = snapshotManifest(manifest);
    const id = randomUUID();
    const json = JSON.stringify(clean);
    const rows = await this.sql`
      INSERT INTO arcana_user_decks (id, owner_id, slug, manifest, visibility, revision, created_at, updated_at)
      VALUES (${id}, ${owner}, ${clean.data.slug}, ${json}::jsonb, 'private', 1, now(), now())
      ON CONFLICT (owner_id, slug) DO NOTHING
      RETURNING id, owner_id, slug, manifest, visibility, revision, created_at, updated_at, published_at
    `;
    if (!rows.length) {
      throw new Error(`A deck with slug “${clean.data.slug}” is already owned by this account.`);
    }
    return parseRow(rows[0]!);
  }

  async upsertImported(ownerId: string, manifest: UserDeckManifest): Promise<UserDeckRecord> {
    await this.ensureSchema();
    const owner = requireText(ownerId, "ownerId");
    const clean = snapshotManifest(manifest);
    const id = randomUUID();
    const json = JSON.stringify(clean);
    const rows = await this.sql`
      INSERT INTO arcana_user_decks (id, owner_id, slug, manifest, visibility, revision, created_at, updated_at)
      VALUES (${id}, ${owner}, ${clean.data.slug}, ${json}::jsonb, 'private', 1, now(), now())
      ON CONFLICT (owner_id, slug)
      DO UPDATE SET
        manifest = EXCLUDED.manifest,
        revision = arcana_user_decks.revision + 1,
        updated_at = now()
      RETURNING id, owner_id, slug, manifest, visibility, revision, created_at, updated_at, published_at
    `;
    if (!rows.length) throw new Error("User deck upsert returned no row.");
    return parseRow(rows[0]!);
  }

  async setVisibility(ownerId: string, deckId: string, visibility: DeckVisibility): Promise<UserDeckRecord> {
    await this.ensureSchema();
    const owner = requireText(ownerId, "ownerId");
    const id = requireText(deckId, "deckId");
    const next = requireVisibility(visibility);
    const rows = await this.sql`
      UPDATE arcana_user_decks
      SET
        visibility = ${next},
        revision = revision + 1,
        updated_at = now(),
        published_at = CASE WHEN ${next} = 'public' THEN now() ELSE NULL END
      WHERE id = ${id} AND owner_id = ${owner} AND visibility <> ${next}
      RETURNING id, owner_id, slug, manifest, visibility, revision, created_at, updated_at, published_at
    `;
    if (rows.length) return parseRow(rows[0]!);
    const existing = await this.sql`
      SELECT id, owner_id, slug, manifest, visibility, revision, created_at, updated_at, published_at
      FROM arcana_user_decks
      WHERE id = ${id} AND owner_id = ${owner}
      LIMIT 1
    `;
    if (!existing.length) throw new Error("Unknown owned user deck.");
    return parseRow(existing[0]!);
  }

  async deleteOwned(ownerId: string, deckId: string): Promise<boolean> {
    await this.ensureSchema();
    const owner = requireText(ownerId, "ownerId");
    const id = requireText(deckId, "deckId");
    const rows = await this.sql`
      DELETE FROM arcana_user_decks
      WHERE id = ${id} AND owner_id = ${owner}
      RETURNING id
    `;
    return rows.length > 0;
  }

  async deleteAllOwned(ownerId: string): Promise<number> {
    await this.ensureSchema();
    const owner = requireText(ownerId, "ownerId");
    const rows = await this.sql`
      DELETE FROM arcana_user_decks
      WHERE owner_id = ${owner}
      RETURNING id
    `;
    return rows.length;
  }

  private ensureSchema(): Promise<void> {
    this.ready ??= (async () => {
      await this.sql`
        CREATE TABLE IF NOT EXISTS arcana_user_decks (
          id text PRIMARY KEY,
          owner_id text NOT NULL,
          slug text NOT NULL,
          manifest jsonb NOT NULL,
          visibility text NOT NULL DEFAULT 'private' CHECK (visibility IN ('private', 'unlisted', 'public')),
          revision integer NOT NULL DEFAULT 1 CHECK (revision > 0),
          created_at timestamptz NOT NULL DEFAULT now(),
          updated_at timestamptz NOT NULL DEFAULT now(),
          published_at timestamptz,
          UNIQUE (owner_id, slug)
        )
      `;
      await this.sql`
        CREATE INDEX IF NOT EXISTS arcana_user_decks_owner_updated_idx
        ON arcana_user_decks (owner_id, updated_at DESC)
      `;
      await this.sql`
        CREATE INDEX IF NOT EXISTS arcana_user_decks_public_published_idx
        ON arcana_user_decks (published_at DESC, updated_at DESC)
        WHERE visibility = 'public'
      `;
    })();
    return this.ready;
  }
}

function parseRow(row: Record<string, unknown>): UserDeckRecord {
  const visibility = requireVisibility(row.visibility);
  const manifest = snapshotManifest(row.manifest as UserDeckManifest);
  const revision = typeof row.revision === "number" ? row.revision : Number(row.revision);
  if (!Number.isSafeInteger(revision) || revision < 1) throw new Error("Invalid user deck revision from catalog.");
  const record: UserDeckRecord = {
    id: requireText(row.id, "catalog id"),
    ownerId: requireText(row.owner_id, "catalog owner_id"),
    slug: requireText(row.slug, "catalog slug"),
    manifest,
    visibility,
    revision,
    createdAt: timestamp(row.created_at, "created_at"),
    updatedAt: timestamp(row.updated_at, "updated_at"),
    ...(row.published_at === null || row.published_at === undefined ? {} : { publishedAt: timestamp(row.published_at, "published_at") }),
  };
  return immutableJsonSnapshot(record, "User deck catalog row");
}

function snapshotManifest(manifest: UserDeckManifest): UserDeckManifest {
  const validation = validateDeckManifest(manifest);
  if (!validation.ok) throw new Error(validation.error);
  return validation.manifest;
}

function requireText(value: unknown, label: string): string {
  if (typeof value !== "string" || !value.trim()) throw new Error(`${label} must be a non-empty string.`);
  return value.trim();
}

function requireVisibility(value: unknown): DeckVisibility {
  if (value !== "private" && value !== "unlisted" && value !== "public") throw new Error("Invalid deck visibility.");
  return value;
}

function requireLimit(value: number): number {
  if (!Number.isSafeInteger(value) || value < 1 || value > 200) throw new Error("catalog limit must be an integer from 1 to 200.");
  return value;
}

function timestamp(value: unknown, label: string): string {
  if (value instanceof Date && !Number.isNaN(value.valueOf())) return value.toISOString();
  if (typeof value === "string") {
    const date = new Date(value);
    if (!Number.isNaN(date.valueOf())) return date.toISOString();
  }
  throw new Error(`Invalid ${label} timestamp from user deck catalog.`);
}
