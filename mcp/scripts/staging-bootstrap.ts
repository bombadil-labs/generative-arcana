import { digest, schema, MigrationSafetyError, type Connection, type Entry } from './domain-migrations';

export const stagingRoot = Object.freeze({ project:'blue-pond-70470746', branch:'br-solitary-shape-b7f1tpxs', host:'ep-purple-hill-b7kz7n0g.c-13.us-east-1.aws.neon.tech', database:'neondb', user:'neondb_owner', port:'5432' });
export const recipe = 'persistent-staging-root-v4-bootstrap-v1';
const requireSafe = (ok: unknown, message: string) => { if (!ok) throw new MigrationSafetyError(message); };
export function bootstrapTarget(flags:Record<string,string>) {
  requireSafe(flags.target === 'preview' && flags['expected-host'] === stagingRoot.host && flags['expected-database'] === stagingRoot.database && flags['expected-user'] === stagingRoot.user && (flags['expected-port'] || '5432') === stagingRoot.port, 'Bootstrap requires the pinned persistent preview root and one-time owner');
}
export interface Recovery {
  project:string; branch:string; database:string; artifactReference:string; restoreTestReference:string;
  verifiedAt:string; validUntil:string;
}
export function recoveryEvidence(value:Recovery, now=Date.now()) {
  requireSafe(value && value.project===stagingRoot.project && value.branch===stagingRoot.branch && value.database===stagingRoot.database, 'Recovery target mismatch');
  for(const reference of [value.artifactReference,value.restoreTestReference]) requireSafe(typeof reference==='string' && /^[A-Za-z0-9][A-Za-z0-9._:/-]{2,255}$/.test(reference) && !reference.startsWith('disposable-staging:'), 'Real recovery artifact and restore-test references required');
  const verified=Date.parse(value.verifiedAt), expires=Date.parse(value.validUntil);
  requireSafe(Number.isFinite(verified) && Number.isFinite(expires) && verified<=now && expires>now && expires>verified, 'Recovery evidence expired or invalid');
  return value;
}
export function bootstrapRecipe(entries:(Entry & {sql:string})[]) {
  requireSafe(entries[1]?.file==='002-card-artwork.sql' && entries[3]?.version===4, 'Immutable v4 catalog required');
  const source=structuredClone(entries[3].schema) as any[];
  const index=source.findIndex(t=>t.name==='arcana_card_artwork');
  requireSafe(index>=0,'Expected legacy artwork definition missing');source.splice(index,1);
  const constraint=source.find(t=>t.name==='arcana_visual_pack_artwork')?.constraints.find((c:any[])=>c[0]==='arcana_visual_pack_artwork_asset_check');
  requireSafe(constraint,'Expected artwork constraint missing');
  constraint[1]="CHECK (((asset ->> 'mediaType'::text) = 'image/webp'::text))";
  const create=entries[1].sql.replace('CREATE TABLE IF NOT EXISTS arcana_card_artwork','CREATE TABLE arcana_card_artwork');
  requireSafe(create!==entries[1].sql,'Unexpected legacy DDL');
  const tighten="ALTER TABLE public.arcana_visual_pack_artwork DROP CONSTRAINT arcana_visual_pack_artwork_asset_check, ADD CONSTRAINT arcana_visual_pack_artwork_asset_check CHECK (asset->>'mediaType' IS NOT NULL AND asset->>'mediaType'='image/webp')";
  return {source,expected:entries[3].schema,sql:[create,tighten]};
}
/** No row contents, auth changes, roles, grants or automatic baseline. */
export async function bootstrap(db:Connection, entries:(Entry & {sql:string})[], options:{operation:'plan'|'apply';sha:string;planDigest?:string;recovery?:Recovery}) {
  requireSafe(/^[a-f0-9]{40}$/.test(options.sha),'Exact reviewed code SHA required');
  if(options.operation==='apply') { recoveryEvidence(options.recovery!); requireSafe(/^[a-f0-9]{64}$/.test(options.planDigest||''),'Reviewed bootstrap plan digest required'); }
  const spec=bootstrapRecipe(entries);
  await db.query(options.operation==='plan'?'BEGIN READ ONLY':'BEGIN');
  try {
    await db.query('SET LOCAL search_path = public, pg_catalog');
    await db.query("SET LOCAL lock_timeout = '5s'");await db.query("SET LOCAL statement_timeout = '30s'");
    await db.query('SELECT pg_advisory_xact_lock(184734901)');
    requireSafe(!(await db.query("SELECT to_regclass('public.arcana_migration_history') IS NOT NULL AS present")).rows[0].present,'Ledger already exists; use normal migration plan/status');
    const names=spec.source.map(t=>t.name as string).sort();
    requireSafe(names.every(name=>/^arcana_[a-z0-9_]+$/.test(name)),'Unexpected relation');
    await db.query(`LOCK TABLE ${names.map(name=>`public.${name}`).join(',')} IN ${options.operation==='apply'?'ACCESS EXCLUSIVE':'ACCESS SHARE'} MODE`);
    const actual=await schema(db);
    const equal=(a:unknown,b:unknown)=>JSON.stringify(a)===JSON.stringify(b);
    const already=equal(actual,spec.expected);
    requireSafe(already||equal(actual,spec.source),'Persistent staging source profile mismatch');
    const owners=(await db.query("SELECT c.relname AS name, pg_get_userbyid(c.relowner) AS owner FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='public' AND c.relname = ANY($1::text[]) ORDER BY c.relname",[names])).rows;
    requireSafe(owners.length===names.length && owners.every(row=>row.owner===stagingRoot.user),'Unexpected source ownership; review role preparation separately');
    const invalid=(await db.query("SELECT count(*)::text AS n FROM public.arcana_visual_pack_artwork WHERE (asset->>'mediaType' IS NOT NULL AND asset->>'mediaType'='image/webp') IS NOT TRUE")).rows[0].n;
    requireSafe(invalid==='0','Noncompliant artwork rows; no data repair is authorized');
    const counts=[];
    for(const name of names) counts.push({name,rows:(await db.query(`SELECT count(*)::text AS n FROM public.${name}`)).rows[0].n});
    const plan={recipe,target:stagingRoot,sha:options.sha,source:spec.source,expected:spec.expected,owners,counts,noncompliantCount:0,sql:spec.sql};
    const planDigest=digest(JSON.stringify(plan));
    if(options.operation==='apply' && !already) {
      requireSafe(options.planDigest===planDigest,'Bootstrap plan changed; inspect a fresh plan');
      recoveryEvidence(options.recovery!);
      for(const sql of spec.sql) await db.query(sql);
      requireSafe(equal(await schema(db),spec.expected),'Bootstrap postcondition failed');
    }
    await db.query('COMMIT');
    return {operation:options.operation,planDigest,alreadyBootstrapped:already,verifiedBaselineVersion:options.operation==='apply'||already?4:null,ledgerWritten:false,plan};
  } catch(error) {await db.query('ROLLBACK');throw error;}
}
