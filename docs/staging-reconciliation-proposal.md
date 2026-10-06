# Staging adoption proposal — not implemented for live use

Scope: reconcile only the independently verified existing PR105 staging database. No publication, live query, DDL, data/ledger write, role/secret change or resource creation is authorized by this document. The app-to-Neon mapping is still unverified and must be established before any repair. Current target metadata came from read-only run37401671687 on PostgreSQL18.6.

## Evidence and unknown cause

The inspected schema equals catalog004 except (1) public.arcana_card_artwork is absent and (2) the named-artwork mediaType CHECK has the exact fingerprint of the older equality-only check, without IS NOT NULL.005 draft additions and006 cover/back table are absent. No exact baseline is currently valid.

Repository commit e669c4c introduced004 with the stricter check. Its old migrate-domain runner automatically included002 when --include-visual-packs was selected, even without --include-artwork; commit5ef42a4 retained that dependency. Migration004 explicitly promises to preserve the legacy table. No DROP/RENAME of arcana_card_artwork was found in numbered SQL history. Therefore normal execution of those committed runners does not explain this state. Manual/older external DDL, restore/branch provenance or later changes are possible but unverified; the cause is UNKNOWN. Do not claim the table was safely unused, newly missing, or deleted. Creating an empty table cannot recover former rows, object keys or lost content. Investigate available existing backup/audit/provenance evidence before deciding whether recovery is necessary.

## Minimal versioned adoption path

Do not edit SQL001–006/catalog entries, add a force flag, weaken baseline matching, or pretend007 can fix an untracked noncanonical prefix. Instead, if approved, implement a separate immutable adoption recipe named staging-domain-adoption-v1, with reviewed code/recipe checksum and exact approved source-profile fingerprint, using the same dedicated native migration connection and host/database/user guards. Its CI audit record must identify target, reviewed revision, recipe checksum, recovery evidence and outcomes. It is not a new numbered migration or evidence that001–004 originally ran. No live-capable recipe is included here; only an in-memory test simulation.

1. Verify app/deployment→Neon project/branch/endpoint mapping. Review usable recovery coverage for this branch and potential legacy-table loss: timestamp, retention/expiry, restoration procedure/access and responsible operator. Do not create a backup branch implicitly. Coordinate quiescence of schema writers and a short application-write maintenance window.
2. Perform the separately approved count-only compliance query below in a read-only transaction. If the count is nonzero, STOP. Do not delete/quarantine rows, add guessed mediaType values, rewrite JSON, skip validation or ignore the mismatch. Existing data must remain unchanged. A data-owner review of actual asset provenance and a separately approved corrective/recovery plan is needed; neither row contents nor object keys should enter public CI logs. No row-level access is authorized here.
3. In the future repair operation, BEGIN; set the existing5s lock/30s statement timeouts and search_path; take advisory transaction lock184734901. Acquire ACCESS EXCLUSIVE on public.arcana_visual_pack_artwork so concurrent writes cannot race the compliance check/constraint validation. Other schema writers must remain quiescent; an advisory lock cannot stop arbitrary DDL. Reverify absence of a migration ledger and exact match to the specifically observed source profile (canonical004 minus legacy table, plus exactly the known weaker constraint). Any additional drift, pre-existing legacy table, ledger or target discrepancy stops the repair.
4. Recheck the same aggregate compliance predicate under the table lock. Only zero permits the following two changes, in one transaction:
   - Execute exact immutable002 SQL, creating the previously absent legacy arcana_card_artwork table with its committed columns, keys, FK and checks. No named-front rows are copied or moved. No artwork/private storage is touched. The table begins EMPTY, not recovered.
   - Replace only arcana_visual_pack_artwork_asset_check with its exact committed004 predicate. Use a normally validated ADD CONSTRAINT, never NOT VALID. PostgreSQL must validate existing rows; failure aborts the transaction.
5. Re-read the entire domain schema with the existing strict schema reader. Require byte-equivalent serialized snapshot004. Only then COMMIT. This operation creates no migration ledger and performs no row INSERT/UPDATE/DELETE. Failure rolls back both DDL changes together. Existing rows, JSON and revisions stay unchanged.
6. Run normal read-only plan. It must return verifiedBaselineCandidate=4. After approval, normal baseline --through4 independently re-verifies the exact schema under the standard lock and records001–004 as operation=baseline, with original immutable checksums. This asserts verified schema equivalence, not fabricated execution history. If intervening drift appears, stop.
7. Normal plan must now list only005 and006. After review, normal apply executes them and records their original checksums atomically. Then status must be current; a second apply must be a no-op. Verify app readiness and feature smoke tests against the mapped deployment before PR105 merge. Auth remains separate; neither this repair nor006 guarantees readiness.

## Exact proposed aggregate and DDL effects

Read-only preflight (and the identical recheck inside the locked repair transaction):

```sql
SELECT count(*)::text AS noncompliant_count
FROM public.arcana_visual_pack_artwork
WHERE ((asset->>'mediaType') IS NOT NULL
       AND (asset->>'mediaType')='image/webp') IS NOT TRUE;
```

Only noncompliant_count is emitted; no row identifiers, JSON, keys or samples. The exact-source check includes RLS flags, and the approved owner role must have full visibility. Permission/RLS uncertainty is a blocker, not evidence that a zero count covers all rows. Missing JSON mediaType and JSON null both fail the new predicate. Existing equality-only CHECK permits SQLNULL, so zero cannot be assumed.

The legacy table definition is reused verbatim from mcp/migrations/002-card-artwork.sql. The sole existing-object alteration is:

```sql
ALTER TABLE public.arcana_visual_pack_artwork
  DROP CONSTRAINT arcana_visual_pack_artwork_asset_check,
  ADD CONSTRAINT arcana_visual_pack_artwork_asset_check
    CHECK (asset->>'mediaType' IS NOT NULL
           AND asset->>'mediaType'='image/webp');
```

Creating the legacy table provides future compatibility only. It must never be described as restoring missing artwork. Tightening the CHECK changes acceptance of future missing/null mediaType values but does not modify existing rows.

## Failure and recovery

Before commit, any lock timeout, nonzero count, DDL/validation error or failed canonical postcondition rolls back the complete repair. After an uncertain connection/commit result, run read-only plan/diagnostics to establish state before retry; no blind rerun. A subsequent baseline failure leaves an untracked but canonical004 schema for investigation/retry. Normal005/006 already roll back together on transactional failure.

After commit, do not automatically drop the new table or weaken the CHECK: new data may exist and weakening restores invalid-data acceptance. Keep the verified recovery mechanism available and prefer reviewed forward repair. Any restore, data remediation, down change or new branch/resource requires separate coordination. Application rollback alone does not reverse additive schema and cannot recover missing historical rows.

## Local verification

mcp/test/staging-reconciliation-proposal.ts uses only fresh in-memory PGlite databases and accepts no connection URI or secrets. It reproduces the exact observed noncanonical profile; proves missing/null mediaType rows cause refusal with all rows/schema unchanged; tests unexpected drift refusal and injected post-DDL failure rollback; verifies an empty legacy table, unchanged existing fronts/packs/deck revisions, strict004 postcondition, normal baseline001–004, normal005/006 apply, original ledger checksums and no-op repeat. These are proposal tests, not a live repair implementation or live-data compliance evidence. PostgreSQL18 locking/validation in an isolated server should also be verified before a future repair runner is reviewed for deployment.
