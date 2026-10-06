import { digest, schema, MigrationSafetyError, type Connection, type Entry } from './domain-migrations';

export const productionAdoptionTarget = {
  host: 'ep-square-sun-b79gp0dh.c-13.us-east-1.aws.neon.tech', database: 'neondb', port: '5432',
};
export const productionRecipe = 'production-v5-artwork-constraint-v1';
export function productionEvidence(flags: Record<string,string>) {
  const t = productionAdoptionTarget;
  if (flags.target !== 'production' || flags['expected-host'] !== t.host || flags['expected-database'] !== t.database ||
      (flags['expected-port'] || '5432') !== t.port || !flags['expected-user']) throw new MigrationSafetyError('Production reconciliation requires the exact reviewed production target and explicit migration role');
  const reference = flags['backup-reference'];
  if (!reference || reference.startsWith('disposable-staging:') || reference.length > 256 || /[\r\n\0]/.test(reference)) throw new MigrationSafetyError('Verified production recovery reference required; staging risk acceptance is not valid');
  return { kind: 'recovery-reference', reference };
}
export function productionSource(entries: (Entry & {sql:string})[]) {
  if (entries[4]?.version !== 5 || entries[4]?.file !== '005-manifest-drafts.sql') throw new MigrationSafetyError('Expected immutable version5 catalog missing');
  const profile = structuredClone(entries[4].schema) as any[];
  const check = profile.find(t => t.name === 'arcana_visual_pack_artwork')?.constraints.find((c:any[]) => c[0] === 'arcana_visual_pack_artwork_asset_check');
  if (!check) throw new MigrationSafetyError('Expected version5 artwork constraint missing');
  check[1] = "CHECK (((asset ->> 'mediaType'::text) = 'image/webp'::text))";
  return profile;
}
const complianceSql = "SELECT count(*)::text AS noncompliant_count FROM public.arcana_visual_pack_artwork WHERE ((asset->>'mediaType') IS NOT NULL AND (asset->>'mediaType')='image/webp') IS NOT TRUE";
const tightenSql = `ALTER TABLE public.arcana_visual_pack_artwork
  DROP CONSTRAINT arcana_visual_pack_artwork_asset_check,
  ADD CONSTRAINT arcana_visual_pack_artwork_asset_check
    CHECK (asset->>'mediaType' IS NOT NULL AND asset->>'mediaType'='image/webp')`;

/** One reviewed constraint replacement only. Target/connected-role verification occurs before dispatch. */
export async function reconcileProduction(db: Connection, entries: (Entry & {sql:string})[]) {
  const source = productionSource(entries);
  const recipeChecksum = digest(JSON.stringify({ recipe: productionRecipe, target: productionAdoptionTarget, source, complianceSql, tightenSql, expected: entries[4].schema }));
  await db.query('BEGIN');
  try {
    await db.query('SET LOCAL search_path = public, pg_catalog');
    await db.query("SET LOCAL lock_timeout = '5s'");
    await db.query("SET LOCAL statement_timeout = '30s'");
    await db.query('SELECT pg_advisory_xact_lock(184734901)');
    // Hold existing domain relations stable against concurrent ALTER/DROP through commit.
    const names = source.map(t => t.name as string).sort();
    if (names.some(name => !/^arcana_[a-z0-9_]+$/.test(name))) throw new MigrationSafetyError('Unexpected catalog relation name');
    await db.query(`LOCK TABLE ${names.map(name => `public.${name}`).join(', ')} IN ACCESS SHARE MODE`);
    await db.query('LOCK TABLE public.arcana_visual_pack_artwork IN ACCESS EXCLUSIVE MODE');
    if ((await db.query("SELECT to_regclass('public.arcana_migration_history') IS NOT NULL AS present")).rows[0].present) throw new MigrationSafetyError('Production reconciliation requires no existing ledger');
    if (JSON.stringify(await schema(db)) !== JSON.stringify(source)) throw new MigrationSafetyError('Production source profile mismatch; no repair performed');
    if ((await db.query(complianceSql)).rows[0].noncompliant_count !== '0') throw new MigrationSafetyError('Production artwork compliance check failed; no rows modified');
    await db.query(tightenSql);
    if (JSON.stringify(await schema(db)) !== JSON.stringify(entries[4].schema)) throw new MigrationSafetyError('Production postcondition failed; changes rolled back');
    await db.query('COMMIT');
    return { command: 'reconcile-production', recipe: productionRecipe, recipeChecksum, verifiedSchemaVersion: 5, noncompliantCount: 0, ledgerWritten: false, pending: [] };
  } catch (error) { await db.query('ROLLBACK'); throw error; }
}
