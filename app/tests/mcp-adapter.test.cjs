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

test("list/get/analyze/query share engine semantics", async () => {
  const { deck, tools } = adapter();
  const listed = await tools.call("list_decks");
  assert.equal(listed[0].id, deck.id);
  const card = deck.cards[0];
  assert.equal((await tools.call("get_card", { deckId: deck.id, cardSlug: card.slug })).slug, card.slug);
  assert.equal((await tools.call("analyze_card", { deckId: deck.id, cardSlug: card.slug })).card.slug, card.slug);
  const matches = await tools.call("query_cards", { deckId: deck.id, query: { station: card.station_slug } });
  assert.ok(matches.some((entry) => entry.card.slug === card.slug));
});

test("cast/resolve/context preserve one reading token", async () => {
  const { deck, tools } = adapter();
  const cast = await tools.call("cast_reading", { deckId: deck.id, spread: "single", question: "What now?", reversalRate: 0 });
  const resolved = await tools.call("resolve_reading", { token: cast.token, deckId: deck.id });
  const context = await tools.call("interpretation_context", { token: cast.token, deckId: deck.id });
  assert.equal(resolved.token, cast.token);
  assert.equal(resolved.placements.length, 1);
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

test("canonical DeckManifest is a first-class import payload", async () => {
  const registry = new DeckRegistry();
  const tools = new ArcanaToolAdapter(new ArcanaEngine(registry));
  const data = rawDeck();
  data.slug = "manifest-native-import";
  data.name = "Manifest Native Import";
  const manifest = { data, tagline: "Imported as one canonical artifact" };
  const imported = await tools.call("import_deck", { manifest });
  assert.equal(imported.id, "manifest-native-import");
  assert.equal(registry.getDeck("manifest-native-import").tagline, manifest.tagline);
});

test("manifest import keeps authored envelope fields inside the manifest", async () => {
  const registry = new DeckRegistry();
  const tools = new ArcanaToolAdapter(new ArcanaEngine(registry));
  const data = rawDeck();
  data.slug = "manifest-no-overrides";
  const manifest = { data, tagline: "Canonical" };

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
