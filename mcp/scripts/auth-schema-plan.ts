/** A reviewed plan is bound to one database target, code version, and exact SQL. */
import { createHash } from 'node:crypto';

export interface AuthSchemaTarget {
  host: string;
  port: string;
  database: string;
  schema: string;
  role: string;
}

export interface AuthSchemaPlan {
  format: 'arcana-better-auth-schema-v1';
  betterAuthVersion: string;
  target: AuthSchemaTarget;
  sql: string;
  unsafeChanges: string[];
  schemaProblems: string[];
  sha256: string;
}

function contents(plan: Omit<AuthSchemaPlan, 'sha256'>): string {
  // Explicit ordering keeps digests stable across JSON formatters.
  return JSON.stringify({
    format: plan.format,
    betterAuthVersion: plan.betterAuthVersion,
    target: {
      host: plan.target.host, port: plan.target.port, database: plan.target.database,
      schema: plan.target.schema, role: plan.target.role,
    },
    sql: plan.sql,
    unsafeChanges: plan.unsafeChanges,
    schemaProblems: plan.schemaProblems,
  });
}

export function buildAuthSchemaPlan(input: Omit<AuthSchemaPlan, 'format' | 'sha256'>): AuthSchemaPlan {
  const plan = { format: 'arcana-better-auth-schema-v1' as const, ...input };
  return { ...plan, sha256: createHash('sha256').update(contents(plan)).digest('hex') };
}

export function assertReviewedAuthSchemaPlan(reviewed: unknown, live: AuthSchemaPlan): void {
  if (!reviewed || typeof reviewed !== 'object') throw new Error('Invalid reviewed schema plan');
  const value = reviewed as Partial<AuthSchemaPlan>;
  if (value.format !== 'arcana-better-auth-schema-v1' || !value.target ||
      typeof value.sql !== 'string' || typeof value.betterAuthVersion !== 'string' ||
      !Array.isArray(value.unsafeChanges) || !Array.isArray(value.schemaProblems) ||
      !value.unsafeChanges.every((item) => typeof item === 'string') ||
      !value.schemaProblems.every((item) => typeof item === 'string')) {
    throw new Error('Invalid reviewed schema plan');
  }
  const recalculated = buildAuthSchemaPlan(value as Omit<AuthSchemaPlan, 'format' | 'sha256'>);
  if (value.sha256 !== recalculated.sha256) throw new Error('Reviewed schema plan checksum is invalid');
  if (value.sha256 !== live.sha256) {
    throw new Error('Schema plan changed, or database target/version differs; generate and review a new plan');
  }
  assertSafeAuthSchemaPlan(live);
}

export function assertSafeAuthSchemaPlan(plan: AuthSchemaPlan): void {
  if (plan.unsafeChanges.length || plan.schemaProblems.length) {
    throw new Error('Schema diagnostics require manual review/backfill before this plan can be applied');
  }
  // The generator has no bind values in its public compiled-SQL API. Refuse any such output.
  if (/\$\d+\b/.test(plan.sql)) throw new Error('Generated SQL contains bind parameters; use a reviewed manual migration');
}

export function authSchemaHasChanges(plan: AuthSchemaPlan): boolean {
  return plan.sql.replace(/[;\s]/g, '').length > 0;
}
