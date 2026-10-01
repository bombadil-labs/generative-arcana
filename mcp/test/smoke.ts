import assert from "node:assert/strict";
import { Client, InMemoryTransport } from "@modelcontextprotocol/client";
import { StdioClientTransport } from "@modelcontextprotocol/client/stdio";
import type { RenderableCard } from "../../app/src/decks/renderSpec";
import { createArcanaMcpServer } from "../src/server";
import { assertFormerDecksUnavailable, neutralManifest, neutralVisualStore, TEST_DECK_ID, textContent, toolResult } from "./protocol-fixtures";

const SPREAD_WIDGET_URI = "ui://arcana/spread/v2.html";

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
    const renderTool = listed.tools.find((tool) => tool.name === "render_reading");
    const renderMeta = renderTool?._meta as { ui?: { resourceUri?: string } } | undefined;
    assert.equal(renderMeta?.ui?.resourceUri, SPREAD_WIDGET_URI, "render_reading must advertise the spread UI resource");

    const resources = await withTimeout(client.listResources(), 5_000, "stdio resources/list");
    assert.ok(resources.resources.some((resource) => resource.uri === SPREAD_WIDGET_URI), "spread UI resource is not discoverable");
    const widget = await withTimeout(client.readResource({ uri: SPREAD_WIDGET_URI }), 5_000, "stdio resources/read spread widget");
    const widgetContent = widget.contents.find((content) => content.uri === SPREAD_WIDGET_URI);
    assert.ok(widgetContent && "text" in widgetContent, "spread UI resource returned no HTML text");
    assert.equal(widgetContent.mimeType, "text/html;profile=mcp-app");
    assert.match(widgetContent.text, /spread-grid/, "spread UI resource is missing its layout surface");
    assert.match(widgetContent.text, /ui\/initialize/, "spread UI resource must perform the MCP Apps initialization handshake");
    assert.match(widgetContent.text, /ui\/notifications\/initialized/, "spread UI resource must signal initialization completion");
    const widgetMeta = widgetContent._meta as { ui?: { csp?: { connectDomains?: string[]; resourceDomains?: string[] } } } | undefined;
    assert.deepEqual(widgetMeta?.ui?.csp?.connectDomains, []);
    assert.deepEqual(widgetMeta?.ui?.csp?.resourceDomains, []);

    const result = await withTimeout(client.callTool({ name: "list_decks", arguments: {} }), 5_000, "stdio list_decks");
    assert.deepEqual(toolResult(result), [], "default stdio must start with no bundled decks");
    await assertFormerDecksUnavailable(client);

    const reading = await importAndCastNeutralDeck(client);
    const packs = await client.callTool({ name: "list_visual_packs", arguments: { deckId: TEST_DECK_ID } });
    assert.deepEqual(toolResult(packs), [], "importing a deck must not implicitly add a visual pack");
    const art = await client.callTool({ name: "get_card_art", arguments: { deckId: TEST_DECK_ID, cardSlug: "major-0" } });
    assert.equal(art.isError, true);
    assert.match(textContent(art), /no server-renderable card-art pack/);
    const rendered = await client.callTool({ name: "render_reading", arguments: { token: reading.token } });
    assert.equal(rendered.isError, true);
    assert.match(textContent(rendered), /no server-renderable visual/);
    const resolvedAfterRender = toolResult<Reading>(await client.callTool({ name: "resolve_reading", arguments: { token: reading.token } }));
    assert.deepEqual(resolvedAfterRender, reading, "missing art must not alter the symbolic reading");
  } finally {
    await withTimeout(client.close(), 3_000, "stdio client close").catch(() => undefined);
  }
  await assertExplicitVisualProtocol();
}

interface Reading {
  token: string;
  deckId: string;
  question: string;
  placements: Array<{ card: { slug: string }; position: { name: string; prompt: string }; reversed: boolean }>;
}

async function importAndCastNeutralDeck(client: Client): Promise<Reading> {
  const imported = toolResult<{ id: string; custom: boolean; cardCount: number }>(await client.callTool({
    name: "import_deck", arguments: { manifest: neutralManifest() },
  }));
  assert.equal(imported.id, TEST_DECK_ID);
  assert.equal(imported.custom, true);
  assert.equal(imported.cardCount, 4);
  const decks = toolResult<Array<{ id: string }>>(await client.callTool({ name: "list_decks", arguments: {} }));
  assert.deepEqual(decks.map((deck) => deck.id), [TEST_DECK_ID]);

  const minor = toolResult<RenderableCard>(await client.callTool({
    name: "get_card", arguments: { deckId: TEST_DECK_ID, cardSlug: "lines-4" },
  }));
  assert.equal(minor.render.deck.version, "1.0.0");
  assert.equal(minor.render.render.material.medium, "Ink");
  assert.equal(minor.render.render.material.surface, "Plain paper");
  assert.equal(minor.render.render.form.familyComposition, "A horizontal field of simple lines.");
  assert.equal(minor.render.render.form.rank?.composition_law, "A balanced square.");
  assert.equal(minor.render.render.legacy.rankContent, "Four equal marks.");
  assert.equal(minor.render.render.environment?.palette, "Gray and white.");
  assert.equal(minor.render.render.scene.description, "Four lines form a simple square.");
  assert.deepEqual(minor.render.render.avoid, ["lettering"]);

  const major = toolResult<RenderableCard>(await client.callTool({
    name: "get_card", arguments: { deckId: TEST_DECK_ID, cardSlug: "major-6" },
  }));
  assert.equal(major.render.render.form.familyComposition, "One centered arrangement.");
  assert.equal(major.render.render.form.numericLogic, "Pair two triangular groups.");
  assert.equal(major.render.context.number.factorization?.gloss, "Two groups of three.");

  const reading = toolResult<Reading>(await client.callTool({
    name: "cast_reading",
    arguments: { deckId: TEST_DECK_ID, spread: "three-card", question: "Protocol smoke test", reversalRate: 0 },
  }));
  assert.equal(reading.deckId, TEST_DECK_ID);
  assert.equal(reading.placements.length, 3);
  assert.equal(new Set(reading.placements.map((placement) => placement.card.slug)).size, 3);
  assert.ok(reading.placements.every((placement) => !placement.reversed && !!placement.position.prompt));
  const resolved = toolResult<Reading>(await client.callTool({ name: "resolve_reading", arguments: { token: reading.token } }));
  assert.deepEqual(resolved, reading, "cast and resolved reading must preserve all authored placements");
  const context = toolResult<{ context: string }>(await client.callTool({ name: "interpretation_context", arguments: { token: reading.token } }));
  assert.ok(context.context.includes(reading.question));
  return reading;
}

async function assertExplicitVisualProtocol(): Promise<void> {
  // The real stdio host above stays empty by default. Only this test server receives fixture art.
  const server = createArcanaMcpServer({ visuals: neutralVisualStore() });
  const client = new Client({ name: "neutral-visual-protocol", version: "0.2.0" });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  try {
    await withTimeout(Promise.all([server.connect(serverTransport), client.connect(clientTransport)]), 5_000, "fixture visual MCP connect");
    assert.deepEqual(toolResult(await client.callTool({ name: "list_decks", arguments: {} })), []);
    const reading = await importAndCastNeutralDeck(client);
    const packs = toolResult<Array<{ id: string; renderer: string; complete: boolean }>>(await client.callTool({
      name: "list_visual_packs", arguments: { deckId: TEST_DECK_ID },
    }));
    assert.deepEqual(packs.map((pack) => pack.id), ["test-png"]);
    assert.equal(packs[0]?.renderer, "static-image");
    assert.equal(packs[0]?.complete, true);

    const art = await client.callTool({ name: "get_card_art", arguments: { deckId: TEST_DECK_ID, cardSlug: "major-0" } });
    assert.equal(art.isError, undefined);
    const cardImage = art.content.find((part) => part.type === "image");
    assert.ok(cardImage && cardImage.type === "image");
    assert.equal(cardImage.mimeType, "image/png");
    assert.ok(cardImage.data.startsWith("iVBORw0KGgo"));

    const rendered = await client.callTool({ name: "render_reading", arguments: { token: reading.token } });
    assert.equal(rendered.isError, undefined);
    const images = rendered.content.filter((part) => part.type === "image");
    assert.equal(images.length, 3, "three-card render should return three fixture images");
    for (const image of images) {
      assert.equal(image.mimeType, "image/png");
      assert.ok(image.data.startsWith("iVBORw0KGgo"));
    }
    const structured = rendered.structuredContent as {
      result?: { token?: string; layout?: { kind?: string }; placements?: Array<{ cardSlug: string; positionPrompt: string }> };
    } | undefined;
    assert.equal(structured?.result?.token, reading.token, "rendering must never recast the reading");
    assert.equal(structured?.result?.layout?.kind, "flow");
    assert.deepEqual(structured?.result?.placements?.map((placement) => placement.cardSlug), reading.placements.map((placement) => placement.card.slug));
    assert.deepEqual(structured?.result?.placements?.map((placement) => placement.positionPrompt), reading.placements.map((placement) => placement.position.prompt));
  } finally {
    await withTimeout(client.close(), 2_000, "fixture client close").catch(() => undefined);
    await withTimeout(server.close(), 2_000, "fixture server close").catch(() => undefined);
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
