import assert from 'node:assert/strict';
import { Pool } from 'pg';
import { catalog, run, schema } from '../scripts/domain-migrations';
import { prepareVersionSixUpgrade, verifyVersionSixUpgrade } from './migration-six-fixture';
// This executable is only for the disposable service declared in migration CI.
// No inherited migration/runtime connection string is accepted.
if (process.env.GITHUB_ACTIONS !== 'true' || process.env.ARCANA_DISPOSABLE_POSTGRES !== '1') throw new Error('CI disposable PostgreSQL service required');
const pool = new Pool({host:'127.0.0.1',port:5432,database:'arcana_migration_ci',user:'arcana_ci',password:'disposable-ci-only',max:3});
const entries = await catalog();
const a = await pool.connect();
const b = await pool.connect();
try {
  assert.deepEqual(await schema(a),[], 'CI database must be empty');
  const before = await prepareVersionSixUpgrade(a,entries);
  await Promise.all([run(a,entries,'apply'),run(b,entries,'apply')]);
  await verifyVersionSixUpgrade(a,entries,before);
  assert.equal((await a.query('SELECT count(*)::int AS n FROM arcana_migration_history')).rows[0].n,entries.length);
  assert.equal((await run(a,entries,'status')).pending.length,0);
  await a.query('BEGIN');
  await a.query('SELECT pg_advisory_xact_lock(184734901)');
  await assert.rejects(run(b,entries,'apply'), /lock timeout/);
  await a.query('ROLLBACK');
  assert.equal((await run(b,entries,'status')).pending.length,0);
  console.log('PostgreSQL concurrent apply, bounded lock contention and retry passed.');
} finally { a.release(); b.release(); await pool.end(); }
