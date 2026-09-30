/** Explicit operator-only schema tooling. Never import this from the server startup path. */
import { readFile, writeFile } from 'node:fs/promises';
import { randomBytes } from 'node:crypto';
import { pathToFileURL } from 'node:url';
import { Pool, type PoolClient } from 'pg';
import { getMigrations } from 'better-auth/db/migration';
import { createArcanaBetterAuthOptions, createBetterAuthConfigurationFromEnv } from '../src/betterAuth.js';
import { assertReviewedAuthSchemaPlan, assertSafeAuthSchemaPlan, authSchemaHasChanges, buildAuthSchemaPlan } from './auth-schema-plan.js';

class OperatorInputError extends Error {}
interface Arguments { mode: 'plan' | 'check' | 'apply'; out?: string; plan?: string; expectedHost?: string; backupRef?: string }
export function parseAuthSchemaArguments(args: string[]): Arguments {
  const [mode, ...flags] = args;
  if (mode !== 'plan' && mode !== 'check' && mode !== 'apply') throw new OperatorInputError('Choose plan, check, or apply. See docs/better-auth-deployment.md.');
  const options: Arguments = { mode };
  const keys = new Map([['--out', 'out'], ['--plan', 'plan'], ['--expected-host', 'expectedHost'], ['--backup-ref', 'backupRef']] as const);
  for (let i = 0; i < flags.length; i += 2) {
    const key = keys.get(flags[i] as '--out');
    const value = flags[i + 1];
    if (!key || !value || value.startsWith('--') || /[\r\n\0]/.test(value) || options[key]) throw new OperatorInputError('Unknown, duplicated, or incomplete schema argument.');
    options[key] = value;
  }
  if (mode === 'apply' && (!options.plan || !options.expectedHost || !options.backupRef)) throw new OperatorInputError('Apply requires --plan, --expected-host, and --backup-ref after review and restore verification.');
  if (mode === 'apply' && options.out || mode !== 'apply' && (options.plan || options.expectedHost || options.backupRef) || mode === 'check' && options.out) throw new OperatorInputError('Argument does not apply to this schema operation.');
  if (options.backupRef && options.backupRef.length > 256) throw new OperatorInputError('Use a short backup reference, never credentials or backup content.');
  return options;
}

export async function runAuthSchema(args: string[], env: NodeJS.ProcessEnv = process.env): Promise<number> {
  // Validate mutation intent before touching the database or loading a plan.
  const options = parseAuthSchemaArguments(args);
  const databaseUrl = env.BETTER_AUTH_DATABASE_URL || env.DATABASE_URL;
  if (!databaseUrl) throw new OperatorInputError('BETTER_AUTH_DATABASE_URL or DATABASE_URL is required.');
  const targetURL = new URL(databaseUrl);
  if (!['postgres:', 'postgresql:'].includes(targetURL.protocol)) throw new OperatorInputError('Auth schema tooling requires PostgreSQL.');
  if (options.mode === 'apply' && targetURL.hostname !== options.expectedHost) throw new OperatorInputError('--expected-host does not match the selected database hostname.');
  const reviewed: unknown = options.plan ? JSON.parse(await readFile(options.plan, 'utf8')) : undefined;
  const { version: betterAuthVersion } = JSON.parse(await readFile(new URL('../package.json', import.meta.resolve('better-auth')), 'utf8')) as { version: string };
  // Schema generation never sends email or reads/writes encrypted user values. Its ephemeral
  // secret avoids granting the migration job production auth/SMTP credentials unnecessarily.
  const config = createBetterAuthConfigurationFromEnv({
    ...env, BETTER_AUTH_DATABASE_URL: databaseUrl,
    BETTER_AUTH_SECRET: randomBytes(48).toString('base64'), BETTER_AUTH_SECRETS: undefined,
    SMTP_HOST: 'schema-only.invalid', SMTP_FROM: 'schema-only@example.invalid',
    SMTP_PORT: '587', SMTP_SECURE: 'false', SMTP_USER: undefined, SMTP_PASSWORD: undefined,
  });
  const pool = new Pool({ connectionString: databaseUrl, max: 3, connectionTimeoutMillis: 10_000, statement_timeout: 30_000 });
  const authOptions = createArcanaBetterAuthOptions(config, { database: pool, sendEmail: async () => { throw new Error('Email is forbidden in schema tooling.'); } });
  let client: PoolClient | undefined;
  let transaction = false;
  try {
    // All cooperating apply jobs serialize before introspection. Unexpected concurrent DDL
    // fails the PostgreSQL transaction rather than partially applying a stale generated plan.
    if (options.mode === 'apply') {
      client = await pool.connect();
      await client.query('BEGIN'); transaction = true;
      await client.query("SET LOCAL lock_timeout = '5s'");
      await client.query("SET LOCAL statement_timeout = '30s'");
      await client.query('SELECT pg_advisory_xact_lock(184734902)');
    }
    const identity = await (client ?? pool).query<{ database: string; schema: string; role: string }>('SELECT current_database() AS database, current_schema() AS schema, session_user AS role');
    const metadata = identity.rows[0];
    if (!metadata?.database || !metadata.schema || !metadata.role) throw new OperatorInputError('Cannot identify exact database/schema/role.');
    const migration = await getMigrations(authOptions, { throwOnUnsafe: false });
    const live = buildAuthSchemaPlan({
      betterAuthVersion,
      target: { host: targetURL.hostname, port: targetURL.port || '5432', ...metadata },
      sql: await migration.compileMigrations(),
      unsafeChanges: migration.unsafeChanges, schemaProblems: migration.schemaProblems,
    });
    if (options.mode === 'plan') {
      const output = `${JSON.stringify(live, null, 2)}\n`;
      if (options.out) {
        await writeFile(options.out, output, { flag: 'wx', mode: 0o600 });
        console.log(`Schema plan saved. Review target, SQL, diagnostics and SHA-256 ${live.sha256}. No schema changes applied.`);
      } else console.log(output);
      return live.unsafeChanges.length || live.schemaProblems.length ? 2 : 0;
    }
    if (options.mode === 'check') {
      try { assertSafeAuthSchemaPlan(live); }
      catch (error) { throw new OperatorInputError((error as Error).message); }
      if (authSchemaHasChanges(live)) {
        console.error('Auth schema differs from installed configuration. Generate and review a plan; no changes applied.');
        return 2;
      }
      console.log('Auth schema matches the installed configuration. Read-only check; no changes applied.');
      return 0;
    }
    try { assertReviewedAuthSchemaPlan(reviewed, live); }
    catch (error) { throw new OperatorInputError((error as Error).message); }
    if (authSchemaHasChanges(live)) await client!.query(live.sql);
    await client!.query('COMMIT'); transaction = false;
    // Deliberately omit credentials, SQL/user values, and the private backup reference from output.
    console.log(`Auth schema applied transactionally. Reviewed SHA-256 ${live.sha256}; backup attestation supplied. Restart service replicas and run read-only check plus acceptance tests.`);
    return 0;
  } catch (error) {
    if (transaction) await client?.query('ROLLBACK');
    throw error;
  } finally {
    client?.release();
    await pool.end();
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try { process.exitCode = await runAuthSchema(process.argv.slice(2)); }
  catch (error) {
    // Unexpected driver/provider exceptions can contain operational data. Do not echo them to CI.
    if (error instanceof OperatorInputError) console.error(error.message);
    else console.error('Auth schema operation failed. No success is claimed; inspect the target and reviewed plan in a private operator session. No credentials or driver error detail logged.');
    process.exitCode = 1;
  }
}
