import { neon } from "@neondatabase/serverless";
import type { ArcanaHostState, ArcanaHostStateRepository } from "./hostState";

type NeonSql = ReturnType<typeof neon>;

export class NeonArcanaHostStateRepository implements ArcanaHostStateRepository {
  private readonly sql: NeonSql;
  private ready?: Promise<void>;

  constructor(connectionString: string, sql?: NeonSql) {
    if (!connectionString.trim()) throw new Error("DATABASE_URL must be non-empty.");
    this.sql = sql ?? neon(connectionString);
  }

  async load(scopeId: string): Promise<unknown | null> {
    await this.ensureSchema();
    const rows = await this.sql`
      SELECT state
      FROM arcana_host_state
      WHERE scope_id = ${scopeId}
      LIMIT 1
    `;
    return rows.length ? rows[0]?.state ?? null : null;
  }

  async save(scopeId: string, state: ArcanaHostState): Promise<void> {
    await this.ensureSchema();
    const json = JSON.stringify(state);
    await this.sql`
      INSERT INTO arcana_host_state (scope_id, state, updated_at)
      VALUES (${scopeId}, ${json}::jsonb, now())
      ON CONFLICT (scope_id)
      DO UPDATE SET state = EXCLUDED.state, updated_at = now()
    `;
  }

  async delete(scopeId: string): Promise<boolean> {
    await this.ensureSchema();
    const rows = await this.sql`
      DELETE FROM arcana_host_state
      WHERE scope_id = ${scopeId}
      RETURNING scope_id
    `;
    return rows.length > 0;
  }

  private ensureSchema(): Promise<void> {
    this.ready ??= (async () => {
      await this.sql`
        CREATE TABLE IF NOT EXISTS arcana_host_state (
          scope_id text PRIMARY KEY,
          state jsonb NOT NULL,
          updated_at timestamptz NOT NULL DEFAULT now()
        )
      `;
    })();
    return this.ready;
  }
}
