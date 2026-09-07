const { test } = require("node:test");
const assert = require("node:assert/strict");
const {
  rankLabel,
  rankBadge,
  suitLabel,
  stationName,
  suitGlyphSvg,
  majorGlyphSvg,
  omega,
  facWord,
} = require("../.test-build/decks/cardMeta.js");

const deck = {
  suits: { structures: { name: "Structures", index: 0, symbol: { svg: "<svg>structure</svg>" } } },
  ranks: { homecoming: { name: "Homecoming", index: 0, symbol: "H" } },
  transversal: { name: "Cycle", description: "", stations: { dusk: { name: "Dusk", index: 0 } } },
  major_arcana: { symbol: { svg: "<svg>major</svg>" } },
};

test("deck-authored metadata wins over bundled fallbacks", () => {
  assert.equal(rankLabel(deck, "homecoming"), "Homecoming");
  assert.equal(rankBadge(deck, "homecoming"), "H");
  assert.equal(suitLabel(deck, "structures"), "Structures");
  assert.equal(stationName(deck, "dusk"), "Dusk");
  assert.equal(suitGlyphSvg(deck, "structures"), "<svg>structure</svg>");
  assert.equal(majorGlyphSvg(deck), "<svg>major</svg>");
});

test("metadata helpers preserve portable fallbacks without React", () => {
  assert.equal(rankLabel(undefined, "two"), "Two");
  assert.equal(rankBadge(undefined, "two"), "II");
  assert.equal(suitLabel(undefined, "crowns"), "Crowns");
  assert.equal(stationName(undefined, "unknown-station"), "unknown-station");
});

test("factorization helpers remain domain-pure", () => {
  assert.equal(omega(1), 0);
  assert.equal(omega(13), 1);
  assert.equal(omega(12), 3);
  assert.equal(facWord(0), "identity");
  assert.equal(facWord(1), "prime");
  assert.equal(facWord(3), "composite");
});
