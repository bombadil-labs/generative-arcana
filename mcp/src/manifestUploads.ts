import { createHash, randomBytes, randomUUID } from "node:crypto";
import type { Pool, PoolClient } from "pg";
import { inspectDeckAuthoringArtifact } from "../../app/src/decks/authoring";
import { inspectStagedManifest } from "./manifestDiagnostics";

export const MAX_MANIFEST_UPLOAD_BYTES = 2_000_000;
export const MANIFEST_UPLOAD_TTL_SECONDS = 15 * 60;
export const MANIFEST_RECEIPT_TTL_SECONDS = 24 * 60 * 60;
export const MAX_ACTIVE_MANIFEST_UPLOADS = 8;
export class ManifestUploadError extends Error {
  constructor(public readonly status: number, message: string) { super(message); }
}
const missing = () => new ManifestUploadError(404, "Unknown or expired manifest upload.");
export const hashBytes = (bytes: Uint8Array | string) => createHash("sha256").update(bytes).digest("hex");
export interface ManifestImportOptions { deckId?: string; expectedRevision?: number }
export interface ManifestUploadRepository {
  create(ownerId: string, byteLength: number, sha256?: string): Promise<{ uploadId: string; ticket: string; expiresAt: string }>;
  finalize(uploadId: string, ticket: string, bytes: Uint8Array): Promise<{ uploadId: string; sha256: string; byteLength: number; validation: ReturnType<typeof stagedManifestReport> }>;
  read(ownerId: string, uploadId: string): Promise<{ uploadId: string; json: string; sha256: string; byteLength: number }>;
  import(ownerId: string, uploadId: string, options?: ManifestImportOptions): Promise<Record<string, unknown>>;
}
/** Private, bounded, immutable staging plus transactional import receipts shared by all replicas. */
export class PostgresManifestUploads implements ManifestUploadRepository {
  constructor(private readonly pool: Pick<Pool, "query" | "connect">) {}
  async pruneExpired(limit = 500): Promise<number> {
    if (!Number.isSafeInteger(limit) || limit < 1 || limit > 1000) throw new Error("Invalid manifest cleanup batch.");
    const result = await this.pool.query("DELETE FROM arcana_manifest_uploads WHERE id IN (SELECT id FROM arcana_manifest_uploads WHERE expires_at <= now() ORDER BY expires_at LIMIT $1 FOR UPDATE SKIP LOCKED) RETURNING id", [limit]);
    return result.rows.length;
  }
  async create(ownerId: string, byteLength: number, sha256?: string) {
    if (!Number.isSafeInteger(byteLength) || byteLength < 1 || byteLength > MAX_MANIFEST_UPLOAD_BYTES) throw new ManifestUploadError(400, "Manifest upload size must be between 1 and 2000000 bytes.");
    if (sha256 !== undefined && !/^[0-9a-f]{64}$/.test(sha256)) throw new ManifestUploadError(400, "Invalid SHA-256 digest.");
    await this.pruneExpired();
    const uploadId = randomUUID(), ticket = randomBytes(32).toString("base64url");
    return this.transaction(async client => {
      // Serialize quota checks across independent replicas. Only this account's transient rows are swept.
      await client.query("SELECT pg_advisory_xact_lock(hashtextextended($1, 719311))", [ownerId]);
      await client.query("DELETE FROM arcana_manifest_uploads WHERE owner_id=$1 AND expires_at <= now()", [ownerId]);
      const counts = (await client.query("SELECT count(*)::integer AS total, count(*) FILTER (WHERE import_result IS NULL)::integer AS active FROM arcana_manifest_uploads WHERE owner_id=$1", [ownerId])).rows[0];
      if (Number(counts.active) >= MAX_ACTIVE_MANIFEST_UPLOADS || Number(counts.total) >= 100) throw new ManifestUploadError(429, "Manifest staging quota reached. Retry after existing uploads expire.");
      const row = (await client.query(`INSERT INTO arcana_manifest_uploads(id,owner_id,ticket_hash,expected_bytes,expected_sha256,expires_at)
        VALUES($1,$2,$3,$4,$5,now()+interval '15 minutes') RETURNING expires_at`, [uploadId, ownerId, hashBytes(ticket), byteLength, sha256 ?? null])).rows[0];
      return { uploadId, ticket, expiresAt: new Date(row.expires_at).toISOString() };
    });
  }
  async finalize(uploadId: string, ticket: string, bytes: Uint8Array) {
    if (!/^[A-Za-z0-9_-]{43}$/.test(ticket)) throw missing();
    if (!bytes.byteLength || bytes.byteLength > MAX_MANIFEST_UPLOAD_BYTES) throw new ManifestUploadError(413, "Manifest upload exceeds the byte limit.");
    let json: string;
    try { json = new TextDecoder("utf-8", { fatal: true }).decode(bytes); } catch { throw new ManifestUploadError(400, "Manifest must be UTF-8 JSON."); }
    if (json.includes("\u0000")) throw new ManifestUploadError(400, "Manifest must not contain NUL bytes.");
    const sha256 = hashBytes(bytes);
    return this.transaction(async client => {
      const row = (await client.query("SELECT * FROM arcana_manifest_uploads WHERE id=$1 AND ticket_hash=$2 AND expires_at>now() FOR UPDATE", [uploadId, hashBytes(ticket)])).rows[0];
      if (!row || row.import_result) throw missing();
      if (Number(row.expected_bytes) !== bytes.byteLength || (row.expected_sha256 && row.expected_sha256 !== sha256)) throw new ManifestUploadError(400, "Uploaded byte count or SHA-256 does not match the upload ticket.");
      if (row.sha256 && row.sha256 !== sha256) throw new ManifestUploadError(409, "Manifest upload is immutable. Create a new upload for changed content.");
      if (!row.sha256) await client.query("UPDATE arcana_manifest_uploads SET raw_json=$2,sha256=$3,byte_length=$4 WHERE id=$1", [uploadId, json, sha256, bytes.byteLength]);
      return { uploadId, sha256, byteLength: bytes.byteLength, validation: stagedManifestReport(json) };
    });
  }
  async read(ownerId: string, uploadId: string) {
    const row = (await this.pool.query("SELECT raw_json,sha256,byte_length FROM arcana_manifest_uploads WHERE id=$1 AND owner_id=$2 AND expires_at>now()", [uploadId, ownerId])).rows[0];
    if (!row) throw missing();
    if (row.raw_json === null) throw new ManifestUploadError(409, "Upload is not finalized, or was already imported. Import retries return the original receipt.");
    return { uploadId, json: String(row.raw_json), sha256: String(row.sha256), byteLength: Number(row.byte_length) };
  }
  async import(ownerId: string, uploadId: string, options: ManifestImportOptions = {}) {
    if ((options.deckId !== undefined) !== (options.expectedRevision !== undefined) || (options.expectedRevision !== undefined && (!Number.isSafeInteger(options.expectedRevision) || options.expectedRevision < 1))) throw new ManifestUploadError(400, "Replacement requires a stable deckId and expectedRevision together.");
    if (options.deckId !== undefined && (typeof options.deckId !== "string" || !options.deckId.trim() || options.deckId.length > 200)) throw new ManifestUploadError(400, "Invalid stable deckId.");
    const request = { deckId: options.deckId ?? null, expectedRevision: options.expectedRevision ?? null };
    return this.transaction(async client => {
      const row = (await client.query("SELECT * FROM arcana_manifest_uploads WHERE id=$1 AND owner_id=$2 AND expires_at>now() FOR UPDATE", [uploadId, ownerId])).rows[0];
      if (!row) throw missing();
      if (row.import_result) {
        if (JSON.stringify(row.import_request) !== JSON.stringify(request) && (row.import_request.deckId !== request.deckId || row.import_request.expectedRevision !== request.expectedRevision)) throw new ManifestUploadError(409, "This upload was already imported with different options.");
        return row.import_result as Record<string, unknown>;
      }
      if (row.raw_json === null) throw new ManifestUploadError(409, "Upload bytes before importing this manifest.");
      const validation = inspectStagedManifest(row.raw_json);
      if (!validation.ok) throw new ManifestUploadError(400, validation.errors.map(error => `${error.path}: ${error.message}`).join("\n"));
      const manifest = validation.manifest;
      let deck: Record<string, unknown> | undefined;
      if (options.deckId !== undefined) {
        const owned = (await client.query("SELECT id,owner_id,revision,slug FROM arcana_user_decks WHERE id=$1 AND owner_id=$2 FOR UPDATE", [options.deckId, ownerId])).rows[0];
        if (!owned || owned.owner_id !== ownerId) throw new ManifestUploadError(404, "Unknown owned user deck.");
        if (Number(owned.revision) !== options.expectedRevision) throw new ManifestUploadError(409, "Deck revision conflict. Read the latest revision and retry with a new upload or unchanged options.");
        if (owned.slug !== manifest.data.slug) throw new ManifestUploadError(400, "Replacement must preserve the authored deck slug.");
        deck = (await client.query("UPDATE arcana_user_decks SET manifest=$2::jsonb,revision=revision+1,updated_at=now() WHERE id=$1 RETURNING id,slug,revision", [options.deckId, JSON.stringify(manifest)])).rows[0];
      } else {
        deck = (await client.query(`INSERT INTO arcana_user_decks(id,owner_id,slug,manifest) VALUES($1,$2,$3,$4::jsonb)
          ON CONFLICT(owner_id,slug) DO NOTHING RETURNING id,slug,revision`, [randomUUID(), ownerId, manifest.data.slug, JSON.stringify(manifest)])).rows[0];
        if (!deck) throw new ManifestUploadError(409, "A deck with this slug already exists. Replace it using its stable deckId and expectedRevision.");
      }
      const result = { id: deck!.id, slug: deck!.slug, revision: Number(deck!.revision), name: manifest.data.name, cardCount: Object.keys(manifest.data.cards).length, custom: true, uploadId, sha256: row.sha256 };
      // Commit the deck and receipt together. Discard only the transient source bytes, retain receipt 24h.
      await client.query("UPDATE arcana_manifest_uploads SET raw_json=NULL,import_request=$2::jsonb,import_result=$3::jsonb,expires_at=now()+interval '24 hours' WHERE id=$1", [uploadId, JSON.stringify(request), JSON.stringify(result)]);
      return result;
    });
  }
  private async transaction<T>(operation: (client: PoolClient) => Promise<T>): Promise<T> {
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      await client.query("SET LOCAL lock_timeout = '5s'");
      await client.query("SET LOCAL statement_timeout = '15s'");
      const result = await operation(client);
      await client.query("COMMIT"); return result;
    } catch (error) { await client.query("ROLLBACK").catch(() => undefined); throw error; }
    finally { client.release(); }
  }
}

/** Same complete-manifest authority for upload feedback, validation by reference, and import. */
export function stagedManifestReport(json: string, includeNormalizedManifest = false) {
  const inspected = inspectStagedManifest(json);
  if (!inspected.ok) return { valid: false, canonical: false, specVersion: "2", inputKind: "unknown", error: inspected.errors.map(error => `${error.path}: ${error.message}`).join("\n"), errors: inspected.errors, errorsTruncated: inspected.errorsTruncated };
  const report = inspectDeckAuthoringArtifact(JSON.parse(json), { includeNormalizedManifest });
  return { ...report, errors: [], errorsTruncated: false };
}
