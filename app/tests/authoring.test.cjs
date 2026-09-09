const test = require("node:test");
const assert = require("node:assert/strict");
const { rawDeck } = require("./fixtures.cjs");
const {
  DECK_MANIFEST_SPEC,
  inspectDeckAuthoringArtifact,
} = require("../.test-build/decks/authoring.js");

test("authoring spec names DeckManifest as the canonical producer artifact", () => {
  assert.equal(DECK_MANIFEST_SPEC.kind, "generative-arcana/deck-manifest");
  assert.deepEqual(DECK_MANIFEST_SPEC.envelope.required, ["data", "tagline"]);
  assert.equal(DECK_MANIFEST_SPEC.compatibility.rawDeckDataImportAccepted, true);
  assert.equal(DECK_MANIFEST_SPEC.compatibility.rawDeckDataIsCanonicalManifest, false);
});

test("canonical manifests validate with compact structural summary", () => {
  const data = rawDeck();
  const result = inspectDeckAuthoringArtifact({ data, tagline: "Canonical test" });
  assert.equal(result.valid, true);
  assert.equal(result.canonical, true);
  assert.equal(result.inputKind, "manifest");
  assert.equal(result.summary.slug, data.slug);
  assert.equal(result.summary.cardCount, Object.keys(data.cards).length);
  assert.equal(result.normalizedManifest, undefined);
});

test("normalized manifests are opt-in because they can be large", () => {
  const data = rawDeck();
  const result = inspectDeckAuthoringArtifact(
    { data, tagline: "Canonical test" },
    { includeNormalizedManifest: true },
  );
  assert.equal(result.valid, true);
  assert.equal(result.normalizedManifest.tagline, "Canonical test");
});

test("legacy raw deck JSON remains valid compatibility input but is identified as non-canonical", () => {
  const data = rawDeck();
  const result = inspectDeckAuthoringArtifact(data);
  assert.equal(result.valid, true);
  assert.equal(result.canonical, false);
  assert.equal(result.inputKind, "legacy-raw-deck");
  assert.match(result.warning, /compatibility/i);
});

test("half-authored manifests get manifest-specific repair diagnostics", () => {
  const result = inspectDeckAuthoringArtifact({ tagline: "Missing data" });
  assert.equal(result.valid, false);
  assert.equal(result.inputKind, "manifest");
  assert.match(result.error, /manifest\.data.*required/i);
});
