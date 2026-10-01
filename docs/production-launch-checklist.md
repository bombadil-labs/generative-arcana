# Production account launch: setup and evidence

**Status: not accepted.** These are acceptance criteria and a record template, not checked-off
production results. Keep secrets, token/cookie values, personal emails, and private deck content out
of this file and public issue/CI logs. Use dedicated test accounts and clearly designated test decks.
Only delete those test decks with the owner's explicit approval.

- Canonical web: https://generative-arcana.vercel.app/
- Canonical MCP resource: https://generative-arcana.vercel.app/mcp
- Default account path: [self-hosted Better Auth + Neon deployment](better-auth-deployment.md)
- Operations: [patches, rotation, restore, email and abuse controls](better-auth-operations.md)
- Exit path: [hosted identity migration preserving ownership](hosted-auth-migration.md)
- User flow: [Claude / ChatGPT authoring](authoring-hosts.md)

## Dated baseline, not current acceptance

The read-only audit on **2026-09-30 UTC** observed production at a deployment associated with
[`7b17308be1e334993163c8826df627bb4fcdfba0`](https://github.com/bombadil-labs/generative-arcana/commit/7b17308be1e334993163c8826df627bb4fcdfba0):

- Web app, seven bundled decks, and anonymous MCP worked.
- `/healthz`: HTTP 200; `auth: "alpha-bearer"`, `browserAuth: "disabled"`, `state: "neon"`;
  account/cross-host/library readiness flags false.
- `/readyz`: HTTP 503, missing `mcpOAuth`, `browserAuth`, and `alphaDisabled`. That audited revision
  reported configuration flags only, not the dependency probes added in this launch-readiness work.
- `/auth/session`: HTTP 503 `browser_auth_unavailable`; My Decks said accounts were not configured.
- Anonymous MCP omitted protected import/library tools intentionally in non-OAuth mode. Authoring
  spec/validation were present; there was no evidence of a missing import implementation.
- OAuth well-known routes returned SPA HTML rather than discovery JSON.
- GitHub recorded a successful deployment of the above SHA, but the runtime did not expose a SHA.
- Existing cross-host tests used mocked identity/WorkOS and in-memory state. No real authenticated
  Claude/ChatGPT signup or durable Neon journey had been demonstrated by this audit.

A fresh anonymous production smoke at **2026-09-30 21:13:37 UTC** reconfirmed the account blockers:
alpha bearer mode, disabled browser auth, 503 readiness/session responses, HTML discovery fallback,
and absent protected authoring tools. It did not attempt signup, credentials, or catalog mutations.

A source fix, green local test, new guide, or successful deployment does not turn any unchecked
acceptance item below into a pass. Replace this baseline only with dated, attributable evidence.

## 1. Production activation prerequisites

This branch selects self-hosted Better Auth. Production changes, service costs and the operating
commitment require approval; implementation alone does not establish them.

- [ ] Approve the production rollout, SMTP/provider costs, operating owner and backup operator.
- [ ] Record canonical origin, exact MCP resource/audience, `/api/auth` issuer, intended commit,
  installed Better Auth/plugin versions, artifact, and rollback compatibility.
- [ ] Set the production `BETTER_AUTH_*`, SMTP or Resend Marketplace email configuration, domain `DATABASE_URL`, exact host/origin allowlists,
  and deployment identity from the guide. Keep secrets in secret management, not this checklist.
- [ ] Verify sender domain/TLS and deliver actual signup-verification and password-reset emails to
  independent mail providers. Test expiry/replay, SMTP failure, and reset/session invalidation.
  Review the documented outage-time recovery enumeration tradeoff before enabling public signup.
- [ ] Back up auth + identity/catalog data and required key versions. Perform and time a staging
  restore; set actual RPO/RTO/retention and name the recovery operator.
- [ ] Generate and review the auth schema plan; separately review domain migration SQL. Apply only
  with approval and a recorded restore point, verify idempotency/readiness, then use runtime DML-only
  roles. Startup and requests must never perform schema migrations.
- [ ] Rehearse signing-key overlap/expiry and versioned-secret rotation against old encrypted data.
  Record exactly what survives, what requires reauthentication, and the tested rollback. A config
  default or unit assertion is not cryptographic rotation evidence.
- [ ] Verify PKCE/S256, exact resource binding, user consent, `decks:read` and `decks:write`.
- [ ] Record the working client-identification path for **each real host**. Current self-hosted code
  supports CIMD with guarded Node transport; DCR is disabled. If a host needs a different path,
  implement/test that scoped compatibility work before marking the host accepted.
- [ ] Verify trusted-edge IP handling, shared atomic limits across independent replicas, bounded
  auth bodies, security logs/alerts, cleanup/retention, and staging/production isolation.
- [ ] Inventory alpha-owned decks and preserve/migrate ownership deliberately if necessary.
  Remove `MCP_ALPHA_TOKEN` before enabling OAuth. Never map alpha/private libraries by email.
- [ ] Deploy the intended tested full web + MCP container. Record URL, full SHA, deployment time
  and CI for that exact SHA. Changed environment variables require redeployment.

## 2. Read-only deployment smoke

From the repository root, save a fresh, dated report after deploying:

```bash
node tools/smoke-production.mjs \
  --url https://generative-arcana.vercel.app \
  --expected-sha FULL_DEPLOYED_COMMIT_SHA
```

The production smoke is read-only and should fail until its readiness/discovery requirements pass.
It is supplementary to the authenticated acceptance below. For focused HTTP inspection:

```bash
base=https://generative-arcana.vercel.app
curl --fail-with-body -sS "$base/healthz"
curl --fail-with-body -sS "$base/readyz"
curl --fail-with-body -sS "$base/auth/session"
curl --fail-with-body -sS "$base/.well-known/oauth-protected-resource/mcp"
curl --fail-with-body -sS "$base/.well-known/oauth-protected-resource"
curl --fail-with-body -sS "$base/.well-known/oauth-authorization-server"
```

Do not add tokens or a cookie jar to the anonymous inspection commands. HTTP 200 alone is not a
pass: verify JSON content type and parse the body, so an SPA fallback cannot masquerade as an API.

- [ ] `/healthz` is JSON with expected build identity, `auth: "oauth-oidc"`,
  `browserAuth: "better-auth"`, and `state: "neon"`.
- [ ] `build.sha` matches the intended commit (record the full SHA separately); `build.shaSource`,
  `build.id`, and `build.idSource` identify their origin. Missing/invalid build IDs are `null`, not
  evidence of freshness. `ARCANA_BUILD_SHA`/`ARCANA_BUILD_ID` override supported Vercel variables.
- [ ] `/readyz` is HTTP 200 JSON, `readiness.configurationReady` and `productionAccounts` true,
  every check true, and `missing: []`. Inspect `readiness.dependencies.databaseConnectivity` and
  `issuerDiscovery`: both must be `healthy` with recent `checkedAt` values. Record the response.
- [ ] Probe semantics are understood: read-only domain-table/schema checks plus exact-issuer metadata,
  3-second timeout and 15-second cache. Neither this nor liveness proves DML permissions, durable
  writes, email delivery, key rotation, or a working end-user login.
- [ ] Anonymous `/auth/session` returns HTTP 200 `{ "authenticated": false }`.
- [ ] Both protected-resource documents name the exact MCP URL, issuer, and deck scopes. Authorization-server
  discovery and protected-resource metadata agree on issuer; authorization/token/JWKS endpoints use
  HTTPS and S256 is advertised. Check the selected registration path, not just endpoint presence.
- [ ] Missing/disabled machine endpoints cannot fall through to SPA HTML. Check an unknown
  `/api/...`, `/auth/...`, and `/.well-known/...` path for a structured non-success response.
- [ ] Initialize MCP and call anonymous `tools/list` using an MCP client. In OAuth mode,
  `import_deck`, `list_my_decks`, `set_deck_visibility`, and `delete_my_deck` are advertised with
  appropriate security metadata. An unauthorized protected call challenges and changes no data.
- [ ] Refresh/reconnect both host integrations if tool discovery was cached before the deployment.

## 3. Real friend journey: test every row

Use two independently controlled test accounts, A and B, and a small valid canonical manifest.
Record host product, plan/workspace prerequisites, date, client path, and result. An API call with a
hand-supplied bearer token is useful supplementary evidence but **does not pass a Claude/ChatGPT row**.

| Acceptance case | Expected result | Result / evidence |
|-----------------|-----------------|-------------------|
| Fresh web account A | Signup → actual email verification → login without alpha secret; My Decks loads; sign out and return works | Not run |
| Recovery and account UI | Reset email/link expiry/replay, password change, session invalidation, resend, interrupted login, repeated clicks, Close/Back/Forward, loading/error states | Not run |
| Claude account A | Production remote connector consent → author → validate → explicit import → list → cast → resolve/render | Not run |
| ChatGPT account A | Supported custom MCP/developer surface and permissions → fresh OAuth consent → same full workflow | Not run |
| Same account, three surfaces | Deck created in one host appears with the same resource ID, current contents, revision, and visibility in the other host and web | Not run |
| Explicit replacement | Validated same-slug update with `replaceExisting: true` preserves resource ID/visibility, advances revision, and is used in a newly dealt reading | Not run |
| Browser refresh / reconnect | Full reload, sign-in return, and each host reconnect preserve account-owned decks | Not run |
| Container restart / redeploy | Same deck survives restart/redeploy with the same identity/content, proving actual Neon persistence | Not run |
| Independent server instances | A imports/replaces/deletes; B lists/gets/deals the latest state and cannot read a deleted record from a stale owner cache | Not run |
| Account B isolation | Cannot list/read/replace/publish/delete A's private deck; B can import the same authored slug with a distinct owner/resource ID | Not run |
| Unlisted | Known-ID/link resolution succeeds for non-owner; public discovery does not list it | Not run |
| Public | Appears in Community/public list and resolves by its stable resource ID | Not run |
| Re-private / delete | Fresh non-owner and anonymous catalog resolution fails; other process caches do not continue serving it. Already received copies cannot be revoked | Not run |
| Reading integrity | Same current manifest/token resolves to the same cards; after a content replacement, an old mismatching token fails explicitly | Not run |
| Bad/expired credentials | Invalid signature, wrong issuer/audience, expired token, or missing read/write scope fails closed without mutation | Not run |
| Refresh / disconnected client | Token renewal/reconnection works; disconnect blocks that grant on every instance; other users/clients remain isolated; reconsent never revives an old token | Not run |
| Signout / password reset | Current-session signout blocks its delegated tokens; reset invalidates sessions; test refresh and unrelated login-session grants explicitly | Not run |
| Rotation / restore | New signing kid + old-key overlap/expiry, versioned-secret old-data decrypt, restart and timed isolated restore all demonstrated | Not run |

For self-hosted Better Auth, each resource request verifies the JWT and checks the current verified
user, client, originating browser session and exact consent row. Disconnect deletes that grant;
old tokens must fail and a later reconsent must not revive them. Signout also affects connectors
bound to that browser session. Test access **and refresh** behavior, including another session's
grants, rather than inferring it from a successful UI response. The configured access lifetime is
five minutes; the refresh maximum is 30 days but resource access still requires an active session.

The optional upstream-only JWT adapter has different semantics: it does not consult Better Auth's
session/grant tables or introspect every external token. For that future deployment mode, measure
the unexpired-token revocation window separately. Do not transfer self-hosted guarantees to it.

## 4. Evidence record to attach to the release

Fill this with non-secret links, redacted results, and explicit pass/fail/not-run states:

```text
Recorded at (UTC):
Operator:
Canonical web / MCP URLs:
Full commit SHA:
CI run for that SHA:
Production deployment URL / time:
Runtime build { sha, shaSource, id, idSource }:
Readiness JSON and dependency check times:
Discovery content types / exact resource / issuer / S256 / client paths:
Browser signup/actual verification email, logout, return and interrupted-UI result:
Password reset, expiry/replay and session invalidation result:
Claude product / workspace prerequisites / OAuth and authoring result:
ChatGPT product / workspace prerequisites / OAuth and authoring result:
Account A same resource ID / revision across hosts + web:
Account B isolation / same-slug result:
Neon restart + independent-instance freshness evidence:
Private / unlisted / public / re-private / deletion results:
Invalid / expired / wrong-audience / missing-scope results:
Refresh / client disconnect / current-session logout / password-reset behavior:
JWT and secret rotation / old-data decrypt / rollback evidence:
Backup restore point, measured RPO/RTO, isolation and restored-credential invalidation:
Shared limiter/proxy/cleanup and alerting evidence:
Production owner / backup operator / cost approval:
Test-data cleanup approved / completed:
Known failures or unrun cases:
Launch decision and owner:
```

**Done means:** a friend without an alpha secret independently creates an account and private deck
through either host, finds/deals the same durable resource in the other host and the web app, and
all identity/isolation/freshness checks above pass against the identifiable production deployment.
Until those observations exist, report the remaining blockers instead of “production verified.”
