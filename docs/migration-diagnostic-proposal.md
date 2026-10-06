# Proposed read-only schema diagnostic (not published or dispatched)

The live plan succeeded but returned baselineRequired=true and verifiedBaselineCandidate=null. Its strict comparison covers public arcana_* relations except arcana_auth_* and the history table: relation kind/RLS, column order/type/nullability/default/identity/generated, constraints/validation, indexes/validity, triggers and policy names. The previous output does not identify the failing fields. No actual mismatch is yet established beyond the complete snapshots differing.

This patch adds diagnostic output only when an untracked, nonempty schema matches no historical snapshot. It reuses the exact schema(db) SELECT already executed by plan; no additional table scans or user rows. Existing transaction/lock/timeouts and target/native-transport guards are unchanged. It adds only this metadata query within BEGIN READ ONLY:

```sql
SELECT current_setting('server_version_num') AS server_version_num,
       current_setting('transaction_read_only') AS transaction_read_only
```

Existing SQL remains BEGIN READ ONLY; SET LOCAL search_path/lock_timeout/statement_timeout; SELECT pg_advisory_xact_lock; SELECT to_regclass for ledger presence; SELECT history version/checksum/file/operation only if the ledger exists; and the existing pg_catalog schema snapshot SELECT; then COMMIT. Plan never creates a ledger or executes migration SQL. The mismatch path has no ledger, so it does not read ledger rows either.

Output: diagnosticContext reports PostgreSQL numeric version and read-only state. schemaDiagnostics reports per-version exactSnapshotMatch and differenceCount; closest comparisons and the latest snapshot include up to80 field-level differences with explicit truncation. A path identifies relation/column/constraint/index fields. Only boolean/number/null values are printed directly. All strings/SQL expressions/defaults/trigger definitions are SHA256 summaries; nonstandard identifiers are hashed. No raw schema dumps, SQL literals, function arguments, credentials or user rows are emitted. A field legend explains column/constraint/index positions. A zero field count with exactSnapshotMatch=false identifies serialization/order differences without changing strict baseline matching. Closest is diagnostic similarity, never baseline authorization.

Example from a disposable fixture (not staging): public.arcana_host_state.columns[1:state][2], expected=true, actual=false identifies changed nullability; [3] reports a changed default using hashes only. A missing public.arcana_visual_pack_assets relation is reported by name with missing=true and a hash of the expected metadata.

Publication proposal: after review, cherry-pick this local commit onto the existing feat/visual-pack-cover-backs branch. This avoids another Git/Neon preview branch, though pushing normally rebuilds the existing preview. Run its existing CI (diagnostic tests are added to test:migration-runner). Then dispatch the existing main workflow with operation=plan and that exact reviewed new SHA, identical target identifiers and blank write inputs. No workflow changes or merge are needed for this diagnostic execution. Do not publish or dispatch before coordination.

App mapping remains separate: Vercel metadata confirms deployment dpl_J3PEj1XGircrvsm25m9jhJvJHrAX uses c15c01e on feat/visual-pack-cover-backs. A decrypt=false branch env metadata query returns no branch-specific entries; shared preview DATABASE_URL/PGHOST/PGHOST_UNPOOLED/NEON_PROJECT_ID names exist as sensitive variables. Their values were not read. Neither this metadata nor the migration connection proves the effective app-to-Neon endpoint. That requires independent nonsecret provider/deployment mapping evidence; no runtime diagnostic or configuration changes are included.
