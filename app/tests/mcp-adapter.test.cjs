const { test } = require("node:test");
const assert = require("node:assert/strict");
const { ArcanaEngine } = require("../.test-build/engine/ArcanaEngine.js");
const { DeckRegistry } = require("../.test-build/decks/registry.js");
const { ArcanaToolAdapter, ARCANA_TOOL_NAMES } = require("../.test-build/mcp/ArcanaToolAdapter.js");
const { rawDeck } = require("./fixtures.cjs");

function adapter() {
  const registry = new DeckRegistry();
  const deck = registry.registerDeck({ data: rawDeck(), tagline: "Fixture" });
  return { deck, tools: new ArcanaToolAdapter(new ArcanaEngine(registry)) };
}

test("tool contract exposes the intended initial MCP surface", () => {
  const { tools } = adapter();
  assert.deepEqual(tools.definitions().map((tool) => tool.name), [...ARCANA_TOOL_NAMES]);
});

test("get_card preserves card fields and adds a complete render projection", async () => {
  const { deck, tools } = adapter();
  const listed = await tools.call("list_decks");
  assert.equal(listed[0].id, deck.id);
  const sourceCard = deck.cards[0];
  const card = await tools.call("get_card", { deckId: deck.id, cardSlug: sourceCard.slug });
  assert.equal(card.slug, sourceCard.slug);
  assert.equal(card.render.deck.id, deck.id);
  assert.equal(card.render.render.scene.description, sourceCard.visuals.detailed_description);
  assert.equal(card.render.context.station.slug, sourceCard.station_slug);

  assert.equal((await tools.call("analyze_card", { deckId: deck.id, cardSlug: sourceCard.slug })).card.slug, sourceCard.slug);
  const matches = await tools.call("query_cards", { deckId: deck.id, query: { station: sourceCard.station_slug } });
  assert.ok(matches.some((entry) => entry.card.slug === sourceCard.slug));
});

test("cast/resolve/context preserve one reading token and return renderable placements", async () => {
  const { deck, tools } = adapter();
  const cast = await tools.call("cast_reading", { deckId: deck.id, spread: "single", question: "What now?", reversalRate: 0 });
  const resolved = await tools.call("resolve_reading", { token: cast.token, deckId: deck.id });
  const context = await tools.call("interpretation_context", { token: cast.token, deckId: deck.id });
  assert.equal(resolved.token, cast.token);
  assert.equal(resolved.placements.length, 1);
  assert.ok(resolved.placements[0].card.render);
  assert.equal(resolved.placements[0].card.render.render.scene.description, resolved.placements[0].card.visuals.detailed_description);
  assert.match(context.context, /What now\?/);
});

test("custom import mutates only the adapter engine registry", async () => {
  const registry = new DeckRegistry();
  const tools = new ArcanaToolAdapter(new ArcanaEngine(registry));
  const data = rawDeck();
  data.slug = "imported-tool-deck";
  const imported = await tools.call("import_deck", { data });
  assert.equal(imported.id, "imported-tool-deck");
  assert.equal(registry.getDeck("imported-tool-deck").custom, true);
});

test("canonical schema v2 DeckManifest is a first-class import payload", async () => {
  const registry = new DeckRegistry();
  const tools = new ArcanaToolAdapter(new ArcanaEngine(registry));
  const data = rawDeck();
  data.slug = "manifest-native-import";
  data.name = "Manifest Native Import";
  const manifest = { schemaVersion: 2, data, tagline: "Imported as one canonical artifact" };
  const imported = await tools.call("import_deck", { manifest });
  assert.equal(imported.id, "manifest-native-import");
  assert.equal(registry.getDeck("manifest-native-import").tagline, manifest.tagline);
});

test("legacy v1 manifest import remains compatible", async () => {
  const registry = new DeckRegistry();
  const tools = new ArcanaToolAdapter(new ArcanaEngine(registry));
  const data = rawDeck();
  data.slug = "manifest-v1-import";
  const imported = await tools.call("import_deck", { manifest: { data, tagline: "Legacy" } });
  assert.equal(imported.id, "manifest-v1-import");
});

test("manifest import keeps authored envelope fields inside the manifest", async () => {
  const registry = new DeckRegistry();
  const tools = new ArcanaToolAdapter(new ArcanaEngine(registry));
  const data = rawDeck();
  data.slug = "manifest-no-overrides";
  const manifest = { schemaVersion: 2, data, tagline: "Canonical" };

  await assert.rejects(
    tools.call("import_deck", { manifest, tagline: "override" }),
    /tagline and spreads must be authored inside the manifest/i,
  );
  await assert.rejects(
    tools.call("import_deck", { manifest, data }),
    /exactly one of manifest, data, or json/i,
  );
});

test("adapter rejects malformed transport inputs before reaching domain calls", async () => {
  const { tools } = adapter();
  await assert.rejects(tools.call("get_card", { deckId: "", cardSlug: "x" }), /deckId/);
  await assert.rejects(tools.call("cast_reading", { deckId: "x", spread: null }), /spread/);
});
