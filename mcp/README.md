# Generative Arcana MCP

Headless MCP transports for the Generative Arcana engine. The MCP layer owns no symbolic semantics: it loads the shipped corpus into an isolated `DeckRegistry`, creates an `ArcanaEngine`, and delegates symbolic tool calls through `ArcanaToolAdapter`. Renderer capabilities remain host-owned beside the engine; static image-backed packs can be returned as real MCP image content without importing browser-only p5/kit renderers.

## Local stdio

```bash
cd mcp
npm install
npm start
```

Use `npm --prefix /path/to/generative-arcana/mcp start` as a local MCP server command in a host that supports stdio servers.

A stdio connection owns one persistent Arcana host, so `import_deck` is available there and imported custom decks remain available to later tool calls on that connection.

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
- `MCP_ALPHA_TOKEN` — optional private-alpha bearer token; when absent HTTP remains anonymous/stateless
- `MCP_ALPHA_PRINCIPAL_ID` — stable opaque scope id for the alpha token, default `alpha-user-v1`
- `MCP_OAUTH_ISSUER` — upstream OAuth/OIDC issuer URL for real accounts
- `MCP_OAUTH_RESOURCE` — canonical MCP resource/audience URL, e.g. `https://arcana.example/mcp`
- `MCP_OAUTH_JWKS_URI` — optional explicit JWKS URL; otherwise discovered from the issuer
- `MCP_OAUTH_READ_SCOPES` — comma-separated personal-deck read scopes, default `decks:read`
- `MCP_OAUTH_WRITE_SCOPES` — comma-separated deck mutation scopes, default `decks:write`
- `WORKOS_API_KEY` — optional AuthKit server API key for first-party browser sessions
- `WORKOS_CLIENT_ID` — AuthKit application client id for browser sign-in
- `WORKOS_COOKIE_PASSWORD` — at least 32 characters; seals the app-owned browser session cookie
- `WORKOS_REDIRECT_URI` — configured AuthKit callback URL, e.g. `https://arcana.example/auth/callback`
- `WORKOS_IDENTITY_ISSUER` — optional explicit browser identity issuer; defaults to `MCP_OAUTH_ISSUER` and must match it when both are set
- `ARCANA_SESSION_COOKIE` — optional browser session cookie name, default `arcana-session`
- `MCP_STATE_DIR` — optional durable filesystem root for authenticated custom deck state
- `MCP_MAX_REQUEST_BYTES` — declared HTTP request-size cap, default `4000000`
- `MCP_RATE_LIMIT_PER_MINUTE` — in-process per-remote-address request budget, default `120`

Anonymous HTTP exposes the public/read-oriented symbolic + visual tools. `MCP_ALPHA_TOKEN` remains available for private dogfooding. For real accounts, configure `MCP_OAUTH_ISSUER` + `MCP_OAUTH_RESOURCE` with `DATABASE_URL`: Generative Arcana acts only as an OAuth resource server, validates OIDC JWT access tokens, and maps the token's `(issuer, subject)` pair onto a stable opaque `usr_*` principal stored in Neon. A supplied malformed/invalid credential fails closed instead of silently downgrading to anonymous.

OAuth mode publishes RFC 9728 Protected Resource Metadata at the path-specific well-known URL (for `/mcp`, `/.well-known/oauth-protected-resource/mcp`) and at the root compatibility URL. Public tools advertise mixed anonymous/OAuth metadata; `import_deck` remains discoverable before login but returns the MCP `mcp/www_authenticate` challenge until the caller has both `decks:read` and `decks:write`.

If `MCP_STATE_DIR` is also configured, authenticated custom deck manifests are restored across process restarts. The persisted format contains only versioned custom deck manifests; bundled decks and engine/session objects are reconstructed from code on every process start. Files are written atomically and principal ids are hashed before filesystem use.

The static bearer resolver is deliberately an **alpha/testing adapter**. Production OAuth stays provider-neutral: an upstream authorization server owns login/consent/token issuance, `OidcJwtBearerIdentityVerifier` validates issuer + audience + signature, and `NeonExternalIdentityRepository` supplies the stable internal principal. The chosen identity provider is therefore deployment configuration rather than an Arcana domain dependency.

Browser sign-in is a separate first-party session boundary. When the `WORKOS_*` settings are present, `/auth/login` and `/auth/callback` use AuthKit Hosted UI, the resulting session is kept in an HttpOnly/SameSite sealed cookie, `/auth/session` validates and refreshes it server-side, and POST `/auth/logout` ends the upstream session. The browser adapter proves an external `(issuer, subject)` identity and sends it through the **same** `NeonExternalIdentityRepository` used by MCP bearer tokens, so both transports converge on one opaque `usr_*` owner.

The browser never receives or stores the MCP resource bearer token. AuthKit is therefore deployment glue for the web session, not an `ArcanaEngine`, manifest, or ownership dependency; MCP audience/resource-indicator semantics remain independent.

`/healthz` reports the MCP version plus the active auth/state/limit modes so bug reports can identify the deployed contract. Tool-call diagnostics are JSON lines on stderr containing only tool name, success/failure, duration, transport, and an opaque principal hash; tool arguments, questions, tokens, and custom deck payloads are never logged by this layer.

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

## Remote alpha on Vercel

Vercel is the preferred private-alpha target. The project uses Vercel's **Container** runtime rather than per-file Functions, so the deployed server is the same Node HTTP process exercised by the local/container protocol tests.

The repository root contains:

- `Dockerfile.vercel` — the production container entrypoint
- `vercel.json` — an explicit catch-all rewrite into the container service
- `/mcp` — Streamable HTTP MCP endpoint served by `mcp/src/http.ts`
- `/healthz` — versioned runtime/auth/state metadata
- Neon-backed `ArcanaHostStateRepository` whenever `DATABASE_URL` is present

The container does **not** rely on ephemeral process memory for authenticated state when Neon is configured. Each authenticated principal host restores its versioned custom-deck state from Neon, while anonymous requests receive a fresh bundled symbolic host.

### Vercel setup

1. Import `bombadil-labs/generative-arcana` with the repository root as the project root.
2. Set **Framework Preset → Container**. Leave Build Command, Output Directory, and Install Command on their automatic/default values.
3. Add the Neon integration from the Vercel Marketplace. Vercel/Neon will provide `DATABASE_URL` (and can create isolated preview branches for preview deployments).
4. For private-alpha stateful access, add:

```text
MCP_ALPHA_TOKEN=<long random secret>
MCP_ALPHA_PRINCIPAL_ID=alpha-user-v1   # optional
```

For browser account sessions, also configure the AuthKit adapter (alongside `DATABASE_URL`):

```text
WORKOS_API_KEY=<server API key>
WORKOS_CLIENT_ID=<AuthKit client id>
WORKOS_COOKIE_PASSWORD=<32+ character secret>
WORKOS_REDIRECT_URI=https://YOUR_PROJECT.vercel.app/auth/callback
# WORKOS_IDENTITY_ISSUER=https://...   # optional when MCP_OAUTH_ISSUER is configured
```

5. Deploy. Vercel supplies the serving `PORT`; `mcp/src/http.ts` derives the deployment Host allowlist from Vercel's hostname environment variables.

The resulting endpoints are:

```text
https://YOUR_PROJECT.vercel.app/mcp
https://YOUR_PROJECT.vercel.app/healthz
```

`/healthz` reports `runtime: "vercel-container"` plus active auth/state/limit modes. With `DATABASE_URL`, state mode is `neon`. A valid `Authorization: Bearer <MCP_ALPHA_TOKEN>` request receives the principal-scoped surface including `import_deck`; invalid credentials fail closed with 401.

The Neon adapter lazily creates one table:

```sql
arcana_host_state(scope_id text primary key, state jsonb, updated_at timestamptz)
```

The stored JSON remains the same versioned `ArcanaHostState` envelope used by the filesystem repository; bundled decks and runtime/session objects are never persisted. Real account mode uses the same Neon deployment for the `arcana_external_identities` mapping table. The upstream OAuth/OIDC provider remains replaceable; it must support the MCP client authorization flow (OAuth 2.1 + PKCE/resource indicators and an interoperable client-registration approach).

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

Anonymous MCP clients can use the twelve stateless symbolic + visual tools. Clients capable of sending the configured bearer credential receive the principal-scoped stateful surface as well. Do not treat the static bearer adapter as a public multi-user auth system; it exists to make private dogfooding and restart-persistence testing honest before OAuth lands.

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
- `list_visual_packs`
- `get_card_art`
- `render_reading`

The visual tools are renderer-capability tools, not symbolic semantics. `Final Fantasy Tarot` currently ships the first complete server-renderable pack (`pixel`, 78 PNGs). `get_card_art` returns an MCP `image` content block for one card; `render_reading` resolves a reading token and returns its drawn cards as image blocks with position/orientation metadata. Browser-only kit/raw-p5 skins remain separate until a headless renderer is added.

Additionally available over stdio and authenticated HTTP:

- `import_deck`

Symbolic tools delegate to the same `ArcanaEngine` and `ArcanaToolAdapter`; auth and persistence select host state but do not redefine symbolic behavior. Visual tools consume the same stable deck/card identities through a host-owned visual asset store.
