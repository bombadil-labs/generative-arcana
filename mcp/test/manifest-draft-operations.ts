import assert from "node:assert/strict";
import * as z from "zod/v4";
import { inspectStagedManifest } from "../src/manifestDiagnostics.js";
import {
  INITIAL_DRAFT_JSON, MAX_DRAFT_READ_BYTES, MAX_DRAFT_UPDATE_BYTES,
  applyDraftUpdate, canonicalDraftJson, draftReadSchema, draftSummary, draftUpdateSchema, readDraftPart,
} from "../src/manifestDraftOperations.js";
import { neutralManifest } from "./protocol-fixtures.js";

const draftId = "82f5a10a-2fbb-4b95-bd80-2f33c76c42a3";
const base = { draftId, expectedVersion: 1, mutationId: "chunk-1" };
const update = (input: object) => ({ ...base, ...input });
const fixture = neutralManifest();
const sampleCard = fixture.data.cards["major-0"];

// The protocol advertises a real object schema, including typed card/axis fields.
const advertised = z.toJSONSchema(draftUpdateSchema, { io: "input" });
assert.equal(advertised.type, "object");
assert.match(JSON.stringify(advertised), /station_slug/);
assert.match(JSON.stringify(advertised), /visual_environment/);

function rejects(input: unknown, pattern: RegExp = /./) {
  assert.equal(draftUpdateSchema.safeParse(input).success, false);
  assert.throws(() => applyDraftUpdate(INITIAL_DRAFT_JSON, input), pattern);
}

function assembledDeck() {
  // Entirely synthetic 22 + 4*14 deck; no shipped authored deck content is loaded.
  const manifest = neutralManifest("synthetic-incremental");
  manifest.data.cards = {};
  manifest.data.suits = {};
  manifest.data.ranks = {};
  for (let suit = 0; suit < 4; suit++) manifest.data.suits[`suit-${suit}`] = { name: `Suit ${suit}`, index: suit, symbol: { name: "Shape", svg: "<svg/>" }, visual_grammar: { composition: "A quiet line." }, custom_axis: { order: [3, 1, 2] } };
  for (let rank = 1; rank <= 14; rank++) manifest.data.ranks[`rank-${rank}`] = { name: `Rank ${rank}`, index: rank - 1, numeric_value: rank, symbol: String(rank), arcana: "minor", visual_form: { rhythm: "Even marks." } };
  for (let major = 0; major < 22; major++) manifest.data.cards[`major-${major}`] = { ...sampleCard, slug: `major-${major}`, number: String(major), name: `Shape ${major}` };
  for (let suit = 0; suit < 4; suit++) for (let rank = 1; rank <= 14; rank++) {
    const slug = `suit-${suit}-rank-${rank}`;
    manifest.data.cards[slug] = { ...sampleCard, slug, name: `Mark ${suit}/${rank}`, arcana: "minor", number: String(rank), suit_slug: `suit-${suit}`, rank_slug: `rank-${rank}` };
  }
  manifest.spreads = [{ id: "shape-route", deckId: manifest.data.slug, name: "Shape route", description: "Three original positions.", positions: [{ name: "Here", prompt: "Observe." }, { name: "Near", prompt: "Compare." }, { name: "Next", prompt: "Choose." }] }];
  manifest.data.visual_language = { ...manifest.data.visual_language, mark_making: "Small strokes.", signature_accent: "One dark mark.", finish: "Matte." };
  manifest.data.major_arcana = { ...manifest.data.major_arcana, visual_style: "Simple geometry.", symbol: { name: "Circle", description: "One outline.", svg: "<svg/>" } };
  manifest.data.transversal.ordering_rationale = "One shared station.";
  manifest.data.transversal.suit_stride = 1;
  manifest.data.extra_authoring_profile = { z: true, a: [2, 1] };
  const { cards, suits, ranks, transversal, ...metadata } = manifest.data;
  const { stations, ...transversalMetadata } = transversal;
  let json = INITIAL_DRAFT_JSON;
  let version = 1;
  const apply = (edits: object) => { json = applyDraftUpdate(json, { draftId, expectedVersion: version, mutationId: `part-${version++}`, ...edits }); };
  apply({ metadata: { schemaVersion: 2, tagline: manifest.tagline, data: metadata } });
  assert.equal(inspectStagedManifest(json).ok, false, "private drafts may be incomplete");
  // Cross-references are intentionally unresolved until later chunks.
  const cardList = Object.values(cards);
  for (let offset = 0; offset < cardList.length; offset += 20) apply({ cards: { upsert: cardList.slice(offset, offset + 20) } });
  assert.equal(inspectStagedManifest(json).ok, false, "unresolved card axes are allowed before commit");
  for (const [section, entries] of Object.entries({ suits, ranks, stations })) apply({ [section]: { upsert: Object.entries(entries).map(([key, value]) => ({ key, value })) } });
  apply({ transversal: transversalMetadata, spreads: { upsert: manifest.spreads } });
  assert.deepEqual(JSON.parse(json), manifest);
  assert.equal(inspectStagedManifest(json).ok, true, "all chunks assemble into a canonical, valid native-spread deck");
  assert.deepEqual(draftSummary(json), { cardCount: 78, suitCount: 4, rankCount: 14, stationCount: 1, spreadCount: 1, byteLength: Buffer.byteLength(json) });
  assert.deepEqual(readDraftPart(json, { draftId }), draftSummary(json), "default read returns counts only");
  const seen: string[] = [];
  let offset = 0;
  do {
    const result = readDraftPart(json, { draftId, section: "cards", offset, limit: 20 });
    assert.ok("entries" in result);
    assert.ok(result.entries.length <= 20);
    assert.ok(Buffer.byteLength(JSON.stringify(result)) <= MAX_DRAFT_READ_BYTES);
    seen.push(...result.entries.map(entry => entry.key));
    if (result.nextOffset === null) break;
    offset = result.nextOffset;
  } while (true);
  assert.deepEqual(seen, Object.keys(cards).sort());
  assert.throws(() => readDraftPart(json, { draftId, section: "cards", keys: ["absent"] }), /Unknown/);
  assert.equal(draftReadSchema.safeParse({ draftId, limit: 20 }).success, false);
  assert.equal(draftReadSchema.safeParse({ draftId, section: "cards", limit: 21 }).success, false);
  assert.equal(draftReadSchema.safeParse({ draftId, section: "cards", keys: ["same", "same"] }).success, false);
  return json;
}

let json = assembledDeck();
const extendedCard = { ...sampleCard, extension: { nested: ["😀", { retained: true }] }, meaning: { ...sampleCard.meaning, annotation: "Retained" }, visuals: { ...sampleCard.visuals, custom_rendering: "Retained" } };
json = applyDraftUpdate(json, update({ cards: { upsert: [extendedCard] }, metadata: { data: { extension: { value: 1 } } }, transversal: { extension: { value: 2 } } }));
assert.deepEqual(JSON.parse(json).data.cards[extendedCard.slug], extendedCard, "all card and nested extensions survive");
json = applyDraftUpdate(json, update({ cards: { upsert: [sampleCard], remove: ["major-1"] }, metadata: { remove: ["extension"] }, transversalRemove: ["extension"] }));
assert.deepEqual(JSON.parse(json).data.cards[sampleCard.slug], sampleCard, "whole-value replacement removes omitted optional extensions");
assert.equal(JSON.parse(json).data.cards["major-1"], undefined);
assert.equal(JSON.parse(json).data.extension, undefined);
assert.equal(JSON.parse(json).data.transversal.extension, undefined);
assert.throws(() => applyDraftUpdate(json, update({ cards: { remove: ["absent"] } })), /Unknown cards/);
assert.throws(() => applyDraftUpdate(json, update({ metadata: { remove: ["absent"] } })), /Unknown metadata/);

const spreadA = { id: "z-route", name: "Z", description: "", positions: [{ name: "Center", prompt: "" }], extension: { kept: true } };
const spreadB = { ...spreadA, id: "a-route" };
json = applyDraftUpdate(json, update({ spreads: { upsert: [spreadA, spreadB] } }));
json = applyDraftUpdate(json, update({ spreads: { upsert: [{ ...spreadA, name: "Corrected" }], remove: ["shape-route"] } }));
assert.deepEqual(JSON.parse(json).spreads.map((spread: { id: string }) => spread.id), ["z-route", "a-route"], "spread order is preserved, including replacements");
const spreadRead = readDraftPart(json, { draftId, section: "spreads" });
assert.ok("entries" in spreadRead);
assert.deepEqual(spreadRead.entries.map(entry => entry.key), ["z-route", "a-route"]);
assert.equal(canonicalDraftJson({ z: 1, a: { y: 2, b: 1 }, array: [2, 1], "10": true, "2": false }), '{"10":true,"2":false,"a":{"b":1,"y":2},"array":[2,1],"z":1}');

for (const bad of [
  {}, update({}), update({ unknown: true }), update({ expectedVersion: 0, metadata: { tagline: "x" } }),
  update({ draftId: "bad", metadata: { tagline: "x" } }), update({ mutationId: "bad key", metadata: { tagline: "x" } }),
  update({ metadata: { data: { cards: {} } } }), update({ metadata: { remove: ["ranks"] } }),
  update({ transversal: { stations: {} } }), update({ transversalRemove: ["stations"] }),
  update({ metadata: { data: { name: "x" }, remove: ["name"] } }),
  update({ cards: { upsert: [sampleCard], remove: [sampleCard.slug] } }),
  update({ suits: { upsert: [{ key: "lines", value: { name: "Lines", index: 0, slug: "other" } }] } }),
  update({ ranks: { upsert: [{ key: "first", value: { name: "First", index: 0, symbol: {} } }] } }),
  update({ stations: { upsert: [{ key: "still", value: { name: "Still", index: 0, meaning: { upright: "wrong", inverted: [] } } }] } }),
  update({ cards: { upsert: [{ ...sampleCard, arcana: "minor" }] } }),
  update({ cards: { upsert: [{ ...sampleCard, suit_slug: "lines" }] } }),
  update({ cards: { upsert: [{ ...sampleCard, number: "01" }] } }),
  update({ metadata: { data: { theme: { name: "No missing required local fields" } } } }),
  update({ spreads: { upsert: [{ ...spreadA, positions: [] }] } }),
  update({ metadata: { data: Object.fromEntries(Array.from({ length: 21 }, (_, i) => [`field-${i}`, true])) } }),
  update({ cards: { remove: Array.from({ length: 20 }, (_, i) => `card-${i}`) }, metadata: { tagline: "one more" } }),
  update({ metadata: { data: { extension: "x\0" } } }), update({ metadata: { data: { extension: "x\ud800" } } }),
  update({ metadata: { data: { extension: { constructor: true } } } }),
  update({ cards: { upsert: [{ ...sampleCard, extension: { prototype: {} } }] } }),
]) rejects(bad);

for (const location of ["data", "card", "nested"]) {
  const malicious = JSON.parse('{"__proto__":{"polluted":true}}');
  rejects(location === "data" ? update({ metadata: { data: malicious } }) : location === "card" ? update({ cards: { upsert: [{ ...sampleCard, ...malicious }] } }) : update({ metadata: { data: { extension: malicious } } }), /Unsafe object key/);
}
rejects(update({ metadata: { data: { extension: "é".repeat(MAX_DRAFT_UPDATE_BYTES / 2) } } }), /UTF-8 JSON bytes/);
let deep: unknown = "leaf";
for (let i = 0; i < 130; i++) deep = { next: deep };
rejects(update({ metadata: { data: { extension: deep } } }), /nesting/);
for (const bad of [NaN, Infinity, 1n, undefined, () => 1, new Date(), new Map(), Object.create({ inherited: true }), [undefined], Array(2)]) assert.throws(() => canonicalDraftJson(bad));
const cyclic: Record<string, unknown> = {};
cyclic.self = cyclic;
assert.throws(() => canonicalDraftJson(cyclic), /cycles/);
assert.throws(() => canonicalDraftJson(Array(100_000).fill(null)), /nodes/);
assert.throws(() => canonicalDraftJson({ large: "x".repeat(2_000_000) }), /UTF-8 JSON bytes/);
assert.throws(() => canonicalDraftJson({ get accessor() { throw new Error("Accessor must not be called"); } }), /accessors/);
assert.equal(canonicalDraftJson({ text: "paired 😀 Unicode" }), '{"text":"paired 😀 Unicode"}');

// Accumulated output is bounded independently from each small update; read pages shrink to fit.
let large = INITIAL_DRAFT_JSON;
for (let i = 0; i < 33; i++) large = applyDraftUpdate(large, update({ metadata: { data: { [`extension-${i}`]: "x".repeat(60_000) } } }));
assert.throws(() => applyDraftUpdate(large, update({ metadata: { data: { extra: "x".repeat(60_000) } } })), /UTF-8 JSON bytes/);
const largeRead = readDraftPart(large, { draftId, section: "metadata", keys: ["data.extension-0", "data.extension-1"], limit: 20 });
assert.ok("entries" in largeRead);
assert.equal(largeRead.entries.length, 1);
assert.equal(largeRead.nextOffset, 1);
assert.ok(Buffer.byteLength(JSON.stringify(largeRead)) <= MAX_DRAFT_READ_BYTES);
const remainder = readDraftPart(large, { draftId, section: "metadata", keys: ["data.extension-0", "data.extension-1"], offset: 1 });
assert.ok("entries" in remainder);
assert.equal(remainder.entries[0].key, "data.extension-1");
assert.equal(remainder.nextOffset, null);
console.log("Incremental semantic draft assembly, typed local checks, preserved extensions, deterministic order and bounded reads passed.");
