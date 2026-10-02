const { test } = require("node:test");
const assert = require("node:assert/strict");
const { ArcanaEngine } = require("../.test-build/engine/ArcanaEngine.js");
const { DeckRegistry } = require("../.test-build/decks/registry.js");
const { ArcanaToolAdapter, ARCANA_TOOL_NAMES } = require("../.test-build/mcp/ArcanaToolAdapter.js");
const { snapshotDeckManifest, validateDeckManifest } = require("../.test-build/decks/manifest.js");
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

test("get_deck keeps the historical runtime projection by default and explicitly", async () => {
  const { deck, tools } = adapter();
  assert.strictEqual(await tools.call("get_deck", { deckId: deck.id }), deck);
  assert.strictEqual(await tools.call("get_deck", { deckId: deck.id, view: "full" }), deck);
  assert.ok(Array.isArray(deck.cards));
  assert.deepEqual(deck.data.cards[deck.cards[0].slug], deck.cards[0]);
});

test("get_deck manifest view returns the canonical artifact with card bodies only once", async () => {
  const { deck, tools } = adapter();
  const manifest = await tools.call("get_deck", { deckId: deck.id, view: "manifest" });
  assert.deepEqual(manifest, snapshotDeckManifest(deck));
  assert.equal(manifest.schemaVersion, 2);
  assert.equal(manifest.cards, undefined);
  assert.equal(manifest.id, undefined, "runtime resource identity is not authored into the manifest");
  assert.deepEqual(manifest.data.cards, deck.data.cards);
  assert.equal(validateDeckManifest(manifest).ok, true);
  assert.ok(JSON.stringify(manifest).length < JSON.stringify(deck).length * 0.7,
    "the lean manifest must materially reduce the duplicated runtime payload");
});

test("get_deck summary and structure omit card bodies without changing source data", async () => {
  const { deck, tools } = adapter();
  const before = JSON.stringify(deck);
  const summary = await tools.call("get_deck", { deckId: deck.id, view: "summary" });
  assert.equal(summary.id, deck.id);
  assert.equal(summary.slug, deck.data.slug);
  assert.equal(summary.name, deck.name);
  assert.equal(summary.cardCount, deck.cards.length);
  assert.equal(summary.suitCount, Object.keys(deck.data.suits).length);
  assert.equal(summary.rankCount, Object.keys(deck.data.ranks).length);
  assert.equal(summary.stationCount, Object.keys(deck.data.transversal.stations).length);
  assert.equal(summary.spreadCount, (await tools.call("list_spreads", { deckId: deck.id })).length);
  assert.equal(summary.nativeSpreadCount, 0);
  assert.equal(summary.data, undefined);
  assert.equal(summary.cards, undefined);

  const structure = await tools.call("get_deck", { deckId: deck.id, view: "structure" });
  assert.deepEqual(structure.summary, summary);
  assert.deepEqual(structure.cardOrder, deck.cards.map((card) => card.slug));
  const { cards, ...dataWithoutCards } = deck.data;
  assert.deepEqual(structure.data, dataWithoutCards);
  assert.equal(structure.data.cards, undefined);
  assert.equal(structure.cards, undefined);
  assert.equal(structure.schemaVersion, undefined, "structure is not advertised as an importable manifest");
  assert.equal(structure.spreads, undefined);
  assert.equal(JSON.stringify(deck), before);
});

test("lean deck views preserve runtime identity, authored extensions and native spreads", async () => {
  const registry = new DeckRegistry();
  const data = rawDeck();
  data.authoring_profile = { name: "Extension survives projection" };
  const nativeSpread = { id: "native", name: "Native", description: "One card", positions: [{ name: "Here", prompt: "What is here?" }] };
  const deck = registry.registerDeck({ data, tagline: "Fixture", runtimeId: "resource-123", custom: true, spreads: [nativeSpread] });
  const tools = new ArcanaToolAdapter(new ArcanaEngine(registry));
  const summary = await tools.call("get_deck", { deckId: data.slug, view: "summary" });
  assert.equal(summary.id, "resource-123");
  assert.equal(summary.slug, data.slug);
  assert.equal(summary.custom, true);
  assert.equal(summary.nativeSpreadCount, 1);
  const structure = await tools.call("get_deck", { deckId: deck.id, view: "structure" });
  assert.deepEqual(structure.data.authoring_profile, data.authoring_profile);
  assert.deepEqual(structure.spreads, deck.spreads);
  const manifest = await tools.call("get_deck", { deckId: deck.id, view: "manifest" });
  assert.deepEqual(manifest, snapshotDeckManifest(deck));
});

test("get_deck rejects invalid views instead of silently sending a full deck", async () => {
  const { deck, tools } = adapter();
  for (const view of ["compact", "", null, false, [], {}]) {
    await assert.rejects(tools.call("get_deck", { deckId: deck.id, view }), /view must be one of/);
  }
  await assert.rejects(tools.call("get_deck", { deckId: "missing", view: "summary" }), /Unknown deck/);
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
