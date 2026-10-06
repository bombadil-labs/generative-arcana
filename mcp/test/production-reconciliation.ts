import assert from 'node:assert/strict';
import { PGlite } from '@electric-sql/pglite';
import { catalog, run, schema, type Connection } from '../scripts/domain-migrations';
import { productionEvidence, productionSource, productionAdoptionTarget, reconcileProduction } from '../scripts/production-reconciliation';
import { connectLibpq } from '../scripts/migration-connection';

const entries = await catalog();
const approved = { target:'production', 'expected-host':productionAdoptionTarget.host, 'expected-database':'neondb', 'expected-user':'reviewed-migrator', 'backup-reference':'test-only-verified-restore-reference' };
assert.equal(productionEvidence(approved).kind, 'recovery-reference');
for (const key of ['target','expected-host','expected-database','expected-port']) assert.throws(() => productionEvidence({...approved,[key]:'wrong'}), /exact reviewed/);
assert.throws(() => productionEvidence({...approved,'expected-user':''}), /explicit migration role/);
for (const reference of ['', 'disposable-staging:approval', 'line\nbreak']) assert.throws(() => productionEvidence({...approved,'backup-reference':reference}), /recovery reference/);

const fixtureRun=Date.now().toString(36);
let fixtureNumber=0;
const nativeUrls=new WeakMap<Connection,string>();
async function fixture(test:(db:Connection)=>Promise<void>) {
  let db:Connection, close:()=>Promise<void>;
  if(process.env.ARCANA_RECONCILIATION_PG18_TEST==='1') {
    const python=process.env.MIGRATION_PYTHON!,ca=process.env.MIGRATION_TEST_CA_FILE!;
    assert.ok(python&&ca);
    const base='postgresql://migration_test:local-test-only@127.0.0.1:54481/postgres?sslmode=require&channel_binding=require';
    const admin=await connectLibpq(base,python,ca);
    const database=`arcana_prod_reconcile_${fixtureRun}_${++fixtureNumber}`;
    try {
      assert.match((await admin.query("SELECT current_setting('server_version_num') AS version")).rows[0].version,/^18\d{4}$/);
      await admin.query(`CREATE DATABASE ${database}`);
    } finally {await admin.close();}
    const url=base.replace('/postgres?','/'+database+'?');
    const native=await connectLibpq(url,python,ca);
    db=native; close=()=>native.close(); nativeUrls.set(db,url);
  } else {
    const pg=new PGlite();
    db={query:async(sql,values)=>values?pg.query(sql,values):({rows:(await pg.exec(sql)).at(-1)?.rows??[]})};
    close=()=>pg.close();
  }
  try {
    for (const e of entries.slice(0,5)) await db.query(e.sql);
    await db.query(`ALTER TABLE arcana_visual_pack_artwork DROP CONSTRAINT arcana_visual_pack_artwork_asset_check,
      ADD CONSTRAINT arcana_visual_pack_artwork_asset_check CHECK (asset->>'mediaType'='image/webp');
      INSERT INTO arcana_user_decks(id,owner_id,slug,manifest,revision) VALUES ('test','owner','test','{}',17);
      INSERT INTO arcana_visual_packs(deck_id,pack_id,label) VALUES ('test','named','Fixture');
      INSERT INTO arcana_visual_pack_artwork(deck_id,pack_id,card_slug,asset) VALUES ('test','named','front','{"deckId":"test","packId":"named","cardSlug":"front","mediaType":"image/webp","objectKey":"preserve"}');`);
    assert.deepEqual(await schema(db), productionSource(entries));
    await test(db);
  } finally { await close(); }
}
async function rows(db:Connection) {
  return Promise.all((entries[4].schema as {name:string}[]).map(async ({name}) => (await db.query(`SELECT to_jsonb(t) AS row FROM ${name} t ORDER BY to_jsonb(t)::text`)).rows));
}
await fixture(async db => {
  const before = await rows(db);
  await assert.rejects(run(db,entries,'baseline',5), /schema mismatch/);
  const statements:string[] = [];
  await reconcileProduction({query:async(sql,values)=>{statements.push(sql);return db.query(sql,values);}},entries);
  assert.equal(statements.filter(sql => sql.startsWith('ALTER TABLE')).length,1);
  assert.ok(!statements.some(sql=>/^(INSERT|UPDATE|DELETE|CREATE|DROP TABLE)/.test(sql)));
  assert.deepEqual(await rows(db),before);
  assert.deepEqual(await schema(db),entries[4].schema);
  assert.equal((await run(db,entries,'plan')).verifiedBaselineCandidate,5);
  await assert.rejects(reconcileProduction(db,entries), /source profile mismatch/);
  await run(db,entries,'baseline',5);
  await assert.rejects(reconcileProduction(db,entries), /existing ledger/);
  assert.deepEqual((await run(db,entries,'plan')).pending.map(x=>x.version),entries.slice(5).map(x=>x.version));
  await run(db,entries,'apply');
  const history=(await db.query('SELECT version,checksum,operation FROM arcana_migration_history ORDER BY version')).rows;
  assert.deepEqual(history.map(x=>x.operation),entries.map((_,i)=>i<5?'baseline':'apply'));
  assert.deepEqual(history.map(x=>x.checksum),entries.map(x=>x.sha256));
  await run(db,entries,'apply');
  assert.deepEqual((await db.query('SELECT version,checksum,operation FROM arcana_migration_history ORDER BY version')).rows,history);
  assert.deepEqual((await run(db,entries,'status')).pending,[]);
  assert.deepEqual(await rows(db),before);
});
for (const mediaType of [undefined,null]) await fixture(async db => {
  const asset={deckId:'test',packId:'named',cardSlug:'invalid',...(mediaType===null?{mediaType:null}:{})};
  await db.query('INSERT INTO arcana_visual_pack_artwork VALUES ($1,$2,$3,$4::jsonb)',['test','named','invalid',JSON.stringify(asset)]);
  const before=await rows(db);
  await assert.rejects(reconcileProduction(db,entries), /compliance check failed/);
  assert.deepEqual(await rows(db),before);
  assert.deepEqual(await schema(db),productionSource(entries));
});
await fixture(async db => {
  await db.query('ALTER TABLE arcana_visual_packs ADD COLUMN unexpected text');
  const before=await schema(db);
  await assert.rejects(reconcileProduction(db,entries), /source profile mismatch/);
  assert.deepEqual(await schema(db),before);
});
await fixture(async db => {
  let changed=false;
  await assert.rejects(reconcileProduction({query:async(sql,values)=>{
    if(changed && sql.startsWith('SELECT c.relname')) throw new Error('injected post-DDL failure');
    const result=await db.query(sql,values);
    if(sql.startsWith('ALTER TABLE'))changed=true;
    return result;
  }},entries), /injected/);
  assert.deepEqual(await schema(db),productionSource(entries));
});
if(process.env.ARCANA_RECONCILIATION_PG18_TEST==='1') await fixture(async db=>{
  const second=await connectLibpq(nativeUrls.get(db)!,process.env.MIGRATION_PYTHON!,process.env.MIGRATION_TEST_CA_FILE!);
  try {
    await second.query('BEGIN');
    await second.query('LOCK TABLE public.arcana_visual_pack_artwork IN ACCESS EXCLUSIVE MODE');
    await assert.rejects(reconcileProduction(db,entries),/55P03/);
    await second.query('ROLLBACK');
    assert.deepEqual(await schema(db),productionSource(entries));
    const results=await Promise.allSettled([reconcileProduction(db,entries),reconcileProduction(second,entries)]);
    assert.equal(results.filter(r=>r.status==='fulfilled').length,1);
    assert.equal(results.filter(r=>r.status==='rejected').length,1);
    assert.deepEqual(await schema(db),entries[4].schema);
  } finally {await second.close();}
});
console.log('Production constraint reconciliation: exact target/source, strict baseline refusal, invalid-row refusal, rollback, row preservation, baseline5/pending-catalog/checksums/noop passed on disposable fixtures. No live database used.');
