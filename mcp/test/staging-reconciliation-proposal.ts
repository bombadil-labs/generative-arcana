// Proposal verification ONLY: all databases are new, in-memory PGlite instances.
// No connection URI, environment secret, CLI deployment or production adapter.
import assert from 'node:assert/strict';
import { PGlite } from '@electric-sql/pglite';
import { catalog, run, schema, type Connection } from '../scripts/domain-migrations';
const entries=await catalog();
const profile=structuredClone(entries[3].schema) as any[];
profile.splice(profile.findIndex(t=>t.name==='arcana_card_artwork'),1);
const artwork=profile.find(t=>t.name==='arcana_visual_pack_artwork');
artwork.constraints.find((c:any[])=>c[0]==='arcana_visual_pack_artwork_asset_check')[1]="CHECK (((asset ->> 'mediaType'::text) = 'image/webp'::text))";
const compliance="SELECT count(*)::text AS noncompliant_count FROM public.arcana_visual_pack_artwork WHERE ((asset->>'mediaType') IS NOT NULL AND (asset->>'mediaType')='image/webp') IS NOT TRUE";
const tighten=`ALTER TABLE public.arcana_visual_pack_artwork
  DROP CONSTRAINT arcana_visual_pack_artwork_asset_check,
  ADD CONSTRAINT arcana_visual_pack_artwork_asset_check
    CHECK (asset->>'mediaType' IS NOT NULL AND asset->>'mediaType'='image/webp')`;
async function fixture(test:(db:Connection)=>Promise<void>) {
  const pg=new PGlite();
  const db:Connection={query:async(sql,values)=>values?pg.query(sql,values):({rows:(await pg.exec(sql)).at(-1)?.rows??[]})};
  try {
    for(const e of [entries[0],entries[2],entries[3]]) await db.query(e.sql);
    await db.query(`ALTER TABLE arcana_visual_pack_artwork DROP CONSTRAINT arcana_visual_pack_artwork_asset_check,
      ADD CONSTRAINT arcana_visual_pack_artwork_asset_check CHECK (asset->>'mediaType'='image/webp')`);
    await db.query(`INSERT INTO arcana_user_decks(id,owner_id,slug,manifest,revision) VALUES ('test','owner','test','{}',17);
      INSERT INTO arcana_visual_packs(deck_id,pack_id,label) VALUES ('test','named','Fixture');
      INSERT INTO arcana_visual_pack_artwork(deck_id,pack_id,card_slug,asset) VALUES
      ('test','named','front','{"deckId":"test","packId":"named","cardSlug":"front","mediaType":"image/webp","objectKey":"preserve"}')`);
    assert.deepEqual(await schema(db),profile);
    await test(db);
  } finally {await pg.close();}
}
async function data(db:Connection) {
  return Promise.all(['arcana_user_decks','arcana_visual_packs','arcana_visual_pack_artwork'].map(async t=>(await db.query(`SELECT to_jsonb(t) AS row FROM ${t} t ORDER BY to_jsonb(t)::text`)).rows));
}
// Test-only simulation of the proposed one-time repair. Not exported or wired to CLI.
async function simulateRepair(db:Connection,failAfterDDL=false) {
  await db.query('BEGIN');
  try {
    await db.query("SET LOCAL lock_timeout='5s'");
    await db.query("SET LOCAL statement_timeout='30s'");
    await db.query('SELECT pg_advisory_xact_lock(184734901)');
    await db.query('LOCK TABLE public.arcana_visual_pack_artwork IN ACCESS EXCLUSIVE MODE');
    assert.equal((await db.query("SELECT to_regclass('public.arcana_migration_history') AS ledger")).rows[0].ledger,null);
    assert.deepEqual(await schema(db),profile,'only exact observed noncanonical profile is eligible');
    assert.equal((await db.query(compliance)).rows[0].noncompliant_count,'0','noncompliant rows require separate review; preserve all rows');
    await db.query(entries[1].sql); // Exact immutable002, only after proving its table absent.
    await db.query(tighten); // ADD CHECK validates all rows, no NOT VALID escape.
    if(failAfterDDL) throw new Error('injected post-DDL failure');
    assert.deepEqual(await schema(db),entries[3].schema,'strict canonical004 postcondition');
    await db.query('COMMIT');
  } catch(error) {await db.query('ROLLBACK');throw error;}
}
await fixture(async db=>{
  const before=await data(db);
  assert.equal((await run(db,entries,'plan')).verifiedBaselineCandidate,null);
  await assert.rejects(simulateRepair(db,true),/injected/);
  assert.deepEqual(await schema(db),profile);
  assert.deepEqual(await data(db),before);
  await simulateRepair(db);
  assert.deepEqual(await data(db),before);
  assert.equal((await db.query('SELECT count(*)::text AS n FROM arcana_card_artwork')).rows[0].n,'0');
  assert.equal((await db.query("SELECT to_regclass('public.arcana_migration_history') AS ledger")).rows[0].ledger,null);
  assert.equal((await run(db,entries,'plan')).verifiedBaselineCandidate,4);
  await run(db,entries,'baseline',4);
  assert.deepEqual((await run(db,entries,'plan')).pending.map(e=>e.version),[5,6]);
  await run(db,entries,'apply');
  const history=(await db.query('SELECT version,operation,checksum FROM arcana_migration_history ORDER BY version')).rows;
  assert.deepEqual(history.map(h=>h.operation),['baseline','baseline','baseline','baseline','apply','apply']);
  assert.deepEqual(history.map(h=>h.checksum),entries.map(e=>e.sha256));
  await run(db,entries,'apply');
  assert.deepEqual((await db.query('SELECT version,operation,checksum FROM arcana_migration_history ORDER BY version')).rows,history);
  assert.deepEqual(await data(db),before);
  assert.deepEqual((await run(db,entries,'status')).pending,[]);
});
for(const mediaType of [undefined,null]) await fixture(async db=>{
  const asset={deckId:'test',packId:'named',cardSlug:'invalid',...(mediaType===null?{mediaType:null}:{})};
  await db.query('INSERT INTO arcana_visual_pack_artwork VALUES ($1,$2,$3,$4::jsonb)',['test','named','invalid',JSON.stringify(asset)]);
  const before=await data(db);
  assert.equal((await db.query(compliance)).rows[0].noncompliant_count,'1');
  await assert.rejects(simulateRepair(db),/noncompliant/);
  assert.deepEqual(await data(db),before);
  assert.deepEqual(await schema(db),profile);
});
await fixture(async db=>{
  await db.query('ALTER TABLE arcana_visual_packs ADD COLUMN unexpected text');
  const before=await schema(db);
  await assert.rejects(simulateRepair(db),/exact observed/);
  assert.deepEqual(await schema(db),before);
});
console.log('Proposal-only PGlite tests passed: exact-profile gate, noncompliance refusal without edits, rollback, empty legacy-table creation, strict004 verification/baseline, normal005+006, immutable checksums/no-op and data preservation. No live database connection.');
