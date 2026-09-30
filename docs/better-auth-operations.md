# Self-hosted authentication: operating runbook

**Owner decision:** this branch selects self-hosted Better Auth for browser accounts and MCP OAuth,
with Neon/PostgreSQL for durable state. This is an operating commitment, not a managed-auth SLA.
This document does not authorize production changes, purchases, or provisioning. Deployment and
real-user acceptance remain separate gates in the [launch checklist](production-launch-checklist.md).

## Boundaries and ownership

- The Node service hosts the Better Auth login/session/OAuth endpoints. The deck engine, manifests,
  reading tokens, and catalog permission checks stay provider-neutral.
- The browser session and a verified MCP access token both prove an `(issuer, subject)` identity.
  The identity repository resolves that to an opaque `usr_*` principal. Catalog owner IDs are never
  email addresses, Better Auth table IDs, or host-product IDs.
- The auth database contains password hashes, sessions, verification state, encrypted signing keys,
  OAuth clients, grants, and tokens. Treat its backups as sensitive, even if encrypted at rest.
- Name a primary operator and backup operator before inviting users. They own alerts, SMTP,
  dependency patches, restore drills, key rotation, incident communication, and access reviews.
  Record these people and alert destinations in the private release record, not in public source.

## Routine maintenance and budget

These are planning estimates for a small friends-and-family service, **not vendor prices or
measured spend**. Existing hosting/database bills, traffic, provider quotas, and chosen recovery
retention determine actual cost. Verify current provider quotes before committing money.

| Work | Suggested cadence | Estimated operator time |
|------|-------------------|-------------------------|
| Review auth/security notices, failed-login/mail/error signals, dependency alerts | Weekly | 15–30 minutes |
| Routine dependency update, lockfile/schema review, regression tests, staging canary | Monthly and when patches land | 1–2 hours |
| Restore + rotation + cross-host canary drill | Quarterly, and before material auth changes | 2–4 hours per drill |
| Access, retention, SMTP reputation, and cost review | Quarterly | 30–60 minutes |
| Security incident or difficult upgrade | As needed | 4–12+ hours per incident |

Allow roughly **3–6 hours/month** averaged over routine work and drills; the first production
hardening/acceptance pass may take **1–3 operator-days**, depending on host compatibility. Set aside
an estimated **$10–60/month of incremental infrastructure/email/monitoring capacity** at low volume,
on top of existing hosting/database plans. Free tiers may reduce cash spend but do not remove the
labor or recovery obligations. At an illustrative $75/hour, 3–6 hours is $225–450/month of operator
time. These numbers are a budget exercise, not a promise of cost or availability.

## Patching and security response

1. Keep Better Auth and its companion packages exactly aligned in the committed lockfile. Review
   the [release/upgrade guide](https://better-auth.com/docs/guides/1-7-upgrade-guide) and
   [upstream advisories](https://github.com/better-auth/better-auth/security/advisories), including
   changes to endpoint defaults, schema, cookie/state formats, and refresh-token behavior.
2. Triage a reachable critical auth flaw the same day; aim to contain immediately and deploy a
   validated fix within 24 hours. Triage high-severity issues within one business day and target
   a fix within 72 hours. These are proposed service objectives, not a staffed on-call guarantee.
3. Start with a local/staging reproduction and a recent restore point. Generate a new schema plan;
   never apply an upstream “latest” CLI migration against production by habit. Check the package
   version and plan digest in the release record.
4. Run typechecks, all relevant protocol/auth/isolation tests, the browser build, a disposable-DB
   migration/restore rehearsal, and staging signup/reset/consent/refresh. Review security-sensitive
   diffs; a clean vulnerability scanner is supplementary evidence.
5. Deploy a pinned artifact only after approval. Run the read-only smoke and real-host canaries.
   Roll back the application only if the previous artifact remains compatible with the new schema.
6. During a suspected compromise, restrict affected endpoints at the trusted edge, preserve
   redacted evidence, determine whether sessions, refresh grants, secrets, or signing keys leaked,
   revoke affected credentials, and rotate the correct keys. Re-enable only after negative tests.
   Notify affected users through an approved channel if required; do not put private logs in issues.

## Schema changes: explicit, reviewed, recoverable

Neither server startup nor an ordinary auth/catalog request should create or alter tables. Apply
[deployment migrations](better-auth-deployment.md#schema-review-and-application) as a separate,
authorized operator action. The runtime role should not have schema-owner or DDL rights after setup.

The auth planner uses the installed Better Auth schema rather than hand-maintaining a copy. Its
plan includes generated SQL, unsafe-change/schema diagnostics, exact target host/database/schema/
role, installed version, and a SHA-256 digest. Apply re-introspects the target, rejects drift and
unsafe diagnostics, requires the reviewed plan, explicit expected host and backup reference, and
runs generated DDL in a transaction with an advisory lock. A backup reference is an operator
attestation, **not proof** that a backup exists or restores. See the
[Better Auth migration API](https://better-auth.com/docs/concepts/database).

For upgrades, review table/column/index names, unique keys, nullability, constraints, destructive
steps, lock duration, and backfills. Resolve duplicate identities/account keys explicitly; do not
collapse different people. The automatic generator does not transfer provider accounts or prove
application-level compatibility. Use expand/backfill/contract stages for breaking changes. Do not
mix a schema downgrade, identity merge, and package downgrade into one emergency command.

## Backups, recovery, and isolation

Before launch choose an approved recovery target. A starting objective is **RPO ≤24 hours and RTO
≤4 hours**; tighten it if account/deck volume demands. This is a target until a timed drill proves it.

- Confirm the actual Neon plan's restore retention, cost, and regional coverage. Keep a recent
  restore point before every schema/identity change; configure encrypted independent exports if the
  failure model requires recovery outside the primary account. A branch alone is not an independent
  backup. See [Neon restore guidance](https://neon.com/docs/manage/branches#restore-a-branch).
- Back up auth tables, principal/identity links, catalog records, and any retained host-state data
  together. If auth has a separate database, record coordinated recovery timestamps and rehearse
  mismatched-point recovery; a new identity without its catalog mapping can strand a library.
- Retain the matching application artifact, migration plans, package lockfile, and the minimum
  historic secret versions needed to decrypt the selected backup. Store keys separately from
  database backups with access logging. Never put keys in a SQL dump, repository, or test fixture.
- Quarterly, restore into an access-restricted isolated database. Use a distinct origin, SMTP sink,
  secret set, and OAuth test clients; block public sign-ins and outbound real-user mail. Sanitize
  production data before broad developer access. Treat branch copies as equally sensitive.
- Before opening a restored service, deliberately invalidate restored browser sessions, reset
  links, and OAuth grants/tokens so a restore cannot resurrect previously revoked access. Preserve
  account and `usr_*` identity links. Re-issue credentials through normal login.
- Prove signup/login, ownership, two-user isolation, import/read/delete of designated test data,
  integrity constraints, and endpoint behavior. Measure elapsed recovery time and recoverable data
  cutoff. Destroy the test copy under the approved retention policy after the drill.

Use independent preview/staging/prod databases or branches, SMTP credentials, cookie origins,
secret versions, and OAuth client registrations. Never point a preview at production auth or allow
all `*.vercel.app` origins. Database permissions and backup access must be scoped to their purpose.

## Secret rotation: distinguish encryption, signing, and provider credentials

A random application secret, a JWT signing key pair, SMTP credentials, and a database password are
four different credentials with different failure modes. Rotating one does not rotate the others.
Never include their values in a runbook, shell history, screenshots, or evidence report.

### Planned application-secret rotation

Better Auth supports versioned encryption secrets: the first configured version encrypts new
values and older versions decrypt existing envelopes. A singular legacy secret can decrypt data
from before envelopes. **In the pinned 1.7.7 implementation, session cookies are checked against
only the current secret: changing the current key logs out existing browser cookies even while
older versions remain for database decryption.** Plan a user re-login and restart interrupted
OAuth flows. Retaining old keys preserves necessary ciphertext; it does not promise seamless
cookies. Secret rotation alone also does not delete server-side sessions/grants. Inspect the pinned
source and repeat the regression before each upgrade.
[Options and versioned secrets](https://better-auth.com/docs/reference/options)

1. Generate a fresh high-entropy value directly into approved secret management. Assign a new,
   never-reused integer version. Record version IDs only.
2. Rehearse on a disposable environment containing old encrypted signing keys and active browser/
   OAuth test sessions. Add the new version first and retain old decrypt versions. Preserve the
   legacy singular secret when legacy ciphertext still exists.
3. Roll the same complete key ring to every replica. Prove old browser cookies are rejected and a
   fresh login works; test old encrypted JWKS readability, verification/reset flows, pending consent,
   JWT signing, and token refresh. A failing in-flight flow must restart safely and must not bind
   another user's identity. Avoid mixed-current-secret replicas causing intermittent re-login.
4. Verify new writes use the new version. A successful login does not re-encrypt every stored key.
   Inventory dormant encrypted records and historic backup requirements before retiring any key.
   Re-encrypt long-lived rows via a reviewed one-time migration if necessary.
5. Retire the old version only after its live ciphertext and backup retention obligations are
   resolved and the test proves no required decrypt path depends on it. Re-run real-host canaries.

If a secret was compromised, preserving seamless sessions is secondary to containment. Invalidate
sessions/grants and reset flows as needed, replace affected encryption/signing material, and require
fresh login. Do not remove an old key blindly if it would make the only backup unrecoverable.

### JWT signing-key rotation

The JWT plugin supports `rotationInterval` and an old-key `gracePeriod`; private keys remain
encrypted in the auth database. Rotation is not an external scheduled job: exercise issuance after
the interval and prove the selected signing `kid` changes. Preserve verification keys for at least
the longest issued token lifetime plus verifier cache/clock-skew allowance. See
[JWT key rotation](https://better-auth.com/docs/plugins/jwt#key-rotation).

The configured defaults are 30-day rotation, 1-day key grace and five-minute access tokens.
On staging, shorten the interval in a test-only configuration, mint one real OAuth resource token
before and after rotation, verify both against published JWKS during overlap, restart the service,
and verify the new key still works. After the allowed lifetime/overlap ends, prove old tokens fail.
Record only `kid`, timings, issuer/audience/scopes and outcomes; never record token values.

For a compromised signing key, ordinary grace is unsafe. Stop issuing with it, remove trust in the
compromised key, revoke refresh grants, and clear/restart resource-verifier JWKS caches as needed.
Test an old-key token fails on **every replica**. The self-hosted verifier additionally checks the
active user, client, session and exact consent on each request; disconnected or expired-session grants fail even before token expiry. Signout
invalidates the current session and its delegated tokens, while other login-session grants may
remain. Authorization codes and refresh tokens are bound to the original consent generation, so
reconsenting must not revive a pending code, captured refresh, or JWT from a disconnected generation.
Refresh-token rotation uses a zero-second reuse interval. Concurrent redemption of the same refresh
token is deliberately strict: one request succeeds and a duplicate fails. Clients must serialize
refreshes; duplicate/lost-response recovery may require reconnecting. The local suite verifies
one-success/one-failure behavior, not transparent recovery from concurrent client retries. Confirm
actual Claude/ChatGPT behavior during acceptance before changing this security setting.

Both resource access and refresh issuance require the originating session to remain active;
reset and signout must reject refresh as well. The optional upstream-only verifier has no such local
grant/session check, so its unexpired-JWT window must be measured separately. A compromised key
still requires removal and verification on every replica, not just normal user logout.

### SMTP and database credentials

Where the provider supports overlap, create a least-privilege replacement, update one canary,
verify delivery/DB access, roll all replicas, then revoke the old credential. Keep migration and
runtime DB roles distinct. Test the old credential is rejected. Do not perform provider credential
creation or rotation without the necessary access authorization.

## Transactional email operations

Use an approved SMTP provider and a verified sender domain. Configure SPF/DKIM and DMARC according
to that provider; send only account verification/recovery messages here. Use TLS with certificate
verification and least-privilege mail credentials. Do not fall back to printing verification URLs
or silently accepting verification failure when mail is unavailable.

For Resend Marketplace deployments, keep the injected `RESEND_API_KEY` and `RESEND_EMAIL_DOMAIN`
server-only and remove every explicit `SMTP_*` setting to opt into the fallback. The sender is
`Generative Arcana <noreply@DOMAIN>`; the configured domain must already be verified in Resend.
Any explicit SMTP value selects the existing SMTP path and incomplete settings fail closed. Use an
explicit SMTP sink or isolated test credentials/recipients in preview; shared Marketplace values
do not prove preview/production isolation. Do not print the injected key while diagnosing setup.

Before inviting users, deliver real verification and reset messages to at least two independent
mail providers; check inbox/spam placement, link origin, expiry, replay rejection, and reset/session
invalidation. Exercise SMTP timeout/rejection and check that the UI never claims an email was sent
when delivery failed. Normal recovery responses conceal absent accounts, but explicit SMTP failures
currently return 503 for attempted delivery while an absent account still returns the generic 200.
This is a known account-enumeration risk during mail outages or recipient rejection. The implementation
chooses truthful failure reporting; it does not claim enumeration resistance for this failure case.
Before a higher-sensitivity launch, implement a durable, monitored outbox with uniform request
acknowledgements (and wording that promises only queue acceptance), rather than hiding send failures.
Monitor queue or send errors, throttles, bounce/complaint rates, sender-domain reputation, and daily spend. Set alerts
with the selected provider's actual thresholds. Suppress hard bounces/complaints and avoid repeated
resends to a bad address. Keep staging on a mail sink or test-recipient allowlist.

## Abuse controls and observability

Use a shared, atomic rate-limiter budget for public HTTP across replicas plus endpoint-specific
Better Auth limits. A per-process counter alone is not a production abuse control. Better Auth
supports shared database/secondary storage, but its configured storage must be exercised under
concurrency; storage persistence alone is not proof of atomic counting.
[Rate-limit reference](https://better-auth.com/docs/concepts/rate-limit)

- Verify the trusted proxy strips/replaces IP headers and bypassing it is impossible. Never trust
  arbitrary client-supplied `X-Forwarded-For`. Compare budgets across two instances with the same
  source and after restart. Check separate legitimate users are not needlessly locked out.
- Bound signup, login, resend/reset, OAuth authorization/token/registration, and metadata fetches.
  Add edge request/body/concurrency and spend controls. Evaluate CAPTCHA or signup throttling if
  abuse appears; a new CAPTCHA is a UX/vendor/privacy decision, not a free security guarantee.
- CIMD fetches must use the bundled guarded Node transport, never raw `fetch`: reject special-use
  IPs, pin the resolved address, and reject redirects for both metadata and discovered resources.
  Keep dynamic registration opt-in and rate-limited; require PKCE/S256 and explicit resource scopes.
  [MCP configuration](https://better-auth.com/docs/plugins/mcp)
- Alert on readiness loss, database/SMTP failures, elevated 401/403/429/5xx, signup/reset spikes,
  client-registration growth, and latency. Do not log passwords, bearer/cookie/reset tokens,
  complete OAuth callback URLs, mail bodies, deck manifests, or private questions.
- Run the explicit limiter-pruning script daily after approval. It removes expired domain counters
  and Better Auth counters whose millisecond `lastRequest` is older than 24 hours, using the
  separate auth connection when configured. This is well beyond current endpoint windows.
  Session/verification/refresh-token cleanup needs a separately reviewed provider-aware retention
  plan; do not run broad age-based DELETEs over active grants, identity mappings or audit evidence.
- Review retention and access to redacted security events. Use opaque request/principal IDs where
  useful; avoid building an unnecessary store of IPs/emails or shipping them to unapproved services.

## Rollback and exit triggers

Maintain the last known-good artifact and a tested compatibility matrix before every rollout.
If code-only rollback is safe, restore that artifact with the compatible key ring and confirm
health plus full auth canaries. Do not automatically roll schema backwards. For incompatible
changes, pause writes, restore to an isolated target, reconcile changes after the restore point,
and obtain approval before promoting it; describe expected data loss first.

Switch to a hosted provider when operator coverage, security response, compliance requirements,
email support, or recurring labor exceed the acceptable budget. Re-evaluate quarterly and after
an incident. Use the [hosted migration plan](hosted-auth-migration.md); preserve `usr_*` ownership
and prove both identities through fresh authentication, never email-only merging.

## Evidence required before claiming an operation is tested

Record operation, exact commit/package versions, environment, operator/date, pre/post conditions,
redacted result, timings, rollback result, and remaining risks. A runbook is not a completed drill.
The automated test report must distinguish configuration/unit checks from real database,
cryptographic overlap, SMTP, browser, Claude, and ChatGPT tests. Production acceptance remains
**not run** until the [release evidence](production-launch-checklist.md) is filled by an operator.
