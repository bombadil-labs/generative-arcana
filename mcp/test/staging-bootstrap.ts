import assert from 'node:assert/strict';
import { PGlite } from '@electric-sql/pglite';
import { catalog, schema, run, type Connection } from '../scripts/domain-migrations';
import { bootstrap, bootstrapRecipe, bootstrapTarget, recoveryEvidence, stagingRoot } from '../scripts/staging-bootstrap';
import { restrictedMigrator } from '../scripts/restricted-migrator';
const entries=await catalog(), sha='a'.repeat(40);
const recovery={project:stagingRoot.project,branch:stagingRoot.branch,database:'neondb',artifactReference:'snapshot:synthetic-fixture',restoreTestReference:'restore:synthetic-fixture',verifiedAt:new Date(Date.now()-1000).toISOString(),validUntil:new Date(Date.now()+3600000).toISOString()};
const flags={target:'preview','expected-host':stagingRoot.host,'expected-database':'neondb','expected-user':'neondb_owner'};
bootstrapTarget(flags);
for(const key of Object.keys(flags))assert.throws(()=>bootstrapTarget({...flags,[key]:'wrong'}));
for(const patch of [{branch:'wrong'},{artifactReference:''},{restoreTestReference:''},{artifactReference:'disposable-staging:old'},{validUntil:'2000-01-01'},{verifiedAt:'2999-01-01'}])assert.throws(()=>recoveryEvidence({...recovery,...patch}));
async function fixture(test:(db:Connection)=>Promise<void>) {
  const pg=new PGlite();
  const db:Connection={query:async(sql,values)=>values?pg.query(sql,values):({rows:(await pg.exec(sql)).at(-1)?.rows??[]})};
  try {
    await db.query('CREATE ROLE neondb_owner; GRANT USAGE,CREATE ON SCHEMA public TO neondb_owner; SET ROLE neondb_owner');
    for(const entry of [entries[0],entries[2],entries[3]])await db.query(entry.sql);
    await db.query("ALTER TABLE arcana_visual_pack_artwork DROP CONSTRAINT arcana_visual_pack_artwork_asset_check, ADD CONSTRAINT arcana_visual_pack_artwork_asset_check CHECK(asset->>'mediaType'='image/webp')");
    await db.query("CREATE TABLE arcana_auth_fixture(id text); INSERT INTO arcana_auth_fixture VALUES ('unchanged'); INSERT INTO arcana_user_decks(id,owner_id,slug,manifest,revision) VALUES('fixture','owner','fixture','{}',17); INSERT INTO arcana_visual_packs(deck_id,pack_id,label) VALUES('fixture','named','Fixture'); INSERT INTO arcana_visual_pack_artwork VALUES('fixture','named','front','{\"deckId\":\"fixture\",\"packId\":\"named\",\"cardSlug\":\"front\",\"mediaType\":\"image/webp\",\"objectKey\":\"preserve\"}')");
    assert.deepEqual(await schema(db),bootstrapRecipe(entries).source);
    await test(db);
    assert.equal((await db.query('SELECT id FROM arcana_auth_fixture')).rows[0].id,'unchanged');
  } finally {await pg.close();}
}
await fixture(async db=>{
  const before=await schema(db);
  const plan=await bootstrap(db,entries,{operation:'plan',sha});assert.deepEqual(await schema(db),before);
  assert.equal((await db.query("SELECT to_regclass('arcana_migration_history') AS ledger")).rows[0].ledger,null);
  await assert.rejects(bootstrap(db,entries,{operation:'apply',sha,planDigest:plan.planDigest}),/Recovery/);
  await assert.rejects(bootstrap(db,entries,{operation:'apply',sha,planDigest:'b'.repeat(64),recovery}),/plan changed/);
  let ddl=false;
  const broken:Connection={query:async(sql,values)=>{if(ddl&&sql.startsWith('SELECT c.relname'))throw Error('injected after DDL');const result=await db.query(sql,values);if(sql.startsWith('ALTER TABLE public.arcana_visual_pack_artwork'))ddl=true;return result;}};
  await assert.rejects(bootstrap(broken,entries,{operation:'apply',sha,planDigest:plan.planDigest,recovery}),/injected/);
  assert.deepEqual(await schema(db),before);
  await bootstrap(db,entries,{operation:'apply',sha,planDigest:plan.planDigest,recovery});assert.deepEqual(await schema(db),entries[3].schema);
  assert.equal((await db.query('SELECT count(*)::text AS n FROM arcana_card_artwork')).rows[0].n,'0');
  assert.equal((await db.query("SELECT asset->>'objectKey' AS key FROM arcana_visual_pack_artwork")).rows[0].key,'preserve');
  assert.equal((await bootstrap(db,entries,{operation:'apply',sha,planDigest:plan.planDigest,recovery})).alreadyBootstrapped,true);
  await run(db,entries,'baseline',4);await run(db,entries,'apply');assert.deepEqual((await run(db,entries,'status')).pending,[]);
  await assert.rejects(bootstrap(db,entries,{operation:'plan',sha}),/Ledger already exists/);
});
for(const invalid of ['{}','{"mediaType":null}'])await fixture(async db=>{
  await db.query('INSERT INTO arcana_visual_pack_artwork VALUES($1,$2,$3,$4::jsonb)',['fixture','named','invalid',JSON.stringify({deckId:'fixture',packId:'named',cardSlug:'invalid',...JSON.parse(invalid)})]);
  const before=await schema(db);await assert.rejects(bootstrap(db,entries,{operation:'plan',sha}),/Noncompliant/);assert.deepEqual(await schema(db),before);
});
await fixture(async db=>{
  const plan=await bootstrap(db,entries,{operation:'plan',sha});
  await db.query("INSERT INTO arcana_visual_pack_artwork VALUES('fixture','named','new','{\"deckId\":\"fixture\",\"packId\":\"named\",\"cardSlug\":\"new\",\"mediaType\":\"image/webp\"}')");
  await assert.rejects(bootstrap(db,entries,{operation:'apply',sha,planDigest:plan.planDigest,recovery}),/plan changed/);
  await db.query('ALTER TABLE arcana_visual_packs ADD COLUMN unexpected text');
  await assert.rejects(bootstrap(db,entries,{operation:'plan',sha}),/profile mismatch/);
});
await fixture(async db=>{
  await db.query('RESET ROLE; CREATE ROLE unexpected; ALTER TABLE arcana_visual_packs OWNER TO unexpected; SET ROLE neondb_owner');
  await assert.rejects(bootstrap(db,entries,{operation:'plan',sha}));
});
// Role check exercises real catalog privileges; a role name alone never establishes least privilege.
await fixture(async db=>{
  await assert.rejects(restrictedMigrator(db),/Restricted/); // SET ROLE is not a direct login.
  await db.query('RESET ROLE');await assert.rejects(restrictedMigrator(db),/Restricted/); // fixture superuser.
});
await fixture(async db=>{
  await db.query('RESET ROLE; CREATE ROLE arcana_staging_migrator LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS; GRANT USAGE,CREATE ON SCHEMA public TO arcana_staging_migrator; GRANT SELECT ON public.arcana_auth_fixture TO arcana_staging_migrator; SET SESSION AUTHORIZATION arcana_staging_migrator');
  // Owning a normal application table also owns its internal TOAST relation.
  await db.query('CREATE TABLE public.domain_role_fixture(payload text)');
  await restrictedMigrator(db);
  await db.query('CREATE TABLE public.arcana_auth_unexpected(id text)');
  await assert.rejects(restrictedMigrator(db),/Restricted/);
  await db.query('DROP TABLE public.arcana_auth_unexpected');
});
await fixture(async db=>{
  await db.query('RESET ROLE; CREATE ROLE schema_owner LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS; ALTER SCHEMA public OWNER TO schema_owner; GRANT SELECT ON public.arcana_auth_fixture TO schema_owner; SET SESSION AUTHORIZATION schema_owner');
  assert.equal((await db.query("SELECT pg_get_userbyid(nspowner) AS owner FROM pg_namespace WHERE nspname='public'")).rows[0].owner,'schema_owner');
  assert.equal((await db.query("SELECT pg_get_userbyid(relowner) AS owner FROM pg_class WHERE oid='public.arcana_auth_fixture'::regclass")).rows[0].owner,'neondb_owner');
  await assert.rejects(restrictedMigrator(db),/Restricted/);
});
const limitedRole={direct:true,limited:true,no_memberships:true,no_schema_ownership:true,no_database_create:true,no_auth_ownership:true,no_other_schema_create:true};
for(const key of Object.keys(limitedRole)) {
  await assert.rejects(restrictedMigrator({query:async()=>({rows:[{...limitedRole,[key]:false}]})}),/Restricted/);
}
await restrictedMigrator({query:async()=>({rows:[limitedRole]})});
console.log('Persistent staging bootstrap: target/recovery gates, read-only plan, exact schema/data/owners, rollback, repeat, baseline/upgrade, auth preservation and restricted-role checks passed. Disposable local fixtures only.');
