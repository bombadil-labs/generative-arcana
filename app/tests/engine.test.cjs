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

test("routed resolution rejects a token for a different expected deck", async () => {
  const { engine, deck } = engineWithDeck();
  const reading = await engine.castReading(deck.id, "single", "", { reversalRate: 0 });
  await assert.rejects(engine.resolveReading(reading.token, "different-deck"), /different deck than the route/i);
});

test("card queries address exact intersections in the symbolic space", () => {
  const { engine, deck } = engineWithDeck();
  const card = deck.cards.find((candidate) => candidate.arcana === "minor");
  assert.ok(card, "fixture should contain a minor card");
  const analysis = engine.analyzeCard(deck.id, card.slug);
  const results = engine.queryCards(deck.id, {
    arcana: "minor",
    suit: card.suit_slug,
    rank: card.rank_slug,
    station: card.station_slug,
  });
  assert.ok(results.some((candidate) => candidate.card.slug === card.slug));
  assert.ok(Object.isFrozen(results));

  if (analysis.number.omega !== undefined) {
    assert.ok(engine.queryCards(deck.id, { omega: analysis.number.omega }).some((candidate) => candidate.card.slug === card.slug));
  }
});

test("dialectic queries follow authored pole coordinates when the deck defines them", () => {
  const { engine, deck } = engineWithDeck();
  const analysis = deck.cards.map((card) => engine.analyzeCard(deck.id, card.slug)).find((candidate) => candidate.axes.dialectic);
  if (!analysis) return;
  const coordinate = analysis.axes.dialectic[0];
  const results = engine.queryCards(deck.id, { dialectic: { axis: coordinate.axis, pole: coordinate.pole } });
  assert.ok(results.some((candidate) => candidate.card.slug === analysis.card.slug));
});

test("card queries reject nonsensical Ω coordinates", () => {
  const { engine, deck } = engineWithDeck();
  assert.throws(() => engine.queryCards(deck.id, { omega: -1 }), /non-negative integer/);
  assert.throws(() => engine.queryCards(deck.id, { omega: 1.5 }), /non-negative integer/);
});

test("catalog-backed decks cast with resource ids while legacy slug routes remain resolvable", async () => {
  const registry = new DeckRegistry();
  const engine = new ArcanaEngine(registry);
  const data = rawDeck();
  data.slug = "legacy-custom-slug";
  const deck = engine.importDeck(data, {
    runtimeId: "catalog-resource-id",
    spreads: [{
      id: "native",
      name: "Native",
      description: "Native spread",
      deckId: data.slug,
      positions: [{ name: "Card", prompt: "the card" }],
    }],
  });

  assert.equal(deck.id, "catalog-resource-id");
  assert.equal(engine.getDeck(data.slug), deck);
  const reading = await engine.castReading(data.slug, "native", "", { reversalRate: 0 });
  assert.equal(reading.deck.id, "catalog-resource-id");
  assert.equal(reading.spread.deckId, "catalog-resource-id");
  assert.equal((await engine.resolveReading(reading.token, data.slug)).deck, deck);
  assert.equal((await engine.resolveReading(reading.token, deck.id)).deck, deck);
});
