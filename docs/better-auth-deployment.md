# Deploying self-hosted Better Auth with Neon

The default account implementation is self-hosted **Better Auth**, hosted beside the Arcana web
app and MCP resource server. Neon PostgreSQL stores auth and catalog state. This guide is a
checklist for an authorized operator; it is **not proof of production activation** and does not
authorize purchases, secret creation, production migrations, or deployment.

Read the [operations runbook](better-auth-operations.md) before launch and preserve the
[real browser/Claude/ChatGPT acceptance record](production-launch-checklist.md). A local regression
suite, synthetic OAuth client, or green `/readyz` is insufficient to invite users.

## Architecture and canonical addresses

| Purpose | Canonical production value |
|---------|----------------------------|
| Browser origin / `BETTER_AUTH_URL` | `https://generative-arcana.vercel.app` |
| Better Auth base path and issuer | `https://generative-arcana.vercel.app/api/auth` |
| MCP protected resource and access-token audience | `https://generative-arcana.vercel.app/mcp` |
| Browser account entry | `/auth/login` |
| Browser account session bridge | `/auth/session` |
| Browser logout | `POST /auth/logout` |
| Better Auth API | `/api/auth/*` |
| MCP metadata | `/.well-known/oauth-protected-resource/mcp` and root compatibility route |

Better Auth owns login, verified-email password accounts, cookies, consent, and token issuance.
`mcp()` already composes the OAuth provider; **do not add a second `oauthProvider()` instance**.
The accompanying CIMD plugin uses the guarded Node fetch transport and the MCP metadata profile.
The Arcana resource verifier still enforces issuer/signature, exact resource audience, expiry and
`decks:read`/`decks:write`, then maps the identity through the stable `usr_*` boundary. Browser and
MCP identity must resolve to the same principal. Email matching is never a migration strategy.
[Upstream MCP setup](https://better-auth.com/docs/plugins/mcp)

## Preconditions

- [ ] Approve the production change, service/email costs, operator and recovery objectives.
- [ ] Record canonical origin/resource, exact tested commit, pinned Better Auth/plugin versions,
  independent staging environment, and rollback artifact.
- [ ] Retain the production domain `DATABASE_URL`. Choose whether auth uses the same database or a
  separate `BETTER_AUTH_DATABASE_URL`; establish coordinated backups if separate.
- [ ] Give the migrator schema privileges and the running service only the required table DML.
  Do not leave a schema-owner credential in runtime merely because setup needed it.
- [ ] Configure a verified SMTP sender and test actual delivery, reset/verification links, expiry,
  failure behavior, and sender reputation. Staging uses a sink or limited test recipients.
- [ ] Store generated secrets in approved secret management. Review the secret-rotation plan and
  backups before rolling out a key ring. Never paste credentials into evidence or commits.
- [ ] Confirm proxy/IP handling, trusted origins/hosts, shared rate limiting, traffic/spend alerts,
  and source/DB/SMTP isolation for preview versus production.
- [ ] Inventory alpha-owned content. Preserve ownership through an explicitly verified migration
  where necessary. Remove `MCP_ALPHA_TOKEN` before enabling account OAuth; they cannot coexist.

## Environment

Use [`mcp/.env.example`](../mcp/.env.example) as a non-secret reference. The service reads process
environment; it does not implicitly load a committed `.env` file. In local shells, use an approved
secret injection or Node's environment-file mechanism. Do not check in a filled environment file.

Required for the self-hosted account path:

- `BETTER_AUTH_URL`: exact browser origin, without `/api/auth` or `/mcp`; explicit HTTPS in production
- `BETTER_AUTH_SECRET` or `BETTER_AUTH_SECRETS`: high-entropy singular secret (at least 32 characters)
  or a versioned encryption key ring; retain the singular legacy key only when required for old ciphertext
  (rotating the current key requires browser re-login; see the operations runbook)
- `DATABASE_URL`: runtime catalog/identity/shared-limiter PostgreSQL connection string
- `BETTER_AUTH_DATABASE_URL`: optional separate auth connection; otherwise `DATABASE_URL`
- Email: either explicit SMTP below or the Resend Marketplace integration
  - `SMTP_HOST`, `SMTP_FROM`: approved SMTP server and verified sender; `SMTP_PORT` defaults to
    `587`, `SMTP_SECURE` defaults to `false` (mandatory STARTTLS)
  - `SMTP_USER`, `SMTP_PASSWORD`: provider credentials supplied together where required
  - Alternatively, `RESEND_API_KEY`, `RESEND_EMAIL_DOMAIN`: server-only values injected by Vercel
    Marketplace. Keep every `SMTP_*` variable listed above absent, including blank values

The Resend fallback uses [Resend's SMTP service](https://resend.com/docs/send-with-smtp) at
`smtp.resend.com:465` with implicit TLS, certificate verification, username `resend`, and the injected
API key as its password. A verified `RESEND_EMAIL_DOMAIN=bombadil.pub` derives the sender
`Generative Arcana <noreply@bombadil.pub>`. The domain must be plain ASCII DNS syntax, with no URL,
email address, port or whitespace. Local validation cannot establish provider domain verification,
API-key permissions, quota or deliverability. Verify the domain in Resend and complete live mail
acceptance before inviting users. No key needs to be copied into `SMTP_PASSWORD` or frontend variables.

Any explicitly set SMTP variable, even an empty one, selects the explicit SMTP path; incomplete or
invalid configuration fails startup instead of falling back to another provider. A complete explicit
SMTP configuration ignores Resend values, so existing SMTP deployments keep their own sender and
credentials. Do not log configuration objects or expose mail credentials in client-visible settings.
For preview, use an explicit SMTP sink or appropriately isolated Resend credentials/test recipients;
Marketplace injection into both Preview and Production does not itself provide mail isolation.

MCP issuer/resource/scopes are derived/configured consistently with the canonical origin. Do not
point a self-hosted browser at a different OAuth issuer, override the resource to another host,
or grant only OIDC identity scopes to a deck-writing client. `MCP_OAUTH_RESOURCE` must be the exact
canonical `/mcp` URL if explicitly configured. See [server configuration](../mcp/README.md).

`DATABASE_MIGRATION_URL` is an operator-only, DDL-capable domain connection for migration/link
commands. For auth plan/apply, supply the DDL-capable connection in `BETTER_AUTH_DATABASE_URL`
(or `DATABASE_URL` if using the shared default) only for that operator process. Never deploy the
migration role as the production runtime role. Do not set migration credentials in frontend/Vite
variables, browser code, build output, or client-visible configuration.

## Isolated staging and Neon-managed auth

Neon's console **Managed Better Auth** service is separate from this self-hosted runtime. Its
managed tables live in `neon_auth`; enabling it does not configure Arcana's `/api/auth` server.
Arcana uses 13 `arcana_auth_*` tables plus its `arcana_*` domain tables in an approved application
schema, normally `public`. Do not target `neon_auth`, reuse managed-service credentials/endpoints
as Arcana configuration, or infer identity ownership from matching email addresses.
[Neon managed-auth architecture](https://neon.com/docs/auth/overview)

- Use an isolated, empty/schema-only staging database or a deliberately sanitized snapshot.
  A branch copied from production also copies its data and managed-auth state; a different branch
  name alone is not data sanitization. Check branch capacity before provisioning; a branch limit
  is not permission to delete another branch, upgrade a plan, or change billing.
- Scope staging Vercel variables to **Preview and the intended Git branch**. Both `DATABASE_URL`
  and any `BETTER_AUTH_DATABASE_URL` override must select the isolated staging target. Do not let
  an inherited auth connection silently point at production. Use one stable staging origin for
  `BETTER_AUTH_URL`, its `/api/auth` issuer and its `/mcp` resource, plus staging-only auth secrets
  and controlled email recipients. Environment edits require a new preview deployment.
- Before planning or applying, verify `current_database()`, `current_schema()` and `session_user`
  against the approved target. Set a consistent, explicit application `search_path` for the
  migrator and runtime roles, normally `public`; the SQL uses unqualified table names. Inspect
  the plan's recorded schema and every SQL statement. Table-name prefixes alone do not enforce
  schema isolation.
- Keep both roles without ownership, DDL or DML privileges over `neon_auth` or other provider-managed
  schemas. Give the migrator only the required application-schema privileges and the runtime only
  application-table DML. Do not grant broad cross-schema privileges or run migrations against
  the managed-auth schema. Never disable or remove the managed service as a setup shortcut.

## Schema review and application

For a production target, use the production-labeled **read-only** WSL/Linux helper with Node.js 24:

```bash
bash tools/prepare-production-auth.sh https://generative-arcana.vercel.app
```

Enter the unpooled/direct Neon connection for the **effective Production auth database** only at
the hidden local terminal prompt, never in chat or a command argument. If Production has a separate
`BETTER_AUTH_DATABASE_URL`, use that target rather than assuming `DATABASE_URL` supplies auth.
The helper clears inherited database/auth/mail and PostgreSQL driver overrides before installing
dependencies and reading the secret. It reuses the strict read-only Neon inspection below, labels
the target comparison as Production, and writes a new private mode-0600 auth plan under
`~/arcana-production-plan.*`. It does not change environment variables in Vercel, create credentials,
apply either schema, or send email. A successful preflight is review evidence, not production activation
or full domain-schema validation. Review the auth plan and domain migration separately; obtain target
and migration approval plus a verified restore point before any production apply. The disposable
staging exception and its apply helper are never a production path.

For a new isolated staging target, the WSL/Linux helper bundles installation, hidden local secret
entry, read-only target inspection and auth-plan generation. Use Node.js 24 and the current branch:

```bash
bash tools/prepare-staging-auth.sh https://YOUR-STABLE-PREVIEW-HOST
```

Paste the **unpooled/direct connection for the exact feature-branch Preview database** only into its hidden terminal prompt,
never chat. With automatic Neon preview branching, inspect/apply against the actual preview branch;
an existing child branch does not inherit later schema changes from its parent. The helper requires
TLS, refuses pooled endpoints and ambiguous driver overrides, forces PostgreSQL connections and
inspection transactions read-only, verifies the server's read-only default, and requires `public` as
the application schema. It saves a new mode-0600 plan in a private directory under your home directory.
It reports only host/database/schema/role and table-presence metadata; Better Auth's planner may
also probe existing tables for row existence, without returning account contents. It cannot prove which Neon
project/branch owns an endpoint: compare the reported target with Vercel's effective branch-specific
connection and the intended Neon branch before approval. Inspect the generated auth SQL and the
domain migration separately. **The helper never applies either migration, returns account contents, sends
email, or changes Vercel. Stop for target and migration approval after it completes.**

Run with the committed lockfile and installed package scripts. The commands below are procedures;
**do not run apply against production without approval and a verified restore point**. Server
startup, builds, health checks, and login requests do not run these migrations.

1. Install the exact dependency set and inspect the domain migration:

   ```bash
   npm ci --prefix mcp
   npm --prefix mcp run db:migrate:domain
   ```

2. Capture a backup/restore reference, review `mcp/migrations/001-domain.sql`, and rehearse against a
   disposable PostgreSQL database. This includes identity mapping, catalog, legacy host state,
   identity-link audit, and shared rate-limit tables. The migration preserves existing principals
   and removes the old one-identity-per-principal constraint to permit deliberate identity links.

3. Generate the auth schema plan against the **intended target**, saving outside the repository:

   ```bash
   npm --prefix mcp run db:auth:plan -- --out /secure/path/arcana-auth-plan.json
   ```

   Inspect every SQL statement, target identity, installed version, SHA-256 digest, unsafe-change
   and schema diagnostics. A live plan is read-only database introspection. Backfills or conflicts
   require a separately reviewed migration, not an override flag. Regenerate and review if schema,
   package version, role, target, or config changes. The file contains schema/host metadata, not
   credentials, but keep the operator record private. Plan/check/apply use an ephemeral application
   secret and a rejecting email stub: production auth/SMTP secrets are unnecessary for schema work.

4. Apply the domain migration and reviewed auth plan during the approved window:

   ```bash
   npm --prefix mcp run db:migrate:domain -- --apply --expected-host REVIEWED_DATABASE_HOST
   npm --prefix mcp run db:auth:apply -- \
     --plan /secure/path/arcana-auth-plan.json \
     --expected-host REVIEWED_AUTH_DATABASE_HOST \
     --backup-ref APPROVED_RESTORE_REFERENCE
   npm --prefix mcp run db:auth:check
   ```

   The auth apply path regenerates the plan and rejects changed SQL/target/version, invalid
   checksums, and unsafe diagnostics, then applies generated SQL under a transaction/advisory lock.
   A backup reference records an assertion; it cannot verify provider recovery. The domain and auth
   operations are separate transactions: if the second fails, stop and investigate rather than
   pretending both rolled back. No startup path is a migration fallback.

5. Re-run the auth check under the runtime role, verify domain table reads/writes in staging,
   restart all replicas to clear cached schema validation, and retain redacted migration evidence.
   Remove migration credentials from the execution environment. A successful `SELECT 1` is not
   schema/permission evidence. Better Auth can print its generic `npx auth migrate` suggestion for
   missing tables; use this repository's pinned, reviewed plan/apply workflow instead.

## Host-client setup

Use the current host's supported OAuth connection UI and exact callback(s). The browser login
origin is not a Claude/ChatGPT redirect URI. Keep consent visible and require PKCE/S256 and exact
resource binding. CIMD is the implemented discovery path. DCR is disabled and there is no public client-admin
interface. If a host cannot complete the supported CIMD path, treat that host as blocked until a
scoped registration/provisioning implementation is approved and tested. Do not turn off PKCE, origin checks,
resource checks, or deck scopes to get past a host failure.

Record actual client-identification path, host product/plan/workspace policy, redirect URI,
authorization/token/JWKS endpoints, resource, scopes and consent outcomes without recording secrets.
A synthetic registered client demonstrates protocol behavior, not Claude/ChatGPT integration.
See [host onboarding](authoring-hosts.md).

## Container rollout and verification

Use repository-root `Dockerfile.vercel`, `vercel.json`, and the Vercel **Container** preset. Serve
the browser, auth, catalog API, and MCP endpoint on the same canonical origin. Environment changes
require a new deployment; do not assume updating a variable changes an already-running instance.
`ARCANA_BUILD_SHA`/`ARCANA_BUILD_ID` can explicitly identify the artifact; otherwise supported Vercel
build variables are used.

After the separately approved rollout:

```bash
node tools/smoke-production.mjs \
  --url https://generative-arcana.vercel.app \
  --expected-sha FULL_DEPLOYED_COMMIT_SHA
```

Check JSON content types and exact metadata values, not HTTP 200 alone. `/healthz` is liveness and
configuration; `/readyz` is bounded read-only dependency/configuration evidence. Neither proves
SMTP delivery, a durable authenticated write, rotation/restore readiness, or host-client OAuth.
Run every [real-user launch acceptance](production-launch-checklist.md) row, including a second
independent account and a separate server instance. Do not claim production is verified while a
host or recovery gate remains unrun.

## Retention and onward migration

Schedule the operator-owned cleanup of expired domain counters and auth counters older than
24 hours only after deployment approval: `npm --prefix mcp run db:prune-rate-limits -- --apply` (daily is a starting cadence).
Review auth/session/token cleanup and retention separately; do not delete unexpired grants or
identity mappings by age. See [maintenance, rotation, backup and incident procedures](better-auth-operations.md)
and the [hosted-auth migration strategy](hosted-auth-migration.md).

## Explicit disposable staging exception

For an operator-approved, disposable **empty Vercel branch Preview** only, an auth apply may omit
its backup attestation using `--disposable-staging --staging-origin HTTPS_PREVIEW_ORIGIN` instead
of `--backup-ref`. `BETTER_AUTH_URL` must match that origin and `VERCEL_ENV` must be `preview`.
This is a conscious no-backup choice, not a claimed restore point. Production and populated
staging retain the backup-backed workflow. The flags do not establish Neon branch ownership;
confirm the endpoint is the isolated Preview target first.

The exception still checks the reviewed plan's checksum, exact database/schema/role/host/port,
package version and generated SQL. It requires direct Neon with certificate-verified TLS and
`public`, permits only additive `arcana_auth_*` table/index creation, and rejects alterations or
managed-auth SQL. Under the auth apply transaction it locks existing public `arcana_*` tables
and checks every one is empty, including auth, catalog and domain tables. Empty domain tables
from the separate domain migration are allowed. Non-table relations and unverifiable/RLS-hidden
contents fail closed. Managed `neon_auth` data is neither queried nor modified by this guard.
Keep runtime replicas stopped during staging initialization; locks cannot prevent unrelated
operators creating entirely new domain relations concurrently.

After reviewing both the committed domain migration and the auth plan, the helper below takes the
exact reviewed plan digest and target, prompts for the direct connection locally, verifies target
identity and empty Arcana data, applies domain then auth in separate transactions, then checks auth
using PostgreSQL startup read-only settings. It clears inherited connection/auth/email overrides
and drops the prompted secret when it exits. Install the pinned dependencies before running it.

```bash
bash tools/apply-disposable-staging-auth.sh \
  https://YOUR-STABLE-BRANCH-PREVIEW.vercel.app \
  /private/path/auth-plan.json REVIEWED_DIRECT_HOST REVIEWED_PLAN_SHA256
```

It does not install packages, deploy, restart replicas, or send email.
A committed domain/auth step followed by a failed later step is not a rollback; stop and investigate. Keep the
plan private, retain the honest no-backup output, and complete the remaining acceptance tests.
