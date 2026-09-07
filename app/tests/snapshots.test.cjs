const { test } = require("node:test");
const assert = require("node:assert/strict");
const { DeckRegistry } = require("../.test-build/decks/registry.js");
const { rawDeck } = require("./fixtures.cjs");

test("registered decks detach from caller-owned data and spread objects", () => {
  const registry = new DeckRegistry();
  const data = rawDeck();
  data.slug = "snapshot-detaches-source";
  const cardSlug = Object.keys(data.cards)[0];
  const originalCardName = data.cards[cardSlug].name;
  const spread = {
    id: "snapshot-spread",
    name: "Snapshot Spread",
    description: "A test spread.",
    positions: [{ name: "Original Position", prompt: "read this" }],
  };
  const deck = registry.registerDeck({ data, tagline: "Snapshot", spreads: [spread] });

  data.name = "Mutated source";
  data.cards[cardSlug].name = "Mutated card";
  spread.positions[0].name = "Mutated position";

  assert.notEqual(deck.name, "Mutated source");
  assert.equal(deck.data.cards[cardSlug].name, originalCardName);
  assert.equal(deck.spreads[0].positions[0].name, "Original Position");
});

test("registered deck graphs are deeply frozen snapshots", () => {
  const registry = new DeckRegistry();
  const data = rawDeck();
  data.slug = "snapshot-frozen";
  const deck = registry.registerDeck({ data, tagline: "Frozen" });
  const cardSlug = deck.cards[0].slug;
  const originalName = deck.data.cards[cardSlug].name;

  assert.equal(Object.isFrozen(deck), true);
  assert.equal(Object.isFrozen(deck.data), true);
  assert.equal(Object.isFrozen(deck.data.cards), true);
  assert.equal(Object.isFrozen(deck.data.cards[cardSlug]), true);
  assert.equal(Object.isFrozen(deck.cards), true);
  assert.throws(() => deck.cards.push(deck.cards[0]), TypeError);
  try { deck.data.cards[cardSlug].name = "Mutated"; } catch {}
  assert.equal(deck.data.cards[cardSlug].name, originalName);
});

test("non-JSON extension metadata cannot enter a registered deck", () => {
  const registry = new DeckRegistry();
  const withFunction = rawDeck();
  withFunction.slug = "snapshot-function";
  withFunction.extension = () => "not json";
  assert.throws(() => registry.registerDeck({ data: withFunction, tagline: "Invalid" }), /JSON-compatible/);

  const withInfinity = rawDeck();
  withInfinity.slug = "snapshot-infinity";
  withInfinity.extension = Infinity;
  assert.throws(() => registry.registerDeck({ data: withInfinity, tagline: "Invalid" }), /finite/);

  const cyclic = rawDeck();
  cyclic.slug = "snapshot-cycle";
  cyclic.extension = cyclic;
  assert.throws(() => registry.registerDeck({ data: cyclic, tagline: "Invalid" }), /cycles/);
});
