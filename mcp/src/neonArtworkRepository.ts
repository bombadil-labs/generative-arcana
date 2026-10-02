import { Pool } from "pg";
import { ArtworkError, DEFAULT_ARTWORK_PACK_ID, artworkConflict, artworkMissing, type ArtworkPack, type ArtworkRecord, type ArtworkRepository } from "./cardArtwork";

type PackRow = { pack_id: string; label: string; description: string | null; created_at: Date | string };
const packFromRow = (row: PackRow): ArtworkPack => ({ id: row.pack_id, label: row.label, ...(row.description ? { description: row.description } : {}), createdAt: new Date(row.created_at).toISOString() });
/** Deck locks serialize creation/attachment against deletion, revision changes and independent replicas. */
export class NeonArtworkRepository implements ArtworkRepository {
  constructor(private readonly pool: Pick<Pool, "query" | "connect">) {}
  async get(deckId: string, cardSlug: string, packId = DEFAULT_ARTWORK_PACK_ID): Promise<ArtworkRecord | null> {
    const result = packId === DEFAULT_ARTWORK_PACK_ID
      ? await this.pool.query("SELECT asset FROM arcana_card_artwork WHERE deck_id=$1 AND card_slug=$2", [deckId, cardSlug])
      : await this.pool.query("SELECT asset FROM arcana_visual_pack_artwork WHERE deck_id=$1 AND card_slug=$2 AND pack_id=$3", [deckId, cardSlug, packId]);
    const asset = result.rows[0]?.asset;
    return asset ? { ...asset, packId } : null;
  }
  async list(deckId: string, packId?: string): Promise<ArtworkRecord[]> {
    const legacy = packId === undefined || packId === DEFAULT_ARTWORK_PACK_ID
      ? (await this.pool.query("SELECT asset FROM arcana_card_artwork WHERE deck_id=$1", [deckId])).rows.map(row => ({ ...row.asset, packId: DEFAULT_ARTWORK_PACK_ID })) : [];
    const named = packId !== DEFAULT_ARTWORK_PACK_ID
      ? (await this.pool.query("SELECT asset FROM arcana_visual_pack_artwork WHERE deck_id=$1 AND ($2::text IS NULL OR pack_id=$2)", [deckId, packId ?? null])).rows.map(row => row.asset) : [];
    return [...legacy, ...named];
  }
  async listPacks(deckId: string): Promise<ArtworkPack[]> {
    return (await this.pool.query("SELECT pack_id,label,description,created_at FROM arcana_visual_packs WHERE deck_id=$1 ORDER BY created_at,pack_id", [deckId])).rows.map(packFromRow);
  }
  async createPack(ownerId: string, deckId: string, revision: number, pack: ArtworkPack): Promise<ArtworkPack> {
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      await client.query("SET LOCAL lock_timeout = '5s'"); await client.query("SET LOCAL statement_timeout = '15s'");
      const deck = (await client.query("SELECT owner_id,revision FROM arcana_user_decks WHERE id=$1 AND owner_id=$2 FOR UPDATE", [deckId, ownerId])).rows[0];
      if (!deck || deck.owner_id !== ownerId) throw artworkMissing();
      if (Number(deck.revision) !== revision) throw artworkConflict();
      const rows = (await client.query("SELECT pack_id,label,description,created_at FROM arcana_visual_packs WHERE deck_id=$1", [deckId])).rows as PackRow[];
      const existing = rows.find(row => row.pack_id === pack.id);
      if (existing) {
        if (existing.label !== pack.label || (existing.description ?? undefined) !== pack.description) throw artworkConflict();
        await client.query("COMMIT"); return packFromRow(existing);
      }
      if (rows.filter(row => row.pack_id !== DEFAULT_ARTWORK_PACK_ID).length >= 32) throw new ArtworkError(400, "artwork_pack_limit", "This deck already has 32 visual sets.");
      await client.query("INSERT INTO arcana_visual_packs(deck_id,pack_id,label,description,created_at) VALUES($1,$2,$3,$4,$5)", [deckId,pack.id,pack.label,pack.description ?? null,pack.createdAt ?? new Date().toISOString()]);
      await client.query("COMMIT"); return pack;
    } catch (error) { await client.query("ROLLBACK").catch(() => undefined); throw error; }
    finally { client.release(); }
  }
  async attach(ownerId: string, revision: number, expected: string | null, record: ArtworkRecord): Promise<ArtworkRecord | null> {
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      await client.query("SET LOCAL lock_timeout = '5s'"); await client.query("SET LOCAL statement_timeout = '15s'");
      const deck = (await client.query("SELECT owner_id, revision, manifest FROM arcana_user_decks WHERE id=$1 AND owner_id=$2 FOR UPDATE", [record.deckId, ownerId])).rows[0];
      if (!deck || deck.owner_id !== ownerId || !Object.hasOwn(deck.manifest.data.cards, record.cardSlug)) throw artworkMissing();
      if (Number(deck.revision) !== revision) throw artworkConflict();
      const isDefault = record.packId === DEFAULT_ARTWORK_PACK_ID;
      if (!isDefault) {
        const pack = await client.query("SELECT pack_id FROM arcana_visual_packs WHERE deck_id=$1 AND pack_id=$2", [record.deckId, record.packId]);
        if (!pack.rows.length) throw artworkMissing();
      }
      const previousRow = isDefault
        ? await client.query("SELECT asset FROM arcana_card_artwork WHERE deck_id=$1 AND card_slug=$2 FOR UPDATE", [record.deckId, record.cardSlug])
        : await client.query("SELECT asset FROM arcana_visual_pack_artwork WHERE deck_id=$1 AND card_slug=$2 AND pack_id=$3 FOR UPDATE", [record.deckId, record.cardSlug, record.packId]);
      const previous: ArtworkRecord | null = previousRow.rows[0]?.asset ? { ...previousRow.rows[0].asset, packId: record.packId } : null;
      if ((previous?.id ?? null) !== expected) throw artworkConflict();
      if (isDefault) {
        // Preserve the original schema and JSON contract so old deployments remain compatible.
        const { packId: _packId, ...legacy } = record;
        await client.query(`INSERT INTO arcana_card_artwork(deck_id,card_slug,asset) VALUES($1,$2,$3::jsonb)
          ON CONFLICT(deck_id,card_slug) DO UPDATE SET asset=EXCLUDED.asset`, [record.deckId, record.cardSlug, JSON.stringify(legacy)]);
      } else {
        await client.query(`INSERT INTO arcana_visual_pack_artwork(deck_id,pack_id,card_slug,asset) VALUES($1,$2,$3,$4::jsonb)
          ON CONFLICT(deck_id,pack_id,card_slug) DO UPDATE SET asset=EXCLUDED.asset`, [record.deckId, record.packId, record.cardSlug, JSON.stringify(record)]);
      }
      await client.query("COMMIT");
      return previous;
    } catch (error) { await client.query("ROLLBACK").catch(() => undefined); throw error; }
    finally { client.release(); }
  }
}
