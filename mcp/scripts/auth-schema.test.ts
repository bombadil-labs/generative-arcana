import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { assertAdditiveAuthCreation, assertDisposableStagingPlan, assertEmptyDisposableStaging, disposableStagingConnection } from './disposable-staging.js';
import { parseAuthSchemaArguments, runAuthSchema } from './auth-schema.js';
import { assertReviewedAuthSchemaPlan, assertSafeAuthSchemaPlan, authSchemaHasChanges, buildAuthSchemaPlan } from './auth-schema-plan.js';

const input = {
  betterAuthVersion: 'test-version',
  target: { host: 'db.example.invalid', port: '5432', database: 'arcana', schema: 'public', role: 'migrator' },
  sql: 'create table "arcana_auth_user" ("id" text primary key);',
  unsafeChanges: [], schemaProblems: [],
};
const original = buildAuthSchemaPlan(input);
assertReviewedAuthSchemaPlan(JSON.parse(JSON.stringify(original)), original);
assert.equal(authSchemaHasChanges(original), true);
assert.equal(authSchemaHasChanges(buildAuthSchemaPlan({ ...input, sql: ';\n' })), false);
assert.throws(() => assertReviewedAuthSchemaPlan(null, original), /Invalid/);
assert.throws(() => assertReviewedAuthSchemaPlan({ ...original, sql: 'drop table example;' }, original), /checksum/);
for (const changed of [
  { ...input, betterAuthVersion: 'next-version' },
  { ...input, sql: 'create table "arcana_auth_session" ("id" text);' },
  { ...input, target: { ...input.target, host: 'other.example.invalid' } },
  { ...input, target: { ...input.target, database: 'other' } },
  { ...input, target: { ...input.target, schema: 'other' } },
  { ...input, target: { ...input.target, role: 'other' } },
]) assert.throws(() => assertReviewedAuthSchemaPlan(original, buildAuthSchemaPlan(changed)), /changed/);
for (const changed of [
  { ...input, unsafeChanges: ['backfill needed'] },
  { ...input, schemaProblems: ['wrong type'] },
]) {
  const unsafe = buildAuthSchemaPlan(changed);
  assert.throws(() => assertReviewedAuthSchemaPlan(unsafe, unsafe), /manual review/);
}
assert.throws(() => assertSafeAuthSchemaPlan(buildAuthSchemaPlan({ ...input, sql: 'select $1;' })), /bind parameters/);
console.log('Auth schema review guards passed: checksum, target/version drift, unsafe schema, empty plan');

assert.deepEqual(parseAuthSchemaArguments(['check']), { mode: 'check' });
assert.deepEqual(parseAuthSchemaArguments(['plan', '--out', '/tmp/review.json']), { mode: 'plan', out: '/tmp/review.json' });
for (const args of [[], ['apply'], ['plan', '--apply'], ['check', '--out', 'somewhere'], ['plan', '--out', 'one', '--out', 'two'], ['apply', '--plan', 'file', '--expected-host', 'host']]) {
  assert.throws(() => parseAuthSchemaArguments(args));
}
await assert.rejects(runAuthSchema(['apply', '--plan', '/unread-because-host-mismatch.json', '--expected-host', 'wrong.invalid', '--backup-ref', 'test-only'], { DATABASE_URL: 'postgresql://test:test@expected.invalid/test' }), /expected-host/);
console.log('Auth schema CLI guards passed: explicit mode, flags, backup, wrong-host rejection before connection');

const stagingOrigin = 'https://arcana-git-staging-team.vercel.app';
const stagingEnv = { BETTER_AUTH_URL: stagingOrigin, VERCEL_ENV: 'preview' };
const stagingURL = 'postgresql://migrator:test-only@ep-test.us-east-1.aws.neon.tech/arcana?sslmode=require';
const disposableArgs = ['apply', '--plan', 'private.json', '--expected-host', 'ep-test.us-east-1.aws.neon.tech', '--disposable-staging', '--staging-origin', stagingOrigin];
assert.equal(parseAuthSchemaArguments(disposableArgs).disposableStaging, true);
assert.equal(parseAuthSchemaArguments(['apply', '--disposable-staging', ...disposableArgs.slice(1, 5), '--staging-origin', stagingOrigin]).disposableStaging, true);
for (const args of [
  [...disposableArgs, '--backup-ref', 'fake'], [...disposableArgs, '--disposable-staging'],
  disposableArgs.slice(0, -2), ['check', '--disposable-staging', '--staging-origin', stagingOrigin],
  ['apply', '--plan', 'p', '--expected-host', 'h', '--staging-origin', stagingOrigin, '--backup-ref', 'b'],
]) assert.throws(() => parseAuthSchemaArguments(args));
const safeConnection = new URL(disposableStagingConnection(stagingURL, stagingEnv, stagingOrigin));
assert.equal(safeConnection.searchParams.get('sslmode'), 'verify-full');
assert.equal(safeConnection.port, '5432');
assert.equal(safeConnection.searchParams.get('options'), '-c search_path=public');
for (const env of [
  { ...stagingEnv, VERCEL_ENV: 'production' }, { BETTER_AUTH_URL: stagingOrigin },
  { ...stagingEnv, BETTER_AUTH_URL: 'https://generative-arcana.vercel.app' },
  { ...stagingEnv, MCP_OAUTH_RESOURCE: 'https://elsewhere.invalid/mcp' },
]) assert.throws(() => disposableStagingConnection(stagingURL, env, stagingOrigin), /Preview/);
assert.throws(() => disposableStagingConnection(stagingURL, { BETTER_AUTH_URL: 'https://generative-arcana.vercel.app', VERCEL_ENV: 'preview' }, 'https://generative-arcana.vercel.app'), /Preview/);
for (const url of [
  stagingURL.replace('ep-test.', 'ep-test-pooler.'), stagingURL.replace('sslmode=require', 'sslmode=disable'),
  `${stagingURL}&host=other.neon.tech`, `${stagingURL}&sslmode=require`,
  `${stagingURL}&options=-c%20search_path=neon_auth`, stagingURL.replace('migrator:test-only@', ''),
]) assert.throws(() => disposableStagingConnection(url, stagingEnv, stagingOrigin), /direct Neon/);
for (const sql of [
  'drop table "arcana_auth_user";', 'alter table "arcana_auth_user" add column x text;',
  'create table "other" (id text);', 'create table neon_auth."arcana_auth_user" (id text);',
  'create table "arcana_auth_user" (id text); insert into "arcana_auth_user" values (1);',
  'create index "x" on "arcana_user_decks" (id);', '',
]) assert.throws(() => assertAdditiveAuthCreation(sql), /additive/);
assertDisposableStagingPlan(original);
assert.throws(() => assertDisposableStagingPlan(buildAuthSchemaPlan({ ...input, target: { ...input.target, schema: 'neon_auth' } })), /managed schemas/);
console.log('Disposable staging CLI guards passed: explicit origin, no fake backup, production/pooler/override refusal, public-only additive auth SQL');


// Real PostgreSQL engine, embedded and disposable: validate generated SQL without a live service.
const { PGlite } = await import('@electric-sql/pglite');
const { PostgresDialect } = await import('kysely');
const { getMigrations } = await import('better-auth/db/migration');
const { createArcanaBetterAuthOptions, AUTH_TABLE_NAMES } = await import('../src/betterAuth.js');
const db = await PGlite.create();
let queue = Promise.resolve();
const dialect = new PostgresDialect({ pool: {
  async connect() {
    let unlock!: () => void;
    const previous = queue;
    queue = new Promise<void>((resolve) => { unlock = resolve; });
    await previous;
    return {
      async query(sql: string, values: readonly unknown[] = []) {
        const result = await db.query(sql, [...values]);
        return { ...result, rowCount: result.affectedRows ?? result.rows.length };
      }, release() { unlock(); },
    };
  }, async end() {},
} as unknown as import('kysely').PostgresPool });
const authOptions = createArcanaBetterAuthOptions({ baseURL: 'https://schema-test.invalid', resource: 'https://schema-test.invalid/mcp', secret: 'schema-test-only-not-a-production-secret-0123456789' }, {
  database: { dialect, type: 'postgres' }, sendEmail: async () => { throw new Error('Schema test must not send email'); },
});
try {
  // A provider-managed auth schema may coexist in the database. Arcana must leave it alone.
  await db.exec('CREATE SCHEMA neon_auth; CREATE TABLE neon_auth."user" (id text primary key, marker text not null); INSERT INTO neon_auth."user" VALUES (\'managed-sentinel\', \'untouched\');');
  const initial = await getMigrations(authOptions, { throwOnUnsafe: false });
  const sql = await initial.compileMigrations();
  assert.ok(initial.toBeCreated.length >= Object.keys(AUTH_TABLE_NAMES).length);
  for (const table of Object.values(AUTH_TABLE_NAMES)) assert.ok(sql.includes(`"${table}"`), `Missing ${table}`);
  assert.ok(Object.values(AUTH_TABLE_NAMES).every((table) => table.startsWith('arcana_auth_')));
  assert.ok(!sql.includes('neon_auth'), 'generated Arcana schema must not target managed auth');
  const live = buildAuthSchemaPlan({ ...input, sql, unsafeChanges: initial.unsafeChanges, schemaProblems: initial.schemaProblems });
  assertReviewedAuthSchemaPlan(live, live);
  assertDisposableStagingPlan(live);
  const before = await db.query<{ count: number }>("SELECT count(*)::integer AS count FROM information_schema.tables WHERE table_schema='public'");
  assert.equal(before.rows[0].count, 0, 'factory and schema planning must not create tables');
  const client = db as unknown as Pick<import('pg').PoolClient, 'query'>;
  await db.exec('BEGIN');
  await assertEmptyDisposableStaging(client);
  await db.exec(await readFile(new URL('../migrations/001-domain.sql', import.meta.url), 'utf8'));
  await assertEmptyDisposableStaging(client); // Empty domain tables may already exist.
  await db.exec('COMMIT');
  await db.exec("BEGIN; INSERT INTO arcana_host_state VALUES ('sentinel', '{}', now());");
  await assert.rejects(assertEmptyDisposableStaging(client), /data exists/);
  await db.exec('ROLLBACK');
  await db.exec('BEGIN; CREATE VIEW arcana_unverifiable AS SELECT 1 AS id;');
  await assert.rejects(assertEmptyDisposableStaging(client), /non-table/);
  await db.exec('ROLLBACK');
  await db.exec(`BEGIN; ${sql} COMMIT;`);
  await db.exec('BEGIN');
  await assertEmptyDisposableStaging(client);
  await db.exec('COMMIT');
  assert.equal((await db.query<{ count: number }>('SELECT count(*)::integer AS count FROM arcana_auth_oauth_resource')).rows[0].count, 0, 'schema creation must not seed runtime data');
  await db.exec('BEGIN READ ONLY');
  const inspectOnly = createArcanaBetterAuthOptions({ baseURL: 'https://schema-test.invalid', resource: 'https://schema-test.invalid/mcp', secret: 'schema-test-only-not-a-production-secret-0123456789' }, {
    database: { dialect, type: 'postgres' }, sendEmail: async () => { throw new Error('Read-only inspection must not send email'); },
  });
  const readOnlyPlan = await getMigrations(inspectOnly, { throwOnUnsafe: false });
  await readOnlyPlan.compileMigrations();
  await db.exec('COMMIT');
  assert.equal((await db.query<{ count: number }>('SELECT count(*)::integer AS count FROM arcana_auth_oauth_resource')).rows[0].count, 0, 'fresh options-only introspection must not initialize runtime or seed resources');
  const after = await getMigrations(authOptions, { throwOnUnsafe: false });
  const stable = buildAuthSchemaPlan({ ...input, sql: await after.compileMigrations(), unsafeChanges: after.unsafeChanges, schemaProblems: after.schemaProblems });
  assertSafeAuthSchemaPlan(stable);
  assert.equal(authSchemaHasChanges(stable), false, 'freshly applied generated SQL should be idempotent');
  assert.throws(() => assertReviewedAuthSchemaPlan(live, stable), /changed/, 'previous plan cannot reapply against changed schema');
  assert.equal((await db.query<{ count: number }>('SELECT count(*)::integer AS count FROM arcana_auth_jwks')).rows[0].count, 0, 'schema operations must not create private keys');
  assert.deepEqual((await db.query('SELECT id, marker FROM neon_auth."user"')).rows, [{ id: 'managed-sentinel', marker: 'untouched' }], 'planning and applying Arcana auth SQL must preserve managed auth data');
  assert.deepEqual((await db.query<{ table_name: string }>("SELECT table_name FROM information_schema.tables WHERE table_schema='neon_auth' ORDER BY table_name")).rows, [{ table_name: 'user' }], 'Arcana must not add tables to the managed schema');
  await db.exec(`INSERT INTO arcana_auth_user (id,name,email,"emailVerified","createdAt","updatedAt") VALUES ('existing','Existing user','schema@example.invalid',false,now(),now()); ALTER TABLE arcana_auth_user DROP COLUMN email;`);
  await db.exec('BEGIN');
  await assert.rejects(assertEmptyDisposableStaging(client), /data exists/);
  await db.exec('ROLLBACK');
  const unsafe = await getMigrations(authOptions, { throwOnUnsafe: false });
  assert.ok(unsafe.unsafeChanges.length, 'required-column backfill must not silently apply to populated table');
  assert.throws(() => assertSafeAuthSchemaPlan(buildAuthSchemaPlan({ ...input, sql: ';', unsafeChanges: unsafe.unsafeChanges, schemaProblems: unsafe.schemaProblems })), /manual review/);
  console.log('Real PostgreSQL/PGlite schema generation passed: 13 namespaced tables, managed-auth schema preserved, no introspection DDL/keys/resource seeds, read-only transaction, transactional SQL, idempotency and unsafe-backfill refusal');
} finally { await db.close(); }
