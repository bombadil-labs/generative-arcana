const { readFileSync } = require("node:fs");
const { resolve } = require("node:path");
const { canonicalCards } = require("../.test-build/decks/validate.js");
function rawDeck(id = "deep-time") {
  return JSON.parse(readFileSync(resolve(__dirname, `../../decks/${id}/deck.json`), "utf8"));
}
function moduleFor(data = rawDeck(), custom = false) {
  return { id: data.slug, name: data.name, tagline: "Test", data, cards: canonicalCards(data), custom };
}
function pack(value) { return Buffer.from(JSON.stringify(value), "utf8").toString("base64url"); }
function legacy(deck, overrides = {}) {
  return { v: 1, d: deck.id, s: "single", q: "A question?", c: [[0, 0]], ...overrides };
}
module.exports = { rawDeck, moduleFor, pack, legacy };
