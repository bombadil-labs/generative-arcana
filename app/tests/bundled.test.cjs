const { test } = require("node:test");
const assert = require("node:assert/strict");
const { DeckRegistry } = require("../.test-build/decks/registry.js");
const { registerBundledDecks } = require("../.test-build/decks/bundled.js");

const EXPECTED = ["byrne", "deep-time", "evolution", "finalfantasy", "ultima", "ultima-octave", "ulysses"];

test("headless bundled registration loads the complete shipped symbolic corpus", () => {
  const registry = new DeckRegistry();
  const decks = registerBundledDecks(registry);
  assert.equal(decks.length, 7);
  assert.deepEqual(registry.listDecks().map((deck) => deck.id).sort(), EXPECTED);
});

test("headless registration preserves native spread manifests", () => {
  const registry = new DeckRegistry();
  registerBundledDecks(registry);
  assert.ok(registry.getDeck("ultima").spreads.some((spread) => spread.id === "three-principles"));
  assert.ok(registry.getDeck("deep-time").spreads.some((spread) => spread.id === "core-sample"));
});
