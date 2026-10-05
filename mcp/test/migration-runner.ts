import assert from 'node:assert/strict';
import { PGlite } from '@electric-sql/pglite';
import { catalog, run, schema, target, type Connection } from '../scripts/domain-migrations';
import { prepareVersionSixUpgrade, verifyVersionSixUpgrade } from './migration-six-fixture';
const entries = await catalog();
const flags = {target:'test','expected-host':'localhost','expected-database':'arcana','expected-user':'migration'};
const url = 'postgresql://migration:secret@localhost/arcana';
assert.throws(() => target({DATABASE_URL:url}, flags), /Dedicated/);
for (const key of ['expected-host','expected-database','expected-user']) assert.throws(() => target({DATABASE_MIGRATION_URL:url}, {...flags,[key]:'wrong'}), /target/);
assert.throws(() => target({DATABASE_MIGRATION_URL:url+'?host=evil'}, flags), /parameters/);
assert.throws(() => target({DATABASE_MIGRATION_URL:url+'?sslmode=require&channel_binding=require'}, flags), /channel_binding=require cannot be enforced/);
assert.throws(() => target({DATABASE_MIGRATION_URL:url+'?channel_binding=prefer&channel_binding=require'}, flags), /channel_binding=require cannot be enforced/);
assert.throws(() => target({DATABASE_MIGRATION_URL:url+'?channel_binding=disable'}, flags), /parameters/);
assert.throws(() => target({DATABASE_MIGRATION_URL:url}, {...flags,target:''}), /Explicit/);
assert.equal(target({DATABASE_MIGRATION_URL:url}, flags),url);
async function fixture(test: (db: Connection) => Promise<void>) {
  const db = new PGlite();
  const adapter: Connection = {query: async (sql, values) => {
    if (values) return db.query(sql, values);
    const results = await db.exec(sql);
    return {rows:results.at(-1)?.rows ?? []};
  }};
  try { await test(adapter); } finally { await db.close(); }
}
await fixture(async db => {
  await db.query('CREATE TABLE arcana_auth_user (id text PRIMARY KEY); INSERT INTO arcana_auth_user VALUES (\'untouched\')');
  assert.equal((await run(db, entries, 'plan')).pending.length,entries.length);
  assert.equal((await db.query("SELECT to_regclass('public.arcana_migration_history') AS ledger")).rows[0].ledger,null);
  await run(db, entries,'apply');
  assert.deepEqual(await schema(db),entries.at(-1)!.schema);
  await run(db,entries,'apply');
  assert.equal((await db.query('SELECT id FROM arcana_auth_user')).rows[0].id,'untouched');
  assert.equal((await db.query('SELECT count(*)::int AS n FROM arcana_migration_history')).rows[0].n,entries.length);
  await db.query("UPDATE arcana_migration_history SET checksum='bad' WHERE version=1");
  await assert.rejects(run(db, entries,'apply'), /checksum/);
});
await fixture(async db => {
  await run(db,entries.slice(0,2),'apply');
  assert.equal((await run(db,entries,'plan')).pending.length,entries.length-2);
  await run(db,entries,'apply');
});
await fixture(async db => {
  for (const e of entries.slice(0,3)) await db.query(e.sql);
  await db.query("INSERT INTO arcana_host_state VALUES ('preserved','{}',now())");
  assert.equal((await run(db,entries,'plan')).verifiedBaselineCandidate,3);
  await assert.rejects(run(db,entries,'apply'), /baseline/);
  await assert.rejects(run(db,entries,'baseline',2), /mismatch/);
  await run(db,entries,'baseline',3);
  await run(db,entries,'apply');
  assert.equal((await db.query('SELECT scope_id FROM arcana_host_state')).rows[0].scope_id,'preserved');
  assert.equal((await db.query("SELECT count(*)::int AS n FROM arcana_migration_history WHERE operation='baseline'")).rows[0].n,3);
});
await fixture(async db => {
  await db.query(entries[0].sql);
  await db.query('ALTER TABLE arcana_host_state ALTER COLUMN state DROP NOT NULL');
  await assert.rejects(run(db,entries,'baseline',1), /mismatch/);
});
await fixture(async db => {
  for (const e of [entries[0],entries[1],entries[3]]) await db.query(e.sql);
  assert.equal((await run(db,entries,'plan')).verifiedBaselineCandidate,null);
  await assert.rejects(run(db,entries,'baseline',4), /mismatch/);
});
await fixture(async db => {
  const broken = entries.map(e => ({...e}));
  broken[2].sql += '; SELECT definitely_missing_function()';
  await assert.rejects(run(db,broken,'apply'));
  assert.deepEqual(await schema(db),[]);
  assert.equal((await db.query("SELECT to_regclass('public.arcana_migration_history') AS ledger")).rows[0].ledger,null);
});
await fixture(async db => {
  await run(db,entries,'apply');
  await db.query('DROP INDEX arcana_rate_limits_expiry_idx');
  await assert.rejects(run(db,entries,'apply'), /drift/);
});
console.log('Migration safety tests passed: clean, partial, baseline, drift, checksums, target, credentials, rollback, idempotence.');
await fixture(async db => {
  const before = await prepareVersionSixUpgrade(db,entries);
  await run(db,entries,'apply');
  await verifyVersionSixUpgrade(db,entries,before);
});
