# Generative Arcana MCP

Headless MCP transports for the Generative Arcana engine. The MCP layer owns no symbolic semantics: it loads the shipped corpus into an isolated `DeckRegistry`, creates an `ArcanaEngine`, and delegates symbolic tool calls through `ArcanaToolAdapter`. Renderer capabilities remain host-owned beside the engine; static image-backed packs can be returned as real MCP image content without importing browser-only p5/kit renderers.

## Run over stdio

```bash
cd mcp
npm install
npm run dev
```

## Run over HTTP

```bash
cd mcp
npm install
npm run http
```

Environment:

- `PORT` — listen port, default `3000`
- `HOST` — bind host, default `127.0.0.1`
- `MCP_ALLOWED_HOSTS` — comma-separated Host-header allowlist; required when binding publicly unless the runtime provides a recognized Vercel deployment hostname
- `MCP_ALLOWED_ORIGINS` — comma-separated Origin allowlist; defaults to the host allowlist
- `MCP_MAX_REQUEST_BYTES` — maximum HTTP request body size, default `4000000`
- `MCP_RATE_LIMIT_PER_MINUTE` — fixed-window per-source request limit, default `120`
- `MCP_STATE_DIR` — optional directory for authenticated per-principal persisted host state
- `DATABASE_URL` — optional Neon/Postgres connection string; when set, authenticated state uses the Neon-backed repository instead of filesystem/memory
- `MCP_ALPHA_TOKEN` — optional private-alpha bearer token; when absent HTTP remains anonymous/stateless
- `MCP_ALPHA_PRINCIPAL_ID` — stable opaque scope id for the alpha token, default `alpha-user-v1`
- `MCP_OAUTH_ISSUER` — upstream OAuth/OIDC issuer URL for real accounts
- `MCP_OAUTH_RESOURCE` — canonical MCP resource/audience URL, e.g. `https://arcana.example/mcp`
- `MCP_OAUTH_JWKS_URI` — optional explicit JWKS URL; otherwise discovered from the issuer
- `MCP_OAUTH_READ_SCOPES` — comma-separated personal-deck read scopes, default `decks:read`
- `MCP_OAUTH_WRITE_SCOPES` — comma-separated deck mutation scopes, default `decks:write`
- `WORKOS_API_KEY` — optional AuthKit server API key for the browser account session adapter
- `WORKOS_CLIENT_ID` — AuthKit application client id for browser sign-in
- `WORKOS_COOKIE_PASSWORD` — at least 32 characters; encrypts the app-owned sealed browser session cookie
- `WORKOS_REDIRECT_URI` — configured AuthKit callback URL, e.g. `https://arcana.example/auth/callback`
- `WORKOS_IDENTITY_ISSUER` — optional explicit browser identity issuer; defaults to `MCP_OAUTH_ISSUER` and must match it when both are set
- `ARCANA_SESSION_COOKIE` — optional browser session cookie name, default `arcana-session`
- `ARCANA_STATIC_VISUAL_BASE_URL` — optional HTTPS/loopback URL used to expose repository-backed visual assets to remote MCP hosts (for example `https://raw.githubusercontent.com/<owner>/<repo>/<commit>/`)
- `ARCANA_STATIC_VISUAL_ROOT` — optional local repository/content root override used when returning image bytes; defaults to the repository root inferred from the MCP module location

The endpoint is `POST /mcp` and uses MCP Streamable HTTP. Each HTTP request gets a fresh protocol server; anonymous requests use a fresh stateless Arcana adapter, while authenticated requests resolve through the configured principal store and may reuse a principal-scoped host.

Anonymous HTTP exposes the public/read-oriented symbolic + visual tools. `MCP_ALPHA_TOKEN` remains available for private dogfooding. For real accounts, configure `MCP_OAUTH_ISSUER` + `MCP_OAUTH_RESOURCE` with `DATABASE_URL`: Generative Arcana acts only as an OAuth resource server, validates OIDC JWT access tokens, and maps the token's `(issuer, subject)` pair onto a stable opaque `usr_*` principal stored in Neon. A supplied malformed/invalid credential fails closed instead of silently downgrading to anonymous.

OAuth mode publishes RFC 9728 Protected Resource Metadata at the path-specific well-known URL (for `/mcp`, `/.well-known/oauth-protected-resource/mcp`) and at the root compatibility URL. Public tools advertise mixed anonymous/OAuth metadata; `import_deck` remains discoverable before login but returns the MCP `mcp/www_authenticate` challenge until the caller has both `decks:read` and `decks:write`.

For client interoperability, the HTTP server also exposes a legacy RFC 8414 `/.well-known/oauth-authorization-server` compatibility route that fetches the configured issuer's authorization metadata, verifies that the returned `issuer` exactly matches `MCP_OAUTH_ISSUER`, and then relays it. The metadata fetch is bounded to five seconds, limited in size, and follows only safe HTTPS/loopback redirects. This lets clients that have not yet adopted RFC 9728 discover the same upstream authorization server without turning Generative Arcana into an authorization server or an open proxy.

The static bearer resolver is deliberately an **alpha/testing adapter**. Production OAuth stays provider-neutral: an upstream authorization server owns login/consent/token issuance, `OidcJwtBearerIdentityVerifier` validates issuer + audience + signature, and `NeonExternalIdentityRepository` supplies the stable internal principal. The chosen identity provider is therefore deployment configuration rather than an Arcana domain dependency.

Browser sign-in is a separate first-party session boundary. When the `WORKOS_*` browser settings are present, `/auth/login` and `/auth/callback` use AuthKit Hosted UI, the resulting access+refresh tokens stay encrypted inside an HttpOnly/SameSite `arcana-session` cookie, `/auth/session` refreshes that sealed session server-side when necessary, and `/auth/logout` terminates the upstream session. The browser adapter proves an external `(issuer, subject)` pair and feeds it through the **same** `NeonExternalIdentityRepository` used by MCP bearer tokens, so web, ChatGPT, Claude, and future hosts converge on one opaque `usr_*` owner without making WorkOS part of the deck/domain model.

The browser app never needs the MCP bearer token. This keeps MCP resource-indicator/audience semantics independent from the ordinary web session while preserving account identity across both transports.

The current recommended first provider is **WorkOS AuthKit** because its MCP support covers the pieces Generative Arcana needs now: OAuth 2.1/PKCE, resource indicators, current MCP Client ID Metadata Documents, Dynamic Client Registration fallback, hosted login, and first-party account UX. This is a deployment adapter choice, not a domain dependency. Configure the AuthKit MCP resource indicator to exactly match `MCP_OAUTH_RESOURCE`; enable CIMD and keep DCR enabled for older clients while ChatGPT/Claude interoperability is being verified. Other standards-compliant OAuth/OIDC providers can replace AuthKit later without changing `ArcanaEngine`, deck manifests, or ownership records.

## What it exposes

- `list_decks` — current runtime decks (bundled plus the authenticated principal's owned/imported decks)
- `get_deck` — validated deck data plus metadata
- `get_card` — authored card data
- `analyze_card` — factorized symbolic-axis projection for one card
- `query_cards` — exact intersections over authored axes and numeric structure
- `list_spreads` — generic + native spread definitions
- `cast_reading` — fresh reading + compact reproducible token
- `resolve_reading` — decode v2 and legacy v1 reading tokens; new readings use the deck's stable runtime/resource id while legacy slug tokens remain compatible when unambiguous
- `interpretation_context` — LLM-ready authored context for a reading
- `import_deck` — validate/import custom deck JSON into the authenticated principal's catalog-backed runtime; new imports are private and receive an opaque stable resource id independent from the authored manifest slug
- `list_public_decks` — discover published public user decks without installing them
- `get_shared_deck` — resolve a public/unlisted deck by stable resource id, or an owned private deck when authenticated
- `list_my_decks` — list the authenticated principal's owned catalog resources and visibility state
- `set_deck_visibility` — owner-only `private | unlisted | public` publication control
- `delete_my_deck` — owner-only permanent deck deletion
- `render_card` — visual card content when a host-readable visual source is available
- `render_reading` — visual spread content for a resolved reading when every placed card can be rendered

Shared deck ids also flow through the ordinary read-oriented symbolic and visual tools: visible public/unlisted catalog resources resolve read-through into isolated scratch engines without being copied into the caller's account or mutating the caller's owned runtime. They therefore do not appear in `list_decks`, but `get_deck`, card/query/spread operations, reading resolution, and visual rendering can operate on them directly by stable resource id. Private records stay owner-only and unauthorized callers receive the same unknown-resource behavior as missing ids.

Visual tools return MCP image content (`type: "image"`) rather than browser HTML. The current resolver supports static image-backed packs in `app/src/decks/<deck>/...` and deliberately treats browser-only p5 sketches as unavailable in headless MCP. `ARCANA_STATIC_VISUAL_BASE_URL` is optional presentation glue for remote host URLs; symbolic tools work without it. A future renderer can be added behind the host-side visual resolver without changing the engine, registry, or symbolic tool contract.

## Smoke test

```bash
npm run smoke
npm run test:host-store
npm run test:durable-state
npm run test:deck-catalog
npm run test:principal
npm run test:alpha-auth
npm run test:oauth-identity
npm run test:hardening
npm run test:visuals
npm run eval:golden
```

`smoke:http` starts the real Node listener on a random local port, initializes the official Streamable HTTP client transport, and asserts anonymous public tool behavior. `smoke:http-auth` additionally starts the server with a temporary `MCP_STATE_DIR`, proves unauthenticated imports are absent, imports a deck with the configured bearer token, restarts the whole process, and confirms that the same principal sees the persisted deck while anonymous callers still do not. The in-process persistence tests additionally verify immutable snapshotting on save/restore boundaries, and the hardening test covers host/origin rejection plus the configured request limit/rate limiter.

See `mcp/TESTING.md` for the private-alpha conversational test plan and bug-capture rules.

## MCP client config

Local stdio:

```json
{
  "mcpServers": {
    "generative-arcana": {
      "command": "node",
      "args": ["--import", "tsx", "/absolute/path/to/generative-arcana/mcp/src/stdio.ts"]
    }
  }
}
```

Remote Streamable HTTP:

```json
{
  "mcpServers": {
    "generative-arcana": {
      "url": "https://your-arcana-host.example/mcp"
    }
  }
}
```

Private alpha with durable custom decks:

```bash
export MCP_ALPHA_TOKEN='replace-with-a-long-random-secret'
export MCP_ALPHA_PRINCIPAL_ID='alpha-user-v1'
export MCP_STATE_DIR='/var/lib/generative-arcana'
npm run http
```

Then point the client at `https://your-host.example/mcp` and configure it to send `Authorization: Bearer <MCP_ALPHA_TOKEN>`.

## Container

```bash
docker build -f mcp/Dockerfile -t generative-arcana-mcp .
docker run --rm -p 3000:3000 \
  -e MCP_ALLOWED_HOSTS=localhost:3000 \
  -e MCP_ALLOWED_ORIGINS=http://localhost:3000 \
  -e MCP_ALPHA_TOKEN=replace-me \
  -e MCP_STATE_DIR=/data \
  -v "$PWD/.arcana-mcp:/data" \
  generative-arcana-mcp
```

The image binds `0.0.0.0:3000` for container platforms but intentionally **fails to start** unless `MCP_ALLOWED_HOSTS` is supplied. Configure `MCP_ALLOWED_ORIGINS` separately when browser-origin requests are expected.

## Remote alpha on Vercel

Vercel is the preferred private-alpha target. The project uses Vercel's **Container** runtime rather than per-file Functions, so the deployed server is the same Node HTTP process exercised by the local/container protocol tests.

1. Import this repository into Vercel and keep the project root at the repository root.
2. The checked-in root `vercel.json` points Vercel at `Dockerfile.vercel`; no framework preset is required.
3. Set `MCP_ALLOWED_HOSTS` to the exact deployment hostnames that should reach `/mcp`, for example:

```text
my-project.vercel.app,my-project-git-main-my-team.vercel.app
```

Vercel also provides `VERCEL_URL` / `VERCEL_PROJECT_PRODUCTION_URL` / `VERCEL_BRANCH_URL`; when explicit hosts are absent the server derives an allowlist from those recognized runtime values. Explicit configuration is still preferable for the stable production endpoint.

4. For private-alpha stateful access, add:

```text
DATABASE_URL=postgresql://...
MCP_ALPHA_TOKEN=<long-random-secret>
MCP_ALPHA_PRINCIPAL_ID=alpha-user-v1   # optional
```

The Vercel container does not persist a writable filesystem across instances, so `MCP_STATE_DIR` is not a production persistence mechanism there. When `DATABASE_URL` is present, authenticated host state is loaded/saved from Neon-compatible Postgres instead. The repository creates its `arcana_host_state` table lazily on first use; no separate migration command is required for this alpha.

5. Deploy. Verify:

```bash
curl https://YOUR-DEPLOYMENT/healthz
```

The health payload reports `runtime: "vercel-container"`, `auth`, and `state`. A private-alpha deployment should report bearer auth plus `state: "neon"`.

6. For OAuth production accounts, replace the private-alpha token with:

```text
DATABASE_URL=postgresql://...
MCP_OAUTH_ISSUER=https://your-auth-domain.example/
MCP_OAUTH_RESOURCE=https://your-deployment.example/mcp
MCP_OAUTH_READ_SCOPES=decks:read
MCP_OAUTH_WRITE_SCOPES=decks:write
# MCP_OAUTH_JWKS_URI=https://...   # optional; issuer discovery is the default
```

The stored JSON remains the same versioned `ArcanaHostState` envelope used by the filesystem repository; bundled decks and runtime/session objects are never persisted. Real account mode uses the same Neon deployment for the `arcana_external_identities` mapping table. The upstream OAuth/OIDC provider remains replaceable; it must support the MCP client authorization flow (OAuth 2.1 + PKCE/resource indicators and an interoperable client-registration approach).

## Remote alpha on Fly.io

The repository includes `mcp/fly.toml.example` for a small private-alpha deployment. It uses the existing Dockerfile, HTTPS, auto-start/auto-stop Machines, a persistent volume, and `/healthz` service checks.

1. Copy the example and replace the app name:

   ```bash
   cp mcp/fly.toml.example fly.toml
   ```

2. Create the app and volume:

   ```bash
   fly apps create your-arcana-app
   fly volumes create arcana_data --region iad --size 1
   ```

3. Set the bearer token as a Fly secret:

   ```bash
   fly secrets set MCP_ALPHA_TOKEN='replace-with-a-long-random-secret'
   ```

4. Deploy from the repository root:

   ```bash
   fly deploy -c fly.toml
   ```

5. Verify `/healthz`, then point the MCP client at `https://your-arcana-app.fly.dev/mcp` with the bearer token.

## Client examples

### Claude Desktop

Claude Desktop can launch the stdio server directly during local development. Add an entry like this to the Claude Desktop MCP config (use your actual repo path):

```json
{
  "mcpServers": {
    "generative-arcana": {
      "command": "node",
      "args": [
        "--import",
        "tsx",
        "/Users/you/src/generative-arcana/mcp/src/stdio.ts"
      ]
    }
  }
}
```

### Generic remote client

For a client that supports Streamable HTTP, point it at:

```text
https://your-arcana-host.example/mcp
```

Anonymous clients receive the public stateless tool surface. During private alpha, authenticated clients also send the configured bearer token. In production OAuth mode the client should follow the protected-resource metadata/challenge to the configured authorization server instead of embedding a static secret.
