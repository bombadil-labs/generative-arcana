const { test } = require("node:test");
const assert = require("node:assert/strict");
const { DeckRegistry, getDeck } = require("../.test-build/decks/registry.js");
const { loadCustomDeck } = require("../.test-build/decks/custom.js");
const { rawDeck } = require("./fixtures.cjs");

test("deck registry instances isolate identical ids", () => {
  const a = new DeckRegistry();
  const b = new DeckRegistry();
  const d = rawDeck();
  d.slug = "isolated-same-id";
  const deckA = a.registerDeck({ data: d, tagline: "A" });
  const deckB = b.registerDeck({ data: d, tagline: "B" });
  assert.equal(a.getDeck(d.slug), deckA);
  assert.equal(b.getDeck(d.slug), deckB);
  assert.notEqual(deckA, deckB);
  assert.equal(deckA.tagline, "A");
  assert.equal(deckB.tagline, "B");
});

test("custom import targets only the supplied registry", () => {
  const isolated = new DeckRegistry();
  const d = rawDeck();
  d.slug = "isolated-custom-import";
  const result = loadCustomDeck(JSON.stringify(d), isolated);
  assert.equal(result.ok, true, result.error);
  assert.equal(isolated.getDeck(d.slug), result.deck);
  assert.equal(getDeck(d.slug), undefined);
});

test("runtime resource identity is distinct from the authored deck slug", () => {
  const registry = new DeckRegistry();
  const d = rawDeck();
  d.slug = "authored-slug";
  const deck = registry.registerDeck({
    data: d,
    custom: true,
    runtimeId: "resource-123",
    spreads: [{
      id: "native",
      name: "Native",
      description: "Authored spread",
      deckId: d.slug,
      positions: [{ name: "Here", prompt: "what is here" }],
    }],
  });

  assert.equal(deck.id, "resource-123");
  assert.equal(deck.data.slug, "authored-slug");
  assert.deepEqual(deck.aliases, ["authored-slug"]);
  assert.equal(registry.getDeck("resource-123"), deck);
  assert.equal(registry.getDeck("authored-slug"), deck, "legacy slug remains a resolution alias when unique");
  assert.equal(deck.spreads[0].deckId, "resource-123", "native spread ownership is normalized to runtime identity");
});

test("canonical ids win over aliases and duplicate aliases never resolve ambiguously", () => {
  const withCanonical = new DeckRegistry();
  const authored = rawDeck();
  authored.slug = "shared-name";
  const canonical = withCanonical.registerDeck({ data: authored, tagline: "Bundled-like" });
  const custom = withCanonical.registerDeck({ data: authored, custom: true, runtimeId: "resource-custom" });
  assert.equal(withCanonical.getDeck("shared-name"), canonical);
  assert.equal(withCanonical.getDeck("resource-custom"), custom);

  const ambiguous = new DeckRegistry();
  const a = rawDeck();
  a.slug = "same-authored-slug";
  const b = structuredClone(a);
  const deckA = ambiguous.registerDeck({ data: a, custom: true, runtimeId: "resource-a" });
  const deckB = ambiguous.registerDeck({ data: b, custom: true, runtimeId: "resource-b" });
  assert.equal(ambiguous.getDeck("resource-a"), deckA);
  assert.equal(ambiguous.getDeck("resource-b"), deckB);
  assert.equal(ambiguous.getDeck("same-authored-slug"), undefined, "ambiguous compatibility aliases fail closed");

  const canonicalAfterAliases = rawDeck();
  canonicalAfterAliases.slug = "same-authored-slug";
  const canonicalLate = ambiguous.registerDeck({ data: canonicalAfterAliases, tagline: "Canonical late" });
  assert.equal(ambiguous.getDeck("same-authored-slug"), canonicalLate, "canonical ids win even when registered after ambiguous aliases");
  assert.equal(ambiguous.getDeck("resource-a"), deckA);
  assert.equal(ambiguous.getDeck("resource-b"), deckB);
});
