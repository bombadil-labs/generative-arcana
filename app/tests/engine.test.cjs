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
  const reading = await engine.castReading(deck.id, "single", "What now?", { reversalRate: 0 });
  assert.equal(reading.deck, deck);
  assert.equal(reading.question, "What now?");
  assert.equal(reading.placements.length, 1);
  assert.equal(reading.placements[0].card.slug, reading.cards[0].slug);
  assert.equal(reading.placements[0].meaning, reading.placements[0].card.meaning.upright);
  const restored = await engine.resolveReading(reading.token, deck.id);
  assert.equal(restored.deck, deck);
  assert.equal(restored.cards[0].slug, reading.cards[0].slug);
  assert.equal(restored.placements[0].card.slug, reading.placements[0].card.slug);
});

test("engine creates and immediately resolves deck-native spreads", async () => {
  const registry = new DeckRegistry();
  const engine = new ArcanaEngine(registry);
  const data = rawDeck();
  data.slug = "custom-native-spread";
  const deck = engine.importDeck(data, {
    spreads: [{
      id: "native-test",
      name: "Native Test",
      description: "A native spread",
      positions: [{ name: "Card", prompt: "the native position" }],
    }],
  });
  assert.equal(engine.listSpreads(deck.id).some((spread) => spread.id === "native-test"), true);
  const reading = await engine.castReading(deck.id, "native-test", "Native?", { reversalRate: 0 });
  assert.equal(reading.spread.id, "native-test");
  assert.equal((await engine.resolveReading(reading.token, deck.id)).spread.id, "native-test");
});

test("card queries share factorized axis semantics with analysis", () => {
  const { engine, deck } = engineWithDeck();
  const card = deck.cards.find((candidate) => candidate.arcana === "minor") ?? deck.cards[0];
  const analysis = engine.analyzeCard(deck.id, card.slug);
  assert.ok(engine.queryCards(deck.id, { arcana: card.arcana }).some((candidate) => candidate.card.slug === card.slug));
  if (card.suit_slug) assert.ok(engine.queryCards(deck.id, { suit: card.suit_slug }).some((candidate) => candidate.card.slug === card.slug));
  if (card.rank_slug) assert.ok(engine.queryCards(deck.id, { rank: card.rank_slug }).some((candidate) => candidate.card.slug === card.slug));
  assert.ok(engine.queryCards(deck.id, { station: card.station_slug }).some((candidate) => candidate.card.slug === card.slug));
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

test("analysis and factorization queries honor explicit suit-owned minor numbers", () => {
  const data = rawDeck();
  data.minor_number_origin = "suit";
  for (const suit of Object.values(data.suits)) {
    suit.numeric_value = [4, 2, 3, 5][suit.index];
    suit.factorization = {
      character: suit.numeric_value === 4 ? "composite" : "prime",
      ...(suit.numeric_value === 4 ? { factors: [2, 2] } : {}),
      gloss: `suit-owned ${suit.name}`,
    };
  }
  for (const card of Object.values(data.cards)) {
    if (card.arcana !== "minor") continue;
    card.number = String(data.suits[card.suit_slug].numeric_value);
    card.factorization = { character: "prime", gloss: "legacy duplicate" };
  }

  const registry = new DeckRegistry();
  const deck = registry.registerDeck({ data, tagline: "Suit-owned numeric fixture" });
  const engine = new ArcanaEngine(registry);
  const suit = Object.values(data.suits).find((entry) => entry.numeric_value === 4);
  const card = deck.cards.find((candidate) => candidate.arcana === "minor" && candidate.suit_slug === suit.slug);
  const analysis = engine.analyzeCard(deck.id, card.slug);
  assert.equal(analysis.number.factorizationOwner, "suit");
  assert.equal(analysis.number.factorization.character, "composite");
  assert.equal(analysis.number.factorization.gloss, `suit-owned ${suit.name}`);
  const matches = engine.queryCards(deck.id, { factorizationCharacter: "composite", suit: suit.slug });
  assert.ok(matches.length > 0);
  assert.ok(matches.every((entry) => entry.number.factorizationOwner === "suit"));
});
