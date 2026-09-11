import { existsSync, readdirSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const decksDir = join(root, "decks");
const check = process.argv.includes("--check");
const requiredEnriched = new Set(
  process.argv
    .filter((arg) => arg.startsWith("--require-enriched="))
    .flatMap((arg) => arg.slice("--require-enriched=".length).split(","))
    .map((id) => id.trim())
    .filter(Boolean),
);

const rows = readdirSync(decksDir, { withFileTypes: true })
  .filter((entry) => entry.isDirectory())
  .map((entry) => audit(entry.name, join(decksDir, entry.name, "deck.json")))
  .sort((a, b) => a.id.localeCompare(b.id));

const headers = [
  "deck",
  "cards",
  "suits",
  "ranks",
  "stations",
  "deck visual",
  "family grammar",
  "rank form",
  "station env",
  "major grammar",
  "major visual logic",
  "legacy fallbacks",
];
console.log(`| ${headers.join(" | ")} |`);
console.log(`| ${headers.map(() => "---").join(" | ")} |`);
for (const row of rows) {
  console.log(`| ${[
    row.id,
    row.cards,
    row.suits,
    row.ranks,
    row.stations,
    yesno(row.deckVisual),
    fraction(row.familyGrammar, row.suits),
    fraction(row.rankForm, row.ranks),
    fraction(row.stationEnvironment, row.stations),
    yesno(row.majorGrammar),
    fraction(row.majorVisualLogic, row.majors),
    row.legacyFallbacks ? "yes" : "no",
  ].join(" | ")} |`);
}

const complete = rows.filter((row) => row.enriched).length;
console.error(`schema-v2 visual enrichment: ${complete}/${rows.length} bundled decks complete`);

if (check) {
  for (const row of rows) {
    if (!row.validShape) throw new Error(`${row.id}: bundled deck shape is incomplete or malformed`);
  }
  for (const id of requiredEnriched) {
    const row = rows.find((candidate) => candidate.id === id);
    if (!row) throw new Error(`${id}: required enriched deck is not bundled`);
    if (!row.enriched) throw new Error(`${id}: required schema-v2 visual enrichment is incomplete`);
  }
}

function audit(id, path) {
  let data = readJson(id, path);
  const fragmentsDir = join(dirname(path), "v2");
  if (existsSync(fragmentsDir)) {
    const fragments = readdirSync(fragmentsDir, { withFileTypes: true })
      .filter((entry) => entry.isFile() && entry.name.endsWith(".json"))
      .map((entry) => entry.name)
      .sort();
    for (const fragment of fragments) data = merge(data, readJson(id, join(fragmentsDir, fragment)));
  }

  const suits = recordValues(data.suits);
  const ranks = recordValues(data.ranks);
  const stations = recordValues(data.transversal?.stations);
  const cards = recordValues(data.cards);
  const majors = cards.filter((card) => card?.arcana === "major");
  const scenes = cards.filter((card) => text(card?.visuals?.detailed_description)).length;

  const familyGrammar = suits.filter((suit) => object(suit?.visual_grammar)).length;
  const rankForm = ranks.filter((rank) => object(rank?.visual_form)).length;
  const stationEnvironment = stations.filter((station) => object(station?.visual_environment)).length;
  const majorVisualLogic = majors.filter((card) => text(card?.factorization?.visual_logic)).length;
  const legacyFallbacks = suits.some((suit) => text(suit?.visual_style))
    || ranks.some((rank) => text(rank?.visual_content))
    || stations.some((station) => text(station?.visual_motif));

  const deckVisual = object(data.visual_language);
  const majorGrammar = object(data.major_arcana?.visual_grammar);
  const enriched = !!deckVisual
    && familyGrammar === suits.length
    && rankForm === ranks.length
    && stationEnvironment === stations.length
    && !!majorGrammar
    && majorVisualLogic === majors.length;

  return {
    id,
    cards: cards.length,
    suits: suits.length,
    ranks: ranks.length,
    stations: stations.length,
    majors: majors.length,
    scenes,
    deckVisual: !!deckVisual,
    familyGrammar,
    rankForm,
    stationEnvironment,
    majorGrammar: !!majorGrammar,
    majorVisualLogic,
    legacyFallbacks,
    enriched,
    validShape: !!text(data.name)
      && !!text(data.slug)
      && cards.length > 0
      && suits.length > 0
      && ranks.length > 0
      && stations.length > 0
      && scenes === cards.length,
  };
}

function readJson(id, path) {
  try {
    return JSON.parse(readFileSync(path, "utf8"));
  } catch (error) {
    throw new Error(`${id}: could not parse ${path}: ${error instanceof Error ? error.message : String(error)}`);
  }
}

function merge(base, patch) {
  if (!object(base) || !object(patch)) return clone(patch);
  const result = { ...base };
  for (const [key, value] of Object.entries(patch)) {
    result[key] = Object.prototype.hasOwnProperty.call(result, key) ? merge(result[key], value) : clone(value);
  }
  return result;
}
function clone(value) {
  if (Array.isArray(value)) return value.map(clone);
  if (object(value)) return Object.fromEntries(Object.entries(value).map(([key, child]) => [key, clone(child)]));
  return value;
}
function recordValues(value) {
  return object(value) ? Object.values(value) : [];
}
function object(value) {
  return !!value && typeof value === "object" && !Array.isArray(value) ? value : null;
}
function text(value) {
  return typeof value === "string" && value.trim() ? value : null;
}
function fraction(value, total) {
  return `${value}/${total}`;
}
function yesno(value) {
  return value ? "yes" : "no";
}
