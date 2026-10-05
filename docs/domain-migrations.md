# Versioned domain migrations

Domain schema changes are an explicit release step, never server startup DDL or browser-pasted SQL. The runner uses only `DATABASE_MIGRATION_URL`. Runtime `DATABASE_URL` is never a fallback. Auth retains its separate plan/check/apply workflow in [better-auth-deployment.md](better-auth-deployment.md).

## Before any database operation

Use a direct connection for a dedicated migration role. Independently verify the endpoint's Neon project/branch, database, role, and intended preview or production environment in the provider. The CLI verifies the URL host/database/user/port and connected database/user; the environment label is an operator assertion, not provider discovery. It cannot prove a Neon branch name from a PostgreSQL connection. Review the exact application commit and a backup/recovery reference. Do not paste credentials into arguments, logs, reports, or this document.

Set `DATABASE_MIGRATION_URL` through the operator's existing secret mechanism. With the reviewed values substituted:

```sh
npm run db:migrate:domain --prefix mcp -- plan \
  --target preview --expected-host REVIEWED_DIRECT_HOST \
  --expected-database REVIEWED_DATABASE --expected-user REVIEWED_MIGRATION_ROLE
```

`status` has the same read-only behavior and exits 2 when baseline or pending migrations remain; it exits 0 only when current. Neither creates the ledger. Plan reports pending versions/checksums, or `baselineRequired` and an exact schema-matching historical candidate. A null candidate requires investigation. The default port is 5432; supply `--expected-port` for another reviewed port. Connection query parameters other than `sslmode` are rejected to prevent target overrides.

For an empty database or a database already tracked by the ledger, run the same command with `apply` and `--backup-reference REVIEWED_REFERENCE`. All pending catalog migrations are applied; retired opt-in flags and `--apply` are rejected. No runtime feature is enabled by applying schema.

## Adopt an existing database

Never rerun the old concatenating runner to establish history. After a read-only plan and backup review, use `baseline --through N --backup-reference REVIEWED_REFERENCE` with the same target flags. The baseline verifies the entire public `arcana_*` table schema (excluding the separately managed `arcana_auth_*` namespace) against the committed snapshot after version N, including column types/nullability/defaults, keys/checks/FKs, indexes, policies, triggers and row-security flags. Only an exact match is recorded, in one transaction, without executing historical SQL. Auth tables remain separate. PostgreSQL 18 NOT NULL constraint catalog entries are normalized away because column nullability is already compared, allowing the same snapshot to be checked on PostgreSQL 17.

This deliberately refuses a predecessor identity table with the old unique-principal constraint, incomplete migrations, out-of-order legacy opt-in combinations, unexpected indexes, and schema drift. Do not guess N, edit catalog history to fit production, or manually insert ledger rows. Investigate the difference and review a separately coordinated reconciliation procedure. Catalog expressions can differ across PostgreSQL major versions: validate against the actual target major version before rollout; a mismatch must fail closed.

After baseline, run `plan`, review pending versions, then `apply`. Inspect `status` afterward. The migration ledger stores version, SHA-256, filename, operation, timestamp and database role. An unknown/gapped version, checksum mismatch or schema mismatch stops execution. Each operation holds advisory transaction lock 184734901 with a 5-second lock timeout and 30-second statement timeout. DDL and ledger writes commit together. Keep other schema writers quiescent: advisory locks coordinate cooperating runners, not arbitrary DDL. If a connection fails around commit, inspect status before retrying; do not assume the outcome.

## Existing preview migration stage

`.github/workflows/preview-migrate.yml` is manually dispatched from main. It checks out a full reviewed commit SHA, installs locked dependencies and runs the selected operation against one existing preview database. It neither creates nor deletes Neon branches, deploys Vercel, nor changes secrets/grants.

Operator setup (not performed by this change):

1. Configure the `arcana-preview-migrations` GitHub environment with required reviewers, no self-approval, and allowed deployment branches. Review the full input SHA and its runner/dependencies before approval; that code receives the migration credential.
2. Bind its `ARCANA_PREVIEW_MIGRATION_URL` environment secret to the independently verified existing preview branch and dedicated migration role. Do not use a production or runtime credential. Restrict the role and runtime grants through a separate reviewed procedure.
3. Dispatch `plan`; resolve baseline/drift if needed, then approve baseline/apply with backup evidence. Preserve the workflow run as release evidence.
4. Verify migration status, the exact preview deployment's `/readyz`, and application smoke tests. A Vercel build marked READY does not establish database/schema readiness. Missing auth schema, connectivity or grants can still prevent readiness.

No environment, secret or provider resource has been created by adding this workflow. It is unusable until the operator setup is complete. No automatic production migration job is included.

## Production migration before promotion

For each release, record one application commit, catalog checksums, independently verified production endpoint, backup/recovery reference and candidate deployment ID. Build the candidate without routing production traffic. In a protected operator/release context, run production `plan`, any separately approved baseline, and `apply` using the dedicated migration connection and `--target production`. Auth migration review remains separate. Run domain `status`, auth `check`, and readiness/smoke checks against the candidate and intended database. Promote that exact deployment only after these pass and release approval is recorded. Promotion is a separate manual operation; this change does not wire production credentials or writes into CI. On failure leave the old deployment serving and investigate. Additive schema remains after an application rollback; no down migration or automatic destructive rollback is provided.

## Add the next migration

Do not edit numbered SQL or existing catalog entries. Add a sequential numbered SQL file with reviewed transactional PostgreSQL DDL (no explicit transaction control, nontransactional commands, or external side effects). Run `npm run db:domain:catalog:append --prefix mcp`, which replays only into an in-memory PGlite database, refuses changes to historical entries, and appends the new schema snapshot and exact-byte checksum. Review and commit both. CI checks historical bytes/catalog entries against the base commit and tests snapshots, rollback and concurrency using a disposable PostgreSQL 17 service.

This prerequisite is based on main through migration 005. PR105's 006 must be rebased, registered with its existing SQL bytes, and tested through this runner before its release. Preserve its existing preview database branch. Do not infer that 006 alone repairs its unhealthy database readiness.
