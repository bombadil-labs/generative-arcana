import assert from "node:assert/strict";
import { test } from "node:test";
import { validateDeckManifest } from "../../app/src/decks/manifest";
import {
  inspectStagedManifest,
  MAX_MANIFEST_DIAGNOSTICS,
  MAX_MANIFEST_DIAGNOSTIC_MESSAGE,
  MAX_MANIFEST_DIAGNOSTIC_PATH,
  MAX_STAGED_MANIFEST_DEPTH,
  MAX_STAGED_MANIFEST_NODES,
  type StagedManifestInspection,
} from "../src/manifestDiagnostics";

type JsonRecord = Record<string, any>;
function fixture(): JsonRecord {
  return {
    schemaVersion: 2,
    tagline: "Diagnostic fixture",
    data: {
      name: "Fixture", slug: "fixture", version: "1.0.0",
      theme: { name: "Theme", description: "", creator: "" },
      suits: { alpha: { name: "Alpha", index: 0 } },
      ranks: { first: { name: "First", index: 0 } },
      transversal: { name: "Stations", description: "", stations: { now: { name: "Now", index: 0 } } },
      major_arcana: {},
      cards: {
        "alpha-first": {
          slug: "alpha-first", name: "Alpha First", number: "1", arcana: "minor",
          suit_slug: "alpha", rank_slug: "first", station_slug: "now",
          meaning: { upright: "Up", inverted: "Down" }, visuals: { detailed_description: "" },
        },
        "major-zero": {
          slug: "major-zero", name: "Major Zero", number: "0", arcana: "major", station_slug: "now",
          meaning: { upright: "Up", inverted: "Down" }, visuals: { detailed_description: "" },
        },
      },
    },
    spreads: [{ id: "native", name: "Native", description: "", positions: [{ name: "Here", prompt: "" }] }],
  };
}
function inspect(value: unknown) { return inspectStagedManifest(JSON.stringify(value)); }
function invalid(result: StagedManifestInspection): Extract<StagedManifestInspection, { ok: false }> {
  assert.equal(result.ok, false);
  if (result.ok) throw new Error("Expected invalid manifest");
  assert.equal("manifest" in result, false, "invalid input never returns a usable manifest");
  return result;
}
function paths(result: StagedManifestInspection) { return new Set(invalid(result).errors.map(error => error.path)); }

test("canonical and legacy manifests use exactly the authoritative normalized snapshot", () => {
  for (const schemaVersion of [undefined, 1, 2]) {
    const raw = fixture();
    raw.schemaVersion = schemaVersion;
    raw.data.extension = { arbitrary: [false, 0, null, { preserved: "yes" }] };
    const result = inspect(raw);
    assert.equal(result.ok, true);
    if (!result.ok) throw new Error("Expected valid fixture");
    const canonical = validateDeckManifest(raw);
    assert.equal(canonical.ok, true);
    if (!canonical.ok) throw new Error("Expected authoritative validation to succeed");
    assert.deepEqual(result.manifest, canonical.manifest);
    assert.equal(result.manifest.schemaVersion, 2);
    assert.equal(result.manifest.spreads?.[0].deckId, "fixture");
    assert.equal(result.sourceSchemaVersion, schemaVersion ?? 1);
    assert.equal(result.migrated, schemaVersion !== 2);
    assert.deepEqual(result.errors, []);
    assert.equal(result.errorsTruncated, false);
    assert.ok(Object.isFrozen(result.manifest.data.cards));
  }
});

test("invalid JSON and invalid root objects have bounded root diagnostics", () => {
  for (const json of ["", "{", "[}", '{"data":']) {
    assert.deepEqual(inspectStagedManifest(json), {
      ok: false, errors: [{ path: "$", message: "Manifest is not valid JSON." }], errorsTruncated: false,
    });
  }
  for (const value of [null, [], false, 4, "string"]) {
    assert.deepEqual(invalid(inspect(value)).errors, [{ path: "$", message: "Must be an object." }]);
  }
});

test("collects independent envelope, card, axis, and spread errors together", () => {
  const raw = fixture();
  raw.schemaVersion = 42;
  raw.tagline = " ";
  raw.data.theme.name = "";
  raw.data.theme.creator = 4;
  raw.data.suits.alpha.name = false;
  raw.data.ranks.first.index = 3;
  raw.data.transversal.stations.now.description = 8;
  raw.data.cards["alpha-first"].name = "";
  raw.data.cards["alpha-first"].suit_slug = "absent";
  raw.data.cards["alpha-first"].rank_slug = "missing";
  raw.data.cards["alpha-first"].station_slug = "lost";
  raw.data.cards["major-zero"].number = "01";
  raw.data.cards["major-zero"].meaning = { upright: "", inverted: null };
  raw.spreads[0].deckId = "another-deck";
  raw.spreads[0].positions[0] = { name: "", prompt: 4 };
  raw.spreads.push({ id: "native", name: "", description: 1, positions: [] });
  raw.spreads.push({ id: "single", name: "Collision", description: "", positions: [{ name: "Here", prompt: "" }] });
  const result = invalid(inspect(raw));
  assert.equal(result.errorsTruncated, false);
  const actualPaths = paths(result);
  for (const path of [
    "$.schemaVersion", "$.tagline", "$.data.theme.name", "$.data.theme.creator",
    "$.data.suits.alpha.name", "$.data.ranks", "$.data.transversal.stations.now.description",
    '$.data.cards["alpha-first"].name', '$.data.cards["alpha-first"].suit_slug',
    '$.data.cards["alpha-first"].rank_slug', '$.data.cards["alpha-first"].station_slug',
    '$.data.cards["major-zero"].number', '$.data.cards["major-zero"].meaning.upright',
    '$.data.cards["major-zero"].meaning.inverted', "$.spreads[0].deckId",
    "$.spreads[0].positions[0].name", "$.spreads[0].positions[0].prompt",
    "$.spreads[1].id", "$.spreads[1].name", "$.spreads[1].description", "$.spreads[1].positions", "$.spreads[2].id",
  ]) assert.ok(actualPaths.has(path), `Missing diagnostic ${path}`);
});

test("invalid envelope and data containers do not hide unrelated spread diagnostics", () => {
  const result = invalid(inspect({ schemaVersion: [], tagline: null, data: null, spreads: [null, { id: "single" }] }));
  assert.deepEqual(paths(result), new Set([
    "$.schemaVersion", "$.tagline", "$.data", "$.spreads[0]", "$.spreads[1].id",
    "$.spreads[1].name", "$.spreads[1].description", "$.spreads[1].positions",
  ]));
  assert.deepEqual(paths(inspect({ schemaVersion: 3, tagline: false, spreads: {} })), new Set(["$.data", "$.tagline", "$.schemaVersion", "$.spreads"]));
  // JSON can shadow Object.toString; authoritative error construction must not escape this helper.
  assert.ok(paths(inspect({ ...fixture(), schemaVersion: { toString: null } })).has("$.schemaVersion"));
});

test("optional authored grammar, factorization, numeric ownership, and dialectic fields are inspected", () => {
  const raw = fixture();
  raw.data.minor_number_origin = "rank";
  raw.data.visual_language = { medium: "", avoid: [4, ""] };
  raw.data.suits.alpha.visual_grammar = { finish: false, avoid: null };
  raw.data.suits.alpha.factorization = { character: "other", gloss: false, visual_logic: "", factors: [0, 2.5] };
  raw.data.ranks.first.arcana = "major";
  raw.data.ranks.first.symbol = {};
  raw.data.ranks.first.visual_form = { rhythm: "" };
  raw.data.transversal.stations.now.visual_environment = { illumination: [] };
  raw.data.major_arcana.symbol = { svg: 5 };
  raw.data.dialectic = { axes: [{ name: "", poles: ["yes", "yes"] }, { name: "Other", poles: [false, "no"] }], cells: { unknown: ["yes", "no"] } };
  const actualPaths = paths(inspect(raw));
  for (const path of [
    "$.data.visual_language.medium", "$.data.visual_language.avoid[0]", "$.data.visual_language.avoid[1]",
    "$.data.suits.alpha.visual_grammar.finish", "$.data.suits.alpha.visual_grammar.avoid",
    "$.data.suits.alpha.factorization.character", "$.data.suits.alpha.factorization.gloss",
    "$.data.suits.alpha.factorization.visual_logic", "$.data.suits.alpha.factorization.factors[0]", "$.data.suits.alpha.factorization.factors[1]",
    "$.data.ranks.first.arcana", "$.data.ranks.first.symbol", "$.data.ranks.first.visual_form.rhythm",
    "$.data.transversal.stations.now.visual_environment.illumination", "$.data.major_arcana.symbol.svg",
    '$.data.cards["alpha-first"].number', "$.data.dialectic.axes[0].name", "$.data.dialectic.axes[0].poles",
    "$.data.dialectic.axes[1].poles[0]", "$.data.dialectic.cells", "$.data.dialectic.cells.unknown",
  ]) assert.ok(actualPaths.has(path), `Missing diagnostic ${path}`);
});

test("axis duplicate indices, card-key ownership, major ownership, and duplicate dialectic cells", () => {
  const raw = fixture();
  raw.data.suits.beta = { name: "Beta", index: 0, slug: "incorrect" };
  raw.data.cards["alpha-first"].slug = "wrong";
  raw.data.cards["major-zero"].suit_slug = "alpha";
  raw.data.dialectic = {
    axes: [{ name: "A", poles: ["left", "right"] }, { name: "B", poles: ["up", "down"] }],
    cells: { alpha: ["left", "up"], beta: ["left", "up"] },
  };
  const actualPaths = paths(inspect(raw));
  for (const path of ["$.data.suits.beta.index", "$.data.suits.beta.slug", '$.data.cards["alpha-first"].slug', '$.data.cards["major-zero"]', "$.data.dialectic.cells.beta"]) assert.ok(actualPaths.has(path), path);
});

test("JSONPath escapes authored keys and never truncates a path into a different property", () => {
  const raw = fixture();
  const key = 'bad.key["quote"]\\x';
  raw.data.cards[key] = { ...raw.data.cards["alpha-first"], slug: key, name: "" };
  assert.ok(paths(inspect(raw)).has(`$.data.cards[${JSON.stringify(key)}].name`));
  const hugeKey = "x".repeat(20_000);
  raw.data.cards = { [hugeKey]: { ...raw.data.cards["alpha-first"], slug: hugeKey, name: "" } };
  const result = invalid(inspect(raw));
  assert.equal(result.errorsTruncated, true);
  assert.ok(result.errors.some(error => error.path === "$.data.cards"));
  assert.equal(result.errors.some(error => error.path === "$.data.cards.name"), false);
  for (const error of result.errors) {
    assert.ok(error.path.length <= MAX_MANIFEST_DIAGNOSTIC_PATH);
    assert.ok(error.message.length <= MAX_MANIFEST_DIAGNOSTIC_MESSAGE);
    assert.equal(error.path.includes("\0"), false);
  }
});

test("error count is capped and accurately signals omitted errors", () => {
  for (const count of [MAX_MANIFEST_DIAGNOSTICS, MAX_MANIFEST_DIAGNOSTICS + 1, 4_000]) {
    const raw = fixture();
    const base = raw.data.cards["alpha-first"];
    raw.data.cards = Object.fromEntries(Array.from({ length: count }, (_, index) => [`card-${index}`, { ...base, slug: `card-${index}`, name: "" }]));
    const result = invalid(inspect(raw));
    assert.equal(result.errors.length, Math.min(count, MAX_MANIFEST_DIAGNOSTICS));
    assert.equal(result.errorsTruncated, count > MAX_MANIFEST_DIAGNOSTICS);
    assert.ok(JSON.stringify(result).length < 100_000);
  }
});

test("overflowing JSON numbers in unrelated extension fields retain their precise paths", () => {
  const json = JSON.stringify(fixture()).replace('"version":"1.0.0"', '"version":"1.0.0","extension":{"overflow":1e400}')
    .replace('"id":"native"', '"id":"native","extension":{"negative":-1e400}');
  const result = invalid(inspectStagedManifest(json));
  assert.deepEqual(paths(result), new Set(["$.data.extension.overflow", "$.spreads[0].extension.negative"]));
  assert.equal(result.errorsTruncated, false);
});

test("deep metadata never overflows the diagnostic collector and work limits are explicit", () => {
  const raw = fixture();
  raw.tagline = "";
  const valid = JSON.stringify(raw);
  const deep = '"extension":' + '['.repeat(60_000) + '0' + ']'.repeat(60_000) + ',';
  const result = invalid(inspectStagedManifest(valid.replace('"data":{', '"data":{' + deep)));
  assert.ok(paths(result).has("$.tagline"));
  assert.equal(result.errorsTruncated, true);
  assert.ok(result.errors.length <= MAX_MANIFEST_DIAGNOSTICS);
});

test("spread position count and independent malformed positions are both reported", () => {
  const raw = fixture();
  raw.spreads[0].positions = Array.from({ length: 513 }, () => ({ name: "Position", prompt: "" }));
  raw.spreads[0].positions[512].prompt = null;
  assert.deepEqual(paths(inspect(raw)), new Set(["$.spreads[0].positions", "$.spreads[0].positions[512].prompt"]));
});

test("PostgreSQL-incompatible decoded NUL and lone surrogates are caught in values and keys", () => {
  const raw = fixture();
  raw.tagline = "NUL\0tagline";
  raw.data.extension = { ["NUL\0key"]: "Valid", high: "\ud800", low: "\udfff", ["lone\ud800key"]: "Valid" };
  raw.spreads[0].extension = "\0";
  // The canonical domain validator alone accepts these; staged JSON must also be storage safe.
  assert.equal(validateDeckManifest(raw).ok, true);
  const result = invalid(inspect(raw));
  assert.deepEqual(paths(result), new Set([
    "$.tagline", '$.data.extension["NUL\\u0000key"]', "$.data.extension.high", "$.data.extension.low",
    '$.data.extension["lone\\ud800key"]', "$.spreads[0].extension",
  ]));
  assert.equal(result.errorsTruncated, false);
  assert.ok(result.errors.some(error => error.message.includes("U+0000")));
  assert.ok(result.errors.some(error => error.message.includes("surrogates")));
});

test("well-formed Unicode including surrogate pairs remains valid", () => {
  const raw = fixture();
  raw.tagline = "☀️ A 🚀 deck";
  raw.data.extension = { ["🚀"]: "𐀀 \uD800\uDC00 \uDBFF\uDFFF" };
  const result = inspect(raw);
  assert.equal(result.ok, true);
});

test("storage-invalid and domain-invalid fields are reported independently", () => {
  const raw = fixture();
  raw.data.extension = "\ud800";
  raw.data.cards["alpha-first"].name = "";
  raw.spreads[0].name = "";
  const result = invalid(inspect(raw));
  assert.deepEqual(paths(result), new Set(["$.data.extension", '$.data.cards["alpha-first"].name', "$.spreads[0].name"]));
});

test("depth and node safety limits reject before recursive normalization", () => {
  const valid = JSON.stringify(fixture());
  const depthLimited = invalid(inspectStagedManifest(valid.replace('"data":{', '"data":{"deep":' + '['.repeat(MAX_STAGED_MANIFEST_DEPTH) + '0' + ']'.repeat(MAX_STAGED_MANIFEST_DEPTH) + ',')));
  assert.ok(depthLimited.errors.some(error => error.message.includes("nesting")));
  assert.equal(depthLimited.errorsTruncated, true);
  const raw = fixture();
  raw.data.extension = Array(MAX_STAGED_MANIFEST_NODES + 1).fill(0);
  const nodeLimited = invalid(inspect(raw));
  assert.ok(nodeLimited.errors.some(error => error.path === "$" && error.message.includes("JSON nodes")));
  assert.equal(nodeLimited.errorsTruncated, true);
});
