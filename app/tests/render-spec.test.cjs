const test = require("node:test");
const assert = require("node:assert/strict");
const { rawDeck } = require("./fixtures.cjs");
const { DeckRegistry } = require("../.test-build/decks/registry.js");
const { resolveCardRenderSpec } = require("../.test-build/decks/renderSpec.js");

test("card render spec denormalizes the full visual stack without changing authored storage", () => {
  const data = rawDeck();
  const suitSlug = Object.keys(data.suits)[0];
  const rankSlug = Object.keys(data.ranks)[0];
  const stationSlug = Object.keys(data.transversal.stations)[0];
  data.visual_language = {
    medium: "ink and gouache",
    surface: "toothy paper",
    mark_making: "visible brush drag",
    signature_accent: "crystal-white highlights",
    finish: "matte",
    avoid: ["glossy 3D"],
  };
  data.suits[suitSlug].visual_grammar = {
    medium_handling: "opaque broad strokes",
    composition: "low horizon",
    edge_language: "broken contours",
    value_structure: "broad middle values",
    camera_and_scale: "wide field",
    detail_distribution: "detail near the subject",
    finish: "dry-brush grain",
    avoid: ["smooth vectors"],
  };
  data.ranks[rankSlug].visual_form = { composition_law: "one undivided form" };
  data.transversal.stations[stationSlug].visual_environment = {
    illumination: "raking light",
    palette: "cool shadows",
    atmosphere: "dust",
  };

  const card = Object.values(data.cards).find((candidate) =>
    candidate.arcana === "minor"
      && candidate.suit_slug === suitSlug
      && candidate.rank_slug === rankSlug
      && candidate.station_slug === stationSlug);
  assert.ok(card, "fixture should contain a card at the selected axis intersection");
  data.ranks[rankSlug].factorization = {
    character: "prime",
    gloss: "irreducible",
    visual_logic: "one indivisible compositional proposition",
  };

  const registry = new DeckRegistry();
  const deck = registry.registerDeck({ data, tagline: "Renderable fixture" });
  const registered = deck.cards.find((candidate) => candidate.slug === card.slug);
  const spec = resolveCardRenderSpec(deck, registered);

  assert.equal(spec.deck.visualLanguage.medium, "ink and gouache");
  assert.equal(spec.context.family.visualGrammar.composition, "low horizon");
  assert.equal(spec.context.rank.visualForm.composition_law, "one undivided form");
  assert.equal(spec.context.station.visualEnvironment.illumination, "raking light");
  assert.equal(spec.render.material.familyHandling, "opaque broad strokes");
  assert.equal(spec.render.form.numericLogic, "one indivisible compositional proposition");
  assert.equal(spec.render.environment.palette, "cool shadows");
  assert.equal(spec.render.scene.description, card.visuals.detailed_description);
  assert.deepEqual(spec.render.avoid, ["glossy 3D", "smooth vectors"]);

  assert.equal(data.cards[card.slug].render, undefined, "resolved render context is a read projection, not duplicated into authored source data");
});

test("legacy visual prose is carried into the render projection as fallback context", () => {
  const data = rawDeck();
  const registry = new DeckRegistry();
  const deck = registry.registerDeck({ data, tagline: "Legacy visual fixture" });
  const card = deck.cards.find((candidate) => candidate.arcana === "minor");
  const spec = resolveCardRenderSpec(deck, card);

  const suit = data.suits[card.suit_slug];
  const rank = data.ranks[card.rank_slug];
  const station = data.transversal.stations[card.station_slug];
  assert.equal(spec.render.legacy.familyStyle, suit.visual_style);
  assert.equal(spec.render.legacy.rankContent, rank.visual_content);
  assert.equal(spec.render.legacy.stationMotif, station.visual_motif);
});

test("explicit suit-owned minor numbers resolve factorization from the suit instead of legacy card duplication", () => {
  const data = rawDeck();
  data.minor_number_origin = "suit";
  const suits = Object.values(data.suits);
  for (const suit of suits) {
    suit.numeric_value = [4, 2, 3, 5][suit.index];
    suit.factorization = {
      character: suit.numeric_value === 4 ? "composite" : "prime",
      ...(suit.numeric_value === 4 ? { factors: [2, 2] } : {}),
      gloss: `suit-owned ${suit.name}`,
      visual_logic: `formal logic for ${suit.name}`,
    };
  }
  for (const card of Object.values(data.cards)) {
    if (card.arcana !== "minor") continue;
    card.number = String(data.suits[card.suit_slug].numeric_value);
    card.factorization = { character: "prime", gloss: "legacy card duplicate that must not win" };
  }

  const registry = new DeckRegistry();
  const deck = registry.registerDeck({ data, tagline: "Suit-owned numeric fixture" });
  const card = deck.cards.find((candidate) => candidate.arcana === "minor" && candidate.suit_slug === Object.keys(data.suits)[2]);
  const spec = resolveCardRenderSpec(deck, card);

  assert.equal(spec.context.number.factorizationOwner, "suit");
  assert.equal(spec.context.number.factorization.gloss, `suit-owned ${data.suits[card.suit_slug].name}`);
  assert.equal(spec.render.form.numericLogic, `formal logic for ${data.suits[card.suit_slug].name}`);
});
