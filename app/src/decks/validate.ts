import type { CardData } from "./card";
import type { DeckDataFile } from "./types";

export type DeckValidation =
  | { ok: true; data: DeckDataFile }
  | { ok: false; error: string };

type RecordValue = Record<string, unknown>;
const SLUG = /^[a-z0-9]+(?:[-_][a-z0-9]+)*$/;
const own = (o: RecordValue, k: string) => Object.prototype.hasOwnProperty.call(o, k);

function fail(path: string, message: string): never {
  throw new Error(`${path}: ${message}.`);
}
function object(value: unknown, path: string): RecordValue {
  if (value === null || typeof value !== "object" || Array.isArray(value)) fail(path, "must be an object");
  return value as RecordValue;
}
function text(value: unknown, path: string, nonempty = false): asserts value is string {
  if (typeof value !== "string" || (nonempty && !value.trim())) fail(path, "must be a string" + (nonempty ? " with content" : ""));
}
function slug(value: unknown, path: string): asserts value is string {
  text(value, path, true);
  if (!SLUG.test(value)) fail(path, "must be a lowercase slug (hyphens or underscores allowed)");
}
function integer(value: unknown, path: string, min = 0): asserts value is number {
  if (!Number.isSafeInteger(value) || (value as number) < min) fail(path, `must be an integer >= ${min}`);
}
function optionalText(o: RecordValue, fields: string[], path: string) {
  for (const k of fields) if (own(o, k)) text(o[k], `${path}.${k}`);
}
function optionalContent(o: RecordValue, fields: string[], path: string) {
  for (const k of fields) if (own(o, k)) text(o[k], `${path}.${k}`, true);
}
function stringList(value: unknown, path: string) {
  if (!Array.isArray(value)) fail(path, "must be an array of strings");
  value.forEach((entry, index) => text(entry, `${path}[${index}]`, true));
}
function proseObject(value: unknown, path: string, fields: string[], withAvoid = false): RecordValue {
  const result = object(value, path);
  optionalContent(result, fields, path);
  if (withAvoid && own(result, "avoid")) stringList(result.avoid, `${path}.avoid`);
  return result;
}
function deckVisualLanguage(value: unknown, path: string) {
  proseObject(value, path, ["medium", "surface", "mark_making", "signature_accent", "finish"], true);
}
function visualFamilyGrammar(value: unknown, path: string) {
  proseObject(value, path, [
    "medium_handling",
    "composition",
    "edge_language",
    "value_structure",
    "camera_and_scale",
    "detail_distribution",
    "finish",
  ], true);
}
function rankVisualForm(value: unknown, path: string) {
  proseObject(value, path, ["composition_law", "spatial_logic", "rhythm", "density", "figure_ground"]);
}
function stationVisualEnvironment(value: unknown, path: string) {
  proseObject(value, path, ["illumination", "palette", "atmosphere", "motion", "density", "material_effects"]);
}
function meaning(value: unknown, path: string, palette: boolean) {
  const m = object(value, path);
  for (const k of ["upright", "inverted"]) {
    if (palette) {
      if (!Array.isArray(m[k])) fail(`${path}.${k}`, "must be an array of strings");
      (m[k] as unknown[]).forEach((v, i) => text(v, `${path}.${k}[${i}]`));
    } else text(m[k], `${path}.${k}`, true);
  }
}
function factorization(value: unknown, path: string) {
  const f = object(value, path);
  if (!["identity", "prime", "composite"].includes(f.character as string)) fail(`${path}.character`, "must be identity, prime, or composite");
  text(f.gloss, `${path}.gloss`);
  if (own(f, "visual_logic")) text(f.visual_logic, `${path}.visual_logic`, true);
  if (own(f, "factors")) {
    if (!Array.isArray(f.factors)) fail(`${path}.factors`, "must be an array");
    f.factors.forEach((v, i) => integer(v, `${path}.factors[${i}]`, 2));
  }
}
function symbol(value: unknown, path: string) {
  const s = object(value, path);
  optionalText(s, ["name", "description", "svg"], path);
}

/** Runtime axes have no fixed cardinality. Authoring-profile requirements are separate. */
function axis(value: unknown, path: string, kind: "suit" | "rank" | "station"): RecordValue {
  const entries = object(value, path);
  if (!Object.keys(entries).length) fail(path, "must not be empty");
  const indices = new Set<number>();
  for (const [key, raw] of Object.entries(entries)) {
    const p = `${path}.${key}`;
    slug(key, p);
    const a = object(raw, p);
    text(a.name, `${p}.name`, true);
    integer(a.index, `${p}.index`);
    if (indices.has(a.index)) fail(`${p}.index`, "duplicates another axis index");
    indices.add(a.index);
    if (own(a, "slug") && a.slug !== key) fail(`${p}.slug`, "must match its object key");
    optionalText(a, ["description", "visual_style", "visual_content", "visual_motif", "question"], p);
    if (own(a, "meaning")) meaning(a.meaning, `${p}.meaning`, true);
    if (own(a, "factorization")) factorization(a.factorization, `${p}.factorization`);
    if (kind === "suit" && own(a, "visual_grammar")) visualFamilyGrammar(a.visual_grammar, `${p}.visual_grammar`);
    if (kind === "rank" && own(a, "visual_form")) rankVisualForm(a.visual_form, `${p}.visual_form`);
    if (kind === "station" && own(a, "visual_environment")) stationVisualEnvironment(a.visual_environment, `${p}.visual_environment`);
    if (own(a, "symbol")) {
      if (kind === "rank") text(a.symbol, `${p}.symbol`);
      else symbol(a.symbol, `${p}.symbol`);
    }
    if (kind === "rank") {
      if (own(a, "numeric_value")) integer(a.numeric_value, `${p}.numeric_value`);
      if (own(a, "arcana") && a.arcana !== "minor") fail(`${p}.arcana`, "must be minor");
    }
  }
  if ([...indices].some((i) => i >= indices.size)) fail(path, "indices must be contiguous from zero");
  return entries;
}

/** Validate every entry before registration. Unknown extension fields are preserved. */
export function validateDeck(value: unknown): DeckValidation {
  try {
    const d = object(value, "deck");
    text(d.name, "name", true);
    slug(d.slug, "slug");
    text(d.version, "version", true);
    const theme = object(d.theme, "theme");
    text(theme.name, "theme.name", true);
    text(theme.description, "theme.description");
    text(theme.creator, "theme.creator");
    if (own(d, "visual_language")) deckVisualLanguage(d.visual_language, "visual_language");
    const suits = axis(d.suits, "suits", "suit");
    const ranks = axis(d.ranks, "ranks", "rank");
    const tx = object(d.transversal, "transversal");
    text(tx.name, "transversal.name", true);
    text(tx.description, "transversal.description");
    optionalText(tx, ["ordering_rationale"], "transversal");
    if (own(tx, "suit_stride")) integer(tx.suit_stride, "transversal.suit_stride", 1);
    const stations = axis(tx.stations, "transversal.stations", "station");
    const major = object(d.major_arcana, "major_arcana");
    optionalText(major, ["story", "visual_style"], "major_arcana");
    if (own(major, "visual_grammar")) visualFamilyGrammar(major.visual_grammar, "major_arcana.visual_grammar");
    if (own(major, "symbol")) symbol(major.symbol, "major_arcana.symbol");

    if (own(d, "dialectic")) {
      const dialectic = object(d.dialectic, "dialectic");
      if (!Array.isArray(dialectic.axes) || dialectic.axes.length !== 2) fail("dialectic.axes", "must contain two axes");
      const poles = dialectic.axes.map((raw, i) => {
        const a = object(raw, `dialectic.axes[${i}]`);
        text(a.name, `dialectic.axes[${i}].name`, true);
        if (!Array.isArray(a.poles) || a.poles.length !== 2) fail(`dialectic.axes[${i}].poles`, "must contain two poles");
        a.poles.forEach((v, j) => text(v, `dialectic.axes[${i}].poles[${j}]`, true));
        if (a.poles[0] === a.poles[1]) fail(`dialectic.axes[${i}].poles`, "must be distinct");
        return a.poles as string[];
      });
      const cells = object(dialectic.cells, "dialectic.cells");
      if (Object.keys(cells).length !== Object.keys(suits).length) fail("dialectic.cells", "must cover each suit exactly once");
      const expectedCellCount = poles[0].length * poles[1].length;
      if (Object.keys(suits).length !== expectedCellCount) fail("dialectic.cells", `a two-axis dialectic must contain exactly ${expectedCellCount} suit cells`);
      const seenCells = new Set<string>();
      for (const [key, cell] of Object.entries(cells)) {
        if (!own(suits, key) || !Array.isArray(cell) || cell.length !== 2 || !poles[0].includes(cell[0]) || !poles[1].includes(cell[1])) {
          fail(`dialectic.cells.${key}`, "must reference a suit and a pole from each axis");
        }
        const cellKey = JSON.stringify(cell);
        if (seenCells.has(cellKey)) fail(`dialectic.cells.${key}`, "duplicates another dialectic cell");
        seenCells.add(cellKey);
      }
    }

    const cards = object(d.cards, "cards");
    if (!Object.keys(cards).length) fail("cards", "the deck has no cards");
    for (const [key, raw] of Object.entries(cards)) {
      const p = `cards.${key}`;
      slug(key, p);
      const c = object(raw, p);
      if (c.slug !== key) fail(`${p}.slug`, "must match its object key");
      text(c.name, `${p}.name`, true);
      text(c.number, `${p}.number`, true);
      if (!/^(0|[1-9]\d*)$/.test(c.number) || !Number.isSafeInteger(Number(c.number))) fail(`${p}.number`, "must be a nonnegative safe integer written as a decimal string");
      if (c.arcana !== "major" && c.arcana !== "minor") fail(`${p}.arcana`, "must be major or minor");
      slug(c.station_slug, `${p}.station_slug`);
      if (!own(stations, c.station_slug)) fail(`${p}.station_slug`, "references an unknown station");
      if (c.arcana === "minor") {
        slug(c.suit_slug, `${p}.suit_slug`);
        slug(c.rank_slug, `${p}.rank_slug`);
        if (!own(suits, c.suit_slug)) fail(`${p}.suit_slug`, "references an unknown suit");
        if (!own(ranks, c.rank_slug)) fail(`${p}.rank_slug`, "references an unknown rank");
      } else if (own(c, "suit_slug") || own(c, "rank_slug")) fail(p, "major cards must not reference a suit or rank");
      meaning(c.meaning, `${p}.meaning`, false);
      const visuals = object(c.visuals, `${p}.visuals`);
      text(visuals.detailed_description, `${p}.visuals.detailed_description`);
      optionalText(visuals, ["style_override", "content_override"], `${p}.visuals`);
      if (own(c, "factorization")) factorization(c.factorization, `${p}.factorization`);
    }
    return { ok: true, data: d as unknown as DeckDataFile };
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : "Invalid deck." };
  }
}

/** Never use JSON property insertion order as the browser's card order. */
export function canonicalCards(data: DeckDataFile): CardData[] {
  const suits = data.suits;
  const ranks = data.ranks;
  return Object.values(data.cards).sort((a, b) => {
    if (a.arcana !== b.arcana) return a.arcana === "major" ? -1 : 1;
    const order = a.arcana === "major"
      ? Number(a.number) - Number(b.number)
      : suits[a.suit_slug!].index - suits[b.suit_slug!].index || ranks[a.rank_slug!].index - ranks[b.rank_slug!].index;
    return order || (a.slug < b.slug ? -1 : a.slug > b.slug ? 1 : 0);
  });
}
