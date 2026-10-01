import { Pool } from "pg";
import { artworkConflict, artworkMissing, type ArtworkRecord, type ArtworkRepository } from "./cardArtwork";

/** Uses transactions/row locks so independent replicas cannot attach stale or unauthorized art. */
export class NeonArtworkRepository implements ArtworkRepository {
  constructor(private readonly pool: Pick<Pool, "query" | "connect">) {}
  async get(deckId: string, cardSlug: string): Promise<ArtworkRecord | null> {
    const result = await this.pool.query("SELECT asset FROM arcana_card_artwork WHERE deck_id=$1 AND card_slug=$2", [deckId, cardSlug]);
    return result.rows[0]?.asset ?? null;
  }
  async list(deckId: string): Promise<ArtworkRecord[]> {
    return (await this.pool.query("SELECT asset FROM arcana_card_artwork WHERE deck_id=$1", [deckId])).rows.map(row => row.asset);
  }
  async attach(ownerId: string, revision: number, expected: string | null, record: ArtworkRecord): Promise<ArtworkRecord | null> {
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      await client.query("SET LOCAL lock_timeout = '5s'");
      await client.query("SET LOCAL statement_timeout = '15s'");
      const deck = (await client.query("SELECT owner_id, revision, manifest FROM arcana_user_decks WHERE id=$1 FOR UPDATE", [record.deckId])).rows[0];
      if (!deck || deck.owner_id !== ownerId || !Object.hasOwn(deck.manifest.data.cards, record.cardSlug)) throw artworkMissing();
      if (Number(deck.revision) !== revision) throw artworkConflict();
      const previous: ArtworkRecord | null = (await client.query("SELECT asset FROM arcana_card_artwork WHERE deck_id=$1 AND card_slug=$2 FOR UPDATE", [record.deckId, record.cardSlug])).rows[0]?.asset ?? null;
      if ((previous?.id ?? null) !== expected) throw artworkConflict();
      await client.query(`INSERT INTO arcana_card_artwork(deck_id,card_slug,asset) VALUES($1,$2,$3::jsonb)
        ON CONFLICT(deck_id,card_slug) DO UPDATE SET asset=EXCLUDED.asset`, [record.deckId, record.cardSlug, JSON.stringify(record)]);
      await client.query("COMMIT");
      return previous;
    } catch (error) { await client.query("ROLLBACK").catch(() => undefined); throw error; }
    finally { client.release(); }
  }
}
