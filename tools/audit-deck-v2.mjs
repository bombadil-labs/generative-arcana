import { readdirSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const decksDir = join(root, "decks");
const check = process.argv.includes("--check");

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
}

function audit(id, path) {
  let data;
  try {
    data = JSON.parse(readFileSync(path, "utf8"));
  } catch (error) {
    throw new Error(`${id}: could not parse ${path}: ${error instanceof Error ? error.message : String(error)}`);
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
