# One-time persistent staging bootstrap

This is prepared code, not authorization to change a live database. Keep both staging release holds and `STAGING_BOOTSTRAP_ENABLED` false. Reconciliation, baseline, role creation/ownership/grants, credential installation, and subsequent migrations each require the operator's approved execution plan. PR110 is separate.

## Fixed target and accepted change

Only preview project `blue-pond-70470746`, its persistent main branch `br-solitary-shape-b7f1tpxs`, database `neondb`, direct host `ep-purple-hill-b7kz7n0g.c-13.us-east-1.aws.neon.tech:5432`, and one-time login `neondb_owner` qualify. Verify the endpoint-to-project/branch mapping in Neon before each run; PostgreSQL cannot attest the provider project/branch IDs. Do not substitute the old PR105 host or disposable-data waiver.

The observed domain schema matches migration 004 except that `arcana_card_artwork` is missing and the named artwork media-type CHECK permits NULL. The recipe independently reconstructs that exact source from the immutable catalog. It creates the missing **empty** legacy table and tightens that CHECK, in one transaction. It does not copy artwork, rewrite data, change auth tables, create roles, grant privileges, or write migration history.

Plan/apply reject an existing ledger, unexpected domain shape, unexpected source owners, and any artwork row with absent/NULL/non-WebP media type. Plans contain schema, SQL and aggregate row counts only. A digest binds those to the reviewed code SHA and pinned target. Apply takes exclusive locks, rechecks the source, counts, ownership, compliance and digest, and verifies exact v4 shape before commit. Aggregate counts are not content hashes: a same-count compliant data edit is not detected and is not rewritten. Pause application writes during the approved operation. Lock/statement timeouts fail closed; rollback covers both DDL statements. Plan is a read-only transaction.

## Recovery is an operator evidence gate

Before any write, establish a recoverable artifact for this exact root and successfully test restoration into an isolated destination. Record retained artifact identity, capture time, complete data/schema scope (including auth), retention/expiry, restore-test result and responsible reviewer in the referenced record. An empty snapshot list and a six-hour history window alone are insufficient. Confirm the artifact remains available through the maintenance and rollback window. Creating/testing recovery resources needs separate authorization.

The workflow accepts a nonsecret JSON evidence record with `project`, `branch`, `database`, `artifactReference`, `restoreTestReference`, `verifiedAt` and `validUntil`. Timestamps are ISO 8601 UTC; references must identify the actual reviewed records, never connection strings or credentials. Code checks target, syntax and expiry, and rejects `disposable-staging:` waivers. **It does not contact Neon or prove an artifact or restore test exists.** Protected-environment reviewers must verify that evidence before approving writes. Do not use example or synthetic test references on a live run.

## Reviewed execution sequence (not yet executed)

1. Merge the reviewed infrastructure through the normal approval process. Record its exact 40-character Git main SHA. Create separately protected GitHub environment `arcana-staging-bootstrap`, allowing only Git main and requiring an independent reviewer. Securely install the one-time owner connection as `ARCANA_STAGING_BOOTSTRAP_URL`, using the pinned direct host with TLS. Never install it in Vercel runtime or the recurring release environment.
2. Dispatch `staging-bootstrap.yml` on Git main with `operation=plan` and `reviewed_sha=<that exact SHA>`. It refuses a SHA different from the dispatch revision. Keep the write hold false. Review the emitted recipe, target, source/expected schemas, counts, SQL and `planDigest`. If source differs, stop; this code performs no generalized repair.
3. After separate write approval and verified recovery, temporarily enable `STAGING_BOOTSTRAP_ENABLED=true`. Dispatch the same workflow/revision with `operation=apply`, the reviewed `plan_digest`, the real `recovery_json`, and `confirmation=APPLY <sha>`. The expected result is `verifiedBaselineVersion: 4`, `ledgerWritten: false`.
4. Inspect the result and dispatch a new read-only `plan`; expect exact v4 and `alreadyBootstrapped: true`. A repeat apply at exact v4 is a no-op, even with the original plan digest; it still requires valid recovery and a digest in the expected format. It never repairs unexpected state. After an uncertain response, inspect first rather than blindly retry.
5. Separately approve `operation=baseline` on the same revision, with current recovery evidence and `confirmation=BASELINE <sha>`. The existing runner independently requires exact v4 and no ledger, then records versions 1–4 with immutable checksums as **baseline**, without executing their SQL. A repeated baseline refuses an existing ledger. Inspect normal migration `status` after any uncertain baseline result. Disable the bootstrap hold and remove the one-time environment secret after completion.
6. Perform the separately reviewed role preparation below. Then install only the dedicated direct migrator URL in `arcana-staging-release`, set `STAGING_MIGRATION_ROLE=arcana_staging_migrator`, and obtain a fresh normal release plan for the exact staging candidate. Review pending SQL and checksums. Approve migration-only `apply` before deployment, then grant explicitly reviewed runtime privileges for new tables and verify readiness. At this PR's catalog, migrations 005 and 006 are pending after baseline; later candidates may add others and require their own review.

All bootstrap/release/manual preview workflows share `arcana-preview-migration`. Other operator paths must honor that maintenance lock too. No commands here dispatch a workflow automatically.

## Role preparation and ownership handoff

First inspect `pg_roles`, `pg_auth_members`, database/schema ACLs, relation owners and effective privileges. Absence from a provider role listing is not proof a PostgreSQL role is absent. If either intended role already exists, stop to review it; do not silently repurpose or reset it. Record PUBLIC/inherited privileges and SECURITY DEFINER function access as well as explicit grants. Runtime must not inherit operator or migrator privileges.

For absent roles, a separately approved operator can create `arcana_staging_migrator` and `arcana_staging_runtime` with `LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS` and no role memberships. Set fresh passwords through a secure password prompt or credential management flow; never put them in SQL files, logs, workflow inputs or chat. Role creation alone is insufficient.

Grant both roles CONNECT on `neondb` and USAGE on `public`; grant only the migrator CREATE on `public`. Neither role should own the database/schema, have CREATE on the database or other schemas, or have any membership in elevated provider roles. The normal release runner checks the actual connected session for these restrictions and rejects `neondb_owner`, elevated attributes, memberships, auth/non-public ownership and other-schema CREATE. This is a guard, not a comprehensive privilege audit.

After bootstrap **and baseline**, transfer these exact relations individually from the operator to `arcana_staging_migrator`:

```sql
ALTER TABLE public.arcana_external_identities OWNER TO arcana_staging_migrator;
ALTER TABLE public.arcana_identity_link_audit OWNER TO arcana_staging_migrator;
ALTER TABLE public.arcana_host_state OWNER TO arcana_staging_migrator;
ALTER TABLE public.arcana_user_decks OWNER TO arcana_staging_migrator;
ALTER TABLE public.arcana_rate_limits OWNER TO arcana_staging_migrator;
ALTER TABLE public.arcana_card_artwork OWNER TO arcana_staging_migrator;
ALTER TABLE public.arcana_manifest_uploads OWNER TO arcana_staging_migrator;
ALTER TABLE public.arcana_visual_packs OWNER TO arcana_staging_migrator;
ALTER TABLE public.arcana_visual_pack_artwork OWNER TO arcana_staging_migrator;
ALTER TABLE public.arcana_migration_history OWNER TO arcana_staging_migrator;
```

Verify this exact list and current ownership first, then execute the approved handoff transaction with bounded lock/statement timeouts. PostgreSQL requires the operator to be able to SET ROLE to the new owner and the new owner to have CREATE on the relation's schema. If temporary membership is needed, grant **migrator to operator**, never operator to migrator, and revoke it in the same handoff transaction. Do not use `REASSIGN OWNED`, transfer auth/managed-schema ownership, or change PUBLIC privileges without separately reviewing their effect on existing applications. See [PostgreSQL ALTER TABLE ownership requirements](https://www.postgresql.org/docs/current/sql-altertable.html).

Grant runtime SELECT/INSERT/UPDATE/DELETE only on the reviewed application tables it uses: external identities, host state, user decks, rate limits, card artwork, manifest uploads, visual packs and visual pack artwork. After 006, explicitly add `arcana_visual_pack_assets`. The existing thirteen `arcana_auth_*` tables require separately reviewed DML grants from their existing owner for self-hosted Better Auth; keep their ownership with the auth/operator path. Verify the exact auth table list from the deployed auth schema. Do not grant runtime access to `arcana_migration_history` or `arcana_identity_link_audit`, TRUNCATE, schema CREATE or role membership. No blanket grants on all public tables or default grants on future tables: later access/audit/entitlement tables may require different permissions.

Connect directly as each new role to verify effective privileges. Migrator must be able to run normal read-only plan/status and own the listed domain relations; runtime must pass synthetic app/auth reads and writes but fail DDL and ledger/audit access. Check effective CREATE from PUBLIC and any function-mediated access; an explicit REVOKE from runtime does not override privileges granted to PUBLIC. Fix any inherited excess through a separately reviewed change before release. PGlite tests cannot establish the live Neon role graph, ACLs, provider ownership-transfer capability or network credentials.

Use the pooled runtime endpoint for Vercel's staging-only `DATABASE_URL` and any `BETTER_AUTH_DATABASE_URL` override, with the runtime role. Keep the direct migrator connection exclusively in the protected release environment. Confirm secure configuration selects this root and never production. Auth-schema migration and future auth ownership changes remain separate from domain migration.

## Local verification

`npm --prefix mcp run test:migration-runner` exercises target/recovery rejection, exact source and owner checks, invalid artwork data, read-only planning, changed-plan refusal, transactional DDL rollback, repeat behavior, preservation of seeded data and an auth fixture, baseline then catalog upgrade, and restricted-role rejection. `node --test tools/test/staging-release.test.mjs` checks workflow guards and separation of one-time owner from recurring migrations. Tests use disposable local fixtures and synthetic credentials; no provider or live database calls are made.
