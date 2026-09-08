# Generative Arcana MCP

Headless MCP transport for the Generative Arcana engine. The MCP layer owns no symbolic semantics: it loads the shipped corpus into an isolated `DeckRegistry`, creates an `ArcanaEngine`, and delegates every tool call through `ArcanaToolAdapter`.

## Local stdio

```bash
cd mcp
npm install
npm start
```

Use the command `npm --prefix /path/to/generative-arcana/mcp start` (or an equivalent `npx tsx .../mcp/src/stdio.ts`) as a local MCP server command in a host that supports stdio servers.

Initial tools:

- `list_decks`
- `get_deck`
- `get_card`
- `analyze_card`
- `query_cards`
- `list_spreads`
- `cast_reading`
- `resolve_reading`
- `interpretation_context`
- `import_deck`

A remote Streamable HTTP transport should wrap the same `createArcanaMcpServer()` factory; it should not define a second tool surface.
