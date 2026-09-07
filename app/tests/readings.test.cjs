const { test } = require("node:test");
const assert = require("node:assert/strict");
const { webcrypto, createHash } = require("node:crypto");
globalThis.crypto ??= webcrypto;
const { encodeReading, decodeReading, resolveReading, deckFingerprint } = require("../.test-build/reading/encode.js");
const { deal } = require("../.test-build/reading/deal.js");
const { GENERIC_SPREADS } = require("../.test-build/decks/spreads.js");
const { rawDeck, moduleFor, pack, legacy } = require("./fixtures.cjs");

for (const encoded of ["", "no!", "a", "a".repeat(65_537), pack(null), pack([]), Buffer.from([0xff]).toString("base64url")]) {
  test(`malformed encoding (${encoded.length} characters) is rejected`, () => assert.equal(decodeReading(encoded), null));
}
const bad = [
  { v: 3 }, { d: null }, { q: {} }, { q: "a".repeat(4_001) }, { s: null },
  { s: { id: "inline", name: "Spread", description: "", positions: [null] } },
  { s: { id: "inline", name: "Spread", description: "", positions: [] } },
  { s: { id: "inline", name: "Spread", description: "", positions: [{ name: 1, prompt: "" }] } },
  { c: [] }, { c: [null] }, { c: [[0]] }, { c: [[0, 0, 0]] }, { c: [[0, true]] },
  { c: [[0, 2]] }, { c: [[-1, 0]] }, { c: [[0.5, 0]] }, { c: [["0", 0]] },
  { c: [[Number.MAX_SAFE_INTEGER + 1, 0]] }, { c: [[0, 0], [0, 1]] },
];
for (let i = 0; i < bad.length; i++) {
  test(`malformed legacy payload ${i + 1} is rejected`, () => {
    assert.equal(decodeReading(pack(legacy(moduleFor(), bad[i]))), null);
  });
}
test("valid v1 built-in links resolve indices into stable identities and carry a legacy warning flag", async () => {
  const deck = moduleFor();
  const token = decodeReading(pack(legacy(deck, { c: [[12, 1]] })));
  const result = await resolveReading(token, deck);
  assert.equal(result.ok, true, result.error);
  assert.equal(result.legacy, true);
  assert.deepEqual(result.dealt, [{ slug: deck.cards[12].slug, reversed: true }]);
});
test("legacy custom-deck links are not silently reinterpreted", async () => {
  const deck = moduleFor(rawDeck(), true);
  const result = await resolveReading(legacy(deck), deck);
  assert.equal(result.ok, false); assert.match(result.error, /original order cannot be verified/);
});
test("legacy indices must fall inside the loaded deck", async () => {
  const deck = moduleFor();
  assert.equal((await resolveReading(legacy(deck, { c: [[deck.cards.length, 0]] }), deck)).ok, false);
});
test("route, spread, and card-count mismatches fail before rendering", async () => {
  const deck = moduleFor();
  for (const overrides of [{ d: "other-deck" }, { s: "unknown" }, { s: "three-card" }]) {
    assert.equal((await resolveReading(legacy(deck, overrides), deck)).ok, false);
  }
});
test("resolveReading independently guards malformed callers", async () => {
  assert.equal((await resolveReading({ v: 1, c: [null] }, moduleFor())).ok, false);
});
test("v2 round trip preserves Unicode, slugs, orientation and spread positions", async () => {
  const deck = moduleFor();
  const dealt = [{ slug: deck.cards[0].slug, reversed: false }, { slug: deck.cards[30].slug, reversed: true }, { slug: deck.cards[77].slug, reversed: false }];
  const encoded = await encodeReading(deck, "three-card", "Що далі? 🌙 café", dealt);
  const token = decodeReading(encoded);
  assert.equal(token.v, 2);
  assert.equal(token.q, "Що далі? 🌙 café");
  assert.equal(token.c[1][0], deck.cards[30].slug);
  assert.equal(typeof token.s, "object");
  const result = await resolveReading(token, deck);
  assert.equal(result.ok, true, result.error);
  assert.equal(result.legacy, false);
  assert.deepEqual(result.dealt, dealt);
});
test("SHA-256 digest uses canonical JSON, not an order-sensitive serialization", async () => {
  const deck = moduleFor();
  const canonical = (v) => Array.isArray(v) ? v.map(canonical) : v !== null && typeof v === "object" ? Object.fromEntries(Object.keys(v).sort().map((k) => [k, canonical(v[k])])) : v;
  const expected = createHash("sha256").update(JSON.stringify(canonical(deck.data))).digest("hex");
  assert.equal(await deckFingerprint(deck), expected);
});
test("reordered JSON and card arrays resolve to exactly the same card identities", async () => {
  const deck = moduleFor(rawDeck(), true);
  const token = decodeReading(await encodeReading(deck, "single", "", [{ slug: deck.cards[0].slug, reversed: true }]));
  const data = structuredClone(deck.data);
  for (const k of ["cards", "ranks", "suits"]) data[k] = Object.fromEntries(Object.entries(data[k]).reverse());
  data.theme = Object.fromEntries(Object.entries(data.theme).reverse());
  const reordered = moduleFor(data, true);
  reordered.cards.reverse();
  assert.equal(await deckFingerprint(deck), await deckFingerprint(reordered));
  const result = await resolveReading(token, reordered);
  assert.equal(result.ok, true, result.error);
  assert.equal(result.dealt[0].slug, deck.cards[0].slug);
  assert.equal(result.dealt[0].reversed, true);
});
test("content edits with an unchanged version string invalidate old readings", async () => {
  const deck = moduleFor();
  const token = decodeReading(await encodeReading(deck, "single", "", [{ slug: deck.cards[0].slug, reversed: false }]));
  const changed = moduleFor(structuredClone(deck.data));
  changed.data.cards["major-0"].meaning.upright += " Changed.";
  assert.equal(changed.data.version, deck.data.version);
  const result = await resolveReading(token, changed);
  assert.equal(result.ok, false); assert.match(result.error, /different revision/);
});
test("reading uses its saved spread, not a later edited native spread", async () => {
  const deck = moduleFor();
  const spread = { id: "native", name: "Native", description: "Original", deckId: deck.id, positions: [{ name: "First", prompt: "Original prompt" }] };
  deck.spreads = [spread];
  const token = decodeReading(await encodeReading(deck, "native", "", [{ slug: deck.cards[0].slug, reversed: false }]));
  spread.positions[0].prompt = "Changed prompt";
  const result = await resolveReading(token, deck);
  assert.equal(result.ok, true, result.error);
  assert.equal(result.spread.positions[0].prompt, "Original prompt");
});
test("malformed v2 digest, slug, reversal, spread, and duplicate identities are rejected", async () => {
  const deck = moduleFor();
  const token = decodeReading(await encodeReading(deck, "single", "", [{ slug: deck.cards[0].slug, reversed: false }]));
  for (const overrides of [{ h: "bad" }, { c: [[0, 0]] }, { c: [["bad slug", 0]] }, { c: [["major-0", false]] }, { s: "single" }, { c: [["major-0", 0], ["major-0", 1]] }]) {
    assert.equal(decodeReading(pack({ ...token, ...overrides })), null);
  }
});
test("v2 missing identities, foreign routes and foreign spreads are rejected", async () => {
  const deck = moduleFor();
  const token = decodeReading(await encodeReading(deck, "single", "", [{ slug: deck.cards[0].slug, reversed: false }]));
  for (const overrides of [{ c: [["missing", 0]] }, { d: "other" }, { s: { ...token.s, deckId: "other" } }, { s: GENERIC_SPREADS[1] }]) {
    assert.equal((await resolveReading({ ...token, ...overrides }, deck)).ok, false);
  }
});
test("encoder refuses partial, repeated, missing, and invalid-orientation deals", async () => {
  const deck = moduleFor();
  const slug = deck.cards[0].slug;
  await assert.rejects(encodeReading(deck, "three-card", "", [{ slug, reversed: false }]));
  await assert.rejects(encodeReading(deck, "three-card", "", Array(3).fill({ slug, reversed: false })));
  for (const card of [{ slug: "missing", reversed: false }, { slug: "bad slug", reversed: false }, { slug, reversed: 0 }]) {
    await assert.rejects(encodeReading(deck, "single", "", [card]));
  }
  await assert.rejects(encodeReading(deck, "unknown", "", [{ slug, reversed: false }]));
});
test("dealing fills every position with a unique stable card identity", () => {
  const slugs = Array.from({ length: 78 }, (_, i) => `card-${i}`);
  const dealt = deal(GENERIC_SPREADS[2], slugs);
  assert.equal(dealt.length, 10);
  assert.equal(new Set(dealt.map((c) => c.slug)).size, 10);
  assert.ok(dealt.every((c) => slugs.includes(c.slug) && typeof c.reversed === "boolean"));
  assert.ok(deal(GENERIC_SPREADS[2], slugs.slice(0, 10), 0).every((c) => !c.reversed));
  assert.ok(deal(GENERIC_SPREADS[2], slugs.slice(0, 10), 1).every((c) => c.reversed));
});
test("small or identity-invalid decks fail instead of creating partial readings", () => {
  for (const slugs of [[], ["a"], ["a", "b"]]) assert.throws(() => deal(GENERIC_SPREADS[1], slugs));
  assert.throws(() => deal(GENERIC_SPREADS[0], ["a", "a"]));
  assert.throws(() => deal(GENERIC_SPREADS[0], [""]));
  for (const rate of [-1, 2, NaN]) assert.throws(() => deal(GENERIC_SPREADS[0], ["a"], rate));
});
