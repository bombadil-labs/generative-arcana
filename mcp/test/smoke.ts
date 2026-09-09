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
  "list_visual_packs",
  "get_card_art",
  "render_reading",
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
  const client = new Client({ name: "generative-arcana-smoke", version: "0.2.0" });
  const transport = new StdioClientTransport({
    command: process.execPath,
    args: ["--import", "tsx", "src/stdio.ts"],
  });

  try {
    await withTimeout(client.connect(transport), 10_000, "stdio MCP connect");

    const listed = await withTimeout(client.listTools(), 5_000, "stdio tools/list");
    const names = new Set(listed.tools.map((tool) => tool.name));
    for (const name of REQUIRED_TOOLS) assert.ok(names.has(name), `missing MCP tool: ${name}`);

    const result = await withTimeout(client.callTool({ name: "list_decks", arguments: {} }), 5_000, "stdio list_decks");
    assert.equal(result.isError, undefined);
    const text = result.content.find((part) => part.type === "text");
    assert.ok(text && text.type === "text", "list_decks returned no text content");

    const decks = JSON.parse(text.text) as Array<{ id: string }>;
    assert.equal(decks.length, BUNDLED_DECK_IDS.length);
    assert.deepEqual(new Set(decks.map((deck) => deck.id)), new Set(BUNDLED_DECK_IDS));

    const packs = await withTimeout(client.callTool({
      name: "list_visual_packs",
      arguments: { deckId: "final-fantasy-tarot" },
    }), 5_000, "stdio list_visual_packs");
    assert.equal(packs.isError, undefined);
    const packsText = packs.content.find((part) => part.type === "text");
    assert.ok(packsText && packsText.type === "text", "list_visual_packs returned no text content");
    const parsedPacks = JSON.parse(packsText.text) as Array<{ id: string; renderer: string; complete: boolean }>;
    assert.deepEqual(parsedPacks.map((pack) => pack.id), ["pixel"]);
    assert.equal(parsedPacks[0]?.renderer, "static-image");
    assert.equal(parsedPacks[0]?.complete, true);

    const cardArt = await withTimeout(client.callTool({
      name: "get_card_art",
      arguments: { deckId: "final-fantasy-tarot", cardSlug: "major-0" },
    }), 5_000, "stdio get_card_art");
    assert.equal(cardArt.isError, undefined);
    const cardImage = cardArt.content.find((part) => part.type === "image");
    assert.ok(cardImage && cardImage.type === "image", "get_card_art returned no image content");
    assert.equal(cardImage.mimeType, "image/png");
    assert.ok(cardImage.data.startsWith("iVBORw0KGgo"), "get_card_art image is not PNG data");

    const cast = await withTimeout(client.callTool({
      name: "cast_reading",
      arguments: { deckId: "final-fantasy-tarot", spread: "three-card", question: "Visual protocol smoke test" },
    }), 5_000, "stdio cast_reading for render");
    assert.equal(cast.isError, undefined);
    const castText = cast.content.find((part) => part.type === "text");
    assert.ok(castText && castText.type === "text", "cast_reading returned no text content");
    const reading = JSON.parse(castText.text) as { token: string };

    const rendered = await withTimeout(client.callTool({
      name: "render_reading",
      arguments: { token: reading.token },
    }), 5_000, "stdio render_reading");
    assert.equal(rendered.isError, undefined);
    const renderedImages = rendered.content.filter((part) => part.type === "image");
    assert.equal(renderedImages.length, 3, "three-card render should return three images");
    for (const image of renderedImages) {
      assert.equal(image.type, "image");
      assert.equal(image.mimeType, "image/png");
      assert.ok(image.data.startsWith("iVBORw0KGgo"), "rendered reading image is not PNG data");
    }
  } finally {
    await withTimeout(client.close(), 3_000, "stdio client close").catch(() => undefined);
  }
}

function withTimeout<T>(promise: Promise<T>, ms: number, label: string): Promise<T> {
  return Promise.race([
    promise,
    new Promise<T>((_, reject) => setTimeout(() => reject(new Error(`${label} timed out after ${ms}ms`)), ms)),
  ]);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
