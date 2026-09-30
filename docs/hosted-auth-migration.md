# Moving from self-hosted to hosted authentication

The durable boundary is `(issuer, subject) → usr_*`. A provider controls authentication;
Generative Arcana controls its stable principal and deck ownership. Migrating identity must not
rewrite catalog owner IDs, deck resource IDs, manifests, revisions, visibility, or reading tokens.
This is a staged design and operator procedure, not an automatic migration or authorization to
create accounts, export personal data, change billing, or deploy.

## Candidate fit, checked 2026-09-30

- **Managed Neon Auth** uses Better Auth as its foundation, but Neon's documented managed plugin
  matrix does not offer the MCP/OAuth Provider needed for third-party hosts to authorize against
  Arcana. It is not a drop-in replacement for this combined browser + MCP authorization server.
  Keeping a self-hosted OAuth layer while moving browser login would still retain significant auth
  operations and require a reviewed federation/linking design. Recheck supported plugins before
  selecting it. [Neon's maintained auth matrix](https://github.com/neondatabase/agent-skills/blob/main/skills/neon-auth/SKILL.md#plugin-support)
- **WorkOS AuthKit + Connect** is a full hosted candidate for user login and OAuth client access.
  Review current scope/resource/PKCE/CIMD or registration support, exact host callbacks, user export
  and recovery options, regional/privacy needs, support, and actual pricing with the provider.
  Do not assume a hosted dashboard toggle makes both hosts interoperable. The removed WorkOS
  browser adapter is not maintained as an alternate runtime in this branch; a future migration
  supplies and tests a new provider adapter. [WorkOS Connect](https://workos.com/docs/authkit/connect)
- Other hosted identity providers qualify only after the same fit test. A social-login SDK or JWT
  issuer alone is insufficient: the MCP authorization server must support the required resource,
  scopes, consent, client identification, PKCE, refresh, and revocation behavior.

There is no commitment to either provider. Compare total operator time, service charges, exit
support, incident response, and the cost of retaining a separate MCP authorization server.

## Invariants and linking evidence

Each `(issuer, subject)` pair is unique and belongs to exactly one internal principal. Multiple
verified external identities may point at the **same** existing principal during/after migration.
An attempt to attach an already-owned identity to a different principal must fail atomically.
Emails, names, usernames, and claimed provider IDs are never sufficient proof of account ownership.

Acceptable linking proof is a short-lived, single-use operation bound to the existing Arcana
session and a fresh completed login to the destination provider, with validated state/nonce/PKCE,
issuer, signature, audience, and subject. Require recent reauthentication to the source account.
If source login cannot be recovered, use a separately approved support/recovery procedure with
strong evidence; do not create a mass email-match fallback.

The offline identity-link tool is an operator boundary: it can preserve a principal and reject
conflicts but cannot prove a human's fresh logins by itself. Before applying a link, retain a private
audit record of both verified identity proofs, explicit user consent, operator, intended principal,
time, and a non-secret approval reference. Never put tokens or authentication evidence in CLI
arguments, source, or public logs. A manual tool is not a self-service migration UI.

## Operator link plan

The domain migration allows several proven identities to reference one existing principal while
retaining `(issuer, subject)` uniqueness. After the dual-authentication/review step, create a private
plan with this shape (all values below are illustrative placeholders):

```json
{
  "source": { "issuer": "https://old.example/api/auth", "subject": "VERIFIED_SOURCE_SUB" },
  "target": { "issuer": "https://new.example/", "subject": "VERIFIED_TARGET_SUB" },
  "expectedPrincipal": "usr_EXISTING_OPAQUE_PRINCIPAL",
  "evidenceReference": "PRIVATE_APPROVAL_REFERENCE_NO_TOKENS"
}
```

Preview and authorized application are separate:

```bash
npm --prefix mcp run auth:link-identity -- --plan /secure/path/identity-link-plan.json
npm --prefix mcp run auth:link-identity -- \
  --plan /secure/path/identity-link-plan.json --apply \
  --expected-host REVIEWED_DOMAIN_DATABASE_HOST --confirm-verified-both-identities
```

The preview prints provider subjects and the evidence reference, so run it in a private terminal,
not public CI. Apply uses `DATABASE_MIGRATION_URL` or `DATABASE_URL`, verifies the source principal,
refuses conflicting target ownership, and records a link audit row transactionally. The flag is an
operator assertion of previously checked proof, not an authentication ceremony. The tool does not
move decks or reset passwords. Preserve the original source mapping for recovery. No production
link is authorized by an example command in this document.

## Staged migration

1. **Inventory and fit test.** Record existing principals, external identities, catalog counts and
   ownership checksums, alpha-owned content if any, auth methods, OAuth clients, scopes, issued
   token lifetimes, and downstream dependencies. Keep inventory private. Obtain approval for the
   named provider, costs, legal terms, and exact personal data to transfer.
2. **Export/recovery rehearsal.** Back up both auth and domain databases plus required secret
   versions. Test a restore. Establish how users will regain access: password-hash import is
   provider/format-specific and must be verified; never promise password, session, or client-secret
   portability. Prefer a fresh login/reset when migration support is unproven. Never transfer
   active sessions, refresh tokens, reset links, or signing private keys to fake continuity.
3. **Implement adapter on staging.** Keep browser-session and bearer verification behind their
   existing interfaces. Configure the new exact issuer/resource and use new provider-specific
   client IDs. Prove discovery, consent, scope/audience enforcement, and every launch-checklist case
   against two test accounts. Separate auth identity from the unchanged `usr_*` domain principal.
4. **Link opted-in users before switching.** Freshly authenticate source and target and record a
   verified link. Validate that the source pair still resolves to the expected principal and target
   pair is unowned or already linked to that same principal. Perform link creation transactionally.
   If both identities already own different principals, stop for a deliberate recovery/merge
   decision; never silently merge libraries or reassign decks.
5. **Canary and freeze.** Choose an approved maintenance/cutover window. Stop new signups or use an
   explicitly designed enrollment path while linking is in progress; avoid creating a second empty
   principal for a migrating user. Snapshot principal/owner invariants again. A canary should see
   the identical deck IDs/revisions/visibility in browser, Claude, and ChatGPT.
6. **Cut over authentication.** Change the verifier/browser adapter together, require fresh host
   consent/reconnection, and invalidate old cookies/grants as planned. The current runtime uses
   one configured issuer; simultaneous dual-provider issuance/verification would be additional
   implementation requiring tests, not an existing feature to assume. Keep historic mapping rows
   and source recovery capability through the rollback window.
7. **Verify and retire.** Compare principal/ownership counts and checksums; test isolation, private
   reads/writes, fresh sessions, host refresh, and new signup. Observe auth/mail/error signals through
   the agreed token/session horizon. Only after acceptance and the retention/rollback window,
   disable the old issuer's access and remove old secrets/provider resources with approval.

## Rollback

Keep source identity links and its compatible artifact/configuration available until acceptance.
If target login fails, stop new target enrollments, restore the source auth route, invalidate target
sessions/grants, and have hosts reconnect to the source issuer. Do not delete correct target links
or revert catalog ownership to “undo” auth. New target-only users need an explicit recovery path;
record them before cutover. Never roll a database backward over new decks without an approved
reconciliation/data-loss plan.

## Cutover acceptance record

Record the exact source and destination issuers, approved provider terms/data transfer, release
commit, tested host client paths, proof-reference format, conflict handling, counts/checksums,
rollback window/operator, test account outcomes, and unresolved users. Do not record credentials.
A successful import API call does not prove preserved ownership. Completion requires the same
existing account/library across real browser, Claude, and ChatGPT plus an isolated second account,
restart/independent-instance persistence, and a demonstrated recovery route.
