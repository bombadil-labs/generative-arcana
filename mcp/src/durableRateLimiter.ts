import { createHash } from "node:crypto";
import { neon } from "@neondatabase/serverless";
import type { RateLimitDecision } from "./limits";

type Query = (query: string, params: unknown[]) => Promise<Array<Record<string, unknown>>>;

/** Atomic PostgreSQL counters shared by every instance; database failure fails closed. */
export class DurableRateLimiter {
  private readonly query: Query;
  constructor(connectionString: string, readonly limit: number, readonly windowMs = 60_000, query?: Query) {
    if (!Number.isSafeInteger(limit) || limit < 1) throw new Error("Rate limit must be a positive integer.");
    if (!Number.isSafeInteger(windowMs) || windowMs < 1) throw new Error("Rate-limit window must be a positive integer.");
    const sql = query ? undefined : neon(connectionString);
    this.query = query ?? ((statement, params) => sql!.query(statement, params) as Promise<Array<Record<string, unknown>>>);
  }
  async check(key: string): Promise<RateLimitDecision> {
    // Database clock prevents skew between instances. Hash minimizes retained address data;
    // counters expire after two windows and should be pruned by the maintenance command.
    const digest = createHash("sha256").update(key).digest("hex");
    const rows = await this.query(`
      INSERT INTO arcana_rate_limits (key, bucket, count, expires_at)
      VALUES ($1, floor(extract(epoch FROM clock_timestamp()) * 1000 / $2)::bigint, 1,
        clock_timestamp() + ($2 * 2) * interval '1 millisecond')
      ON CONFLICT (key) DO UPDATE SET
        bucket = EXCLUDED.bucket,
        count = CASE WHEN arcana_rate_limits.bucket = EXCLUDED.bucket
          THEN LEAST(arcana_rate_limits.count + 1, $3 + 1) ELSE 1 END,
        expires_at = EXCLUDED.expires_at
      RETURNING count, GREATEST(1, ceil(((bucket + 1) * $2 - extract(epoch FROM clock_timestamp()) * 1000) / 1000)) AS retry_after
    `, [digest, this.windowMs, this.limit]);
    const count = Number(rows[0]?.count);
    const retry = Number(rows[0]?.retry_after);
    if (!Number.isFinite(count) || !Number.isFinite(retry)) throw new Error("Invalid shared rate-limit response.");
    return { allowed: count <= this.limit, retryAfterSeconds: count <= this.limit ? 0 : Math.max(1, retry) };
  }
}
