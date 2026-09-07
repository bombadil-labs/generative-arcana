import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { loadCustomDeck } from "../src/decks/custom.ts";
import { validateDeck, orderedCards } from "../src/decks/validate.ts";
import { getDeck, registerDeck } from "../src/decks/registry.ts";
import { encodeReading, decodeReading, tokenToDealt, resolveReading, deckRevision } from "../src/reading/encode.ts";
import { deal } from "../src/reading/deal.ts";
import { GENERIC_SPREADS } from "../src/decks/spreads.ts";

const corpus = new URL("../../decks/", import.meta.url);
const sample = JSON.parse(readFileSync(new URL("deep-time/deck.json", corpus), "utf8"));
const moduleFor = (data = structuredClone(sample)) => ({ id: data.slug, name: data.name, tagline: "test", data, cards: orderedCards(data) });
const raw = (value) => Buffer.from(JSON.stringify(value)).toString("base64url");
const legacy = () => ({ v: 1, d: sample.slug, s: "single", q: "", c: [[0, 0]] });
const reverseKeys = (value) => Array.isArray(value) ? value.map(reverseKeys) : value && typeof value === "object"
  ? Object.fromEntries(Object.entries(value).reverse().map(([k, v]) => [k, reverseKeys(v)])) : value;
const mutate = (fn) => { const data = structuredClone(sample); fn(data); return data; };

for (const entry of readdirSync(corpus, { withFileTypes: true }).filter((e) => e.isDirectory())) {
  test(`portable contract: ${entry.name}`, () => {
    const data = JSON.parse(readFileSync(new URL(`${entry.name}/deck.json`, corpus), "utf8"));
    assert.deepEqual(validateDeck(data), { ok: true, data });
    assert.deepEqual(orderedCards(data).map((c) => c.slug), orderedCards(reverseKeys(data)).map((c) => c.slug));
  });
}

test("invalid root JSON never throws", () => {
  for (const value of [null, [], true, 7, "string", {}, { cards: null }, { cards: [] }]) assert.equal(loadCustomDeck(JSON.stringify(value)).ok, false);
  assert.equal(loadCustomDeck("{").ok, false);
  assert.equal(loadCustomDeck(" ".repeat(5_000_001)).ok, false);
});

test("validate every card, not only the first", () => {
  const data = mutate((d) => { d.cards[Object.keys(d.cards)[1]].meaning = null; });
  assert.equal(loadCustomDeck(JSON.stringify(data)).ok, false);
});

for (const [name, fn] of Object.entries({
  "key/slug mismatch": (d) => { Object.values(d.cards)[0].slug = "wrong"; },
  "unknown station": (d) => { Object.values(d.cards)[0].station_slug = "missing"; },
  "inherited station": (d) => { Object.values(d.cards)[0].station_slug = "toString"; },
  "unknown suit": (d) => { Object.values(d.cards).find((c) => c.arcana === "minor").suit_slug = "missing"; },
  "unknown rank": (d) => { Object.values(d.cards).find((c) => c.arcana === "minor").rank_slug = "missing"; },
  "invalid theme": (d) => { d.theme.description = 42; },
  "duplicate axis index": (d) => { Object.values(d.suits)[1].index = Object.values(d.suits)[0].index; },
  "invalid rank number": (d) => { Object.values(d.ranks)[0].numeric_value = -1; },
  "invalid meaning": (d) => { Object.values(d.cards)[0].meaning.inverted = []; },
  "invalid brief": (d) => { Object.values(d.cards)[0].visuals = null; },
  "invalid factorization": (d) => { Object.values(d.cards)[0].factorization = { character: "anything", gloss: "x" }; },
  "invalid dialectic": (d) => { d.dialectic.axes[0].poles = ["one"]; },
})) test(`reject ${name}`, () => assert.equal(validateDeck(mutate(fn)).ok, false));

test("imports cannot overwrite an existing registry entry", () => {
  const original = registerDeck(moduleFor());
  assert.equal(loadCustomDeck(JSON.stringify(sample)).ok, false);
  assert.equal(getDeck(original.id), original);
  const custom = mutate((d) => { d.slug = "import-test"; });
  const result = loadCustomDeck(JSON.stringify(reverseKeys(custom)));
  assert.equal(result.ok, true);
  assert.deepEqual(result.deck.cards.map((c) => c.slug), orderedCards(custom).map((c) => c.slug));
});

test("v2 preserves Unicode, orientations, slugs, and the spread", async () => {
  const deck = moduleFor();
  const spread = structuredClone(GENERIC_SPREADS[1]);
  const cards = [{ index: 0, reversed: false }, { index: 10, reversed: true }, { index: 77, reversed: false }];
  const encoded = await encodeReading(deck, spread, "Що далі? 🌙 — 日本語", cards);
  assert.match(encoded, /^[A-Za-z0-9_-]+$/);
  const token = decodeReading(encoded);
  assert.equal(token.v, 2);
  assert.equal(token.c[0][0], deck.cards[0].slug);
  const result = await resolveReading(token, deck);
  assert.deepEqual(result, { ok: true, spread, dealt: cards, question: "Що далі? 🌙 — 日本語", legacy: false });
  spread.positions[0].name = "Changed later";
  assert.notEqual(token.s.positions[0].name, spread.positions[0].name);
});

test("reordered JSON and display arrays preserve the same reading", async () => {
  const deck = moduleFor();
  const token = decodeReading(await encodeReading(deck, "single", "", [{ index: 0, reversed: true }]));
  const reordered = moduleFor(reverseKeys(deck.data));
  reordered.cards.reverse();
  assert.equal(await deckRevision(deck.data), await deckRevision(reordered.data));
  const result = await resolveReading(token, reordered);
  assert.equal(result.ok, true);
  assert.equal(reordered.cards[result.dealt[0].index].slug, deck.cards[0].slug);
  assert.equal(result.dealt[0].reversed, true);
});

test("changed content fails closed even when the author forgot to bump version", async () => {
  const deck = moduleFor();
  const token = decodeReading(await encodeReading(deck, "single", "", [{ index: 0, reversed: false }]));
  deck.data.cards[deck.cards[0].slug].meaning.upright += " Changed.";
  const result = await resolveReading(token, deck);
  assert.equal(result.ok, false);
  assert.match(result.error, /revision/);
});

test("valid v1 links resolve but are explicitly marked legacy", async () => {
  const deck = moduleFor();
  const token = decodeReading(raw(legacy()));
  assert.deepEqual(tokenToDealt(token, deck), [{ index: 0, reversed: false }]);
  assert.equal((await resolveReading(token, deck)).legacy, true);
});

for (const [name, change] of Object.entries({
  "null tuple": (t) => { t.c = [null]; },
  "non-array tuple": (t) => { t.c = [7]; },
  "short tuple": (t) => { t.c = [[0]]; },
  "long tuple": (t) => { t.c = [[0, 0, 0]]; },
  "negative index": (t) => { t.c = [[-1, 0]]; },
  "fractional index": (t) => { t.c = [[0.5, 0]]; },
  "string index": (t) => { t.c = [["0", 0]]; },
  "invalid reversal": (t) => { t.c = [[0, 2]]; },
  "boolean reversal": (t) => { t.c = [[0, true]]; },
  "duplicate card": (t) => { t.c = [[0, 0], [0, 1]]; },
  "empty cards": (t) => { t.c = []; },
  "invalid question": (t) => { t.q = null; },
  "oversized question": (t) => { t.q = "x".repeat(4001); },
  "unknown format": (t) => { t.v = 3; },
  "invalid inline spread": (t) => { t.s = { id: "x", positions: [null] }; },
})) test(`malformed token: ${name}`, async () => {
  const token = legacy(); change(token);
  assert.equal(decodeReading(raw(token)), null);
  assert.equal(tokenToDealt(token, moduleFor()), null);
  assert.equal((await resolveReading(token, moduleFor())).ok, false);
});

test("bad encodings and oversized links are rejected", () => {
  for (const value of ["", "!!!", "a", "x".repeat(65537), raw(null), Buffer.from([255]).toString("base64url")]) assert.equal(decodeReading(value), null);
});

test("deck, spread, count, and card bounds are checked before rendering", async () => {
  for (const change of [
    (t) => { t.d = "other-deck"; },
    (t) => { t.s = "unknown"; },
    (t) => { t.s = "three-card"; },
    (t) => { t.c = [[99999, 0]]; },
    (t) => { t.s = { ...GENERIC_SPREADS[0], deckId: "other" }; },
  ]) { const token = legacy(); change(token); assert.equal((await resolveReading(token, moduleFor())).ok, false); }
});

test("v2 validates revisions and referenced slugs", async () => {
  const deck = moduleFor();
  const token = decodeReading(await encodeReading(deck, "single", "", [{ index: 0, reversed: false }]));
  assert.equal(decodeReading(raw({ ...token, r: "invalid" })), null);
  assert.equal(decodeReading(raw({ ...token, c: [[0, 0]] })), null);
  assert.equal((await resolveReading({ ...token, c: [["missing", 0]] }, deck)).ok, false);
});

test("encoder rejects bad deals rather than publishing broken URLs", async () => {
  const deck = moduleFor();
  await assert.rejects(encodeReading(deck, "single", "", []));
  await assert.rejects(encodeReading(deck, "single", "", [{ index: -1, reversed: false }]));
  await assert.rejects(encodeReading(deck, "single", "x".repeat(4001), [{ index: 0, reversed: false }]));
  await assert.rejects(encodeReading(deck, "three-card", "", Array(3).fill({ index: 0, reversed: false })));
});

test("deals are complete, distinct, bounded, and honor reversal rates", () => {
  for (const rate of [0, 1]) {
    const cards = deal(GENERIC_SPREADS[1], 3, rate);
    assert.equal(cards.length, 3);
    assert.equal(new Set(cards.map((c) => c.index)).size, 3);
    assert.ok(cards.every((c) => c.index >= 0 && c.index < 3 && c.reversed === !!rate));
  }
  for (const n of [0, 2, -1, 3.5, NaN]) assert.throws(() => deal(GENERIC_SPREADS[1], n));
  for (const rate of [-1, 2, NaN]) assert.throws(() => deal(GENERIC_SPREADS[0], 4, rate));
});
