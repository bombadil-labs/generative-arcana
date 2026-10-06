# Hosted parlor: reviewed operator rollout

Hosted parlor is **disabled by default**. This code does not apply live migrations, grant accounts, install secrets, select a paid model, or turn on provider calls. No Stripe/billing integration is included.

## Modes and access

`PARLOR_MODE=disabled` is the default. `hosted` requires complete validated server configuration, current pricing approval, browser authentication and durable storage. `byok` explicitly preserves the separate browser-key experience; it never enables hosted API calls. The client reads `/api/parlor/capabilities`; missing configuration, missing migration, unavailable database, missing/revoked/expired entitlement or failed capability discovery never falls back to BYOK.

Hosted setup has only server-approved model/voice choices, no API-key fields, no credential restoration and no credential persistence. Old explicitly remembered BYOK keys are not read by hosted mode; remove them using browser site-data controls if they are no longer wanted. Hosted server secrets are never returned to the browser. The app-local show mode and Escape/touch exit remain unchanged.

POST `/api/parlor/narrate`, `/api/parlor/converse`, and `/api/parlor/speech` require an active verified browser session, exact configured Origin, a current `parlor` entitlement and an owned deck. Each request reconstructs its three-card reading from the current validated deck; the client cannot provide an arbitrary system prompt or a provider URL. Provider/model/voice choices are allowlisted server-side. Bearer MCP deck scopes do not grant hosted access. Authentication and entitlement are checked again before dispatch and before returning output.

## Migration 007 and database permissions

`007-parlor-access.sql` adds only:

- `arcana_entitlements`: `(principal_id, entitlement)` primary key, grant/revoke times and mandatory expiry. Only `parlor` is accepted; it confers no administrator rights.
- `arcana_entitlement_audit`: immutable operator operation UUID, principal, action, evidence reference, database role, timestamps and expiry.
- `arcana_parlor_usage`: operation UUID scoped to principal, operation kind, provider/model, worst-case micro-USD reservation, input byte/output limit metadata, status and bounded concurrency lease. No guest content.

The migration grants nobody. It does not alter Better Auth, existing identities or deck ownership. `principal_id` is not a foreign key to the identity mapping because several verified identities may share that stable domain principal.

Review SQL and the appended exact-byte checksum/schema in `mcp/migrations/catalog.json`; never regenerate versions 001–006. The existing runner applies all pending catalog entries, so review the full plan. Runtime needs SELECT on entitlements and SELECT/INSERT/UPDATE on usage. Runtime does not need INSERT/UPDATE/DELETE on entitlements or access to the audit table. Verify actual role privileges separately; this migration does not grant roles or silently change existing permissions. Do not install the operator migration credential in the service.

## Budget policy and idempotency

All admission decisions use a shared PostgreSQL transaction lock, database time captured after lock acquisition, and that same instant for the reservation's UTC day. Per-principal/global daily reservation budgets and concurrency caps are checked atomically across instances. A unavailable database or failed/uncertain reservation commit prevents provider dispatch.

Every model has an operator-reviewed **maximum cost per request**, in integer micro-USD (1 USD = 1,000,000 micro-USD). Speech has a separate reviewed maximum. This maximum must cover the configured maximum input bytes, output token limit, provider protocol overhead, any billed reasoning/output behavior and maximum speech characters. Review current provider pricing and exact model compatibility before selecting a model; no default model, rate or spending allowance is guessed here. Include margin and set an expiry for that review. Re-review caps whenever model, limits or pricing change. These are conservative application reservation budgets, not a reconciliation of the provider's invoice; incorrect configured upper bounds cannot guarantee an actual dollar ceiling. Use provider-side hard limits where available as an additional control.

The **entire reservation remains charged** on success, provider rejection, timeout, disconnect, cancellation and uncertain outcome. There are no automatic refunds, provider retries or result caches. A duplicate `(principal, operation UUID)` returns 409 without another paid dispatch, including after a process restart. The UI's deliberate Retry action creates a new operation and reserves again; it warns that retries may be billed. Lost successful responses are not recoverable because guest output is not stored. Retain operation IDs to preserve this rule; no usage pruning is introduced.

Successful requests release their concurrency lease. Failed/uncertain ones retain it until the original request timeout plus 30 seconds. Budget remains charged. Timeout/disconnect aborts upstream fetch; the application cannot guarantee that a provider stops billing after receiving a request. Bounds are at most 64,000 serialized provider-input bytes, 2,000 output tokens, 4,000 speech characters, 8 MB audio and a 90-second request deadline; configured limits may be lower. Database statements and lock waits are bounded. Request bodies, provider payloads, keys and raw errors are never logged by the parlor handler.

Guest question, reading token (which contains the question), narration, conversation and audio exist only in request/client memory and provider processing. They are not written to usage/audit tables, URLs, browser storage or server caches. Do not enable request/response body capture in external logging/APM. Provider retention policies still apply. Exit, logout, navigation and account changes abort/fence browser work and release audio; the server discards output if session/entitlement is no longer valid.

## Server-only configuration

Enter real values only through the selected deployment's approved secret/configuration UI. Never paste keys into chat, workflow inputs, shell arguments, `.env` committed files, or `VITE_*` variables. Do not read back secret values to verify installation. Preview and Production scopes must be selected deliberately; do not expose production provider credentials to general PR previews.

| Variable | Required value / meaning |
| --- | --- |
| `PARLOR_MODE` | `disabled` initially; `hosted` only after rollout checks. `byok` is an explicit separate option. |
| `ANTHROPIC_API_KEY`, `OPENAI_API_KEY` | Server secrets only for providers actually present in the allowlist. |
| `PARLOR_MODELS_JSON` | Reviewed array of `{ "provider": "anthropic" or "openai", "id": exact model ID, "maxCostMicrousd": positive integer }`; no arbitrary client models. |
| `ELEVENLABS_API_KEY` | Optional server secret; required only when voices are enabled. |
| `PARLOR_VOICE_IDS` | Comma-separated approved voice IDs; omit for captions-only. |
| `PARLOR_SPEECH_MODEL` | Exact reviewed speech model; required with voices. |
| `PARLOR_SPEECH_MAX_COST_MICROUSD` | Reviewed maximum speech charge per request; required with voices. |
| `PARLOR_USER_DAILY_MICROUSD`, `PARLOR_GLOBAL_DAILY_MICROUSD` | Explicit positive daily reservation budgets; neither has a default. |
| `PARLOR_USER_CONCURRENCY`, `PARLOR_GLOBAL_CONCURRENCY` | Explicit caps, at most 4 / 32 respectively. |
| `PARLOR_MAX_INPUT_BYTES`, `PARLOR_MAX_OUTPUT_TOKENS` | Explicit input/output bounds tied to the pricing review. |
| `PARLOR_MAX_SPEECH_CHARACTERS` | Explicit bound when voices are enabled. |
| `PARLOR_TIMEOUT_MS` | Positive deadline, at most 90000 ms. |
| `PARLOR_PRICING_REVIEW` | Short nonsecret evidence reference for pricing/limits/model review. |
| `PARLOR_PRICING_EXPIRES_AT` | Future ISO timestamp; expired review fails closed on every hosted request. |
| `BETTER_AUTH_URL`, `DATABASE_URL` | Existing exact HTTPS session origin and domain runtime connection; never replace with an operator credential. |

## Preview-first sequence (later, separately reviewed live actions)

1. Review and publish one immutable application/migration SHA. Confirm the existing intended preview database and deployment mapping, direct migration host/database/role, recovery evidence and runtime grants. No new database branch is implied.
2. Use **Approved existing preview migration** (`.github/workflows/preview-migrate.yml`) from main with the reviewed SHA and operation `plan`. It uses `arcana-preview-migrations` / `ARCANA_PREVIEW_MIGRATION_URL`. Resolve drift or untracked history separately; never guess a baseline. After reviewing the plan and recovery evidence, run `apply`, then `status`. The runner uses only the dedicated `DATABASE_MIGRATION_URL`; it does not fall back to runtime credentials.
3. Sign into that exact environment with the intended verified account. Securely inspect its existing `/auth/session` response: `accountId` is Better Auth's subject, **not** the `usr_*` principal. In an authorized operator read, resolve the exact `(issuer = BETTER_AUTH_URL + '/api/auth', subject = accountId)` row in `arcana_external_identities`. Verify its principal. Do not select an account by display name/email or copy browser cookies/tokens into chat. If the mapping does not yet exist, visit the authenticated deck library to establish it through normal login behavior; the grant command will not fabricate it.
4. Prepare a private nonsecret JSON operator plan with `operationId` (fresh UUIDv4), `issuer`, `subject`, `expectedPrincipal`, `action: "grant"`, `expiresAt` (within 90 days), and `evidenceReference` (verified-account approval reference). Use `npm run parlor:access --prefix mcp -- plan --plan PRIVATE_PLAN_FILE --target preview --expected-host REVIEWED_DIRECT_HOST --expected-database REVIEWED_DATABASE --expected-user REVIEWED_OPERATOR_ROLE`. It is read-only and checks the exact mapping and prior operation UUID. After separate approval, replace `plan` with `apply` and add `--approval-reference SAME_EVIDENCE_REFERENCE`. The existing approved migration connection mechanism supplies credentials. Rerun `plan` with the same UUID to verify an uncertain commit instead of issuing another grant. Revoke uses a new UUID, `action: "revoke"`, no `expiresAt`, and the same reviewed workflow; grant renewal also needs a new approved operation.
5. Enter selected preview provider keys securely and configure reviewed models/voice/budgets/expiry. Only then explicitly enable hosted mode. Test anonymous, unentitled, revoked and entitled sessions; verify actual database readiness, capability choices, limits and no frontend key exposure. Live provider smoke calls need separate authorization because they cost money. Mock tests do not establish real model entitlement, voice access or billing.
6. Production is separate: **Approved production migration** (`.github/workflows/production-migrate.yml`) uses `arcana-production-migrations` / `ARCANA_PRODUCTION_MIGRATION_URL`, reviewed SHA, backup reference, and pinned direct host `ep-square-sun-b79gp0dh.c-13.us-east-1.aws.neon.tech`, database `neondb`. Independently confirm target/environment mapping before `plan, then apply, then status`. Prepare/grant only the verified production principal, configure Production-scoped provider secrets and reviewed limits, verify readiness, then approve enabling/promoting that exact candidate. The workflow does not automatically order Vercel production promotion; retain the explicit migration/readiness gate.

Rollback/kill switch: set mode to disabled through a separately authorized deployment/configuration change or revoke the account via the audited operator path. Do not roll back additive schema or delete usage history to recover quota. Show-mode PR publication does not authorize any of these live actions.
