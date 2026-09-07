const { test } = require("node:test");
const assert = require("node:assert/strict");
const { readdirSync } = require("node:fs");
const { resolve } = require("node:path");
const { validateDeck, canonicalCards } = require("../.test-build/decks/validate.js");
const { loadCustomDeck } = require("../.test-build/decks/custom.js");
const { getDeck, registerDeck, listDecks } = require("../.test-build/decks/registry.js");
const { rawDeck, moduleFor } = require("./fixtures.cjs");

for (const id of readdirSync(resolve(__dirname, "../../decks"), { withFileTypes: true }).filter((d) => d.isDirectory()).map((d) => d.name)) {
  test(`bundled corpus validates: ${id}`, () => {
    const result = validateDeck(rawDeck(id));
    assert.equal(result.ok, true, result.error);
  });
}
for (const value of [null, [], 0, false, "not a deck"]) {
  test(`reject a non-object deck: ${JSON.stringify(value)}`, () => {
    const before = listDecks().length;
    assert.equal(loadCustomDeck(JSON.stringify(value)).ok, false);
    assert.equal(listDecks().length, before);
  });
}
test("malformed JSON returns an error", () => assert.equal(loadCustomDeck("{").ok, false));

const invalid = [
  ["name", (d) => d.name = 3],
  ["slug", (d) => d.slug = "Invalid Slug"],
  ["version", (d) => delete d.version],
  ["theme.description", (d) => d.theme.description = {}],
  ["suits", (d) => d.suits = []],
  ["suits", (d) => d.suits = {}],
  ["ranks", (d) => d.ranks = null],
  ["index", (d) => Object.values(d.suits)[1].index = 0],
  ["indices", (d) => Object.values(d.suits)[0].index = 999],
  ["numeric_value", (d) => Object.values(d.ranks)[0].numeric_value = -1],
  ["transversal.stations", (d) => d.transversal.stations = []],
  ["suit_stride", (d) => d.transversal.suit_stride = 0],
  ["major_arcana", (d) => d.major_arcana = null],
  ["cards", (d) => d.cards = []],
  ["cards", (d) => d.cards = {}],
  ["cards.major-1", (d) => d.cards["major-1"] = null],
  ["meaning.inverted", (d) => d.cards["major-1"].meaning.inverted = []],
  ["station_slug", (d) => d.cards["major-1"].station_slug = "missing"],
  ["slug", (d) => d.cards["major-1"].slug = "major-0"],
  ["number", (d) => d.cards["major-1"].number = "NaN"],
  ["number", (d) => d.cards["major-1"].number = "9007199254740992"],
  ["detailed_description", (d) => d.cards["major-1"].visuals = {}],
  ["suit_slug", (d) => Object.values(d.cards).find((c) => c.arcana === "minor").suit_slug = "unknown"],
  ["rank_slug", (d) => Object.values(d.cards).find((c) => c.arcana === "minor").rank_slug = "constructor"],
  ["major cards", (d) => d.cards["major-1"].rank_slug = "ace"],
  ["character", (d) => d.cards["major-1"].factorization.character = "mystery"],
  ["factors", (d) => d.cards["major-1"].factorization.factors = [1.5]],
  ["dialectic.axes", (d) => d.dialectic.axes = []],
  ["dialectic.cells", (d) => Object.values(d.dialectic.cells)[0][0] = "unknown-pole"],
  ["svg", (d) => Object.values(d.suits)[0].symbol.svg = 1],
];
for (const [field, mutate] of invalid) {
  test(`reject invalid ${field}: ${mutate.toString()}`, () => {
    const d = rawDeck();
    mutate(d);
    const result = loadCustomDeck(JSON.stringify(d));
    assert.equal(result.ok, false);
    assert.ok(result.error.includes(field), result.error);
  });
}
test("canonical ordering ignores card and axis key insertion order", () => {
  const d = rawDeck();
  const order = canonicalCards(d).map((c) => c.slug);
  for (const k of ["cards", "ranks", "suits"]) d[k] = Object.fromEntries(Object.entries(d[k]).reverse());
  assert.deepEqual(canonicalCards(d).map((c) => c.slug), order);
  const result = loadCustomDeck(JSON.stringify(d));
  assert.equal(result.ok, true, result.error);
  assert.deepEqual(result.deck.cards.map((c) => c.slug), order);
});
test("Ultima Octave keeps its 8 by 8 lattice, zero values and minor glosses", () => {
  const d = rawDeck("ultima-octave");
  assert.equal(Object.keys(d.cards).length, 86);
  assert.equal(Object.keys(d.suits).length, 8);
  assert.equal(Object.keys(d.ranks).length, 8);
  assert.ok(Object.values(d.cards).some((c) => c.arcana === "minor" && c.factorization));
  assert.equal(loadCustomDeck(JSON.stringify(d)).ok, true);
});
test("runtime imports do not impose complete 78-card authoring profiles", () => {
  const d = rawDeck();
  d.cards = { "major-0": d.cards["major-0"] };
  assert.equal(validateDeck(d).ok, true);
});
test("extension metadata is retained", () => {
  const d = rawDeck(); d.construction = { custom: "an experimental profile" };
  const result = loadCustomDeck(JSON.stringify(d));
  assert.equal(result.ok, true, result.error);
  assert.deepEqual(result.deck.data.construction, d.construction);
});
test("custom imports cannot overwrite a bundled deck", () => {
  const d = rawDeck(); d.slug = "protected-builtin";
  const built = registerDeck(moduleFor(d));
  const result = loadCustomDeck(JSON.stringify(d));
  assert.equal(result.ok, false);
  assert.equal(getDeck(d.slug), built);
});
test("failed re-import leaves the registered custom deck untouched", () => {
  const d = rawDeck(); d.slug = "custom-transaction";
  const result = loadCustomDeck(JSON.stringify(d));
  assert.equal(result.ok, true);
  d.cards["major-1"].meaning = null;
  assert.equal(loadCustomDeck(JSON.stringify(d)).ok, false);
  assert.equal(getDeck(d.slug), result.deck);
});
