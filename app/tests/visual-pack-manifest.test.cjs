const test = require("node:test");
const assert = require("node:assert/strict");
const { rawDeck } = require("./fixtures.cjs");
const { createDeckManifest } = require("../.test-build/decks/manifest.js");
const {
  validateVisualPackManifest,
  validateVisualPackForDeck,
} = require("../.test-build/visuals/manifest.js");

function pack() {
  return {
    schemaVersion: 1,
    id: "living-core",
    label: "Living Core",
    description: "A portable visual pack fixture.",
    assets: {
      "major-image": {
        kind: "image",
        path: "cards/major-0.png",
        mediaType: "image/png",
        integrity: "sha256-YWJjZA==",
      },
      "scene-poster": {
        kind: "image",
        path: "spreads/core-sample.png",
        mediaType: "image/png",
      },
      "scene-program": {
        kind: "program",
        path: "spreads/core-sample.js",
        mediaType: "text/javascript",
        format: "generative-arcana/spread-scene-p5@1",
        capabilities: ["time", "pointer", "resize", "signals"],
        dependencies: ["scene-poster"],
      },
    },
    cards: {
      "major-0": { asset: "major-image" },
    },
    spreads: {
      "three-card": { asset: "scene-program", fallback: "scene-poster" },
    },
  };
}

test("visual pack manifests normalize portable asset declarations without assigning deck identity", () => {
  const result = validateVisualPackManifest(pack());
  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.equal(result.pack.id, "living-core");
  assert.equal(result.pack.assets["scene-program"].kind, "program");
  assert.deepEqual(result.pack.assets["scene-program"].capabilities, ["time", "pointer", "resize", "signals"]);
  assert.equal(result.pack.spreads["three-card"].fallback, "scene-poster");
  assert.equal("deckId" in result.pack, false);
  assert.equal(Object.isFrozen(result.pack), true);
});

test("program declaration is metadata, with image-only static fallbacks", () => {
  const badFallback = pack();
  badFallback.spreads["three-card"].fallback = "scene-program";
  const result = validateVisualPackManifest(badFallback);
  assert.equal(result.ok, false);
  assert.match(result.error, /fallback.*image asset/i);
});

test("portable asset paths reject URLs and traversal", () => {
  const url = pack();
  url.assets["major-image"].path = "https://example.com/card.png";
  let result = validateVisualPackManifest(url);
  assert.equal(result.ok, false);
  assert.match(result.error, /path.*URL|URI/i);

  const traversal = pack();
  traversal.assets["major-image"].path = "../secret.png";
  result = validateVisualPackManifest(traversal);
  assert.equal(result.ok, false);
  assert.match(result.error, /parent-directory/i);
});

test("program dependencies must be known, unique asset keys", () => {
  const value = pack();
  value.assets["scene-program"].dependencies = ["missing"];
  const result = validateVisualPackManifest(value);
  assert.equal(result.ok, false);
  assert.match(result.error, /dependencies.*unknown asset/i);
});

test("deck attachment validates card and spread slots only at the ownership boundary", () => {
  const data = rawDeck();
  const manifest = createDeckManifest(data, {
    tagline: "Fixture",
    spreads: [{
      id: "native-scene",
      name: "Native Scene",
      description: "Fixture native spread.",
      positions: [{ name: "One", prompt: "one" }],
    }],
  });
  const value = pack();
  const firstCard = Object.keys(data.cards)[0];
  value.cards = { [firstCard]: { asset: "major-image" } };
  value.spreads = {
    "three-card": { asset: "scene-program", fallback: "scene-poster" },
    "native-scene": { asset: "scene-program", fallback: "scene-poster" },
  };
  let result = validateVisualPackForDeck(value, manifest);
  assert.equal(result.ok, true);

  value.cards = { missing: { asset: "major-image" } };
  result = validateVisualPackForDeck(value, manifest);
  assert.equal(result.ok, false);
  assert.match(result.error, /cards\.missing.*does not exist/i);

  value.cards = { [firstCard]: { asset: "major-image" } };
  value.spreads = { unknown: { asset: "scene-program", fallback: "scene-poster" } };
  result = validateVisualPackForDeck(value, manifest);
  assert.equal(result.ok, false);
  assert.match(result.error, /spreads\.unknown.*does not exist/i);
});

test("a pack must bind at least one card or spread", () => {
  const value = pack();
  delete value.cards;
  delete value.spreads;
  const result = validateVisualPackManifest(value);
  assert.equal(result.ok, false);
  assert.match(result.error, /bind at least one card or spread/i);
});
