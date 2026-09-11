const test = require("node:test");
const assert = require("node:assert/strict");
const { rawDeck } = require("./fixtures.cjs");
const { validateDeck } = require("../.test-build/decks/validate.js");

test("structured visual grammar is validated and preserved without changing legacy deck requirements", () => {
  const data = rawDeck();
  const suit = data.suits[Object.keys(data.suits)[0]];
  const rank = data.ranks[Object.keys(data.ranks)[0]];
  const station = data.transversal.stations[Object.keys(data.transversal.stations)[0]];
  const major = Object.values(data.cards).find((card) => card.arcana === "major");

  data.visual_language = {
    medium: "mixed water media on toothy paper",
    surface: "visible fiber and matte pigment",
    mark_making: "handmade strokes remain legible",
    signature_accent: "small luminous highlights",
    finish: "tactile rather than digitally polished",
    avoid: ["glossy 3D rendering"],
  };
  suit.visual_grammar = {
    medium_handling: "broad opaque passages with dragged dry-brush edges",
    composition: "wide fields with directional movement",
    edge_language: "broken contours",
    value_structure: "broad midtone masses with selective highlights",
    camera_and_scale: "low horizon and generous negative space",
    detail_distribution: "detail gathers near the active subject",
    finish: "matte and visibly worked",
    avoid: ["smooth vector contours"],
  };
  rank.visual_form = {
    composition_law: "one undivided focal form",
    spatial_logic: "all secondary shapes support a single center",
  };
  station.visual_environment = {
    illumination: "low raking light",
    palette: "cooler shadows with restrained warm accents",
    atmosphere: "dry suspended dust",
    motion: "slow outward drift",
    density: "open air around the subject",
    material_effects: "existing pigment appears chalkier in the light",
  };
  data.major_arcana.visual_grammar = {
    medium_handling: "translucent glazing over the shared deck medium",
    composition: "expansive emblematic staging",
  };
  major.factorization.visual_logic = "the composition reads as one irreducible focal proposition";

  const result = validateDeck(data);
  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.equal(result.data.visual_language.medium, data.visual_language.medium);
  assert.equal(result.data.suits[Object.keys(data.suits)[0]].visual_grammar.composition, suit.visual_grammar.composition);
  assert.equal(result.data.ranks[Object.keys(data.ranks)[0]].visual_form.composition_law, rank.visual_form.composition_law);
  assert.equal(result.data.transversal.stations[Object.keys(data.transversal.stations)[0]].visual_environment.illumination, station.visual_environment.illumination);
  assert.equal(Object.values(result.data.cards).find((card) => card.arcana === "major").factorization.visual_logic, major.factorization.visual_logic);
});

test("structured visual grammar rejects malformed known fields", () => {
  const badAvoid = rawDeck();
  badAvoid.visual_language = { avoid: "not-an-array" };
  const avoidResult = validateDeck(badAvoid);
  assert.equal(avoidResult.ok, false);
  assert.match(avoidResult.error, /visual_language\.avoid.*array of strings/i);

  const badStation = rawDeck();
  const station = badStation.transversal.stations[Object.keys(badStation.transversal.stations)[0]];
  station.visual_environment = { palette: [] };
  const stationResult = validateDeck(badStation);
  assert.equal(stationResult.ok, false);
  assert.match(stationResult.error, /visual_environment\.palette.*string with content/i);

  const badFactor = rawDeck();
  const major = Object.values(badFactor.cards).find((card) => card.arcana === "major");
  major.factorization.visual_logic = 42;
  const factorResult = validateDeck(badFactor);
  assert.equal(factorResult.ok, false);
  assert.match(factorResult.error, /factorization\.visual_logic.*string with content/i);
});
