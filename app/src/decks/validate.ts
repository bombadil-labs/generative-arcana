import type { DeckDataFile } from "./types";

export type ValidationResult = { ok: true; data: DeckDataFile } | { ok: false; error: string };
export const MAX_DECK_JSON_LENGTH = 5_000_000;
export const isRecord = (value: unknown): value is Record<string, unknown> =>
  value !== null && typeof value === "object" && !Array.isArray(value);
const text = (value: unknown): value is string => typeof value === "string" && value.trim().length > 0;
const slug = (value: unknown): value is string => text(value) && /^[a-z0-9]+(?:[-_][a-z0-9]+)*$/.test(value);
const integer = (value: unknown): value is number => Number.isSafeInteger(value) && (value as number) >= 0;
const own = (object: object, key: string) => Object.prototype.hasOwnProperty.call(object, key);

/** Validate the portable runtime contract, not an authoring profile's prescribed card count.
 * Extensions are retained; 77-card decks and the 8x8 Octave are intentionally supported. */
export function validateDeck(value: unknown): ValidationResult {
  const fail = (error: string): ValidationResult => ({ ok: false, error });
  if (!isRecord(value)) return fail("The deck must be a JSON object.");
  const d = value;
  for (const key of ["name", "version"]) if (!text(d[key])) return fail(`\`${key}\` must be a non-empty string.`);
  if (!slug(d.slug)) return fail("`slug` must contain lowercase letters, numbers, hyphens, or underscores.");
  if (!isRecord(d.theme)) return fail("`theme` must be an object.");
  for (const key of ["name", "description", "creator"]) {
    if (typeof d.theme[key] !== "string") return fail(`\`theme.${key}\` must be a string.`);
  }
  if (!isRecord(d.major_arcana)) return fail("`major_arcana` must be an object.");
  if (!isRecord(d.transversal) || !isRecord(d.transversal.stations)) return fail("`transversal.stations` must be an object keyed by slug.");
  const axisMaps = { suits: d.suits, ranks: d.ranks, stations: d.transversal.stations };
  for (const [label, axis] of Object.entries(axisMaps)) {
    if (!isRecord(axis) || !Object.keys(axis).length) return fail(`\`${label}\` must be a non-empty object keyed by slug.`);
    const indices = new Set<number>();
    for (const [key, entry] of Object.entries(axis)) {
      if (!slug(key) || !isRecord(entry) || !text(entry.name) || !integer(entry.index)) return fail(`Invalid ${label} entry: ${key} (need name and non-negative integer index).`);
      if (entry.slug !== undefined && entry.slug !== key) return fail(`${label}.${key}.slug must match its key.`);
      if (indices.has(entry.index)) return fail(`Duplicate ${label} index: ${entry.index}.`);
      indices.add(entry.index);
      if (entry.description !== undefined && typeof entry.description !== "string") return fail(`${label}.${key}.description must be a string.`);
      if (label === "ranks" && !integer(entry.numeric_value)) return fail(`ranks.${key}.numeric_value must be a non-negative integer.`);
    }
  }
  for (const key of ["name", "description", "ordering_rationale"]) {
    if (d.transversal[key] !== undefined && typeof d.transversal[key] !== "string") return fail(`transversal.${key} must be a string.`);
  }
  if (d.transversal.suit_stride !== undefined && !integer(d.transversal.suit_stride)) return fail("transversal.suit_stride must be a non-negative integer.");
  if (!isRecord(d.cards) || !Object.keys(d.cards).length) return fail("`cards` must be a non-empty object keyed by slug.");
  for (const [key, card] of Object.entries(d.cards)) {
    if (!slug(key) || !isRecord(card) || card.slug !== key) return fail(`Card ${key}: slug must match its key.`);
    if (!text(card.name) || typeof card.number !== "string" || !/^(0|[1-9]\d*)$/.test(card.number) || !integer(Number(card.number))) return fail(`Card ${key}: need a name and a non-negative integer number string.`);
    if (card.arcana !== "major" && card.arcana !== "minor") return fail(`Card ${key}: arcana must be major or minor.`);
    if (!text(card.station_slug) || !own(axisMaps.stations, card.station_slug)) return fail(`Card ${key}: unknown station_slug.`);
    if (card.arcana === "minor") {
      if (!text(card.suit_slug) || !own(d.suits as object, card.suit_slug)) return fail(`Card ${key}: unknown suit_slug.`);
      if (!text(card.rank_slug) || !own(d.ranks as object, card.rank_slug)) return fail(`Card ${key}: unknown rank_slug.`);
    } else if (card.suit_slug !== undefined || card.rank_slug !== undefined) return fail(`Card ${key}: majors must not carry suit_slug or rank_slug.`);
    if (!isRecord(card.meaning) || !text(card.meaning.upright) || !text(card.meaning.inverted)) return fail(`Card ${key}: need upright and inverted meaning strings.`);
    if (!isRecord(card.visuals) || typeof card.visuals.detailed_description !== "string") return fail(`Card ${key}: need visuals.detailed_description.`);
    for (const override of ["style_override", "content_override"]) {
      if (card.visuals[override] !== undefined && typeof card.visuals[override] !== "string") return fail(`Card ${key}: ${override} must be a string.`);
    }
    if (card.factorization !== undefined) {
      const f = card.factorization;
      if (!isRecord(f) || !["identity", "prime", "composite"].includes(f.character as string) || !text(f.gloss) ||
          (f.factors !== undefined && (!Array.isArray(f.factors) || !f.factors.every((n: unknown) => integer(n) && n >= 2)))) return fail(`Card ${key}: invalid factorization.`);
    }
  }
  if (d.dialectic !== undefined) {
    const dialectic = d.dialectic;
    if (!isRecord(dialectic) || !Array.isArray(dialectic.axes) || dialectic.axes.length !== 2 || !isRecord(dialectic.cells)) return fail("Invalid dialectic axes or cells.");
    for (const axis of dialectic.axes) {
      if (!isRecord(axis) || !text(axis.name) || !Array.isArray(axis.poles) || axis.poles.length !== 2 || !axis.poles.every(text) || axis.poles[0] === axis.poles[1]) return fail("Each dialectic axis needs two distinct named poles.");
    }
    const axes = dialectic.axes as { poles: string[] }[];
    for (const [key, cell] of Object.entries(dialectic.cells)) {
      if (!own(d.suits as object, key) || !Array.isArray(cell) || cell.length !== 2 || !axes.every((axis, i) => axis.poles.includes(cell[i]))) return fail(`Invalid dialectic cell: ${key}.`);
    }
    if (Object.keys(d.suits as object).some((key) => !own(dialectic.cells as object, key))) return fail("Every suit needs a dialectic cell.");
  }
  return { ok: true, data: d as unknown as DeckDataFile };
}

/** Derive display order; object serialization order is never card identity. */
export function orderedCards(data: DeckDataFile) {
  const suits = data.suits as Record<string, { index: number }>;
  const ranks = data.ranks as Record<string, { index: number }>;
  return Object.values(data.cards).sort((a, b) => {
    if (a.arcana !== b.arcana) return a.arcana === "major" ? -1 : 1;
    const delta = a.arcana === "major" ? Number(a.number) - Number(b.number)
      : suits[a.suit_slug!].index - suits[b.suit_slug!].index || ranks[a.rank_slug!].index - ranks[b.rank_slug!].index;
    return delta || (a.slug < b.slug ? -1 : a.slug > b.slug ? 1 : 0);
  });
}
