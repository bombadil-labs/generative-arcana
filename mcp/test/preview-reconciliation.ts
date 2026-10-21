// Uses fresh PGlite by default or explicitly opted-in loopback PostgreSQL18 fixtures.
// Native fixture uses only fixed local fake credentials; no external connection URI.
import assert from 'node:assert/strict';
import { PGlite } from '@electric-sql/pglite';
import { reconcilePreview, writeEvidence, previewAdoptionTarget } from '../scripts/preview-reconciliation';
import { connectLibpq } from '../scripts/migration-connection';
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
const fixtureRun=Date.now().toString(36);
let fixtureNumber=0;
async function fixture(test:(db:Connection)=>Promise<void>) {
  let db:Connection;
  let close:()=>Promise<void>;
  if(process.env.ARCANA_RECONCILIATION_PG18_TEST==='1') {
    const python=process.env.MIGRATION_PYTHON!,ca=process.env.MIGRATION_TEST_CA_FILE!;
    assert.ok(python&&ca);
    const base='postgresql://migration_test:local-test-only@127.0.0.1:54481/postgres?sslmode=require&channel_binding=require';
    const admin=await connectLibpq(base,python,ca);
    const database=`arcana_reconcile_${fixtureRun}_${++fixtureNumber}`;
    try {
      assert.match((await admin.query("SELECT current_setting('server_version_num') AS version")).rows[0].version,/^18\d{4}$/);
      await admin.query(`CREATE DATABASE ${database}`);
    } finally {await admin.close();}
    const native=await connectLibpq(base.replace('/postgres?','/'+database+'?'),python,ca);
    db=native;close=()=>native.close();
  } else {
    const pg=new PGlite();
    db={query:async(sql,values)=>values?pg.query(sql,values):({rows:(await pg.exec(sql)).at(-1)?.rows??[]})};
    close=()=>pg.close();
  }
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
  } finally {await close();}
}
async function data(db:Connection) {
  return Promise.all(['arcana_user_decks','arcana_visual_packs','arcana_visual_pack_artwork'].map(async t=>(await db.query(`SELECT to_jsonb(t) AS row FROM ${t} t ORDER BY to_jsonb(t)::text`)).rows));
}
// Inject only a test connection failure after both DDL statements.
async function simulateRepair(db:Connection,failAfterDDL=false) {
  let ddlDone=false;
  const wrapped:Connection={query:async(sql,values)=>{
    if(failAfterDDL && ddlDone && sql.startsWith('SELECT c.relname')) throw new Error('injected post-DDL failure');
    const result=await db.query(sql,values);
    if(sql.includes('ADD CONSTRAINT arcana_visual_pack_artwork_asset_check'))ddlDone=true;
    return result;
  }};
  return reconcilePreview(wrapped,entries);
}
const approved={target:'preview','expected-host':previewAdoptionTarget.host,'expected-database':'neondb','expected-user':'neondb_owner','backup-reference':'disposable-staging:Sentinel_35f5cd63ea448191b751aeef71acdbb5'};
assert.equal(writeEvidence('reconcile-preview',approved)?.kind,'disposable-staging-risk-acceptance');
for(const key of ['expected-host','expected-database','expected-user'])assert.throws(()=>writeEvidence('reconcile-preview',{...approved,[key]:'wrong'}),/exact approved/);
assert.throws(()=>writeEvidence('baseline',{...approved,target:'production'}),/only.*preview/);
assert.throws(()=>writeEvidence('reconcile-preview',{...approved,'backup-reference':'invented-backup'}),/restricted/);
assert.throws(()=>writeEvidence('apply',{...approved,'backup-reference':''}),/required/);
assert.equal(writeEvidence('apply',{target:'production','backup-reference':'reviewed-real-recovery'})?.kind,'recovery-reference');
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
  assert.deepEqual((await run(db,entries,'plan')).pending.map(e=>e.version),entries.slice(4).map(e=>e.version));
  await run(db,entries,'apply');
  const history=(await db.query('SELECT version,operation,checksum FROM arcana_migration_history ORDER BY version')).rows;
  assert.deepEqual(history.map(h=>h.operation),entries.map((_,i)=>i<4?'baseline':'apply'));
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
  await assert.rejects(simulateRepair(db),/compliance check failed/);
  assert.deepEqual(await data(db),before);
  assert.deepEqual(await schema(db),profile);
});
await fixture(async db=>{
  await db.query('ALTER TABLE arcana_visual_packs ADD COLUMN unexpected text');
  const before=await schema(db);
  await assert.rejects(simulateRepair(db),/source profile mismatch/);
  assert.deepEqual(await schema(db),before);
});


await fixture(async db=>{
  await db.query(entries[1].sql);
  const before=await schema(db);
  await assert.rejects(simulateRepair(db),/source profile mismatch/);
  assert.deepEqual(await schema(db),before);
});
if(process.env.ARCANA_RECONCILIATION_PG18_TEST==='1') await fixture(async db=>{
  const second=await connectLibpq(`postgresql://migration_test:local-test-only@127.0.0.1:54481/arcana_reconcile_${fixtureRun}_${fixtureNumber}?sslmode=require&channel_binding=require`,process.env.MIGRATION_PYTHON!,process.env.MIGRATION_TEST_CA_FILE!);
  try {
    await second.query('BEGIN');
    await second.query('LOCK TABLE public.arcana_visual_pack_artwork IN ACCESS EXCLUSIVE MODE');
    await assert.rejects(simulateRepair(db),/55P03/);
    await second.query('ROLLBACK');
    assert.deepEqual(await schema(db),profile);
    await simulateRepair(db);
    assert.deepEqual(await schema(db),entries[3].schema);
  } finally {await second.close();}
});
console.log('Guarded reconciliation tests passed: exact-profile gate, noncompliance refusal without edits, rollback, empty legacy-table creation, strict004 verification/baseline, pending catalog migrations, immutable checksums/no-op and data preservation. Disposable test fixture only.');
