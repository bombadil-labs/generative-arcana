import assert from 'node:assert/strict';
import { run, type Connection, type Entry } from '../scripts/domain-migrations';

type Migration = Entry & {sql:string};
async function preservedRows(db: Connection) {
  const tables = ['arcana_user_decks','arcana_card_artwork','arcana_visual_packs','arcana_visual_pack_artwork'];
  return Promise.all(tables.map(async table => (await db.query(`SELECT to_jsonb(t) AS row FROM ${table} t`)).rows));
}

/** Disposable PostgreSQL/PGlite only. Caller supplies an empty domain schema. */
export async function prepareVersionSixUpgrade(db: Connection, entries: Migration[]) {
  assert.equal(entries[5]?.file,'006-visual-pack-assets.sql');
  assert.equal(entries[5].sha256,'61afdfd2b6134f8b0b39de66db9be6444590ce65d1f4d6d80e9b0f5c8111d34d');
  await run(db,entries.slice(0,5),'apply');
  await db.query(`INSERT INTO arcana_user_decks(id,owner_id,slug,manifest,revision)
    VALUES ('migration-deck','migration-owner','preserved-deck','{}',17);
    INSERT INTO arcana_card_artwork(deck_id,card_slug,asset) VALUES
    ('migration-deck','first','{"deckId":"migration-deck","cardSlug":"first","mediaType":"image/webp","objectKey":"legacy-front-preserved"}');
    INSERT INTO arcana_visual_packs(deck_id,pack_id,label) VALUES ('migration-deck','named','Preserved set');
    INSERT INTO arcana_visual_pack_artwork(deck_id,pack_id,card_slug,asset) VALUES
    ('migration-deck','named','first','{"deckId":"migration-deck","packId":"named","cardSlug":"first","mediaType":"image/webp","objectKey":"named-front-preserved"}');`);
  const before = await preservedRows(db);
  const history = (await db.query('SELECT * FROM arcana_migration_history ORDER BY version')).rows;
  const plan = await run(db,entries,'plan');
  assert.equal(plan.recordedThrough,5);
  assert.deepEqual(plan.pending,[{version:6,file:entries[5].file,sha256:entries[5].sha256}]);
  assert.deepEqual((await db.query('SELECT * FROM arcana_migration_history ORDER BY version')).rows,history,'plan is read-only');

  // Execute the real 006 DDL, then deliberately fail its expected postcondition.
  // Its new table and ledger insert must roll back, without touching v5 data.
  const rejected = entries.map(e => e.version === 6 ? {...e,schema:[]} : e);
  await assert.rejects(run(db,rejected,'apply'),/Schema verification failed after 006/);
  assert.equal((await db.query("SELECT to_regclass('public.arcana_visual_pack_assets') AS relation")).rows[0].relation,null);
  assert.deepEqual((await db.query('SELECT * FROM arcana_migration_history ORDER BY version')).rows,history);
  assert.deepEqual(await preservedRows(db),before);
  assert.equal((await run(db,entries,'status')).recordedThrough,5);
  return before;
}

export async function verifyVersionSixUpgrade(db: Connection, entries: Migration[], before: Awaited<ReturnType<typeof preservedRows>>) {
  const status = await run(db,entries,'status');
  assert.equal(status.recordedThrough,6);
  assert.deepEqual(status.pending,[]);
  assert.deepEqual(await preservedRows(db),before,'front rows, JSON, object keys, packs and deck revisions preserved');
  assert.equal((await db.query('SELECT count(*)::int AS n FROM arcana_visual_pack_assets')).rows[0].n,0);
  const history = (await db.query('SELECT * FROM arcana_migration_history ORDER BY version')).rows;
  assert.deepEqual(history.map(row => row.version),[1,2,3,4,5,6]);
  assert.equal(history[5].checksum,entries[5].sha256);
  assert.equal((await run(db,entries,'apply')).recordedThrough,6);
  assert.deepEqual((await db.query('SELECT * FROM arcana_migration_history ORDER BY version')).rows,history,'second apply records nothing');
  assert.deepEqual(await preservedRows(db),before);
  console.log('Tracked v5 -> only006 -> v6 -> no-op passed; failed006 postcondition rolls back table/history and preserves fronts/revisions.');
}
