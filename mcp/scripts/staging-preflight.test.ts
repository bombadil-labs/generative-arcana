import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
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
assert.notEqual((actualDriver.ssl as { rejectUnauthorized?: boolean }).rejectUnauthorized, false, 'certificate verification cannot be disabled');
assert.equal(new URL(connection.connectionString).searchParams.get('sslmode'), 'verify-full');
assert.deepEqual(parsePreflightArguments(['--origin', 'https://preview.example/', '--out', '/private/new.json']), { origin: 'https://preview.example', out: '/private/new.json' });
assert.deepEqual(parsePreflightArguments(['--target', 'production', '--origin', 'https://production.example/', '--out', '/private/new.json']), { origin: 'https://production.example', out: '/private/new.json', target: 'production' });
assert.equal(parsePreflightArguments(['--origin', 'https://preview.example', '--out', 'new.json', '--target', 'staging']).target, 'staging');
for (const flags of [['--target', 'unknown'], ['--target', 'production', '--target', 'staging'], ['--target', 'production', '--apply'], ['--backup-ref', 'unused']]) {
  assert.throws(() => parsePreflightArguments(['--origin', 'https://production.example', '--out', 'file', ...flags]));
}
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
assert.match(reports.join('\n'), /feature-branch Preview/);

reports.length = 0;
const productionResult = await runStagingPreflight({ target: 'production', origin: 'https://production.example', out: '/private/production.json' }, fakeSecret, {
  inspect: async (value) => { assert.equal(value, connection.connectionString); return { ...metadata, arcana_tables: 13 }; },
  plan: async (args, env) => {
    assert.deepEqual(args, ['plan', '--out', '/private/production.json'], 'production can only generate a plan');
    assert.equal(env?.BETTER_AUTH_DATABASE_URL, connection.connectionString);
    assert.equal(env?.DATABASE_URL, connection.connectionString);
    assert.equal(env?.BETTER_AUTH_URL, 'https://production.example');
    assert.equal(env?.MCP_OAUTH_RESOURCE, 'https://production.example/mcp');
    assert.equal(Object.keys(env ?? {}).length, 4);
    return 2;
  }, report: (message) => reports.push(message),
});
assert.equal(productionResult, 2, 'diagnostics preserve their non-success status');
assert.match(reports.join('\n'), /effective Production auth connection/);
assert.match(reports.join('\n'), /cannot establish which Neon project or branch/);
assert.match(reports.join('\n'), /No apply is permitted/);
assert.ok(!/Preview|staging|TEST_ONLY_PASSWORD|postgresql:\/\//.test(reports.join('\n')));
await assert.rejects(runStagingPreflight({ target: 'production', origin: 'https://production.example', out: 'unused.json' }, undefined, {
  inspect: async () => { assert.fail('missing production secret must fail before connecting'); },
  plan: async () => { assert.fail('missing production secret must never plan'); },
}));

// The CLI never falls back to a differently scoped or runtime connection.
for (const target of ['staging', 'production']) {
  const otherTarget = target === 'production' ? 'STAGING' : 'PRODUCTION';
  const cli = spawnSync(process.execPath, ['--import', 'tsx', 'scripts/staging-preflight.ts', '--target', target, '--origin', 'https://production.example', '--out', 'must-not-exist.json'], {
    cwd: fileURLToPath(new URL('../', import.meta.url)), encoding: 'utf8',
    env: { PATH: process.env.PATH, HOME: process.env.HOME, [`ARCANA_${otherTarget}_DATABASE_URL`]: 'INVALID_TEST_ONLY_CONNECTION', DATABASE_URL: 'INVALID_TEST_ONLY_RUNTIME_CONNECTION', BETTER_AUTH_DATABASE_URL: 'INVALID_TEST_ONLY_RUNTIME_CONNECTION' },
  });
  assert.equal(cli.status, 1);
  assert.match(cli.stderr, /A Neon connection is required through the local secret prompt/);
  assert.ok(!cli.stderr.includes('INVALID_TEST_ONLY'), 'driver/input details must not leak');
}

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
console.log('Staging/production preflight passed: local-secret validation, TLS Neon target, read-only transactions/planning, managed-schema rejection, cleanup, and secret-free target-specific summaries.');
