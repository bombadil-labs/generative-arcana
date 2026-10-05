import { createHash } from 'node:crypto';
import { readFile, readdir } from 'node:fs/promises';

export class MigrationSafetyError extends Error {}
export interface Connection { query(sql: string, values?: any[]): Promise<{ rows: any[] }> }
export interface Entry { version: number; file: string; sha256: string; schema: unknown[] }
export const directory = new URL('../migrations/', import.meta.url);
export const digest = (value: string) => createHash('sha256').update(value).digest('hex');

// Conservative adoption: unexpected domain objects require operator review.
export async function schema(db: Connection): Promise<unknown[]> {
  return (await db.query(`SELECT c.relname AS name, c.relkind AS kind,
    c.relrowsecurity AS rls, c.relforcerowsecurity AS force_rls,
    (SELECT jsonb_agg(jsonb_build_array(a.attname, format_type(a.atttypid,a.atttypmod),
      a.attnotnull, pg_get_expr(d.adbin,d.adrelid), a.attidentity, a.attgenerated) ORDER BY a.attnum)
     FROM pg_attribute a LEFT JOIN pg_attrdef d ON d.adrelid=a.attrelid AND d.adnum=a.attnum
     WHERE a.attrelid=c.oid AND a.attnum>0 AND NOT a.attisdropped) AS columns,
    (SELECT jsonb_agg(jsonb_build_array(k.conname,pg_get_constraintdef(k.oid),k.convalidated) ORDER BY k.conname)
     FROM pg_constraint k WHERE k.conrelid=c.oid AND k.contype <> 'n') AS constraints,
    (SELECT jsonb_agg(jsonb_build_array(i.relname,pg_get_indexdef(i.oid),x.indisvalid) ORDER BY i.relname)
     FROM pg_index x JOIN pg_class i ON i.oid=x.indexrelid WHERE x.indrelid=c.oid) AS indexes,
    (SELECT jsonb_agg(pg_get_triggerdef(t.oid) ORDER BY t.tgname)
     FROM pg_trigger t WHERE t.tgrelid=c.oid AND NOT t.tgisinternal) AS triggers,
    (SELECT jsonb_agg(p.polname ORDER BY p.polname) FROM pg_policy p WHERE p.polrelid=c.oid) AS policies
    FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
    WHERE n.nspname='public' AND left(c.relname,7)='arcana_' AND left(c.relname,12) <> 'arcana_auth_'
      AND c.relname <> 'arcana_migration_history' AND c.relkind IN ('r','p','v','m','f')
    ORDER BY c.relname`)).rows;
}
export async function catalog(): Promise<(Entry & { sql: string })[]> {
  const entries: Entry[] = JSON.parse(await readFile(new URL('catalog.json', directory), 'utf8'));
  const files = (await readdir(directory)).filter(f => /^\d+.*\.sql$/.test(f)).sort();
  if (JSON.stringify(files) !== JSON.stringify(entries.map(e => e.file))) throw new MigrationSafetyError('Unregistered or missing migration file');
  return Promise.all(entries.map(async (e, i) => {
    if (e.version !== i + 1) throw new MigrationSafetyError('Catalog versions must be contiguous');
    const sql = await readFile(new URL(e.file, directory), 'utf8');
    if (digest(sql) !== e.sha256) throw new MigrationSafetyError(`Immutable migration checksum mismatch: ${e.file}`);
    return { ...e, sql };
  }));
}
export function target(env: NodeJS.ProcessEnv, flags: Record<string,string>) {
  if (!env.DATABASE_MIGRATION_URL) throw new MigrationSafetyError('Dedicated DATABASE_MIGRATION_URL required; DATABASE_URL is never used');
  let url: URL;
  try { url = new URL(env.DATABASE_MIGRATION_URL); } catch { throw new MigrationSafetyError('Invalid migration URL'); }
  // pg 8.23.1 only prefers SCRAM-SHA-256-PLUS with enableChannelBinding;
  // it can fall back to SCRAM-SHA-256 and does not enforce the URI's require.
  // Never silently strip the parameter or treat preference as enforcement.
  if (url.searchParams.getAll('channel_binding').includes('require')) throw new MigrationSafetyError('channel_binding=require cannot be enforced by the installed pg driver public API. No connection attempted. Review tested driver support; do not remove the requirement.');
  if (!['postgres:', 'postgresql:'].includes(url.protocol) || [...url.searchParams.keys()].some(k => k !== 'sslmode') || url.hash) throw new MigrationSafetyError('Unsupported migration connection parameters');
  if (!['preview','production','test'].includes(flags.target)) throw new MigrationSafetyError('Explicit --target preview|production|test required');
  if (!flags['expected-host'] || url.hostname !== flags['expected-host'] ||
      !flags['expected-database'] || decodeURIComponent(url.pathname.slice(1)) !== flags['expected-database'] ||
      !flags['expected-user'] || decodeURIComponent(url.username) !== flags['expected-user'] ||
      (url.port || '5432') !== (flags['expected-port'] || '5432')) throw new MigrationSafetyError('Migration target does not match reviewed host/database/user/port');
  if (url.hostname.includes('-pooler.')) throw new MigrationSafetyError('Use a direct migration connection, not a pooler');
  return env.DATABASE_MIGRATION_URL;
}
export async function run(db: Connection, entries: (Entry & {sql:string})[], command: string, baseline?: number) {
  if (!['plan','status','apply','baseline'].includes(command)) throw new MigrationSafetyError('Expected plan, status, apply or baseline');
  const write = command === 'apply' || command === 'baseline';
  await db.query(write ? 'BEGIN' : 'BEGIN READ ONLY');
  try {
    await db.query('SET LOCAL search_path = public, pg_catalog');
    await db.query("SET LOCAL lock_timeout = '5s'");
    await db.query("SET LOCAL statement_timeout = '30s'");
    // Shared with retired runner, acquired before inspecting any history.
    await db.query('SELECT pg_advisory_xact_lock(184734901)');
    const exists = (await db.query("SELECT to_regclass('public.arcana_migration_history') IS NOT NULL AS present")).rows[0].present;
    const history = exists ? (await db.query('SELECT version, checksum, file, operation FROM public.arcana_migration_history ORDER BY version')).rows : [];
    for (let i = 0; i < history.length; i++) {
      if (history[i].version !== i + 1 || history[i].checksum !== entries[i]?.sha256 || history[i].file !== entries[i]?.file || !['apply','baseline'].includes(history[i].operation)) throw new MigrationSafetyError('Migration history gap, unknown version or checksum mismatch');
    }
    const actual = await schema(db);
    const equal = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);
    let through = history.length;
    if (command === 'baseline') {
      if (exists || !baseline || !entries[baseline - 1]) throw new MigrationSafetyError('Baseline requires no ledger and a valid explicit --through version');
      if (!equal(actual, entries[baseline - 1].schema)) throw new MigrationSafetyError('Baseline schema mismatch; no history recorded');
      through = baseline;
    } else if (!exists && actual.length && !write) {
      const candidate = entries.find(e => equal(actual, e.schema))?.version ?? null;
      await db.query('COMMIT');
      return {command, recordedThrough:0, baselineRequired:true, verifiedBaselineCandidate:candidate, pending:[]};
    } else if (!equal(actual, through ? entries[through - 1].schema : [])) {
      throw new MigrationSafetyError(through ? 'Schema drift from recorded migration state' : 'Untracked domain schema: verified baseline required');
    }
    const pending = entries.slice(through).map(e => ({version:e.version,file:e.file,sha256:e.sha256}));
    if (write) {
      await db.query(`CREATE TABLE IF NOT EXISTS public.arcana_migration_history (
        version integer PRIMARY KEY, checksum text NOT NULL, file text NOT NULL,
        operation text NOT NULL CHECK (operation IN ('apply','baseline')),
        recorded_at timestamptz NOT NULL DEFAULT now(), recorded_by text NOT NULL DEFAULT current_user)`);
      const work = command === 'baseline' ? entries.slice(0, through) : entries.slice(through);
      for (const entry of work) {
        if (command === 'apply') {
          await db.query(entry.sql);
          if (!equal(await schema(db), entry.schema)) throw new MigrationSafetyError(`Schema verification failed after ${entry.file}`);
        }
        await db.query('INSERT INTO public.arcana_migration_history(version,checksum,file,operation) VALUES ($1,$2,$3,$4)', [entry.version,entry.sha256,entry.file,command]);
      }
    }
    await db.query('COMMIT');
    return {command, recordedThrough: command === 'apply' ? entries.length : through, pending: command === 'apply' ? [] : pending};
  } catch (error) { await db.query('ROLLBACK'); throw error; }
}
