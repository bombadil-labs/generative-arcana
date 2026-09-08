const { test } = require("node:test");
const assert = require("node:assert/strict");
const { rawDeck } = require("./fixtures.cjs");
const { DeckRegistry } = require("../.test-build/decks/registry.js");
const { ArcanaEngine } = require("../.test-build/engine/ArcanaEngine.js");

function engineWithDeck(id = "deep-time") {
  const registry = new DeckRegistry();
  const engine = new ArcanaEngine(registry);
  const deck = engine.importDeck(rawDeck(id));
  return { engine, deck };
}

test("engine owns an isolated validated deck registry", () => {
  const a = engineWithDeck();
  const b = new ArcanaEngine(new DeckRegistry());
  assert.equal(a.engine.listDecks().length, 1);
  assert.equal(b.listDecks().length, 0);
  assert.equal(a.engine.getDeck(a.deck.id), a.deck);
});

test("card analysis exposes authored axes and numeric coordinate", () => {
  const { engine, deck } = engineWithDeck();
  const card = deck.cards.find((candidate) => candidate.arcana === "minor") ?? deck.cards[0];
  const analysis = engine.analyzeCard(deck.id, card.slug);
  assert.equal(analysis.card, card);
  assert.equal(analysis.axes.station, deck.data.transversal.stations[card.station_slug]);
  if (card.suit_slug) assert.equal(analysis.axes.suit, deck.data.suits[card.suit_slug]);
  if (card.rank_slug) assert.equal(analysis.axes.rank, deck.data.ranks[card.rank_slug]);
  assert.equal(analysis.number.label, card.number);
  assert.equal(analysis.authoredMeaning, card.meaning);
});

test("casting produces a first-class resolved reading and round-trips through its token", async () => {
  const { engine, deck } = engineWithDeck();
  const reading = await engine.castReading(deck.id, "single", "What is moving?", { reversalRate: 0 });
  assert.equal(reading.deck, deck);
  assert.equal(reading.spread.id, "single");
  assert.equal(reading.cards.length, 1);
  assert.equal(reading.placements.length, 1);
  assert.equal(reading.placements[0].reversed, false);
  assert.equal(reading.placements[0].card.slug, reading.cards[0].slug);
  assert.ok(Object.isFrozen(reading));
  assert.ok(Object.isFrozen(reading.spread));

  const restored = await engine.resolveReading(reading.token);
  assert.equal(restored.deck, deck);
  assert.equal(restored.cards[0].slug, reading.cards[0].slug);
  assert.equal(restored.question, "What is moving?");
  assert.equal(restored.legacy, false);
});

test("interpretation text is a projection of a resolved reading", async () => {
  const { engine, deck } = engineWithDeck();
  const reading = await engine.castReading(deck.id, "single", "Open reading", { reversalRate: 0 });
  const text = engine.buildInterpretationContext(reading);
  assert.match(text, new RegExp(deck.name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
  assert.match(text, new RegExp(reading.placements[0].card.name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
  assert.match(text, /TASK/);
});

test("spread listing is detached from shared generic spread state", () => {
  const { engine, deck } = engineWithDeck();
  const spreads = engine.listSpreads(deck.id);
  assert.ok(spreads.some((spread) => spread.id === "single"));
  assert.ok(Object.isFrozen(spreads));
  assert.ok(Object.isFrozen(spreads[0]));
});

test("reading tokens cannot resolve against a host that lacks their deck", async () => {
  const { engine, deck } = engineWithDeck();
  const reading = await engine.castReading(deck.id, "single", "", { reversalRate: 0 });
  const empty = new ArcanaEngine(new DeckRegistry());
  await assert.rejects(empty.resolveReading(reading.token), /unknown deck/i);
});
