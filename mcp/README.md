# Generative Arcana MCP

Headless MCP transports for the Generative Arcana engine. The MCP layer owns no symbolic semantics: it starts with an empty isolated `DeckRegistry`, creates an `ArcanaEngine`, and delegates symbolic tool calls through `ArcanaToolAdapter`. Renderer capabilities remain host-owned beside the engine; static image-backed packs can be returned as real MCP image content without importing browser-only p5/kit renderers.

## Production account setup

- Web app: https://generative-arcana.vercel.app/
- Remote MCP: https://generative-arcana.vercel.app/mcp
- [Claude / ChatGPT onboarding and author → validate → import](../docs/authoring-hosts.md)
- [Self-hosted Better Auth + Neon configuration](../docs/better-auth-deployment.md)
- [Production acceptance evidence](../docs/production-launch-checklist.md)

**Account launch status (2026-10-01 UTC):** production accounts and readiness are live at
[`c2cf91a`](https://github.com/bombadil-labs/generative-arcana/commit/c2cf91a2e19b43d76b5db7c6c1e394a177b0740b).
Browser login and real Claude OAuth/private-library reads have been verified. ChatGPT connection
setup, host-driven deck creation/import, and full cross-host persistence acceptance remain pending.
This is not a claim that all [launch acceptance and recovery checks](../docs/production-launch-checklist.md)
have passed; the dated September 30 audit remains historical evidence.

Legacy pre-built decks and their art are no longer installed by default or included in production
containers. Old bundled IDs and reading links fail as unavailable. User imports and authorized
public/unlisted catalog resources keep their existing behavior; no user-owned catalog rows are removed.

## Complete authoring method over MCP

Before planning or constructing a deck, call `get_deck_authoring_guide({})`. With no arguments
it returns all 23 canonical source files verbatim: the complete skill, references and strategies
(including schema and examples), and the reviewed supporting authoring contracts, with
repository-relative filename headers. It is public and read-only in both stdio and HTTP; no
account or rendering capability is required. The same full text is a
listed resource at `arcana://authoring/guide` (`text/plain`). `get_deck_authoring_spec` links to both
surfaces and remains the compact machine-readable validation contract, not the authoring method.

Finish the full guide before design or strategy selection. Then follow the canonical skill's
dialogue: discuss each design decision with the user and wait for explicit agreement before
proceeding to the next. One complete manifest is the final artifact, not a one-turn workflow.
Use the same tool for each of these retrieval patterns:

- **Full:** omit arguments (or pass `{}`) for the complete guide, including its preamble.
- **Discovery and whole files:** use `{ toc: true }` for a compact TOC with bundle format/hash,
  total size, and every exact source path, source size, and purpose. Then use
  `{ files: ["skill/generative-arcana/SKILL.md", "skill/generative-arcana/strategies/index.md"] }`
  as the first batch. Read all remaining inventory files before choosing strategies or beginning
  design, using the TOC's exact
  repository-relative paths. Results always use canonical order, regardless of request order,
  and retain the full guide's filename headers. They omit the preamble and join the framed
  sections with one newline between each pair (`N - 1` separator characters for `N` files).
- **Legacy chunks:** `offset` and/or `maxChars` retain their original behavior for existing
  clients or a single file too large for a host response. Offsets/counts are Unicode code points
  in the complete guide, never file-relative. To stream the full guide, start with
  `{ offset: 0, maxChars: 12000 }`, then continue at `range.nextOffset` until null; concatenate
  chunks without separators. For an oversized file, start at its `section.offset`, cap each
  request to its remaining `section.chars`, and stop when that section is complete.
  `range.nextOffset` tracks the complete guide, so it can remain non-null at a file boundary.

Do not combine `toc`, `files`, or legacy chunk parameters, even an explicit `offset: 0`.
`toc` accepts only `true`; empty selections, duplicate paths, and unknown paths are rejected.
There are no filename aliases or additional per-file tools. The method is not rewritten or
restricted to a particular image/program renderer.

### Response metadata and version checks

Every mode returns the complete inventory in `structuredContent.files`, with each file's
`path`, `purpose`, `sha256`, source `bytes` and `chars`, and `section: { offset, chars, bytes }`.
Source sizes exclude filename headers; `chars` counts Unicode code points. Section sizes cover
that file's complete framed section (headers and framing newlines), excluding the separator
between sections; its offset is measured in Unicode code points from the complete guide's start.
Use section sizes to budget whole-file batches, allowing for the intervening separator newlines.
Also reserve space for the structured inventory and protocol envelope; section sizes and
`returnedByteLength` measure returned text, not the entire tool response.

`mode` is `full`, `toc`, `files`, or `chunk`. `selectedPaths` appears only in `files` mode and
lists canonical return order. `range` appears only in `full`/`chunk` mode and reports `offset`,
`returnedChars`, `totalChars`, and `nextOffset`. `returnedByteLength` is always the actual returned
text's UTF-8 size; global `byteLength` is always the complete guide's UTF-8 size.

Global `sha256` identifies the complete framed guide, and `sourceDigest` identifies the canonical
source inventory, in every mode; neither identifies the TOC or a selected subset. `sourceDigest`
is SHA-256 of the JSON-serialized ordered `{ path, bytes, sha256 }` entries only. Discovery labels
such as `purpose` do not enter either hash, so editing a purpose alone changes neither digest.
`formatVersion: 1` versions the bundle framing, not the tool API, and remains unchanged.

An installed skill can use the TOC to compare source hashes before fetching changed files. Verify
**every** inventory entry, including `docs/contracts-and-readings.md`, `docs/deck-manifest.md`,
`docs/schema-v2.md`, and `docs/visual-grammar.md`; a matching skill directory alone does not prove
that the complete guide matches. Keep global hashes consistent across batches/chunks, and start
over if the guide changes during retrieval.

### Building and inclusion policy

Run `npm run build --prefix mcp` from the repository root to generate
`mcp/generated/authoring-guide.txt` and its inventory JSON. `node tools/build-authoring-guide.mjs
--check` rejects stale output. Both Docker builds generate the same artifact in a source-only
build stage and copy only the bundle plus loader into the final image; no archived deck corpus
is added. Local source checkouts read canonical files directly, so existing stdio/dev commands
work without a prior build. Packaged runtimes fail closed if the bundle is missing/corrupt.

Inclusion policy: every text file under `skill/generative-arcana/`, with `SKILL.md` first and the
rest sorted by repository-relative filename, followed by the reviewed support documents listed
in `tools/build-authoring-guide.mjs`. References between those sources are checked transitively.
Operational onboarding/deployment navigation and implementation-code pointers are not embedded;
new outside-package authoring references fail the build pending an explicit inclusion review.
No source instructions are copied into a second hand-maintained guide.

## Local stdio

```bash
cd mcp
npm install
npm start
```

Use `npm --prefix /path/to/generative-arcana/mcp start` as a local MCP server command in a host that supports stdio servers.

A stdio connection owns one Arcana host, so `import_deck` is available there and imported custom
decks remain available to later tool calls on that connection. This is process/connection state,
not an account-backed production library; it does not by itself survive process restart.

## Streamable HTTP

```bash
cd mcp
npm install
npm run http
```

Defaults:

- endpoint: `http://127.0.0.1:3000/mcp`
- health: `http://127.0.0.1:3000/healthz`
- localhost Host/Origin allowlist is enforced

Environment:

- `PORT` — default `3000`
- `HOST` — default `127.0.0.1`
- `MCP_ALLOWED_HOSTS` — comma-separated hostnames, required when binding non-loopback
- `MCP_ALLOWED_ORIGINS` — comma-separated origin hostnames; defaults to the host allowlist
- `MCP_ALPHA_TOKEN` — optional private-alpha bearer token; incompatible with OAuth mode. When both alpha and OAuth are absent, HTTP callers are anonymous
- `MCP_ALPHA_PRINCIPAL_ID` — stable opaque scope id for the alpha token, default `alpha-user-v1`
- `BETTER_AUTH_URL` — canonical browser origin; enables self-hosted Better Auth, with issuer at `/api/auth`
- `BETTER_AUTH_SECRET` / `BETTER_AUTH_SECRETS` — high-entropy singular secret or versioned encryption key ring; see the rotation runbook
- `BETTER_AUTH_DATABASE_URL` — optional separate auth database; otherwise uses `DATABASE_URL`
- `SMTP_HOST`, `SMTP_PORT` (default `587`), `SMTP_SECURE` (default `false`), `SMTP_FROM` — transactional email configuration; `false` requires STARTTLS, `true` uses implicit TLS
- `SMTP_USER` / `SMTP_PASSWORD` — supplied together if SMTP authentication is required
- `RESEND_API_KEY` / `RESEND_EMAIL_DOMAIN` — server-only Resend fallback when **all six `SMTP_*`
  variables above are absent**. Vercel Marketplace can inject these without copying a key.
  Uses `smtp.resend.com:465`, implicit TLS, username `resend`, and
  `Generative Arcana <noreply@DOMAIN>`. The domain must be a plain ASCII DNS domain already verified
  in Resend; URLs, email addresses, IP literals and whitespace are rejected. Any explicit SMTP
  variable (even blank) takes precedence and requires complete SMTP configuration. Malformed or
  partial configuration fails startup; providers and credentials are never silently mixed
- `BETTER_AUTH_JWKS_ROTATION_SECONDS` — default `2592000` (30 days)
- `BETTER_AUTH_JWKS_GRACE_SECONDS` — default `86400` (1 day); must cover the 300-second resource-token lifetime
- `MCP_OAUTH_RESOURCE` — exact origin + `/mcp`; derived from `BETTER_AUTH_URL` in self-hosted mode
- `MCP_OAUTH_ISSUER` — unnecessary for self-hosted mode; if supplied, must exactly match origin + `/api/auth`
- `MCP_OAUTH_JWKS_URI` — optional explicit upstream JWKS URI in provider-neutral resource-server-only mode; self-hosted mode uses its own signing keys
- `MCP_OAUTH_READ_SCOPES` / `MCP_OAUTH_WRITE_SCOPES` — upstream-only overrides; self-hosted mode fixes `decks:read` / `decks:write`
- `DATABASE_URL` — Neon PostgreSQL runtime connection required for account identity, catalog and shared rate limiting
- `ARCANA_WEB_DIST_DIR` — web build directory; the production container sets `/srv/app/dist`
- `ARCANA_BUILD_SHA` / `ARCANA_BUILD_ID` — optional non-secret deployment identifiers; otherwise use `VERCEL_GIT_COMMIT_SHA` / `VERCEL_DEPLOYMENT_ID`. Both health endpoints expose `build: { sha, shaSource, id, idSource }`; unknown/invalid values are `null`
- `MCP_STATE_DIR` — optional filesystem state root for alpha/development; durability depends on a persistent mounted volume
- `MCP_MAX_REQUEST_BYTES` — declared HTTP request-size cap, default `4000000`
- `MCP_RATE_LIMIT_PER_MINUTE` — per-client budget, default `120`; atomic shared database counter with `DATABASE_URL`, otherwise an in-process development limiter

Anonymous HTTP exposes public/read-oriented symbolic + visual tools. `MCP_ALPHA_TOKEN` remains a
private dogfooding adapter, incompatible with OAuth. The default real-account path uses self-hosted
Better Auth with Neon PostgreSQL; [configuration and explicit migrations](../docs/better-auth-deployment.md)
must precede login. Any partial Better Auth configuration fails rather than silently enabling
unverified or email-less accounts. [`mcp/.env.example`](.env.example) is non-secret reference only.

Better Auth provides verified-email signup, login, reset, first-party database-backed sessions,
OAuth consent, resource-bound five-minute JWTs and refresh tokens. `jwt()` + `mcp()` + `cimd()` are
composed once; MCP already owns the OAuth provider. CIMD uses the bundled SSRF-resistant Node
transport and pinned MCP profile. Dynamic registration is deliberately disabled. Current hosts
must pass real CIMD connection tests; another registration path needs explicit implementation
and verification before it can be described as supported.

Browser authentication and MCP tokens resolve the verified `(issuer, subject)` through the same
`NeonExternalIdentityRepository` to one opaque `usr_*` owner. Better Auth account linking is disabled;
email coincidence cannot merge libraries. The browser uses HttpOnly/SameSite, secure-on-HTTPS
cookies and receives no delegated MCP bearer token. Login/consent UI lives in the web app;
`/api/auth/*` serves the auth APIs and `/auth/*` supplies bounded same-origin account bridges.

Self-hosted token verification validates signature, token type, exact issuer/audience, lifetime,
client and scopes, then reads the active verified user, session and exact consent grant. Revoking
a connection invalidates its grant; signing out invalidates the current browser session and tokens
bound to it, including refresh issuance. Other login-session grants can remain. Password reset
revokes browser sessions. Refresh credentials have a configured 30-day maximum but cannot make an
expired/revoked browser session valid. Rotating the current application secret requires browser
re-login even when old encryption-key versions are retained. Record actual renewal/signout and
rotation behavior in acceptance evidence.

The provider-neutral upstream resource-server adapter remains available through `MCP_OAUTH_*`
without Better Auth. It validates external JWTs and maps the same issuer/subject boundary, but does
not provide a browser-login adapter on its own. Its local JWT verification has different revocation
semantics from the self-hosted DB-checked verifier. A hosted move is a deliberate
[identity-preserving migration](../docs/hosted-auth-migration.md), not an issuer-only env change.

OAuth protected-resource metadata is published at the path-specific well-known URL (for `/mcp`,
`/.well-known/oauth-protected-resource/mcp`) and root compatibility route. Public tools advertise
mixed anonymous/OAuth metadata. Protected tools stay discoverable but challenge until sufficient
`decks:read` / `decks:write` permissions are proved. A malformed/invalid supplied credential fails
closed rather than downgrading to anonymous.

`DATABASE_URL` stores catalog and stable identity state. `MCP_STATE_DIR` can retain alpha/development
custom manifests across process restarts only on a persistent volume; it is not an account catalog.
No auth or domain schema migration runs on server startup. Apply the reviewed operator migrations
first. [Maintenance, backup, rotation and costs](../docs/better-auth-operations.md) are ongoing work.

`/healthz` reports build/configuration and `/readyz` requires the web app, durable catalog, browser
and MCP auth, alpha disabled, and healthy bounded database/schema and exact-issuer discovery
probes. Self-hosted health reports `browserAuth: "better-auth"`. Configuration is separate in
`readiness.configurationReady`. Probes time out after 3 seconds and cache/coalesce for 15 seconds.
They do not prove durable writes, SMTP, user login, restore, or actual Claude/ChatGPT compatibility.

Tool-call diagnostics are JSON lines on stderr containing only tool name, success/failure, duration,
transport, and an opaque principal hash; tool arguments, questions, tokens, and custom deck payloads
are never logged by this layer.

## Protocol smoke tests

Supported paths are exercised with the official MCP v2 client:

```bash
npm --prefix mcp run smoke:stdio
npm --prefix mcp run smoke:http
npm --prefix mcp run smoke:http-auth
# or all three
npm --prefix mcp run smoke
```

The stdio and HTTP protocol smokes also verify that the visual tool surface can return real PNG `image` content blocks. The authenticated HTTP smoke launches the real server with a temporary durable state directory, connects anonymously and authenticated, imports a custom deck, kills/restarts the server, reconnects, and proves that the deck survives only in the authenticated principal's host. HTTP guardrail smoke separately proves versioned health metadata, 413 request rejection, and 429 + `Retry-After` rate limiting.

For the deterministic semantic baseline used before live dogfooding:

```bash
npm --prefix mcp run eval:golden
```

See `mcp/TESTING.md` for the private-alpha conversational test plan and bug-capture rules.

## Container

Build from the repository root so the image can include the shared engine, deck corpus, and server-renderable static visual assets:

```bash
docker build -f mcp/Dockerfile -t generative-arcana-mcp .
```

Anonymous run:

```bash
docker run --rm -p 3000:3000 \
  -e MCP_ALLOWED_HOSTS=localhost \
  generative-arcana-mcp
```

Private alpha with durable custom decks:

```bash
mkdir -p .arcana-state
docker run --rm -p 3000:3000 \
  -e MCP_ALLOWED_HOSTS=localhost \
  -e MCP_ALPHA_TOKEN='replace-with-a-long-random-secret' \
  -e MCP_STATE_DIR=/data/arcana \
  -v "$PWD/.arcana-state:/data" \
  generative-arcana-mcp
```

The image binds `0.0.0.0:3000` for container platforms but intentionally **fails to start** unless `MCP_ALLOWED_HOSTS` is supplied. Configure `MCP_ALLOWED_ORIGINS` separately when browser-origin requests are expected.

## Production web + MCP on Vercel

The project uses Vercel's **Container** runtime. The deployed service is the same Node HTTP process
exercised by local protocol tests, with a built React client served from the same origin.

- Repository-root `Dockerfile.vercel` builds the web app and starts the Node service
- `vercel.json` routes requests into that container
- `/mcp` serves Streamable HTTP; `/auth/*` serves the browser session flow
- `/api/me/decks` serves the authenticated library; `/api/decks/public` and `/api/decks/:id` serve
  the permission-checked catalog
- `/api/authoring/spec` and `/api/authoring/validate` expose stateless authoring validation
- `/healthz` reports liveness/runtime configuration; `/readyz` gates account configuration and
  read-only database/issuer probes

Use the repository root as the Vercel project root and **Framework Preset → Container**. Retain
Neon for domain storage and follow the [Better Auth deployment guide](../docs/better-auth-deployment.md)
for canonical origin, secret management, email, explicit schema review/apply, and host OAuth gates.

Remove `MCP_ALPHA_TOKEN` only after inventorying alpha-owned decks and planning verified ownership
preservation. OAuth and alpha cannot run together. Deploy the intended tested commit after changing
production variables. Vercel supplies `PORT`; the service derives its default Host allowlist from
platform hostname variables. Do not copy production secrets/database access into previews.

Domain tables (`arcana_external_identities`, identity-link audit, `arcana_user_decks`, legacy
`arcana_host_state`, and `arcana_rate_limits`) are installed with `db:migrate:domain`. Auth's
`arcana_auth_*` tables are generated by the installed Better Auth configuration using `db:auth:plan`
and explicitly applied with `db:auth:apply`. These commands are never part of normal startup.

A green `/healthz`, successful static build, or configured Neon variable is not durability or
account-journey evidence. Run the [launch checklist](../docs/production-launch-checklist.md),
including two real host products, two accounts, and separate instances, before inviting friends.

## Remote alpha on Fly.io

The repository includes `mcp/fly.toml.example` for a small private-alpha deployment. It uses the existing Dockerfile, HTTPS, auto-start/auto-stop Machines, a persistent volume, and `/healthz` service checks.

From the repository root:

```bash
cp mcp/fly.toml.example mcp/fly.toml
# edit mcp/fly.toml and replace every YOUR_APP_NAME
fly apps create YOUR_APP_NAME
fly volumes create arcana_state --region iad --size 1
fly secrets set MCP_ALPHA_TOKEN='replace-with-a-long-random-secret'
fly deploy . --config mcp/fly.toml
```

Endpoints:

```text
https://YOUR_APP_NAME.fly.dev/mcp
https://YOUR_APP_NAME.fly.dev/healthz
```

Anonymous MCP clients can use stateless symbolic, authoring-validation, and visual tools. Clients capable of sending the configured bearer credential receive the principal-scoped stateful surface as well. Do not treat the static bearer adapter as a public multi-user auth system; it exists for private dogfooding and restart-persistence testing. Real-account OAuth is implemented
separately and requires the production configuration above.

If a host sends an `Origin` header that is rejected, add that origin explicitly via `MCP_ALLOWED_ORIGINS` rather than weakening Host validation.

## Tools

Available anonymously over HTTP and over stdio:

- `list_decks`
- `get_deck`
- `get_card`
- `analyze_card`
- `query_cards`
- `list_spreads`
- `cast_reading`
- `resolve_reading`
- `interpretation_context`
- `get_deck_authoring_guide`
- `get_deck_authoring_spec`
- `validate_deck_manifest`
- `list_visual_packs`
- `get_card_art`
- `render_reading`

The visual tools are renderer-capability tools, not symbolic semantics. `Final Fantasy Tarot` currently ships the first complete server-renderable pack (`pixel`, 78 PNGs). `get_card_art` returns an MCP `image` content block for one card; `render_reading` resolves a reading token and returns its drawn cards as image blocks with position/orientation metadata. Browser-only kit/raw-p5 skins remain separate until a headless renderer is added.

`import_deck` is available over stdio and authenticated HTTP. In OAuth HTTP mode it is also
advertised before login, but a caller needs the configured read/write permissions to execute it.
Validate a canonical manifest before import; validation does not persist it. Replacement requires
an explicit `replaceExisting: true` and preserves the catalog ID and publication state.

When a catalog is configured, `list_public_decks` and `get_shared_deck` expose visible catalog reads.
`list_my_decks`, `set_deck_visibility`, and `delete_my_deck` operate on the authenticated owner's
library. They are discoverable before login in OAuth mode, returning an OAuth challenge when
needed; non-OAuth anonymous filtering intentionally omits protected tools.

Symbolic tools delegate to the same `ArcanaEngine` and `ArcanaToolAdapter`; auth and persistence select host state but do not redefine symbolic behavior. Visual tools consume the same stable deck/card identities through a host-owned visual asset store.

### Saved static card artwork

Opt-in private PNG/JPEG/WebP card artwork can be uploaded through `set_card_artwork` using exactly one host-native `file` (maximum 5,000,000 bytes) or actual `base64` bytes (maximum 1,000,000 decoded bytes), or through the signed-in website (maximum 3,000,000 bytes). The native path uses ChatGPT's file-parameter contract and restricted file-delivery hosts; actual generated-file availability and transfer still require host acceptance testing. Claude upload tickets currently carry manifest JSON only. `get_card_artwork` returns the verified image plus separate visual-pack metadata; existing card-art tools also resolve saved artwork. Ownership, deck scopes, current visibility and optimistic version checks apply. SVG rasterization and untrusted program execution are not implemented.

See [configuration, lifecycle, isolated-preview activation and limits](../docs/card-artwork.md). The feature is disabled without explicit server-only configuration; it never provisions a bucket, credentials or database schema at startup.
