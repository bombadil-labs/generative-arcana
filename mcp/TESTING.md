# Generative Arcana private-alpha testing

The private alpha is ready for testing when all CI gates are green and a deployed `/healthz` reports the expected MCP version. The goal of the first dogfood round is not to prove divination value; it is to discover whether an LLM equipped with Generative Arcana behaves differently and more coherently than one merely prompted to imitate a tarot reader.

## Preflight

1. `GET /healthz` returns `ok: true`, the expected `version`, and the configured limits.
2. Anonymous MCP connection lists twelve tools and does **not** list `import_deck`.
3. Authenticated private-alpha connection lists all thirteen tools.
4. Bad bearer credentials receive HTTP 401.
5. CI is green for app tests/typecheck/build, MCP typecheck, persistence/auth, both protocol transports, golden eval, guardrails, visual assets, and container builds.

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
```

The golden suite is deterministic infrastructure/semantic coverage. As real dogfood sessions reveal model-behavior failures, promote minimal reproducible conversations into a separate agent-eval corpus rather than making the deterministic suite fuzzy.
