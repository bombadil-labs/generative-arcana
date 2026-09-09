const test = require("node:test");
const assert = require("node:assert/strict");
const { rawDeck } = require("./fixtures.cjs");
const { createDeckManifest, validateDeckManifest } = require("../.test-build/decks/manifest.js");

test("canonical DeckManifest validates and normalizes native spreads", () => {
  const data = rawDeck();
  const result = validateDeckManifest({
    data,
    tagline: "A portable authored artifact.",
    spreads: [{
      id: "native-test",
      name: "Native Test",
      description: "A test spread.",
      positions: [{ name: "One", prompt: "the first position" }],
    }],
  });
  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.equal(result.manifest.data.slug, data.slug);
  assert.equal(result.manifest.tagline, "A portable authored artifact.");
  assert.equal(result.manifest.spreads[0].deckId, data.slug);
});

test("raw deck data is compatibility input, not a canonical manifest", () => {
  const result = validateDeckManifest(rawDeck());
  assert.equal(result.ok, false);
  assert.match(result.error, /manifest\.data.*required/i);
});

test("canonical manifests require an explicit non-empty tagline", () => {
  const data = rawDeck();
  assert.equal(validateDeckManifest({ data, tagline: "" }).ok, false);
  assert.equal(validateDeckManifest({ data }).ok, false);
});

test("legacy raw deck construction still normalizes into the same manifest shape", () => {
  const data = rawDeck();
  const manifest = createDeckManifest(data, { tagline: "Compatibility import" });
  assert.deepEqual(Object.keys(manifest).sort(), ["data", "tagline"]);
  assert.equal(manifest.data.slug, data.slug);
  assert.equal(manifest.tagline, "Compatibility import");
});
