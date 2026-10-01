# Preview data isolation: preparation and cutover

Scope: operator runbook. This document itself changes no integration settings, branches,
credentials or deployments. Provider changes require separate approval and live verification.
The cleanup adaptation described below remains locally prepared and disabled until reviewed.

## Recommended architecture after inspecting the connection form

The inspected connection form exposes environment selection, a required-resource switch,
Preview/Production branch-creation checkboxes, a custom variable prefix and Sensitive switch.
It exposes no source-branch or schema-only selector. The resource's Projects table has separate
Preview and Production connections. These observations do not yet establish the effect of
removing one connection or the actual runtime variable mappings.

**Prefer a second Neon resource/project containing only synthetic preview data, with native
automatic preview branching retained.** Leave the existing Production project, default branch
and Production connection unchanged. This is smaller operationally than building custom CI
provisioning and maintaining new provider tokens/deployment orchestration.

The second project's ordinary default root starts empty. Initialize it from the reviewed repo
domain migration (`mcp/migrations/001-domain.sql`) and generated/reviewed Better Auth schema
plan, then optionally add synthetic fixtures. No production data dump or cross-project
schema-only cloning is needed. The schema-only API's source is within a project; do not assume
it can clone across projects. With **only synthetic data anywhere in the new project**, the
native integration's default source cannot expose production rows, regardless of which root
it selects. Still verify the exact ancestry of the first resulting preview.

### Capacity and price: verify the actual installation

The [native integration guide](https://neon.com/docs/guides/vercel-managed-integration#add-another-database-project)
documents adding another database/project through **Integrations → Neon Postgres → Manage →
More Products → Install**. The [Vercel listing](https://vercel.com/marketplace/neon) advertises
plans starting at $0, and [current general Neon plans](https://neon.com/docs/introduction/plans#plan-overview)
list Free at $0/month with 100 projects, 10 branches per project and 100 CU-hours per project.
These published limits are not a live eligibility/billing check for this installation.

The smallest next operator action is to open that add-resource screen and inspect its plan,
region, limits and displayed price **without creating or upgrading anything**. Confirm Free/$0
is offered for the new resource before approval. The native guide warns that changing plans
affects all databases in the installation. Do not change the existing installation's plan
just to add this preview resource. A new project's branch allowance avoids deleting existing
acceptance previews to make room, but its own previews still require lifecycle management.

### Second-resource cutover sequence

1. Verify and approve the new resource's exact plan, region and name; create it disconnected
   from Arcana until schema initialization and configuration have been reviewed
2. Initialize its empty default root using the existing domain/auth migration tools, approved
   exact endpoint and separate permissions; verify schema readiness and absence of real data
3. Prepare Preview-only auth origin/keys/mail and database-variable mapping. The inspected
   custom prefix field shows `STORAGE` with a fixed `_URL` suffix; do not assume the generated
   key names. Arcana reads `DATABASE_URL`, not `STORAGE_URL`. Verify the actual injected names
   and resolve any old static values or `BETTER_AUTH_DATABASE_URL` override before deployment
4. Review the precise removal/switch of **only the old Preview connection** and addition of
   **only the new Preview connection**, retaining Required and Preview branch creation on the
   new resource. Do not modify the old Production row or delete either resource/its branches
5. Verify the old Preview hook no longer creates production-derived branches, the new native
   deployment injection wins, and the acceptance checks below pass on one controlled preview

Do not merely uncheck native branch creation while leaving the old Preview connection active:
that can leave previews using the old project's default database rather than isolated branches.
Do not run both old and new native Preview connections concurrently as an experiment; duplicate
variable injection and continued production copying must be resolved before a new deployment.

Keep the old project/preview data intact pending separately approved retirement. Disconnecting
the old Preview connection is not itself an approved deletion or a claim about existing deploys.
The exact provider effect must be reviewed from its confirmation screen before proceeding.

This approach needs secure one-time DB/auth setup but does **not** require adding Neon/Vercel
API tokens to GitHub Actions. Existing repo migrations and native deployment remain the tools.
Keep custom explicit-parent CI as a fallback only if the provider cannot support the separate
resource connection or pricing makes the second resource unsuitable.

## What needs isolating

An ordinary Neon branch is a snapshot of both schema and data. It protects production from
preview writes, but it is not a sanitized dataset. Later production writes do not propagate
into an already-created branch; new branches and resets can copy newer data.

Arcana runs **self-hosted Better Auth**, using `arcana_auth_*` tables and the application's
`/api/auth` endpoint. Neon's managed `neon_auth` service is separate. Do not enable, disable,
edit or delete that service as a shortcut, and do not substitute `NEON_AUTH_BASE_URL` for
Arcana's own auth configuration.

Check all of the following together:

- `DATABASE_URL`, and `BETTER_AUTH_DATABASE_URL` if present. The latter overrides the auth
  connection and can silently keep authentication on production after the domain DB moves
- Preview-specific `BETTER_AUTH_SECRET` or key ring, without inherited production keys
- A stable preview `BETTER_AUTH_URL` and matching `/mcp` resource/issuer configuration
- Explicit isolated SMTP/test recipients. Production Resend injection is not mail isolation
- Application data, auth identities, sessions, tokens and user-authored deck content, rather
  than just a users table or an email column

See [the existing auth deployment checklist](better-auth-deployment.md) for exact runtime
variables and [staging preflight](#reuse-the-existing-read-only-preflight) below.

## Provider decision first

The [native integration](https://neon.com/docs/guides/vercel-managed-integration) injects
branch-specific variables at deployment time, overriding configured Preview variables.
Changing ordinary Preview `DATABASE_URL` alone does not disable production-derived copying.
The documented native setup exposes Preview branching and environment selection, but does
not document a per-preview schema-only or custom-parent option. Absence from the guide is
not proof that the current UI lacks a control: inspect the actual connection without saving.

The earlier alternatives below remain available if the recommended second-resource path is
not supported by the actual installation:

1. **Native safe source, if actually supported:** select a verified safe source specifically
   for Preview while leaving Production's database and settings intact. Record the real
   control/API and verify a resulting preview before claiming success.
2. **Explicit-parent provisioning, if needed:** first establish how to stop the native
   Preview branch-creation/injection path while preserving the Production connection.
   Then provision previews using the approved safe source and inject their exact variables.
   The [official Neon create-branch Action](https://github.com/neondatabase/create-branch-action)
   accepts `parent_branch`; use its explicit immutable branch ID rather than the default.
   This requires a reviewed implementation and authorized credential setup, not merely an
   extra Action running alongside native branching.
3. **Short-term shared staging, only if chosen:** one isolated schema-only database can serve
   a deliberately limited preview for acceptance. It is not per-PR isolation; concurrent
   previews can interfere. It still requires disabling conflicting native injection and
   scoping both database/auth settings correctly.

Do not change the production default branch to redirect previews. Do not remove the entire
resource connection as an experiment: that can remove Production environment variables.
If Preview cannot be scoped independently, stop and design a separate preview resource/project
with the owner before changing this integration. Do not install the separate Neon-managed
integration alongside native integration; the guides say they cannot coexist in one Vercel project.

## Prepare the safe source

1. Confirm project capacity before provisioning. A full project is not permission to delete
   existing preview data, raise the plan or change billing. Reserve capacity for the safe
   source **and** its test preview; re-inventory immediately before creation.
2. With approval, create a **schema-only** root from the reviewed application schema. Verify
   its returned project/branch IDs, `init_source=schema-only`, root status and endpoint.
   Keep `main` as default and preserve the production connection. The schema-only source
   should have no expiry if it will parent continuing previews; this is an explicit lifecycle
   choice, not permission to change an existing branch's expiry.
3. Before connecting a preview, verify the exact endpoint belongs to this safe branch and
   that no real rows were copied, including all application/auth tables. Inspect counts or
   existence only; do not export user records to reports. An inaccessible table is an
   unresolved check, not evidence that it is empty. Managed-schema contents and provider
   role credentials require separate review; never modify managed schemas.
4. Start empty or add only reviewed synthetic fixtures through application-supported paths.
   Do not copy production user/password/session/token records. Configure preview-only auth
   keys and controlled email before exercising sign-up. A schema-only DB alone is not a
   ready authentication environment.
5. Keep the source's schema current using reviewed migrations. Ordinary preview children
   may clone its synthetic data; they must never implicitly fall back to `main`.

[Schema-only branches](https://neon.com/docs/guides/branching-schema-only) are independent
roots with plan-specific root/storage limits. They cannot reset from parent. A restore from
production copies **schema and data**, undoing the isolation. One safe root plus ordinary
children avoids creating a root per PR, but still consumes ordinary branch capacity.

[Anonymized branches](https://neon.com/docs/workflows/data-anonymization) are an alternative,
not the default for this application: arbitrary deck text and auth/session data make complete
masking harder to prove. Masking selected email/name columns is insufficient. A dataset must
remain unavailable to previews until sanitization is complete and independently verified.

## Reuse the existing read-only preflight

After the source exists, use the existing operator helper in a private, approved environment:

```sh
bash tools/prepare-staging-auth.sh https://APPROVED-STABLE-PREVIEW-HOST
```

It asks for the direct connection locally, checks TLS/endpoint/database/schema/role, enforces
read-only inspection and generates a private auth migration plan. Never paste credentials in
chat, workflow inputs or source. Review both the plan and domain migrations before applying.

**Limit:** this helper does not establish Neon project/branch ancestry, prove every table is
empty, validate Vercel effective runtime variables, or apply migrations. Those checks remain
separate. A clean schema plan or green `/readyz` does not establish data isolation.

## Cutover acceptance and rollback

Do not activate automated preview provisioning until these are demonstrated on one approved
test preview:

- Production's branch/default, endpoint, variables and current readiness remain unchanged
- Native Preview branch creation/injection is disabled or safely retargeted by verified controls
- The new preview has the approved safe ancestor and the expected exact compute endpoint
- Domain and auth connections both resolve to the intended isolated database
- No production auth keys or uncontrolled production email path are inherited
- Migrations/readiness pass; a synthetic account/deck works and cannot affect production
- An additional update reuses or safely replaces the intended preview without production fallback
- Existing previews retain their current data and mappings until separately approved retirement

Rollback means pause the new preview path and preserve existing evidence/data. Do not restore
production-derived preview copying or point previews at production as a fallback. Production
does not need a database migration or default-branch change for this work.

## Cleanup is a separate change

The locally prepared [cleanup adaptation](preview-cleanup.md) scopes new manifests to the
synthetic project's default root. Production project `dark-poetry-32860113` is excluded,
both root IDs and all nine legacy branch IDs are protected, and all nine legacy Git refs plus
`chore/preview-isolation-test` stay held. It rejects missing/wrong Neon project IDs and
Vercel deployments before a conservative post-isolation timestamp. Same Git ref alone is
not sufficient resource provenance, so `mappingVerified` and `destructiveEnabled` remain false.

Only the new project is queried as an active cleanup target. Legacy retirement stays a
separate review rather than a second automatic cleanup policy. A ref with old-resource and
new-resource deployments cannot be made eligible by discarding old entries from inventory.
Optional automatic PR-close manifests are read-only and require approved read credentials;
actual deletion retains the exact-manifest independent manual approval gate.

Existing previews are not sanitized or deleted by changing where future previews originate.

## Required owner decisions and secure setup

- Approve the exact Preview integration control change after its current behavior is inspected
- Choose capacity: explicitly retire exact disposable targets, use a separate resource, or
  approve any necessary paid capacity; preserve acceptance data unless explicitly released
- Approve the safe-source identity, preview origin, auth-secret destination and email test policy
- If explicit-parent CI is necessary, authorize narrowly scoped persistent provider access
  through supported secure setup; tokens must never appear in dispatch inputs or logs
- Approve the final tested cutover/deployment separately from this preparation

References were checked October 1, 2026. Provider configuration must be re-read at execution
time; this runbook does not claim the controls above are already configured or verified.
