# Disposable PR105 staging reconciliation — implementation review

User confirmation `Sentinel_35f5cd63ea448191b751aeef71acdbb5` says nothing in this staging branch needs preserving. No backup/provenance detour is required for this branch. This does not authorize deletion, reset or arbitrary schema changes. Production policy is unchanged.

## Exact effects and guards

New explicit command `reconcile-preview` is limited to preview, host `ep-fragrant-morning-b7w91pb6.c-13.us-east-1.aws.neon.tech`, database `neondb`, user `neondb_owner`, port5432. It uses the existing dedicated native migration connection and verifies connected database/user. That target was already verified by the successful read-only plan. Effective app-to-Neon mapping is a later readiness check, not a prerequisite for repairing this explicitly selected disposable branch.

Under one transaction,5s lock timeout,30s statement timeout, advisory lock184734901 and an ACCESS EXCLUSIVE named-artwork lock:

1. Require no ledger and the EXACT observed schema: catalog004 minus legacy artwork table, with the known weaker mediaType check only. Additional drift or an already-created table refuses.
2. Run only this aggregate against existing data; any nonzero result refuses without edits:

```sql
SELECT count(*)::text AS noncompliant_count
FROM public.arcana_visual_pack_artwork
WHERE ((asset->>'mediaType') IS NOT NULL
       AND (asset->>'mediaType')='image/webp') IS NOT TRUE;
```

3. Create the empty legacy table with002's committed definition. Remove only its IF NOT EXISTS execution modifier so a concurrently created table causes failure instead of silent adoption; the immutable SQL file is unchanged. Copy/move no rows or blobs.
4. Replace only arcana_visual_pack_artwork_asset_check with fully validated004 CHECK `(asset->>'mediaType' IS NOT NULL AND asset->>'mediaType'='image/webp')`. No NOT VALID shortcut.
5. Require the complete strict snapshot004, then commit. No ledger or row INSERT/UPDATE/DELETE occurs. Emit recipe ID/checksum, schema version4, zero noncompliance, empty-table-created and ledgerWritten=false. Failure rolls back both DDL changes.

The source profile includes RLS=false. Lack of full count visibility/permissions is an error, never proof of compliance. Missing/null mediaType rows stop for separate review; the disposable decision does not silently authorize deleting or rewriting them. Keep schema writers quiescent; the advisory lock coordinates cooperating runners only.

## Transparent write evidence

Use existing `backup_reference` input with literal:

`disposable-staging:Sentinel_35f5cd63ea448191b751aeef71acdbb5`

The CLI logs `writeEvidence.kind=disposable-staging-risk-acceptance`, not a backup. That prefix is accepted ONLY for the exact approved preview target, including later baseline/apply; production refuses it. Existing ordinary recovery references remain supported. No fake backup is claimed, and write evidence is still required. No new approval system or runtime fallback is added.

After approved repair: normal plan must EXACTLY return candidate4; normal baseline --through4 re-verifies and records001–004 with operation=baseline and original checksums. Then normal plan lists005/006; normal apply runs both, status becomes current, second apply is a no-op. No automatic reconciliation or baseline is hidden in ordinary plan/apply. On uncertain commit inspect plan/status before retry. No automatic table drop, constraint weakening, restore or down migration is provided.

## Cause and data limits

Cause of missing legacy table is UNKNOWN. In commit e669c4c (and5ef42a4), old --include-visual-packs automatically included002 even without --include-artwork;004 originally declared the strict check. No DROP/RENAME was found in numbered SQL history. Do not infer harmless absence or claim recovery: creating an empty table restores future compatibility only, never historical artwork/keys/content. User has accepted this staging content risk.

## Smallest dispatcher publication path

The isolated change to main's existing preview-migrate.yml is exactly two lines: add `reconcile-preview` to operation choices; describe backup_reference as recovery or explicit disposable-staging evidence. It keeps dispatch-main guard, scoped environment, exact reviewed-SHA checkout, target inputs and plan default unchanged. A feature-branch workflow edit cannot change main's dispatcher. Land only these dispatcher lines through a separately reviewed maintenance change on main, then use the reviewed PR105 implementation SHA. Do not merge PR105's feature prematurely or send an undocumented choice. No dispatcher publication or live execution has occurred in this task.

## Tests and remaining readiness evidence

mcp/test/preview-reconciliation.ts tests the actual implementation in fresh PGlite or explicitly opted-in loopback PostgreSQL18 fixtures using fixed fake credentials. It checks source/target/evidence guards, noncompliance refusal, unexpected drift, pre-existing legacy table refusal, injected post-DDL rollback, strict004 baseline, normal005/006 checksums/no-op and preservation of named fronts/packs/revisions. NativePG18 additionally tests conflicting ACCESS EXCLUSIVE lock timeout, unchanged schema and retry after release. CI harness is extended fromPG17 toPG17/18, with reconciliation on18; not yet published/run in CI.

Provider metadata confirms PR105 deployment→Git branch/SHA but does not expose its effective database endpoint without decrypting a sensitive variable. Missing evidence for end-to-end readiness: a nonsecret effective deployed database host/database or an authoritative deployment→Neon branchID/endpoint mapping. No credential extraction is proposed. After schema work, verify app readiness and feature smoke tests before105merge; auth remains separate.
