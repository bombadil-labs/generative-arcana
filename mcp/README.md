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

The HTTP entry is stateless at the MCP-server layer. It shares the immutable bundled Arcana corpus across requests but intentionally omits `import_deck`, because a custom import cannot honestly persist to the next request without a caller/session persistence model.

## Container

Build from the repository root so the image can include the shared engine and deck corpus:

```bash
docker build -f mcp/Dockerfile -t generative-arcana-mcp .
```

Run with an explicit public host allowlist:

```bash
docker run --rm -p 3000:3000 \
  -e MCP_ALLOWED_HOSTS=localhost \
  generative-arcana-mcp
```

The image binds `0.0.0.0:3000` for container platforms but intentionally **fails to start** unless `MCP_ALLOWED_HOSTS` is supplied. Configure `MCP_ALLOWED_ORIGINS` separately when browser-origin requests are expected.

The HTTP transport is intentionally unauthenticated at this stage. A public deployment should add authentication in front of `/mcp`; do not expose it merely by setting a permissive host allowlist.

## Tools

Available over both transports:

- `list_decks`
- `get_deck`
- `get_card`
- `analyze_card`
- `query_cards`
- `list_spreads`
- `cast_reading`
- `resolve_reading`
- `interpretation_context`

Additionally available over persistent stdio:

- `import_deck`

Both transports wrap the same `createArcanaMcpServer()` factory and therefore cannot drift into separate symbolic semantics.
