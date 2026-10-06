# Versioned domain migrations

Domain schema changes are an explicit release step, never server startup DDL or browser-pasted SQL. The runner uses only `DATABASE_MIGRATION_URL`. Runtime `DATABASE_URL` is never a fallback. Auth retains its separate plan/check/apply workflow in [better-auth-deployment.md](better-auth-deployment.md).

## Before any database operation

Use a direct connection with a separately configured migration credential. A distinct least-privilege role is recommended, not technically required: an existing owner role can be used after explicit approval of its broader authority for the scoped migration environment. Independently verify the endpoint's Neon project/branch, database, role, and intended preview or production environment in the provider. The CLI verifies the URL host/database/user/port and connected database/user; the environment label is an operator assertion, not provider discovery. It cannot prove a Neon branch name from a PostgreSQL connection. Review the exact application commit and a backup/recovery reference. Do not paste credentials into arguments, logs, reports, or this document.

Set `DATABASE_MIGRATION_URL` through the operator's existing secret mechanism. With the reviewed values substituted:

```sh
npm run db:migrate:domain --prefix mcp -- plan \
  --target preview --expected-host REVIEWED_DIRECT_HOST \
  --expected-database REVIEWED_DATABASE --expected-user REVIEWED_MIGRATION_ROLE
```

`status` has the same read-only behavior and exits 2 when baseline or pending migrations remain; it exits 0 only when current. Neither creates the ledger. Plan reports pending versions/checksums, or `baselineRequired` and an exact schema-matching historical candidate. A null candidate requires investigation. The default port is 5432; supply `--expected-port` for another reviewed port. Only `sslmode` and `channel_binding=require` query parameters are accepted; duplicates and target overrides are rejected. Required channel binding also needs an explicit password and sslmode=require or verify-full.

For an empty database or a database already tracked by the ledger, run the same command with `apply` and `--backup-reference REVIEWED_REFERENCE`. All pending catalog migrations are applied; retired opt-in flags and `--apply` are rejected. No runtime feature is enabled by applying schema.

## Adopt an existing database

Never rerun the old concatenating runner to establish history. After a read-only plan and backup review, use `baseline --through N --backup-reference REVIEWED_REFERENCE` with the same target flags. The baseline verifies the entire public `arcana_*` table schema (excluding the separately managed `arcana_auth_*` namespace) against the committed snapshot after version N, including column types/nullability/defaults, keys/checks/FKs, indexes, policies, triggers and row-security flags. Only an exact match is recorded, in one transaction, without executing historical SQL. Auth tables remain separate. PostgreSQL 18 NOT NULL constraint catalog entries are normalized away because column nullability is already compared, allowing the same snapshot to be checked on PostgreSQL 17.

This deliberately refuses a predecessor identity table with the old unique-principal constraint, incomplete migrations, out-of-order legacy opt-in combinations, unexpected indexes, and schema drift. Do not guess N, edit catalog history to fit production, or manually insert ledger rows. Investigate the difference and review a separately coordinated reconciliation procedure. Catalog expressions can differ across PostgreSQL major versions: validate against the actual target major version before rollout; a mismatch must fail closed.

After baseline, run `plan`, review pending versions, then `apply`. Inspect `status` afterward. The migration ledger stores version, SHA-256, filename, operation, timestamp and database role. An unknown/gapped version, checksum mismatch or schema mismatch stops execution. Each operation holds advisory transaction lock 184734901 with a 5-second lock timeout and 30-second statement timeout. DDL and ledger writes commit together. Keep other schema writers quiescent: advisory locks coordinate cooperating runners, not arbitrary DDL. If a connection fails around commit, inspect status before retrying; do not assume the outcome.

## Existing preview migration stage

`.github/workflows/preview-migrate.yml` is manually dispatched from main. It checks out a full reviewed commit SHA, installs locked dependencies and runs the selected operation against one existing preview database. It neither creates nor deletes Neon branches, deploys Vercel, nor changes secrets/grants.

Operator setup (not performed by this change):

1. Configure the `arcana-preview-migrations` GitHub environment with branch main allowed and the operator-confirmed protection policy. Required reviewers and prevention of self-review are optional policy choices, not assumed staffing requirements. Preserve any existing protections. Review the full input SHA and its runner/dependencies before dispatch or approval; that code receives the migration credential.
2. Bind its `ARCANA_PREVIEW_MIGRATION_URL` environment secret to the independently verified existing preview branch and explicitly approved role. Never use a production credential for preview or fall back to runtime configuration. A separate least-privilege role is recommended; existing owner credentials require explicit approval of their broader authority. Role/grant changes remain a separate procedure.
3. Dispatch `plan`; resolve baseline/drift if needed, then approve baseline/apply with backup evidence. Preserve the workflow run as release evidence.
4. Verify migration status, the exact preview deployment's `/readyz`, and application smoke tests. A Vercel build marked READY does not establish database/schema readiness. Missing auth schema, connectivity or grants can still prevent readiness.

No environment, secret or provider resource has been created by adding this workflow. It is unusable until the operator setup is complete. No automatic production migration job is included.

### Concrete setup for the existing PR105 preview

This is an operator checklist, not authorization for the agent to change roles, grants, secrets or settings. Use only project **neon-indigo-kettle**, ID **blue-pond-70470746**, branch **preview/feat/visual-pack-cover-backs**. Do not use an older static-card-artwork endpoint, either main branch, or a new database branch.

1. Verify the exact project/branch, branch ID, PostgreSQL major version and application deployment mapping. The reviewed connection dialog shows direct host `ep-fragrant-morning-b7w91pb6.c-13.us-east-1.aws.neon.tech`, database `neondb`, and existing role `neondb_owner`, with pooling off. This records metadata, not a successful connection, schema inspection or verified application mapping. Retrieve credentials only through the authorized secret mechanism; never paste them into chat or reset passwords to retrieve them.
2. The runner requires a dedicated connection variable, not a new role. If the user approves the owner credential for this scoped preview environment, use `neondb_owner` as expected user. A less privileged role remains a recommendation. Its minimum scope includes CONNECT, USAGE/CREATE on public, and ownership/membership rights sufficient to alter domain objects and manage the ledger; DML grants alone are insufficient. No role, ownership, grant or runtime-access changes are authorized here.
3. A repository admin opens **Settings → Environments → New environment**, names it **arcana-preview-migrations**, permits only branch **main** under deployment branches/tags, and selects the confirmed protection policy. A sole maintainer can manually review the exact SHA/target and dispatch without adding an independent-reviewer requirement. If the team chooses required reviewers, prevention of self-review, or disabled administrator bypass, confirm that staffing/policy explicitly; do not weaken any existing protections. The repository is public, so GitHub documents these optional protections as available on current plans. Under **Environment secrets → Add secret**, enter **ARCANA_PREVIEW_MIGRATION_URL** and paste the reviewed direct migration URI there, never into a workflow input or chat. These are proposed setup changes, not changes this task has made. A metadata read of this environment returned HTTP 404; existence/access could not be confirmed. [GitHub environment instructions](https://docs.github.com/en/actions/how-tos/deploy/configure-and-manage-deployments/manage-environments).
4. Use a reviewed revision containing the native compatibility transport described below. Do not remove `channel_binding=require`. The workflow prepares the pinned client before passing the migration secret to the operation step.
5. Open **Actions > Approved existing preview migration > Run workflow** on main. The workflow is registered, but this compatibility patch must first be reviewed and landed, then reconciled into PR105. Use that new full SHA containing registered 006; the earlier PR105 SHA lacks this transport. Review the exact code receiving the credential. This task has not configured secrets, dispatched the workflow or connected to Neon.
| Workflow input | Exact value or evidence |
| --- | --- |
| `reviewed_sha` | Full 40-character reviewed commit. For the PR105 release, use its reconciled head containing this runner and registered 006, not its old runner or an unreviewed branch tip. |
| `operation` | Start with `plan`; use `baseline`, `apply`, or `status` only after reviewing the preceding result. |
| `expected_host` | Actual direct read/write compute hostname from the selected PR105 branch; no `-pooler`. |
| `expected_database` | Reviewed connection-dialog value `neondb`; verify the application mapping before execution. |
| `expected_user` | Exact approved role; `neondb_owner` only after approval of its broader credential authority. |
| `backup_reference` | For baseline/apply, a short nonsecret reference to reviewed recovery evidence containing project/branch IDs, capture/restore-point UTC time, usable retention/expiry or backup location, and responsible operator. Verify the existing recovery mechanism covers this specific preview and planned time window. A made-up reference or an unverified retention setting is not evidence. No backup branch/resource is created by this workflow. |
| `baseline_through` | Blank for plan/apply/status. For baseline, the integer from an exact `verifiedBaselineCandidate`, after schema/recovery review; never guess 5 or 6. |

For staging acceptance, preserve the plan result, approved baseline (if needed), apply result, subsequent current status, and a second apply showing the same recorded version and no pending migrations. Inspect ledger versions/checksums read-only and verify PR105 readiness/application smoke tests. Do not deliberately corrupt checksums/schema, reset the shared preview, or execute a destructive rollback to test failure handling; disposable CI already covers those cases. Transaction failures roll back DDL and ledger together, but network failures at commit require status inspection before retry. Any recovery that would reset data or create a branch needs separate coordination.

## Production migration before promotion

For each release, record one application commit, catalog checksums, independently verified production endpoint, backup/recovery reference and candidate deployment ID. Build the candidate without routing production traffic. In a protected operator/release context, run production `plan`, any separately approved baseline, and `apply` using the dedicated migration connection and `--target production`. Auth migration review remains separate. Run domain `status`, auth `check`, and readiness/smoke checks against the candidate and intended database. Promote that exact deployment only after these pass and release approval is recorded. Promotion is a separate manual operation; this change does not wire production credentials or writes into CI. On failure leave the old deployment serving and investigate. Additive schema remains after an application rollback; no down migration or automatic destructive rollback is provided.

## Add the next migration

Do not edit numbered SQL or existing catalog entries. Add a sequential numbered SQL file with reviewed transactional PostgreSQL DDL (no explicit transaction control, nontransactional commands, or external side effects). Run `npm run db:domain:catalog:append --prefix mcp`, which replays only into an in-memory PGlite database, refuses changes to historical entries, and appends the new schema snapshot and exact-byte checksum. Review and commit both. CI checks historical bytes/catalog entries against the base commit and tests snapshots, rollback and concurrency using a disposable PostgreSQL 17 service.

The PR105 catalog now registers `006-visual-pack-assets.sql` with SHA-256 `61afdfd2b6134f8b0b39de66db9be6444590ce65d1f4d6d80e9b0f5c8111d34d` and the generated post-006 schema snapshot. SQL bytes and historical entries 001–005 are unchanged. Pending discovery includes 006 automatically; no feature-specific migration flag is needed. The tracked-v5 regression verifies that plan reports only 006, failed postconditions roll back its table and history, successful application preserves legacy/named fronts and deck revisions, and the second apply is a no-op. The same regression runs against disposable PostgreSQL 17 in CI. Before live baseline/apply, review the exact reconciled PR105 SHA and verify its existing preview target, connection and schema. No live migration or PR105 merge is implied by these tests. Do not infer that 006 alone repairs its unhealthy database readiness.


## Required channel binding transport

For a URI with `channel_binding=require`, the CLI starts a migration-only Python 3.12 helper using public Psycopg APIs and bundled libpq. Libpq enforces SCRAM channel binding, including rejecting trust, MD5, cleartext and non-TLS authentication. The helper strengthens sslmode=require to verify-full, checking CA chain and hostname. It uses no node-postgres preference flag, private authentication hook, or driver fallback. Legacy URIs without channel binding retain the pg path.

The URI travels through stdin, not process arguments. Driver details/stderr are suppressed; errors expose a generic category and SQLSTATE. One native connection holds transactions/advisory locks throughout the operation. Helper loss stops the run; inspect status before retrying an uncertain commit. Runtime Dockerfiles/packages, SQL and catalog checksums are unchanged.

Local setup: create a temporary Python 3.12 venv, then use its Python to run `-m pip install --require-hashes --only-binary=:all: -r mcp/scripts/libpq/requirements.txt`. Set `MIGRATION_PYTHON` to its bin/python (Windows: Scripts/python.exe). No global installation is needed. Hashes cover CPython 3.12 Windows x64 and Linux x64 wheels; unsupported platforms fail rather than compile or choose unreviewed versions. The helper requires binary libpq >=17; the pinned package tested here bundles 18.4. Pinned certifi supplies trusted roots; `DATABASE_MIGRATION_CA_FILE` can explicitly select a reviewed private CA without disabling verification. The workflow uses RUNNER_TEMP. Python is not added to the application image.

For disposable transport tests, run `bash mcp/test/run-libpq-fixture.sh` with MIGRATION_PYTHON set and PostgreSQL server binaries/OpenSSL on PATH. The script creates a fresh cluster, binds loopback only, and stops its server on exit. It never connects to Neon.

## Proposed automated release sequence (not wired)

One-time setup binds verified targets and scoped credentials to preview/production environments, establishes recovery evidence and schema-verifies historical baseline. Baseline is bootstrap: ordinary releases must refuse untracked existing databases instead of adopting them silently.

A release orchestrator should check code/catalog for one immutable SHA, build an unpromoted candidate, then plan/apply/status against its verified existing database using that SHA. Serialize releases per target and retain evidence. After domain status, separate auth checks, readiness and smoke tests pass, promote that exact candidate. Do not automatically retry uncertain commits, repair drift, run down migrations or create database branches. Production credentials remain scoped to their environment and agreed approval policy.

Vercel Git production auto-promotion is outside this workflow. A migration job alone cannot guarantee ordering: before automatic writes, configure one promotion owner/gate so traffic cannot advance before migration and health checks succeed. This patch changes only dependency preparation in the existing manual workflow; no release trigger or production write is added. Neither MCP connectivity nor browser SQL is part of the proposed release path.
