import assert from "node:assert/strict";
import { Client } from "@modelcontextprotocol/client";
import { StdioClientTransport } from "@modelcontextprotocol/client/stdio";

const REQUIRED_TOOLS = [
  "list_decks",
  "get_deck",
  "get_card",
  "analyze_card",
  "query_cards",
  "list_spreads",
  "cast_reading",
  "resolve_reading",
  "interpretation_context",
  "import_deck",
];

const BUNDLED_DECK_IDS = [
  "byrne-journey-tarot",
  "deep-time",
  "evolution-and-consciousness",
  "final-fantasy-tarot",
  "ultima-octave",
  "ultima-tarot",
  "ulysses-tarot",
];

async function main(): Promise<void> {
  const client = new Client({ name: "generative-arcana-smoke", version: "0.1.0" });
  const transport = new StdioClientTransport({ command: "npx", args: ["tsx", "src/stdio.ts"] });

  try {
    await client.connect(transport);

    const listed = await client.listTools();
    const names = new Set(listed.tools.map((tool) => tool.name));
    for (const name of REQUIRED_TOOLS) assert.ok(names.has(name), `missing MCP tool: ${name}`);

    const result = await client.callTool({ name: "list_decks", arguments: {} });
    assert.equal(result.isError, undefined);
    const text = result.content.find((part) => part.type === "text");
    assert.ok(text && text.type === "text", "list_decks returned no text content");

    const decks = JSON.parse(text.text) as Array<{ id: string }>;
    assert.equal(decks.length, BUNDLED_DECK_IDS.length);
    assert.deepEqual(new Set(decks.map((deck) => deck.id)), new Set(BUNDLED_DECK_IDS));
  } finally {
    await client.close();
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
