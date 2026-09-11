const test = require("node:test");
const assert = require("node:assert/strict");
const { rawDeck, moduleFor } = require("./fixtures.cjs");
const {
  buildSpreadSceneData,
  defaultSpreadSceneRects,
} = require("../.test-build/runtime/spreadSceneData.js");

test("default spread scene geometry stays normalized and covers every placement", () => {
  const rects = defaultSpreadSceneRects(5);
  assert.equal(rects.length, 5);
  for (const rect of rects) {
    assert.ok(rect.x >= 0 && rect.x <= 1);
    assert.ok(rect.y >= 0 && rect.y <= 1);
    assert.ok(rect.w > 0 && rect.w <= 1);
    assert.ok(rect.h > 0 && rect.h <= 1);
    assert.ok(rect.x + rect.w <= 1.000001);
    assert.ok(rect.y + rect.h <= 1.000001);
  }
  assert.notDeepEqual(rects[0], rects[1]);
});

test("spread scene data embeds each card's resolved render handoff without mutating authored storage", () => {
  const data = rawDeck();
  const suitSlug = Object.keys(data.suits)[0];
  const rankSlug = Object.keys(data.ranks)[0];
  const stationSlug = Object.keys(data.transversal.stations)[0];
  data.visual_language = { medium: "ink and stone dust" };
  data.suits[suitSlug].visual_grammar = { composition: "one geological family frame" };
  data.ranks[rankSlug].visual_form = { composition_law: "one formal rank law" };
  data.transversal.stations[stationSlug].visual_environment = { atmosphere: "shared weather" };

  const deck = moduleFor(data);
  const card = deck.cards.find((candidate) =>
    candidate.arcana === "minor"
      && candidate.suit_slug === suitSlug
      && candidate.rank_slug === rankSlug
      && candidate.station_slug === stationSlug);
  assert.ok(card);

  const position = { name: "The Layer", prompt: "what is deposited here" };
  const rect = { x: 0.1, y: 0.2, w: 0.3, h: 0.4 };
  const reading = {
    token: "v2.scene-seed",
    deck,
    spread: {
      id: "one-layer",
      name: "One Layer",
      description: "A scene-data fixture.",
      positions: [position],
    },
    question: "What is happening?",
    cards: [],
    placements: [{
      position,
      card,
      reversed: true,
      meaning: card.meaning.inverted,
    }],
    legacy: false,
  };

  const scene = buildSpreadSceneData(reading, [rect]);
  assert.equal(scene.deckId, deck.id);
  assert.equal(scene.spreadId, "one-layer");
  assert.equal(scene.seed, reading.token);
  assert.equal(scene.question, reading.question);
  assert.equal(scene.placements.length, 1);
  assert.deepEqual(scene.placements[0].rect, rect);
  assert.equal(scene.placements[0].reversed, true);
  assert.equal(scene.placements[0].card.slug, card.slug);
  assert.equal(scene.placements[0].render.deck.id, deck.id);
  assert.equal(scene.placements[0].render.render.material.medium, "ink and stone dust");
  assert.equal(scene.placements[0].render.render.form.familyComposition, "one geological family frame");
  assert.equal(scene.placements[0].render.render.form.rank.composition_law, "one formal rank law");
  assert.equal(scene.placements[0].render.render.environment.atmosphere, "shared weather");
  assert.equal(data.cards[card.slug].render, undefined);
});

test("spread scene data rejects geometry that does not match placement count", () => {
  const data = rawDeck();
  const deck = moduleFor(data);
  const card = deck.cards.find((candidate) => candidate.arcana === "minor");
  const position = { name: "One", prompt: "one" };
  const reading = {
    token: "v2.scene-seed",
    deck,
    spread: { id: "one", name: "One", description: "One", positions: [position] },
    question: "",
    cards: [],
    placements: [{ position, card, reversed: false, meaning: card.meaning.upright }],
    legacy: false,
  };
  assert.throws(() => buildSpreadSceneData(reading, []), /0 rectangles for 1 placements/);
});
