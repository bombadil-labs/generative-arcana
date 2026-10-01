/** Explicit empty Preview-only exception. Production retains the backup-backed path. */
import type { PoolClient } from 'pg';
import { AUTH_TABLE_NAMES } from '../src/betterAuth.js';
import { assertSafeAuthSchemaPlan, type AuthSchemaPlan } from './auth-schema-plan.js';

export function disposableStagingConnection(value: string, env: NodeJS.ProcessEnv, stagingOrigin: string): string {
  // The operator explicitly identifies an isolated Preview origin. Never infer staging from
  // an absent NODE_ENV: production deployments can omit it too.
  if (!/^https:\/\/[a-z0-9-]+-git-[a-z0-9-]+\.vercel\.app$/.test(stagingOrigin) ||
      env.BETTER_AUTH_URL !== stagingOrigin || env.VERCEL_ENV !== 'preview' ||
      (env.MCP_OAUTH_RESOURCE !== undefined && env.MCP_OAUTH_RESOURCE !== `${stagingOrigin}/mcp`)) {
    throw new Error('Disposable staging requires --staging-origin matching the HTTPS branch Preview origin, BETTER_AUTH_URL and VERCEL_ENV=preview.');
  }
  const url = new URL(value);
  const keys = [...url.searchParams.keys()];
  if (!['postgres:', 'postgresql:'].includes(url.protocol) ||
      !/^(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+neon\.tech$/.test(url.hostname) ||
      url.hostname.includes('-pooler.') || !url.username || !url.password || url.pathname.length <= 1 || url.hash ||
      new Set(keys).size !== keys.length || keys.some((key) => !['sslmode', 'channel_binding', 'options'].includes(key)) ||
      !['require', 'verify-ca', 'verify-full'].includes(url.searchParams.get('sslmode') ?? '') ||
      (url.searchParams.has('options') && !/^-c\s+search_path=public$/.test(url.searchParams.get('options')!.trim()))) {
    throw new Error('Disposable staging requires the direct Neon connection with TLS and no connection overrides.');
  }
  url.port ||= '5432';
  url.searchParams.set('sslmode', 'verify-full');
  url.searchParams.set('options', '-c search_path=public');
  return url.toString();
}

export function assertDisposableStagingPlan(plan: AuthSchemaPlan): void {
  assertSafeAuthSchemaPlan(plan);
  if (plan.target.schema !== 'public') {
    throw new Error('Disposable staging requires the public application schema; managed schemas are forbidden.');
  }
  assertAdditiveAuthCreation(plan.sql);
}

export function assertAdditiveAuthCreation(sql: string): void {
  const tables = new Set<string>(Object.values(AUTH_TABLE_NAMES));
  const statements = sql.split(';').map((statement) => statement.trim()).filter(Boolean);
  if (!statements.length || statements.some((statement) => {
    const table = /^create table "([a-z_]+)" \(/i.exec(statement)?.[1];
    const index = /^create (?:unique )?index "[a-z_]+" on "([a-z_]+)" \(/i.exec(statement)?.[1];
    return !tables.has(table ?? index ?? '') || /\b(?:alter|drop|insert|truncate|grant|revoke|neon_auth)\b/i.test(statement);
  })) throw new Error('Disposable staging only permits reviewed additive Arcana auth table/index creation.');
}

/** Call inside the apply transaction. Hold locks until commit; never return row contents. */
export async function assertEmptyDisposableStaging(client: Pick<PoolClient, 'query'>): Promise<void> {
  // A forced-RLS table must fail instead of concealing rows from the emptiness check.
  await client.query('SET LOCAL row_security = off');
  const relations = await client.query<{ name: string; kind: string }>(`SELECT c.relname AS name, c.relkind AS kind
    FROM pg_catalog.pg_class c JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'public' AND left(c.relname, 7) = 'arcana_'
      AND c.relkind IN ('r', 'p', 'v', 'm', 'f') ORDER BY c.relname`);
  if (relations.rows.some(({ kind }) => kind !== 'r' && kind !== 'p')) {
    throw new Error('Disposable staging cannot verify non-table Arcana relations; use the backup-backed workflow.');
  }
  for (const { name } of relations.rows) {
    const identifier = `"public"."${name.replaceAll('"', '""')}"`;
    await client.query(`LOCK TABLE ${identifier} IN SHARE ROW EXCLUSIVE MODE`);
    const result = await client.query<{ populated: boolean }>(`SELECT EXISTS (SELECT 1 FROM ${identifier} LIMIT 1) AS populated`);
    if (result.rows[0]?.populated !== false) {
      throw new Error('Disposable staging refused: Arcana auth/catalog data exists or emptiness could not be verified. No auth schema applied.');
    }
  }
}
