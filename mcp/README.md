# Generative Arcana MCP

Headless MCP transports for the Generative Arcana engine. The MCP layer owns no symbolic semantics: it loads the shipped corpus into an isolated `DeckRegistry`, creates an `ArcanaEngine`, and delegates every tool call through `ArcanaToolAdapter`.

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
- `MCP_STATE_DIR` — optional durable filesystem root for authenticated custom deck state
- `MCP_MAX_REQUEST_BYTES` — declared HTTP request-size cap, default `4000000`
- `MCP_RATE_LIMIT_PER_MINUTE` — in-process per-remote-address request budget, default `120`

Anonymous HTTP exposes only the nine stateless/read-oriented tools. When `MCP_ALPHA_TOKEN` is configured, requests with `Authorization: Bearer <token>` resolve to one isolated principal host and expose `import_deck`. A supplied invalid credential fails closed with HTTP 401 rather than downgrading to anonymous.

If `MCP_STATE_DIR` is also configured, authenticated custom deck manifests are restored across process restarts. The persisted format contains only versioned custom deck manifests; bundled decks and engine/session objects are reconstructed from code on every process start. Files are written atomically and principal ids are hashed before filesystem use.

The static bearer resolver is deliberately an **alpha/testing adapter**, not the final account system. The provider-neutral `PrincipalResolver` and `ArcanaHostStateRepository` boundaries are intended to accept OAuth and database adapters later without changing Arcana semantics.

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

The authenticated HTTP smoke launches the real server with a temporary durable state directory, connects anonymously and authenticated, imports a custom deck, kills/restarts the server, reconnects, and proves that the deck survives only in the authenticated principal's host. HTTP guardrail smoke separately proves versioned health metadata, 413 request rejection, and 429 + `Retry-After` rate limiting.

For the deterministic semantic baseline used before live dogfooding:

```bash
npm --prefix mcp run eval:golden
```

See `mcp/TESTING.md` for the private-alpha conversational test plan and bug-capture rules.

## Container

Build from the repository root so the image can include the shared engine and deck corpus:

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

Anonymous MCP clients can use the nine stateless tools. Clients capable of sending the configured bearer credential receive the principal-scoped stateful surface as well. Do not treat the static bearer adapter as a public multi-user auth system; it exists to make private dogfooding and restart-persistence testing honest before OAuth lands.

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

Additionally available over stdio and authenticated HTTP:

- `import_deck`

All transports delegate to the same `ArcanaEngine` and `ArcanaToolAdapter`; auth and persistence select host state but do not redefine symbolic behavior.
