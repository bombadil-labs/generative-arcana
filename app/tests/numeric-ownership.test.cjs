const test = require("node:test");
const assert = require("node:assert/strict");
const { rawDeck } = require("./fixtures.cjs");
const { DeckRegistry } = require("../.test-build/decks/registry.js");
const { ArcanaEngine } = require("../.test-build/engine/ArcanaEngine.js");
const { ArcanaToolAdapter } = require("../.test-build/mcp/ArcanaToolAdapter.js");

test("legacy/default tarot infers minor number ownership from rank", () => {
  const data = rawDeck("deep-time");
  const registry = new DeckRegistry();
  const deck = registry.registerDeck({ data, tagline: "Deep Time test" });
  const analysis = new ArcanaEngine(registry).analyzeCard(deck.id, "faults-five");
  assert.equal(analysis.number.label, "5");
  assert.equal(analysis.number.origin, "rank");
  assert.equal(analysis.number.factorization, undefined);
});

test("variant deck can own minor number and factorization on the suit", async () => {
  const data = rawDeck("ultima-octave");
  data.minor_numeric_origin = "suit";
  for (const [suitSlug, suit] of Object.entries(data.suits)) {
    const representative = data.cards[`${suitSlug}-virtue`];
    suit.numeric_value = Number(representative.number);
    suit.factorization = {
      ...representative.factorization,
      visual_logic: `${suit.name} formally owns number ${representative.number}.`,
    };
  }

  // Deliberately poison the legacy duplicate to prove reads prefer the declared owner.
  data.cards["justice-reagent"].factorization.gloss = "legacy card copy should not win";
  data.cards["justice-reagent"].factorization.visual_logic = "legacy visual logic should not win";

  const registry = new DeckRegistry();
  const deck = registry.registerDeck({ data, tagline: "Octave numeric owner test" });
  const engine = new ArcanaEngine(registry);
  const analysis = engine.analyzeCard(deck.id, "justice-reagent");
  assert.equal(analysis.number.label, "6");
  assert.equal(analysis.number.origin, "suit");
  assert.equal(analysis.number.factorizationSource, "suit");
  assert.equal(analysis.number.factorization.character, "composite");
  assert.deepEqual(analysis.number.factorization.factors, [2, 3]);
  assert.match(analysis.number.factorization.gloss, /Truth\+Love|Compassion x Sacrifice/);

  const card = await new ArcanaToolAdapter(engine).call("get_card", {
    deckId: deck.id,
    cardSlug: "justice-reagent",
  });
  assert.equal(card.render.context.number.origin, "suit");
  assert.equal(card.render.context.number.factorizationSource, "suit");
  assert.equal(card.render.render.form.numericLogic, "Justice formally owns number 6.");
});

test("explicit axis-owned numbering fails closed when the referenced owner disagrees", () => {
  const data = rawDeck("ultima-octave");
  data.minor_numeric_origin = "suit";
  for (const [suitSlug, suit] of Object.entries(data.suits)) {
    suit.numeric_value = Number(data.cards[`${suitSlug}-virtue`].number);
  }
  data.suits.justice.numeric_value = 5;

  const registry = new DeckRegistry();
  assert.throws(
    () => registry.registerDeck({ data, tagline: "Invalid numeric owner" }),
    /must match the referenced suit numeric_value/i,
  );
});
