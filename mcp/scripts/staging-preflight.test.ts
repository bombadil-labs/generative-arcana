import assert from 'node:assert/strict';
import { Client } from 'pg';
import { inspectStagingTarget, parsePreflightArguments, readOnlyNeonConnection, runStagingPreflight, type TargetMetadata } from './staging-preflight.js';

const fakeSecret = 'postgresql://migrator:TEST_ONLY_PASSWORD@ep-test.neon.tech/arcana?sslmode=require&options=-c%20search_path%3Dpublic';
const connection = readOnlyNeonConnection(fakeSecret);
assert.equal(connection.host, 'ep-test.neon.tech');
assert.equal(new URL(connection.connectionString).searchParams.get('options'), '-c search_path=public -c default_transaction_read_only=on');
for (const value of [undefined, '', 'not a url', 'https://example.com', fakeSecret.replace('neon.tech', 'example.com'), fakeSecret.replace('sslmode=require', 'sslmode=disable'), `${fakeSecret}\n`]) assert.throws(() => readOnlyNeonConnection(value));
for (const suffix of ['&host=attacker.invalid', '&user=other', '&database=other', '&sslmode=disable', '&ssl=false', '&sslrootcert=/private/file', '&options=-c%20default_transaction_read_only%3Doff']) assert.throws(() => readOnlyNeonConnection(fakeSecret + suffix));
assert.throws(() => readOnlyNeonConnection(fakeSecret.replace('search_path%3Dpublic', 'session_preload_libraries%3Dunexpected')));
assert.throws(() => readOnlyNeonConnection(fakeSecret.replace('ep-test.neon.tech', 'ep-test-pooler.neon.tech')), /unpooled/);
assert.throws(() => readOnlyNeonConnection(fakeSecret.replace('ep-test.neon.tech', 'ep-test-POOLER.neon.tech')), /unpooled/);
for (const host of ['%2Ftmp%2F.neon.tech', 'ep-test-pooler%2Eus-east-2.aws.neon.tech', 'ep_test.neon.tech']) assert.throws(() => readOnlyNeonConnection(fakeSecret.replace('ep-test.neon.tech', host)), /literal Neon DNS/);
assert.equal(readOnlyNeonConnection(fakeSecret.replace('ep-test.neon.tech', 'EP-TEST.NEON.TECH')).host, 'ep-test.neon.tech');
assert.throws(() => readOnlyNeonConnection(fakeSecret.replace('/arcana?', '/?')), /database/);
assert.throws(() => readOnlyNeonConnection(fakeSecret.replace('/arcana?', '?')), /database/);
const pgClient = new Client({ connectionString: connection.connectionString });
const actualDriver = (pgClient as unknown as { connectionParameters: { host: string; port: number; database: string; options: string; ssl: unknown } }).connectionParameters;
assert.equal(actualDriver.host, 'ep-test.neon.tech', 'validate the same host node-postgres will use');
assert.equal(actualDriver.options, '-c search_path=public -c default_transaction_read_only=on');
assert.equal(actualDriver.port, 5432);
assert.equal(actualDriver.database, 'arcana');
assert.notEqual(actualDriver.ssl, false, 'TLS remains enabled in the actual driver configuration');
assert.deepEqual(parsePreflightArguments(['--origin', 'https://preview.example/', '--out', '/private/new.json']), { origin: 'https://preview.example', out: '/private/new.json' });
for (const args of [[], ['--apply'], ['--origin', 'http://preview.example', '--out', 'file'], ['--origin', 'https://secret@example.com', '--out', 'file'], ['--origin', 'https://preview.example/path', '--out', 'file'], ['--origin', 'https://preview.example', '--out', 'file', '--out', 'other']]) assert.throws(() => parsePreflightArguments(args));

const metadata = { database: 'arcana', schema: 'public', role: 'migrator', read_only: 'on', default_read_only: 'on', managed_auth_present: true, arcana_tables: 0 };
const calls: string[] = [];
const makePool = (target = metadata) => () => ({
  async connect() { return { async query(sql: string) { calls.push(sql); return { rows: [target] }; }, release() { calls.push('release'); } }; },
  async end() { calls.push('end'); },
});
assert.deepEqual(await inspectStagingTarget(connection.connectionString, makePool()), metadata);
assert.equal(calls[0], 'BEGIN READ ONLY');
assert.deepEqual(calls.slice(-3), ['ROLLBACK', 'release', 'end']);
assert.equal(calls.filter((sql) => /^(INSERT|UPDATE|DELETE|CREATE|ALTER|DROP)\b/i.test(sql)).length, 0);
for (const target of [{ ...metadata, schema: 'neon_auth' }, { ...metadata, schema: 'other' }, { ...metadata, read_only: 'off' }, { ...metadata, default_read_only: 'off' }]) {
  calls.length = 0;
  await assert.rejects(inspectStagingTarget(connection.connectionString, makePool(target)));
  assert.deepEqual(calls.slice(-3), ['ROLLBACK', 'release', 'end']);
}

const reports: string[] = [];
let planned = false;
const result = await runStagingPreflight({ origin: 'https://preview.example', out: '/private/new.json' }, fakeSecret, {
  inspect: async (value) => { assert.equal(value, connection.connectionString); return metadata; },
  plan: async (args, env) => {
    planned = true;
    assert.deepEqual(args, ['plan', '--out', '/private/new.json']);
    assert.equal(env?.BETTER_AUTH_DATABASE_URL, connection.connectionString);
    assert.equal(env?.DATABASE_URL, connection.connectionString);
    assert.equal(env?.BETTER_AUTH_URL, 'https://preview.example');
    assert.equal(env?.MCP_OAUTH_RESOURCE, 'https://preview.example/mcp');
    assert.equal(Object.keys(env ?? {}).length, 4, 'do not inherit unrelated provider/auth/mail secrets');
    return 0;
  }, report: (message) => reports.push(message),
});
assert.equal(result, 0);
assert.equal(planned, true);
assert.ok(reports.join('\n').includes('ep-test.neon.tech'));
assert.ok(!reports.join('\n').includes('TEST_ONLY_PASSWORD'));
assert.ok(!reports.join('\n').includes('postgresql://'));
assert.ok(!reports.join('\n').includes('options='));

// Exercise the actual PostgreSQL inspection and read-only checks without a live database.
const { PGlite } = await import('@electric-sql/pglite');
const db = await PGlite.create();
try {
  await db.exec('SET default_transaction_read_only=on');
  const target = await inspectStagingTarget(connection.connectionString, () => ({
    async connect() { return { query: (sql: string) => db.query<TargetMetadata>(sql), release() {} }; },
    async end() {},
  }));
  assert.equal(target.default_read_only, 'on');
  assert.equal(target.read_only, 'on');
  assert.equal(target.schema, 'public');
  assert.equal(target.arcana_tables, 0);
  await assert.rejects(db.exec('CREATE TABLE must_not_be_created (id text)'), /read.only/i);
} finally { await db.close(); }
console.log('Staging preflight passed: local-secret validation, TLS Neon target, read-only transactions/planning, managed-schema rejection, cleanup, and secret-free summaries.');
