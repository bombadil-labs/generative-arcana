# Persistent staging release

Git `staging` is the integration candidate. It uses **Neon `main` inside the preview project**, not the production project and not Git `main`.

| Target | Pinned identity |
| --- | --- |
| Preview Neon project | `blue-pond-70470746` |
| Its persistent main branch | `br-solitary-shape-b7f1tpxs` |
| Database | `neondb` |
| Direct migration host | `ep-purple-hill-b7kz7n0g.c-13.us-east-1.aws.neon.tech` |
| Pooled runtime host | `ep-purple-hill-b7kz7n0g-pooler.c-13.us-east-1.aws.neon.tech` |
| Vercel project | `prj_PqzZBpZubFnrl3nmW12SmtDX3MfM` |
| Vercel team | `team_o9WQj6YpCF9JSk9wpVGfAmyb` |

The custom environment ID, stable alias, migration role and recovery evidence must be independently verified; there are no guessed defaults. Publishing this workflow authorizes no live migration, credential installation, provider calls or deployment. The root has no inherited PR105 disposable-data waiver.

## Platform prerequisites and temporary holds

1. Protect `staging` and Git `main`; require review and CI for candidate changes. Merge this infrastructure separately from feature PR110. Create/update staging only through the approved integration process. This change does not merge that feature.
2. Create GitHub environment `arcana-staging-release` with required reviewers, no self-approval where available, and a deployment branch policy allowing **only Git main**, because the trusted dispatcher runs there. Restrict who can edit its configuration. Candidate code gets migration credentials only after review of the exact staging SHA; CI success alone is not a security review.
3. Configure these environment secret REFERENCES securely: `ARCANA_STAGING_MIGRATION_URL` (dedicated direct application-schema migrator), `VERCEL_STAGING_TOKEN` (least available scope for the pinned project/team), and optional `STAGING_PROTECTION_BYPASS` for protected readiness checks. Never reuse production credentials, expose them as workflow inputs, or place operator credentials in application runtime. This repository contains no secret values.
4. Configure environment variables `STAGING_MIGRATION_ROLE`, `STAGING_ENVIRONMENT_ID`, `STAGING_ALIAS`, `STAGING_MAPPING_REVIEW`, `STAGING_MANUAL_ALIAS_REVIEW`. The last two are nonsecret evidence references documenting verified fixed-resource binding, runtime/auth isolation, automatic deployment/domain controls and ownership of the manual alias. Keep `STAGING_WRITES_ENABLED` and `STAGING_DEPLOY_ENABLED` absent/false until separately approved. Missing configuration fails closed.
5. Bind the Vercel custom environment `staging` to the exact existing preview resource root. Verify native integration injection really selects that root, including any auth connection override. Ordinary PR environments must keep their own child branches; never change global Preview credentials to the shared root. Check that native automation cannot create/rebind staging to a different Neon branch.
6. Disable automatic Git staging deployment **before the first staging push** using reviewed platform controls. Candidate `vercel.json` additionally sets `git.deploymentEnabled.staging=false`; this is not retroactive to old commits. Other branches and production retain their existing settings. A push validates code only; manual release deploys the exact Git SHA through the Vercel API.
7. The stable alias must be manually assigned, not an auto-tracked environment/branch/project domain. The release checks that the custom environment has no domains and the project has no automatic staging domain mapping. A custom-environment domain would otherwise move when the deployment finishes, before our readiness checks. Coordinate this with platform setup rather than silently removing domains. No automatic production promotion is used.
8. Verify the root's domain migration history, schema and recovery capability before planning. Unexpected drift/untracked history stops the runner. Existing reconciliation recipes are target-specific and must not be generalized automatically. Better Auth schema planning/application is separate from domain migrations. Runtime and migrator privileges must remain confined to application tables/schemas, never `neon_auth`.

## Authentication and data isolation

Use the stable staging HTTPS origin as `BETTER_AUTH_URL`; issuer is `<origin>/api/auth`, and `MCP_OAUTH_RESOURCE` must be `<origin>/mcp`. Both `DATABASE_URL` and any overriding `BETTER_AUTH_DATABASE_URL` must point to the preview project root. Configure staging-only auth keys, controlled SMTP/test recipients and exact OAuth callback registrations. Do not add wildcard origins or reuse production sessions/client registrations. Arcana uses self-hosted Better Auth, not Neon's managed auth service.

Leave `MCP_ALLOWED_HOSTS` unset in staging: the default exact-host list includes the platform's `VERCEL_URL` candidate hostname and the hostname from the configured `BETTER_AUTH_URL` stable origin. An explicit `MCP_ALLOWED_HOSTS` still replaces all defaults; if used, it must contain both exact hostnames and be updated for each deployment. Do not use wildcards or forwarded/request headers to discover trusted hosts. Browser auth retains its exact configured trusted origin.

Runtime must report the exact `VERCEL_GIT_COMMIT_SHA` (or securely configured `ARCANA_BUILD_SHA`) through `/readyz`. Before alias promotion, the unique deployment URL must serve `/readyz` without redirecting to the old alias; deployment protection must permit the approved read-only probe. With self-hosted Better Auth, readiness resolves issuer metadata through `browserAuth.handler` in-process and checks the exact configured issuer string: the stable alias need not already resolve for that issuer check. Database/auth schema readiness is still required. External OAuth issuer configurations fetch their metadata normally. The workflow neither weakens readiness nor promotes the alias before candidate readiness passes.

Keep the preview root's data synthetic/minimal. Ordinary Neon children can inherit root data, including auth/session/entitlement state; they are not sanitized merely because their names differ. Existing children do not receive later root migrations automatically. Hosted parlor stays disabled on general PR previews unless separately approved. This workflow neither enables provider keys nor changes PR preview provisioning/cleanup. Git `staging` is already protected by cleanup policy; retain the pinned Neon root protection and verify provider mapping before enabling any destructive cleanup.

## Deliberate release procedure

1. Integrate a reviewed candidate into `staging`; wait for the latest full `ci.yml` **push** run for that exact SHA to succeed. PR merge-ref checks alone do not qualify. The new CI staging trigger must already be present in the candidate.
2. Dispatch **Reviewed persistent staging release** from Git `main`, operation `plan`, and the full current staging SHA. Review the emitted plan and SHA-256 digest, recovery evidence, migration SQL/checksums, database target/role and schema compatibility. No credentials are printed; plan is read-only. `status` is also available.
3. After separate approval and enabling the appropriate hold variables, dispatch `apply` for migration only or `release` for migration plus deployment. Supply that exact plan digest, verified recovery reference and confirmation `APPLY <sha>` or `RELEASE <sha>`. Environment reviewers approve the run. A freshly generated plan must match before apply. Baseline/reconciliation are intentionally unavailable here.
4. Apply uses only the dedicated staging connection and pinned direct host/database/role. Status must show no pending migrations before the deployment job can start. Release then submits the **same SHA** to the exact custom environment, polls boundedly, verifies returned deployment project/environment/Git identity and `/readyz`, rechecks staging's current SHA and environment domain configuration, then manually assigns and verifies the stable alias.
5. Perform signed-in, logout, exact-origin/callback and synthetic-data acceptance after deployment. Readiness is not a substitute for that interactive acceptance. A production release is separate: use the approved production migration workflow and its own recovery/configuration/identity checks; do not point production at staging data or promote a staging-configured deployment to production.

The whole workflow shares `arcana-preview-migration` with the existing manual preview migrator, with `cancel-in-progress: false`. This serializes database work through alias promotion across those workflows; PostgreSQL advisory locks and bounded lock/statement timeouts remain the final database guard. GitHub concurrency is not FIFO and can replace a pending run; dispatch superseded work again only if still wanted. Other operator paths must honor this release lock; do not run ad hoc concurrent migrations.

Every write phase and alias promotion rechecks the candidate. Branch advancement while a deployment builds prevents alias promotion. The final ref check and remote alias write cannot be atomic across GitHub/Vercel; freeze staging advancement during release via the operator/review process. No automatic write retries, schema rollback or resource deletion occur. On failed migration/status, no deployment starts. On build/readiness/superseded failure, the stable alias remains unchanged. A response lost during deployment creation/alias assignment is uncertain: inspect the deployment/alias and migration status before retrying. If post-alias verification fails, stop and restore the prior alias only with a separately reviewed compatible rollback. Additive migrations may already be committed; older running code must tolerate them.

## Verification and sources

`node --test tools/test/staging-release.test.mjs` exercises wrong target/role, disabled writes, plan-digest mismatch, failed migration/status, exact-SHA validation, superseded candidates, wrong deployment identity, failed readiness, automatic-domain refusal and alias ordering with synthetic API responses. It makes no network/provider/database calls. Full CI remains the release acceptance gate. Platform mapping, root schema/recovery, secure configuration and real custom-environment deployment acceptance remain separate live checks.

- [GitHub deployment environments and concurrency](https://docs.github.com/en/actions/how-tos/deploy/configure-and-manage-deployments/control-deployments)
- [Vercel custom environments and automatic domain behavior](https://vercel.com/docs/deployments/environments)
- [Create deployment: customEnvironmentSlugOrId and Git source SHA](https://vercel.com/docs/rest-api/deployments/create-a-new-deployment)
- [Assign an alias](https://vercel.com/docs/rest-api/aliases/assign-an-alias)
- [Vercel deployment CLI](https://vercel.com/docs/cli/deploy): `--skip-domain` is documented for production, so this custom-environment path does not rely on it.
