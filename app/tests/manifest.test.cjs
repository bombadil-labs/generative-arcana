const test = require("node:test");
const assert = require("node:assert/strict");
const { rawDeck } = require("./fixtures.cjs");
const { CURRENT_DECK_MANIFEST_SCHEMA_VERSION, createDeckManifest, validateDeckManifest } = require("../.test-build/decks/manifest.js");

test("schema v2 DeckManifest validates and normalizes native spreads", () => {
  const data = rawDeck();
  const result = validateDeckManifest({
    schemaVersion: 2,
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
  assert.equal(result.sourceSchemaVersion, 2);
  assert.equal(result.migrated, false);
  assert.equal(result.manifest.schemaVersion, CURRENT_DECK_MANIFEST_SCHEMA_VERSION);
  assert.equal(result.manifest.data.slug, data.slug);
  assert.equal(result.manifest.tagline, "A portable authored artifact.");
  assert.equal(result.manifest.spreads[0].deckId, data.slug);
});

test("v1 manifest envelopes remain readable but normalize to schema v2", () => {
  const data = rawDeck();
  const result = validateDeckManifest({ data, tagline: "Legacy v1" });
  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.equal(result.sourceSchemaVersion, 1);
  assert.equal(result.migrated, true);
  assert.equal(result.manifest.schemaVersion, 2);
});

test("unsupported future manifest schema versions fail closed", () => {
  const result = validateDeckManifest({ schemaVersion: 99, data: rawDeck(), tagline: "Future" });
  assert.equal(result.ok, false);
  assert.match(result.error, /unsupported schema version 99/i);
});

test("raw deck data is compatibility input, not a manifest envelope", () => {
  const result = validateDeckManifest(rawDeck());
  assert.equal(result.ok, false);
  assert.match(result.error, /manifest\.data.*required/i);
});

test("canonical manifests require an explicit non-empty tagline", () => {
  const data = rawDeck();
  assert.equal(validateDeckManifest({ schemaVersion: 2, data, tagline: "" }).ok, false);
  assert.equal(validateDeckManifest({ schemaVersion: 2, data }).ok, false);
});

test("raw deck construction now emits schema v2", () => {
  const data = rawDeck();
  const manifest = createDeckManifest(data, { tagline: "Compatibility import" });
  assert.deepEqual(Object.keys(manifest).sort(), ["data", "schemaVersion", "tagline"]);
  assert.equal(manifest.schemaVersion, 2);
  assert.equal(manifest.data.slug, data.slug);
  assert.equal(manifest.tagline, "Compatibility import");
});
