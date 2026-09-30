import assert from 'node:assert/strict';
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
  const initial = await getMigrations(authOptions, { throwOnUnsafe: false });
  const sql = await initial.compileMigrations();
  assert.ok(initial.toBeCreated.length >= Object.keys(AUTH_TABLE_NAMES).length);
  for (const table of Object.values(AUTH_TABLE_NAMES)) assert.ok(sql.includes(`"${table}"`), `Missing ${table}`);
  const live = buildAuthSchemaPlan({ ...input, sql, unsafeChanges: initial.unsafeChanges, schemaProblems: initial.schemaProblems });
  assertReviewedAuthSchemaPlan(live, live);
  const before = await db.query<{ count: number }>("SELECT count(*)::integer AS count FROM information_schema.tables WHERE table_schema='public'");
  assert.equal(before.rows[0].count, 0, 'factory and schema planning must not create tables');
  await db.exec(`BEGIN; ${sql} COMMIT;`);
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
  await db.exec(`INSERT INTO arcana_auth_user (id,name,email,"emailVerified","createdAt","updatedAt") VALUES ('existing','Existing user','schema@example.invalid',false,now(),now()); ALTER TABLE arcana_auth_user DROP COLUMN email;`);
  const unsafe = await getMigrations(authOptions, { throwOnUnsafe: false });
  assert.ok(unsafe.unsafeChanges.length, 'required-column backfill must not silently apply to populated table');
  assert.throws(() => assertSafeAuthSchemaPlan(buildAuthSchemaPlan({ ...input, sql: ';', unsafeChanges: unsafe.unsafeChanges, schemaProblems: unsafe.schemaProblems })), /manual review/);
  console.log('Real PostgreSQL/PGlite schema generation passed: 13 namespaced tables, no introspection DDL/keys/resource seeds, read-only transaction, transactional SQL, idempotency and unsafe-backfill refusal');
} finally { await db.close(); }
