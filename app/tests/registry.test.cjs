const { test } = require("node:test");
const assert = require("node:assert/strict");
const { DeckRegistry, getDeck } = require("../.test-build/decks/registry.js");
const { loadCustomDeck } = require("../.test-build/decks/custom.js");
const { rawDeck } = require("./fixtures.cjs");

test("deck registry instances isolate identical ids", () => {
  const a = new DeckRegistry();
  const b = new DeckRegistry();
  const d = rawDeck();
  d.slug = "isolated-same-id";
  const deckA = a.registerDeck({ data: d, tagline: "A" });
  const deckB = b.registerDeck({ data: d, tagline: "B" });
  assert.equal(a.getDeck(d.slug), deckA);
  assert.equal(b.getDeck(d.slug), deckB);
  assert.notEqual(deckA, deckB);
  assert.equal(deckA.tagline, "A");
  assert.equal(deckB.tagline, "B");
});

test("custom import targets only the supplied registry", () => {
  const isolated = new DeckRegistry();
  const d = rawDeck();
  d.slug = "isolated-custom-import";
  const result = loadCustomDeck(JSON.stringify(d), isolated);
  assert.equal(result.ok, true, result.error);
  assert.equal(isolated.getDeck(d.slug), result.deck);
  assert.equal(getDeck(d.slug), undefined);
});
