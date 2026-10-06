import { digest, schema, MigrationSafetyError, type Connection, type Entry } from './domain-migrations';
export const previewAdoptionTarget = {
  host:'ep-fragrant-morning-b7w91pb6.c-13.us-east-1.aws.neon.tech', database:'neondb', user:'neondb_owner', port:'5432',
};
export const adoptionRecipe = 'pr105-preview-adoption-v1';
export const complianceSql = "SELECT count(*)::text AS noncompliant_count FROM public.arcana_visual_pack_artwork WHERE ((asset->>'mediaType') IS NOT NULL AND (asset->>'mediaType')='image/webp') IS NOT TRUE";
const tightenSql = `ALTER TABLE public.arcana_visual_pack_artwork
  DROP CONSTRAINT arcana_visual_pack_artwork_asset_check,
  ADD CONSTRAINT arcana_visual_pack_artwork_asset_check
    CHECK (asset->>'mediaType' IS NOT NULL AND asset->>'mediaType'='image/webp')`;
export function writeEvidence(command:string, flags:Record<string,string>) {
  const reference=flags['backup-reference'];
  if (!['apply','baseline','reconcile-preview'].includes(command)) return undefined;
  if (!reference || reference.length>256 || /[\r\n\0]/.test(reference)) throw new MigrationSafetyError('Reviewed recovery or explicit disposable-staging risk-acceptance reference required');
  const disposable=reference.startsWith('disposable-staging:');
  if(disposable && (!/^disposable-staging:[A-Za-z0-9_.-]+$/.test(reference) || flags.target!=='preview')) throw new MigrationSafetyError('Disposable-staging evidence is valid only for an explicitly approved preview');
  if(command==='reconcile-preview' || disposable) {
    if(!disposable || flags.target!=='preview' || flags['expected-host']!==previewAdoptionTarget.host || flags['expected-database']!==previewAdoptionTarget.database || flags['expected-user']!==previewAdoptionTarget.user || (flags['expected-port']||'5432')!==previewAdoptionTarget.port) throw new MigrationSafetyError('This adoption recipe is restricted to the exact approved disposable PR105 preview target');
  }
  return {kind:disposable?'disposable-staging-risk-acceptance':'recovery-reference',reference};
}
export function adoptionSource(entries:(Entry&{sql:string})[]) {
  if(entries[1]?.file!=='002-card-artwork.sql'||entries[3]?.file!=='004-named-artwork-sets.sql') throw new MigrationSafetyError('Expected immutable adoption catalog missing');
  const profile=structuredClone(entries[3].schema) as any[];
  const legacy=profile.findIndex(t=>t.name==='arcana_card_artwork');
  const check=profile.find(t=>t.name==='arcana_visual_pack_artwork')?.constraints.find((c:any[])=>c[0]==='arcana_visual_pack_artwork_asset_check');
  if(legacy<0||!check)throw new MigrationSafetyError('Expected adoption catalog objects missing');
  profile.splice(legacy,1);
  check[1]="CHECK (((asset ->> 'mediaType'::text) = 'image/webp'::text))";
  return profile;
}
/** Exact-profile, metadata/aggregate-only adoption. No row edits or ledger writes. */
export async function reconcilePreview(db:Connection,entries:(Entry&{sql:string})[]) {
  const source=adoptionSource(entries);
  // Use002's unchanged definition, but refuse a concurrent/pre-existing table rather than skip it.
  const legacySql=entries[1].sql.replace('CREATE TABLE IF NOT EXISTS arcana_card_artwork','CREATE TABLE arcana_card_artwork');
  if(legacySql===entries[1].sql)throw new MigrationSafetyError('Expected legacy table definition missing');
  const recipeChecksum=digest(JSON.stringify({recipe:adoptionRecipe,source,legacySql,tightenSql,expected:entries[3].schema}));
  await db.query('BEGIN');
  try {
    await db.query('SET LOCAL search_path = public, pg_catalog');
    await db.query("SET LOCAL lock_timeout = '5s'");
    await db.query("SET LOCAL statement_timeout = '30s'");
    await db.query('SELECT pg_advisory_xact_lock(184734901)');
    await db.query('LOCK TABLE public.arcana_visual_pack_artwork IN ACCESS EXCLUSIVE MODE');
    if((await db.query("SELECT to_regclass('public.arcana_migration_history') IS NOT NULL AS present")).rows[0].present)throw new MigrationSafetyError('Adoption requires no existing ledger');
    if(JSON.stringify(await schema(db))!==JSON.stringify(source))throw new MigrationSafetyError('Adoption source profile mismatch; no repair performed');
    // Source profile verifies RLS is off. COUNT sees all rows or raises an error.
    const count=(await db.query(complianceSql)).rows[0].noncompliant_count;
    if(count!=='0')throw new MigrationSafetyError('Named-artwork compliance check failed; no existing rows modified. Separate review required.');
    await db.query(legacySql);
    await db.query(tightenSql);
    if(JSON.stringify(await schema(db))!==JSON.stringify(entries[3].schema))throw new MigrationSafetyError('Adoption postcondition failed; changes rolled back');
    await db.query('COMMIT');
    return {command:'reconcile-preview',recipe:adoptionRecipe,recipeChecksum,verifiedSchemaVersion:4,noncompliantCount:0,legacyTableCreatedEmpty:true,ledgerWritten:false,pending:[]};
  } catch(error) {await db.query('ROLLBACK');throw error;}
}
