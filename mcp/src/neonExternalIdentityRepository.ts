import { randomUUID } from "node:crypto";
import { neon } from "@neondatabase/serverless";
import type { ExternalIdentity, ExternalIdentityRepository } from "./oauthIdentity";

type NeonSql = (strings: TemplateStringsArray, ...params: unknown[]) => Promise<Array<Record<string, unknown>>>;

/**
 * Durable mapping from upstream OIDC identities to stable, provider-neutral Arcana principals.
 *
 * No profile/PII is stored here. Product profile data can later key off `principal_id` without
 * coupling deck ownership to the issuer that authenticated the user.
 */
export class NeonExternalIdentityRepository implements ExternalIdentityRepository {
  private readonly sql: NeonSql;
  private ready?: Promise<void>;

  constructor(connectionString: string, sql?: NeonSql) {
    if (!connectionString.trim()) throw new Error("DATABASE_URL must be non-empty.");
    this.sql = sql ?? (neon(connectionString) as unknown as NeonSql);
  }

  async resolveOrCreate(identity: ExternalIdentity): Promise<string> {
    await this.ensureSchema();
    const issuer = requireText(identity.issuer, "issuer");
    const subject = requireText(identity.subject, "subject");
    const proposedId = `usr_${randomUUID()}`;
    const rows = await this.sql`
      INSERT INTO arcana_external_identities (issuer, subject, principal_id, created_at, updated_at)
      VALUES (${issuer}, ${subject}, ${proposedId}, now(), now())
      ON CONFLICT (issuer, subject)
      DO UPDATE SET updated_at = now()
      RETURNING principal_id
    `;
    const principalId = rows[0]?.principal_id;
    if (typeof principalId !== "string" || !principalId.trim()) {
      throw new Error("External identity upsert returned no principal id.");
    }
    return principalId;
  }

  private ensureSchema(): Promise<void> {
    this.ready ??= (async () => {
      await this.sql`
        CREATE TABLE IF NOT EXISTS arcana_external_identities (
          issuer text NOT NULL,
          subject text NOT NULL,
          principal_id text NOT NULL UNIQUE,
          created_at timestamptz NOT NULL DEFAULT now(),
          updated_at timestamptz NOT NULL DEFAULT now(),
          PRIMARY KEY (issuer, subject)
        )
      `;
      await this.sql`
        CREATE INDEX IF NOT EXISTS arcana_external_identities_principal_idx
        ON arcana_external_identities (principal_id)
      `;
    })();
    return this.ready;
  }
}

function requireText(value: string, label: string): string {
  if (typeof value !== "string" || !value.trim()) throw new Error(`${label} must be a non-empty string.`);
  return value.trim();
}
