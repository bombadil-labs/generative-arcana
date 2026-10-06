# Production rollout proposal — draft maintenance, not approved for execution

Parent's read-only evidence at 2026-10-06T05:15:07.875Z identifies project `dark-poetry-32860113` / `neon-cyclamen-bucket`, branch `main` / `br-steep-heart-b7gdc818`, direct endpoint `ep-square-sun-b79gp0dh.c-13.us-east-1.aws.neon.tech`, database `neondb`, PostgreSQL18.6. The inspected domain schema matches catalog005 except the named artwork mediaType check lacks an explicit nonnull test. No migration ledger or006 table exists; the aggregate found zero violating rows. This worker has not independently fetched that snapshot or verified a production migration role. Preserve the originating inspection artifact with the approval record.

## Narrow change

`reconcile-production` is a dedicated, checksum-reported recipe. It only replaces `arcana_visual_pack_artwork_asset_check` with the exact004/005 catalog definition. It creates no tables, edits no rows, and writes no ledger. Historical SQL and catalog checksums stay unchanged. The strict baseline matcher is unchanged; weaker schemas continue to fail.

The CLI requires the exact production host/database/port, production target, an explicit role matched to the dedicated connection and connected identity, and a reviewed recovery reference. Disposable-staging evidence is rejected. The transaction takes the existing migration advisory lock, locks catalog tables against concurrent DDL and the artwork table against writes, checks absence of history, compares the full reviewed source profile (including RLS/constraints/triggers), reruns the zero-invalid aggregate, applies one ALTER, and verifies strict005 before committing. Timeouts remain5s lock/30s statement. Mismatches/failures roll back. A retry after success refuses the now-strict schema; use plan/status after uncertain outcomes, never blindly retry.

## Versioned delivery and approval gates

The proposed `production-migrate.yml` follows the existing manual dispatcher: default-branch dispatch only, exact reviewed40-character SHA checkout, Node24/Ubuntu24.04, pinned native libpq, dedicated `arcana-production-migrations` environment and `ARCANA_PRODUCTION_MIGRATION_URL` secret, plan default, serialized runs. It has no push/deployment trigger, automatic writes, or promotion. Its target guard applies to all operations and is fixed to this production host/database. No secret or environment has been created.

After approval to publish, land the maintenance runner/dispatcher through a reviewed maintenance change before feature promotion (or an approved separate dispatcher-only prerequisite referencing the CI-passed implementation SHA). The manual workflow must exist on main before it can be dispatched. Do not merge105 merely to obtain a workflow. Obtain successful existing CI, including the new PGlite tests and PG18 native rollback/lock/concurrency fixture, on the exact runner SHA before any production execution.

This maintenance branch is based on main90ff35c and contains no PR105 feature files,006 migration, staging reconciliation, or staging diagnostics. Its catalog ends at005. After the prerequisite lands, incorporate it into the existing105 branch and obtain successful CI on that combined SHA. Use that reviewed combined SHA for the full rollout below, so the catalog includes006 without merging/promoting the feature prematurely. On this maintenance-only SHA, tests establish reconciliation/baseline005 and no pending migrations; the same suite checks006 application when run with the combined catalog. The earlier local candidate's006 checks passed, but they are not a substitute for combined-SHA CI.

An operator must securely configure the dedicated direct migration URL in that production environment if absent, with the verified authorized role and TLS/channel-binding parameters required by the existing runner. Do not copy the runtime URL through chat, relax grants, edit auth secrets, or enable automatic production writes. Normal runtime and migration credentials remain separate.

## Required recovery evidence and minimal user action

Reported21600-second retention is not a verified restore point. Before live writes, document a concrete recoverable point within retention (or a completed approved backup), target/branch identity, time, and a viable tested/documented recovery procedure. Account for writes occurring after that point. Creating recovery resources or restoring production requires separate authorization; this proposal performs neither. The reference string is an audit pointer, not programmatic proof of backup readiness.

Publication of this bounded draft maintenance proposal is approved. Before execution, confirm the actual recovery evidence, authorized migration role/dedicated scoped secret, and explicitly approve the following production operations. No independent extra reviewer is required by this proposal.

## Execution order after approval

1. Dispatch `plan` at the pinned implementation SHA with the verified production role. Confirm exactly the known mismatch and no ledger; compare to the retained inspection evidence.
2. Dispatch `reconcile-production` with the genuine recovery reference. Expect strict005, zero noncompliant rows, no ledger write, and the reported recipe checksum.
3. Dispatch `plan`; require `verifiedBaselineCandidate:5` with exact schema verification.
4. Dispatch `baseline`, `baseline_through:5`, same recovery reference. This records001–005 without rerunning their SQL.
5. Dispatch `plan`; require only006 pending and immutable checksum `61afdfd2b6134f8b0b39de66db9be6444590ce65d1f4d6d80e9b0f5c8111d34d`.
6. Dispatch `apply` with recovery reference, then `status` (through6/no pending), then repeat `apply` to demonstrate no-op.
7. Only then coordinate105 merge/promotion separately, verify exact deployed SHA, readiness, public issuer, and approved production feature smoke tests. Schema readiness alone does not authorize promotion or prove storage access.

If constraint or006 transaction fails, the transaction rolls back; preserve evidence and diagnose. If the connection drops near commit, inspect plan/status first. Do not drop tables, reverse the constraint, delete history, reset the database, or invoke the staging-only repair as a recovery shortcut. If rollout stops after reconciliation/baseline, the additive schema and unchanged row data permit deliberate continuation after review.

## Test evidence

Local disposable tests cover exact target/evidence rejection, strict-baseline rejection before repair, full-schema mismatch refusal, missing/null mediaType refusal without row changes, injected post-DDL rollback, all domain-row preservation, strict005 adoption, only006 pending, immutable history checksums, status and no-op. The native PG18 fixture additionally covers actual table lock timeout and concurrent repair (one success, one profile refusal). Native runs and hosted CI are required before live execution; do not represent unrun checks as passed.

Executed locally: MCP typecheck, new production PGlite suite, existing migration-runner and preview-reconciliation suites passed. Native PG18 execution was attempted using the existing task-local fixture, but WSL failed before startup (`Wsl/Service/CreateInstance/E_FAIL`, code6/step2). No machine settings were changed. The new native test remains unexecuted locally and must pass in the existing PG18 CI job before rollout.
