# Generative Arcana account and private-alpha testing

The default account path is self-hosted Better Auth with PostgreSQL. Green CI and liveness do
not establish production account readiness. Use the [deployment guide](../docs/better-auth-deployment.md)
and complete the [real browser/Claude/ChatGPT launch checklist](../docs/production-launch-checklist.md)
before inviting friends. Private-alpha bearer tests remain useful regression/dogfooding coverage,
but they do not test user signup, consent, account isolation or hosted-client compatibility.

## Account preflight

1. Run app tests/typecheck/build, MCP typecheck, protocol/auth/ownership tests, migration guards,
   identity migration/shared limiter tests, catalog freshness, semantics, visuals and container gates.
2. Apply explicit reviewed domain/auth migrations in an authorized disposable database first.
   Confirm the server cannot create tables on startup and a missing schema fails readiness.
3. On staging, prove actual SMTP signup verification/reset, browser session flow, consent, resource
   token/scopes, refresh/disconnect, two users/two clients, restart and separate-instance persistence.
4. Identify the exact production commit and inspect JSON `/healthz`, `/readyz` and metadata. The
   accepted account deployment has Better Auth enabled, OAuth configured, alpha disabled and healthy
   bounded dependency checks; this is still a prerequisite, not full end-to-end proof.
5. Run every real product and operations acceptance row. A synthetic OAuth client, in-memory auth
   adapter, embedded PostgreSQL engine or hand-supplied bearer cannot substitute for the real
   browser, Claude, ChatGPT, SMTP provider, and deployed Neon tests.

## Private-alpha transport preflight

1. `/healthz` identifies the expected artifact/version and alpha auth mode.
2. Anonymous MCP advertises the public tool set and intentionally omits protected account tools in
   non-OAuth mode. Do not assert an obsolete fixed tool count.
3. The configured alpha bearer permits imports scoped to its one opaque principal; a bad bearer
   fails with 401 rather than anonymous fallback.
4. Durable alpha storage has a persistent volume or explicitly migrated database and passes restart
   testing. It is not multi-user signup. Do not distribute the alpha secret as a friend-account fix.

## Core dogfood journeys

Run these as natural conversations rather than scripted JSON calls. Record which tools the model chooses, whether it asks unnecessary questions, and whether it preserves symbolic identities across follow-ups.

### Discovery

- “What symbolic systems do you have available?”
- “Tell me what makes Deep Time structurally different from Ultima Tarot.”
- “What spreads can I use with Deep Time?”

### Structural interrogation

- “Pick a Deep Time card and explain its coordinates before interpreting its meaning.”
- “Find other cards that share its transversal station.”
- “Find an exact intersection of suit/rank/station or dialectic poles and explain why those cards occupy it.”
- “What does Ω contribute here, and what is authored versus derived?”

### Reading flow

- “Cast a one-card Deep Time reading for: What pattern is asking for my attention?”
- Follow with: “Don’t recast. Explain why *that exact card* appears structurally.”
- Follow with: “Now give me the interpretation.”
- Follow with: “Resolve the reading again from its token and verify we are discussing the same card.”

### Visual reading flow

- “What visual packs can you actually render for Final Fantasy Tarot?” → expect the complete `pixel` pack.
- “Show me the art for Final Fantasy major-0.” → expect a real PNG image content block, not a prose description.
- “Cast a three-card Final Fantasy reading and show me the drawn cards.” → expect one immutable reading token and three image blocks from `render_reading`; the model must not recast merely to obtain art.
- Ask which cards are reversed → orientation metadata must agree with the original reading even though the first static-image slice does not yet rotate the PNG bytes.
- Ask for images from Deep Time → expect an explicit “no server-renderable visual pack yet” tool error while symbolic reading remains available.

### Cross-system reasoning

- “Analyze one card from Deep Time and one from Ultima Tarot without pretending their axes are identical.”
- “What structural comparison is legitimate here, and what would be annexing one deck into the other?”

### Authenticated custom-deck persistence

- Import a deliberately renamed copy of a bundled deck.
- Verify it appears only while authenticated.
- Restart/redeploy the server.
- Reconnect with the same principal and verify it returns.
- Connect anonymously and verify it remains invisible.

## Negative/operational checks

- Send a bad bearer token → expect 401, not anonymous fallback.
- Send an oversized request with a declared content length → expect 413.
- Exceed the configured per-minute request budget → expect 429 + `Retry-After`.
- Query a nonexistent deck/card → expect an explicit tool error, not hallucinated recovery.
- Resolve a reading token against the wrong deck route → expect rejection.
- Corrupt persisted state in a disposable environment → restore must fail closed.

## What to capture for every bug

Capture only:

- server `version` from `/healthz`
- transport: stdio or HTTP
- anonymous vs authenticated (never the token)
- tool name(s) selected
- user-visible expected behavior
- actual behavior/error
- whether the issue reproduces

Do **not** copy bearer tokens, raw custom deck JSON, private questions, or full reading payloads into operational logs. Tool logs intentionally contain only tool name, success/failure, duration, transport, and an opaque principal hash.

## Automated baseline

Run before and after any semantic/tool change:

```bash
npm --prefix mcp run eval:golden
npm --prefix mcp run smoke
npm --prefix mcp run smoke:http-guardrails
npm --prefix mcp run test:visuals
npm --prefix mcp run test:auth-email
npm --prefix mcp run test:better-auth
npm --prefix mcp run test:better-auth-ownership
npm --prefix mcp run test:auth-schema
npm --prefix mcp run test:domain-migrations
```

The golden suite is deterministic infrastructure/semantic coverage. As real dogfood sessions reveal model-behavior failures, promote minimal reproducible conversations into a separate agent-eval corpus rather than making the deterministic suite fuzzy.

## What local auth evidence establishes

The Better Auth protocol tests use the actual installed library and a disposable PostgreSQL/PGlite
engine. The ownership suite uses real signup/verification/login and two OAuth clients to exercise
one `usr_*` identity, a separate user, scoped client disconnect, and old-token rejection after
reconsent. Migration tests use generated auth SQL and legacy domain schema upgrades. The email
transport is a capture sink; host clients are synthetic. These boundaries must remain explicit in
reports. A blocked local browser visual check is a not-run case, not a pass; server-render/API tests
do not establish visual or interactive correctness. Live-host and operations gates remain required.

`test:auth-email` uses synthetic environment fixtures and a stubbed Nodemailer transport. It covers
the Resend Marketplace variables, explicit SMTP precedence, missing/malformed configuration,
domain/header injection rejection, TLS settings and delivery rejection. It does not read real mail
credentials, contact Resend or send mail, and does not prove sender verification or inbox delivery.
