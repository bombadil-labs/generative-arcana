const test = require("node:test");
const assert = require("node:assert/strict");
const { rawDeck } = require("./fixtures.cjs");
const {
  DECK_MANIFEST_SPEC,
  inspectDeckAuthoringArtifact,
} = require("../.test-build/decks/authoring.js");

test("authoring spec names schema v2 DeckManifest as the canonical producer artifact", () => {
  assert.equal(DECK_MANIFEST_SPEC.kind, "generative-arcana/deck-manifest");
  assert.deepEqual(DECK_MANIFEST_SPEC.envelope.required, ["schemaVersion", "data", "tagline"]);
  assert.equal(DECK_MANIFEST_SPEC.schema.current, 2);
  assert.equal(DECK_MANIFEST_SPEC.compatibility.rawDeckDataImportAccepted, true);
  assert.equal(DECK_MANIFEST_SPEC.compatibility.rawDeckDataIsCanonicalManifest, false);
  assert.deepEqual(DECK_MANIFEST_SPEC.numericOwnership.allowed, ["rank", "suit", "card"]);
  assert.equal(DECK_MANIFEST_SPEC.numericOwnership.minorOriginField, "manifest.data.minor_numeric_origin");
});

test("canonical schema v2 manifests validate with compact structural summary", () => {
  const data = rawDeck();
  const result = inspectDeckAuthoringArtifact({ schemaVersion: 2, data, tagline: "Canonical test" });
  assert.equal(result.valid, true);
  assert.equal(result.canonical, true);
  assert.equal(result.inputKind, "manifest-v2");
  assert.equal(result.migrated, false);
  assert.equal(result.summary.schemaVersion, 2);
  assert.equal(result.summary.slug, data.slug);
  assert.equal(result.summary.cardCount, Object.keys(data.cards).length);
  assert.equal(result.normalizedManifest, undefined);
});

test("normalized manifests are opt-in because they can be large", () => {
  const data = rawDeck();
  const result = inspectDeckAuthoringArtifact(
    { schemaVersion: 2, data, tagline: "Canonical test" },
    { includeNormalizedManifest: true },
  );
  assert.equal(result.valid, true);
  assert.equal(result.normalizedManifest.schemaVersion, 2);
  assert.equal(result.normalizedManifest.tagline, "Canonical test");
});

test("v1 manifests remain valid compatibility input but normalize to v2", () => {
  const data = rawDeck();
  const result = inspectDeckAuthoringArtifact({ data, tagline: "Legacy manifest" });
  assert.equal(result.valid, true);
  assert.equal(result.canonical, false);
  assert.equal(result.inputKind, "legacy-manifest-v1");
  assert.equal(result.migrated, true);
  assert.match(result.warning, /schemaVersion 2/i);
});

test("legacy raw deck JSON remains valid compatibility input but is identified as non-canonical", () => {
  const data = rawDeck();
  const result = inspectDeckAuthoringArtifact(data);
  assert.equal(result.valid, true);
  assert.equal(result.canonical, false);
  assert.equal(result.inputKind, "legacy-raw-deck");
  assert.equal(result.migrated, true);
  assert.match(result.warning, /compatibility/i);
});

test("half-authored manifests get manifest-specific repair diagnostics", () => {
  const result = inspectDeckAuthoringArtifact({ tagline: "Missing data" });
  assert.equal(result.valid, false);
  assert.equal(result.inputKind, "manifest-v2");
  assert.match(result.error, /manifest\.data.*required/i);
});
