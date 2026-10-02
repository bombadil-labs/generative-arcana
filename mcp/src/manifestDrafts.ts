import * as z from "zod/v4";
import { randomBytes, randomUUID } from "node:crypto";
import type { Pool, PoolClient } from "pg";
import {
  DRAFT_SHA256_BASIS, hashBytes, MAX_ACTIVE_MANIFEST_UPLOADS, ManifestUploadError, ManifestDraftVersionConflict,
  PostgresManifestUploads, stagedManifestReport, type ManifestImportOptions,
} from "./manifestUploads";
import {
  INITIAL_DRAFT_JSON, applyDraftUpdate, canonicalDraftJson, draftReadSchema,
  draftSummary, draftUpdateSchema, readDraftPart,
} from "./manifestDraftOperations";

export const MANIFEST_DRAFT_TTL_SECONDS = 2 * 60 * 60;
export const MAX_DRAFT_MUTATIONS = 512;
export interface ManifestDraftRepository {
  start(ownerId: string, startKey: string): Promise<Record<string, unknown>>;
  update(ownerId: string, input: unknown): Promise<Record<string, unknown>>;
  read(ownerId: string, input: unknown): Promise<Record<string, unknown>>;
  validate(ownerId: string, draftId: string, expectedVersion: number): Promise<Record<string, unknown>>;
  commit(ownerId: string, draftId: string, expectedVersion: number, options?: ManifestImportOptions): Promise<Record<string, unknown>>;
}
type DraftRow = Record<string, any>;
const missing = () => new ManifestUploadError(404, "Unknown or expired deck draft.");
const validId = (id: string) => /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id);

/** Uses the same bounded staging rows, quota locks, expiry sweep and atomic import as file uploads. */
export class PostgresManifestDrafts implements ManifestDraftRepository {
  constructor(private readonly pool: Pick<Pool, "query" | "connect">, private readonly uploads: PostgresManifestUploads) {}

  async start(ownerId: string, startKey: string) {
    if (typeof startKey !== "string" || !/^[A-Za-z0-9_-]{1,80}$/.test(startKey)) throw new ManifestUploadError(400, "startKey must contain 1–80 ASCII letters, numbers, underscores or hyphens.");
    await this.uploads.pruneExpired();
    return this.transaction(async client => {
      // Same lock as raw-file staging: the active quota is shared across routes and replicas.
      await client.query("SELECT pg_advisory_xact_lock(hashtextextended($1, 719311))", [ownerId]);
      await client.query("DELETE FROM arcana_manifest_uploads WHERE owner_id=$1 AND expires_at<=now()", [ownerId]);
      const existing = (await client.query("SELECT * FROM arcana_manifest_uploads WHERE owner_id=$1 AND draft_key=$2", [ownerId, startKey])).rows[0];
      if (existing) return this.status(existing);
      const counts = (await client.query("SELECT count(*)::integer AS total, count(*) FILTER (WHERE import_result IS NULL)::integer AS active FROM arcana_manifest_uploads WHERE owner_id=$1", [ownerId])).rows[0];
      if (Number(counts.active) >= MAX_ACTIVE_MANIFEST_UPLOADS || Number(counts.total) >= 100) throw new ManifestUploadError(429, "Manifest staging quota reached. Retry after existing uploads or drafts expire.");
      const bytes = Buffer.byteLength(INITIAL_DRAFT_JSON, "utf8");
      const row = (await client.query(`INSERT INTO arcana_manifest_uploads
        (id,owner_id,ticket_hash,expected_bytes,draft_json,sha256,byte_length,expires_at,draft_version,draft_key,draft_history)
        VALUES($1,$2,$3,$4,$5,$6,$4,now()+interval '2 hours',1,$7,'{}'::jsonb) RETURNING *`,
        [randomUUID(), ownerId, hashBytes(randomBytes(32)), bytes, INITIAL_DRAFT_JSON, hashBytes(INITIAL_DRAFT_JSON), startKey])).rows[0];
      return this.status(row);
    });
  }

  async update(ownerId: string, input: unknown): Promise<Record<string, unknown>> {
    const update = draftInput(() => {
      canonicalDraftJson(input); // Inspect original keys before schema parsing can normalize them.
      return draftUpdateSchema.parse(input);
    });
    // Includes expectedVersion, preventing a retry key from silently changing its policy.
    const digest = hashBytes(canonicalDraftJson(update));
    return this.transaction(async client => {
      const row = await this.get(ownerId, update.draftId, client, true);
      const history = row.draft_history as Record<string, { sha256: string; version: number }>;
      const previous = Object.hasOwn(history, update.mutationId) ? history[update.mutationId] : undefined;
      if (previous) {
        if (previous.sha256 !== digest) throw new ManifestUploadError(409, "mutationId was already used with different content or expectedVersion. Use a new mutationId for a new change.");
        return { draftId: update.draftId, version: previous.version, currentVersion: Number(row.draft_version), replayed: true, state: row.import_result ? "committed" : "editing" };
      }
      if (row.import_result) throw new ManifestUploadError(409, "This draft is already committed. Use edit_deck for subsequent corrections.");
      this.expectVersion(row, update.expectedVersion);
      if (Object.keys(history).length >= MAX_DRAFT_MUTATIONS) throw new ManifestUploadError(429, "Draft mutation limit reached. Start a new draft.");
      const json = draftInput(() => applyDraftUpdate(String(row.draft_json), update));
      const version = Number(row.draft_version) + 1;
      const nextHistory = { ...history, [update.mutationId]: { sha256: digest, version } };
      const updated = (await client.query(`UPDATE arcana_manifest_uploads SET draft_json=$2,sha256=$3,byte_length=$4,
        expected_bytes=$4,draft_version=$5,draft_history=$6::jsonb WHERE id=$1 RETURNING *`,
        [update.draftId, json, hashBytes(json), Buffer.byteLength(json, "utf8"), version, JSON.stringify(nextHistory)])).rows[0];
      return { ...this.status(updated), currentVersion: version, replayed: false };
    });
  }

  async read(ownerId: string, input: unknown) {
    const request = draftInput(() => draftReadSchema.parse(input));
    const row = await this.get(ownerId, request.draftId);
    const status = this.status(row);
    if (!request.section) return status;
    if (row.import_result) throw new ManifestUploadError(409, "Draft content was removed after commit. Read the committed deck using its receipt id.");
    return { ...status, part: draftInput(() => readDraftPart(String(row.draft_json), request)) };
  }

  async validate(ownerId: string, draftId: string, expectedVersion: number) {
    const row = await this.get(ownerId, draftId);
    this.expectVersion(row, expectedVersion);
    if (row.import_result) return this.status(row);
    const report = stagedManifestReport(String(row.draft_json));
    // Diagnostics already carry exact paths. Do not duplicate their large aggregate error string.
    const { error: _error, ...validation } = report as typeof report & { error?: string };
    if (validation.valid && "summary" in validation) {
      const summary = validation.summary;
      return { ...this.status(row), validation: { ...validation, summary: { ...summary, name: summary.name.slice(0, 256), version: summary.version.slice(0, 256) }, summaryTextTruncated: summary.name.length > 256 || summary.version.length > 256 } };
    }
    return { ...this.status(row), validation };
  }

  async commit(ownerId: string, draftId: string, expectedVersion: number, options: ManifestImportOptions = {}) {
    if (!validId(draftId)) throw missing();
    return this.uploads.importDraft(ownerId, draftId, expectedVersion, options);
  }

  private status(row: DraftRow): Record<string, unknown> {
    return {
      draftId: String(row.id), version: Number(row.draft_version), state: row.import_result ? "committed" : "editing",
      expiresAt: new Date(row.expires_at).toISOString(), sha256: row.sha256, sha256Basis: DRAFT_SHA256_BASIS, byteLength: Number(row.byte_length),
      ...(row.import_result ? { receipt: { ...row.import_result, sha256Basis: DRAFT_SHA256_BASIS } } : { summary: draftSummary(String(row.draft_json)) }),
    };
  }
  private expectVersion(row: DraftRow, expectedVersion: number) {
    if (!Number.isSafeInteger(expectedVersion) || expectedVersion < 1) throw new ManifestUploadError(400, "Invalid expected draft version.");
    if (Number(row.draft_version) !== expectedVersion) throw new ManifestDraftVersionConflict(Number(row.draft_version));
  }
  private async get(ownerId: string, draftId: string, connection: Pick<Pool, "query"> | PoolClient = this.pool, lock = false): Promise<DraftRow> {
    if (!validId(draftId)) throw missing();
    const row = (await connection.query(`SELECT * FROM arcana_manifest_uploads WHERE id=$1 AND owner_id=$2 AND draft_version IS NOT NULL AND expires_at>now()${lock ? " FOR UPDATE" : ""}`, [draftId, ownerId])).rows[0];
    if (!row) throw missing();
    return row;
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

/** Return actionable bounded input errors, while keeping database/internal exceptions private. */
function draftInput<T>(operation: () => T): T {
  try { return operation(); }
  catch (error) {
    const message = error instanceof z.ZodError
      ? error.issues.slice(0, 8).map(issue => `${issue.path.join(".") || "$"}: ${issue.message}`).join("\n")
      : error instanceof Error ? error.message : "Invalid draft input.";
    throw new ManifestUploadError(400, message.slice(0, 2000));
  }
}
