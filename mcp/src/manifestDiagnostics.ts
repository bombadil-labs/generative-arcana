import { validateDeckManifest, type DeckManifestValidation } from "../../app/src/decks/manifest";
import { GENERIC_SPREADS, MAX_SPREAD_POSITIONS } from "../../app/src/decks/spreads";

export const MAX_MANIFEST_DIAGNOSTICS = 100;
export const MAX_MANIFEST_DIAGNOSTIC_PATH = 256;
export const MAX_MANIFEST_DIAGNOSTIC_MESSAGE = 240;
export const MAX_STAGED_MANIFEST_DEPTH = 128;
export const MAX_STAGED_MANIFEST_NODES = 100_000;
const MAX_DIAGNOSTIC_CHECKS = 100_000;
const SLUG = /^[a-z0-9]+(?:[-_][a-z0-9]+)*$/;
const GENERIC_IDS = new Set(GENERIC_SPREADS.map(spread => spread.id));
const STOP = Symbol("diagnostic limit");
type RecordValue = Record<string, unknown>;
const own = (value: RecordValue, key: string) => Object.prototype.hasOwnProperty.call(value, key);
const isObject = (value: unknown): value is RecordValue => value !== null && typeof value === "object" && !Array.isArray(value);

export interface ManifestDiagnostic { path: string; message: string }
export type StagedManifestInspection =
  | (Extract<DeckManifestValidation, { ok: true }> & { errors: []; errorsTruncated: false })
  | { ok: false; errors: ManifestDiagnostic[]; errorsTruncated: boolean };

/**
 * The shared domain validator is the authority for domain acceptance and normalization. A separate
 * bounded preflight requires PostgreSQL-compatible strings/numbers and bounds recursive snapshot
 * depth before calling it. On rejection,
 * this repair-oriented collector inspects independent fields once; it never repairs/revalidates
 * cloned copies of the full manifest. Keep diagnostic rules aligned with validate.ts/spreads.ts.
 * Errors, individual strings, and diagnostic work are bounded independently of authored cardinality.
 */
export function inspectStagedManifest(json: string): StagedManifestInspection {
  let value: unknown;
  try { value = JSON.parse(json); }
  catch { return { ok: false, errors: [{ path: "$", message: "Manifest is not valid JSON." }], errorsTruncated: false }; }

  const collector = new ManifestDiagnostics();
  let preflightComplete = true;
  try { collector.storagePreflight(value); }
  catch (error) { if (error !== STOP) throw error; preflightComplete = false; }
  let authoritative: DeckManifestValidation | undefined;
  if (preflightComplete && !collector.errors.length) {
    try { authoritative = validateDeckManifest(value); }
    catch { authoritative = { ok: false, error: "Manifest could not be validated." }; }
    if (authoritative.ok) return { ...authoritative, errors: [], errorsTruncated: false };
  }
  try { collector.manifest(value); }
  catch (error) { if (error !== STOP) throw error; }
  // A new domain rule must fail closed even before the repair collector learns its detailed path.
  if (!collector.errors.length) collector.fallback(authoritative && !authoritative.ok ? authoritative.error : "Manifest could not be validated within the staging safety limits.");
  return { ok: false, errors: collector.errors, errorsTruncated: collector.truncated };
}

class ManifestDiagnostics {
  readonly errors: ManifestDiagnostic[] = [];
  truncated = false;
  private checks = 0;
  private readonly seen = new Set<string>();

  private step() {
    if (++this.checks > MAX_DIAGNOSTIC_CHECKS) { this.truncated = true; throw STOP; }
  }
  private path(parent: string, key: string | number): string {
    // Return an exact ancestor rather than emitting an invalid, ellipsis-truncated JSONPath.
    // An internal NUL sentinel prevents later segments from inventing descendants of that ancestor.
    if (parent.endsWith("\0")) return parent;
    if (typeof key === "string" && key.length > MAX_MANIFEST_DIAGNOSTIC_PATH) { this.truncated = true; return parent + "\0"; }
    const part = typeof key === "number" ? `[${key}]` : /^[A-Za-z_$][A-Za-z0-9_$]*$/.test(key) ? `.${key}` : `[${JSON.stringify(key)}]`;
    if (parent.length + part.length > MAX_MANIFEST_DIAGNOSTIC_PATH) { this.truncated = true; return parent + "\0"; }
    return parent + part;
  }
  private add(path: string, message: string) {
    path = path.replace(/\0.*$/, "");
    if (message.length > MAX_MANIFEST_DIAGNOSTIC_MESSAGE) {
      message = message.slice(0, MAX_MANIFEST_DIAGNOSTIC_MESSAGE - 1) + "…";
      this.truncated = true;
    }
    const key = `${path}\n${message}`;
    if (this.seen.has(key)) return;
    if (this.errors.length >= MAX_MANIFEST_DIAGNOSTICS) { this.truncated = true; throw STOP; }
    this.seen.add(key);
    this.errors.push({ path, message });
  }
  fallback(message: string) { this.add("$", message); }
  private object(value: unknown, path: string): RecordValue | undefined {
    this.step();
    if (isObject(value)) return value;
    this.add(path, "Must be an object.");
  }
  private text(value: unknown, path: string, nonempty = false): value is string {
    this.step();
    if (typeof value === "string" && (!nonempty || value.trim())) return true;
    this.add(path, nonempty ? "Must be a non-empty string." : "Must be a string.");
    return false;
  }
  private slug(value: unknown, path: string): value is string {
    if (!this.text(value, path, true)) return false;
    if (SLUG.test(value)) return true;
    this.add(path, "Must be a lowercase slug (hyphens or underscores allowed).");
    return false;
  }
  private integer(value: unknown, path: string, min = 0): value is number {
    this.step();
    if (Number.isSafeInteger(value) && (value as number) >= min) return true;
    this.add(path, `Must be an integer >= ${min}.`);
    return false;
  }
  private optionalText(value: RecordValue, path: string, fields: readonly string[], nonempty = false) {
    for (const key of fields) if (own(value, key)) this.text(value[key], this.path(path, key), nonempty);
  }
  private stringList(value: unknown, path: string, nonempty = true) {
    this.step();
    if (!Array.isArray(value)) { this.add(path, "Must be an array of strings."); return; }
    value.forEach((entry, index) => this.text(entry, this.path(path, index), nonempty));
  }
  private prose(value: unknown, path: string, fields: readonly string[], avoid = false) {
    const record = this.object(value, path);
    if (!record) return;
    this.optionalText(record, path, fields, true);
    if (avoid && own(record, "avoid")) this.stringList(record.avoid, this.path(path, "avoid"));
  }
  private visualGrammar(value: unknown, path: string) {
    this.prose(value, path, ["medium_handling", "composition", "edge_language", "value_structure", "camera_and_scale", "detail_distribution", "finish"], true);
  }
  private meaning(value: unknown, path: string, palette: boolean) {
    const record = this.object(value, path);
    if (!record) return;
    for (const key of ["upright", "inverted"]) {
      if (palette) this.stringList(record[key], this.path(path, key), false);
      else this.text(record[key], this.path(path, key), true);
    }
  }
  private factorization(value: unknown, path: string) {
    const record = this.object(value, path);
    if (!record) return;
    if (!["identity", "prime", "composite"].includes(record.character as string)) this.add(this.path(path, "character"), "Must be identity, prime, or composite.");
    this.text(record.gloss, this.path(path, "gloss"));
    this.optionalText(record, path, ["visual_logic"], true);
    if (own(record, "factors")) {
      if (!Array.isArray(record.factors)) this.add(this.path(path, "factors"), "Must be an array.");
      else record.factors.forEach((entry, index) => this.integer(entry, this.path(this.path(path, "factors"), index), 2));
    }
  }
  private symbol(value: unknown, path: string) {
    const record = this.object(value, path);
    if (record) this.optionalText(record, path, ["name", "description", "svg"]);
  }
  private axis(value: unknown, path: string, kind: "suit" | "rank" | "station"): RecordValue | undefined {
    const entries = this.object(value, path);
    if (!entries) return;
    const keys = Object.keys(entries);
    if (!keys.length) this.add(path, "Must not be empty.");
    const indices = new Set<number>();
    let validIndices = true;
    for (const key of keys) {
      this.step();
      const itemPath = this.path(path, key);
      this.slug(key, itemPath);
      const record = this.object(entries[key], itemPath);
      if (!record) { validIndices = false; continue; }
      this.text(record.name, this.path(itemPath, "name"), true);
      if (this.integer(record.index, this.path(itemPath, "index"))) {
        if (indices.has(record.index)) this.add(this.path(itemPath, "index"), "Duplicates another axis index.");
        indices.add(record.index);
      } else validIndices = false;
      if (own(record, "slug") && record.slug !== key) this.add(this.path(itemPath, "slug"), "Must match its object key.");
      this.optionalText(record, itemPath, ["description", "visual_style", "visual_content", "visual_motif", "question"]);
      if (own(record, "meaning")) this.meaning(record.meaning, this.path(itemPath, "meaning"), true);
      if (own(record, "factorization")) this.factorization(record.factorization, this.path(itemPath, "factorization"));
      if (kind === "suit" && own(record, "visual_grammar")) this.visualGrammar(record.visual_grammar, this.path(itemPath, "visual_grammar"));
      if (kind === "rank" && own(record, "visual_form")) this.prose(record.visual_form, this.path(itemPath, "visual_form"), ["composition_law", "spatial_logic", "rhythm", "density", "figure_ground"]);
      if (kind === "station" && own(record, "visual_environment")) this.prose(record.visual_environment, this.path(itemPath, "visual_environment"), ["illumination", "palette", "atmosphere", "motion", "density", "material_effects"]);
      if (own(record, "symbol")) {
        if (kind === "rank") this.text(record.symbol, this.path(itemPath, "symbol"));
        else this.symbol(record.symbol, this.path(itemPath, "symbol"));
      }
      if (kind !== "station" && own(record, "numeric_value")) this.integer(record.numeric_value, this.path(itemPath, "numeric_value"));
      if (kind === "rank" && own(record, "arcana") && record.arcana !== "minor") this.add(this.path(itemPath, "arcana"), "Must be minor.");
    }
    if (validIndices && [...indices].some(index => index >= indices.size)) this.add(path, "Indices must be contiguous from zero.");
    return entries;
  }
  manifest(value: unknown) {
    const record = this.object(value, "$");
    if (!record) return;
    if (!own(record, "data")) this.add("$.data", "Is required.");
    this.text(record.tagline, "$.tagline", true);
    if (record.schemaVersion !== undefined && record.schemaVersion !== 1 && record.schemaVersion !== 2) this.add("$.schemaVersion", "Unsupported schema version; expected 1 or 2.");
    if (own(record, "data")) this.deck(record.data, "$.data");
    this.spreads(record.spreads, isObject(record.data) ? record.data.slug : undefined);
  }
  private deck(value: unknown, path: string) {
    const record = this.object(value, path);
    if (!record) return;
    this.text(record.name, this.path(path, "name"), true);
    this.slug(record.slug, this.path(path, "slug"));
    this.text(record.version, this.path(path, "version"), true);
    const theme = this.object(record.theme, this.path(path, "theme"));
    if (theme) {
      this.text(theme.name, `${path}.theme.name`, true);
      this.text(theme.description, `${path}.theme.description`);
      this.text(theme.creator, `${path}.theme.creator`);
    }
    if (own(record, "visual_language")) this.prose(record.visual_language, `${path}.visual_language`, ["medium", "surface", "mark_making", "signature_accent", "finish"], true);
    if (own(record, "minor_number_origin") && !["rank", "suit", "card"].includes(record.minor_number_origin as string)) this.add(`${path}.minor_number_origin`, "Must be rank, suit, or card.");
    const suits = this.axis(record.suits, `${path}.suits`, "suit");
    const ranks = this.axis(record.ranks, `${path}.ranks`, "rank");
    const tx = this.object(record.transversal, `${path}.transversal`);
    let stations: RecordValue | undefined;
    if (tx) {
      this.text(tx.name, `${path}.transversal.name`, true);
      this.text(tx.description, `${path}.transversal.description`);
      this.optionalText(tx, `${path}.transversal`, ["ordering_rationale"]);
      if (own(tx, "suit_stride")) this.integer(tx.suit_stride, `${path}.transversal.suit_stride`, 1);
      stations = this.axis(tx.stations, `${path}.transversal.stations`, "station");
    }
    const major = this.object(record.major_arcana, `${path}.major_arcana`);
    if (major) {
      this.optionalText(major, `${path}.major_arcana`, ["story", "visual_style"]);
      if (own(major, "visual_grammar")) this.visualGrammar(major.visual_grammar, `${path}.major_arcana.visual_grammar`);
      if (own(major, "symbol")) this.symbol(major.symbol, `${path}.major_arcana.symbol`);
    }
    if (own(record, "dialectic")) this.dialectic(record.dialectic, `${path}.dialectic`, suits);
    const cards = this.object(record.cards, `${path}.cards`);
    if (!cards) return;
    if (!Object.keys(cards).length) this.add(`${path}.cards`, "The deck has no cards.");
    for (const key of Object.keys(cards)) {
      this.step();
      const itemPath = this.path(`${path}.cards`, key);
      this.slug(key, itemPath);
      const card = this.object(cards[key], itemPath);
      if (!card) continue;
      if (card.slug !== key) this.add(this.path(itemPath, "slug"), "Must match its object key.");
      this.text(card.name, this.path(itemPath, "name"), true);
      const numberIsText = this.text(card.number, this.path(itemPath, "number"), true);
      if (numberIsText && (!/^(0|[1-9]\d*)$/.test(card.number as string) || !Number.isSafeInteger(Number(card.number)))) this.add(this.path(itemPath, "number"), "Must be a nonnegative safe integer written as a decimal string.");
      if (card.arcana !== "major" && card.arcana !== "minor") this.add(this.path(itemPath, "arcana"), "Must be major or minor.");
      if (this.slug(card.station_slug, this.path(itemPath, "station_slug")) && stations && !own(stations, card.station_slug)) this.add(this.path(itemPath, "station_slug"), "References an unknown station.");
      if (card.arcana === "minor") {
        if (this.slug(card.suit_slug, this.path(itemPath, "suit_slug")) && suits && !own(suits, card.suit_slug)) this.add(this.path(itemPath, "suit_slug"), "References an unknown suit.");
        if (this.slug(card.rank_slug, this.path(itemPath, "rank_slug")) && ranks && !own(ranks, card.rank_slug)) this.add(this.path(itemPath, "rank_slug"), "References an unknown rank.");
        const origin = record.minor_number_origin;
        if (origin === "rank" || origin === "suit") {
          const axis = origin === "rank" ? ranks : suits;
          const key = origin === "rank" ? card.rank_slug : card.suit_slug;
          const owner = axis && typeof key === "string" && own(axis, key) ? axis[key] : undefined;
          if (isObject(owner)) {
            if (!own(owner, "numeric_value")) this.add(this.path(itemPath, "number"), `Requires ${origin}.numeric_value when minor_number_origin is ${origin}.`);
            else if (numberIsText && owner.numeric_value !== Number(card.number)) this.add(this.path(itemPath, "number"), `Must match ${origin}.numeric_value.`);
          }
        }
      } else if (card.arcana === "major" && (own(card, "suit_slug") || own(card, "rank_slug"))) this.add(itemPath, "Major cards must not reference a suit or rank.");
      this.meaning(card.meaning, this.path(itemPath, "meaning"), false);
      const visualsPath = this.path(itemPath, "visuals");
      const visuals = this.object(card.visuals, visualsPath);
      if (visuals) {
        this.text(visuals.detailed_description, this.path(visualsPath, "detailed_description"));
        this.optionalText(visuals, visualsPath, ["style_override", "content_override"]);
      }
      if (own(card, "factorization")) this.factorization(card.factorization, this.path(itemPath, "factorization"));
    }
  }
  private dialectic(value: unknown, path: string, suits: RecordValue | undefined) {
    const record = this.object(value, path);
    if (!record) return;
    const axes = Array.isArray(record.axes) ? record.axes : undefined;
    if (!axes || axes.length !== 2) this.add(`${path}.axes`, "Must contain two axes.");
    const poles: Array<string[] | undefined> = [];
    if (axes) axes.forEach((entry, index) => {
      this.step();
      const axisPath = `${path}.axes[${index}]`;
      const axis = this.object(entry, axisPath);
      if (!axis) return;
      this.text(axis.name, `${axisPath}.name`, true);
      if (!Array.isArray(axis.poles) || axis.poles.length !== 2) this.add(`${axisPath}.poles`, "Must contain two poles.");
      if (Array.isArray(axis.poles)) {
        axis.poles.forEach((entry, index) => this.text(entry, `${axisPath}.poles[${index}]`, true));
        if (axis.poles.length === 2) {
          if (axis.poles[0] === axis.poles[1]) this.add(`${axisPath}.poles`, "Must be distinct.");
          if (axis.poles.every(entry => typeof entry === "string")) poles[index] = axis.poles as string[];
        }
      }
    });
    const cells = this.object(record.cells, `${path}.cells`);
    if (!cells) return;
    if (suits && Object.keys(cells).length !== Object.keys(suits).length) this.add(`${path}.cells`, "Must cover each suit exactly once.");
    if (suits && Object.keys(suits).length !== 4) this.add(`${path}.cells`, "A two-axis dialectic must contain exactly 4 suit cells.");
    const seen = new Set<string>();
    for (const key of Object.keys(cells)) {
      this.step();
      const cell = cells[key];
      const cellPath = this.path(`${path}.cells`, key);
      if ((suits && !own(suits, key)) || !Array.isArray(cell) || cell.length !== 2 || (poles[0] && !poles[0].includes(cell[0])) || (poles[1] && !poles[1].includes(cell[1]))) {
        this.add(cellPath, "Must reference a suit and a pole from each axis.");
      }
      if (Array.isArray(cell) && cell.length === 2 && cell.every(entry => typeof entry === "string")) {
        const identity = JSON.stringify(cell);
        if (seen.has(identity)) this.add(cellPath, "Duplicates another dialectic cell.");
        seen.add(identity);
      }
    }
  }
  private spreads(value: unknown, owner: unknown) {
    if (value === undefined) return;
    if (!Array.isArray(value)) { this.add("$.spreads", "Must be an array when provided."); return; }
    const ids = new Set<string>();
    value.forEach((entry, index) => {
      this.step();
      const path = `$.spreads[${index}]`;
      const spread = this.object(entry, path);
      if (!spread) return;
      if (this.text(spread.id, `${path}.id`, true)) {
        if (GENERIC_IDS.has(spread.id)) this.add(`${path}.id`, "Collides with a generic spread id.");
        if (ids.has(spread.id)) this.add(`${path}.id`, "Duplicates another native spread id.");
        ids.add(spread.id);
      }
      this.text(spread.name, `${path}.name`, true);
      this.text(spread.description, `${path}.description`);
      if (spread.deckId !== undefined && this.text(spread.deckId, `${path}.deckId`, true) && typeof owner === "string" && spread.deckId !== owner) this.add(`${path}.deckId`, "Must match the owning deck slug.");
      if (!Array.isArray(spread.positions)) this.add(`${path}.positions`, "Must be an array of positions.");
      else {
        if (!spread.positions.length || spread.positions.length > MAX_SPREAD_POSITIONS) this.add(`${path}.positions`, `Must contain between 1 and ${MAX_SPREAD_POSITIONS} positions.`);
        spread.positions.forEach((entry, index) => {
          const positionPath = `${path}.positions[${index}]`;
          const position = this.object(entry, positionPath);
          if (!position) return;
          this.text(position.name, `${positionPath}.name`, true);
          this.text(position.prompt, `${positionPath}.prompt`);
        });
      }
    });
  }
  storagePreflight(value: unknown) {
    // Iterative DFS avoids recursion overflow and does not enqueue an entire wide object at once.
    // Apply these upload safety limits to the entire submitted JSON, including extension metadata.
    type Frame = { value: unknown; path: string; keys?: string[]; index: number; depth: number };
    const stack: Frame[] = [{ value, path: "$", index: -1, depth: 0 }];
    let nodes = 0;
    while (stack.length) {
      const frame = stack[stack.length - 1];
      if (frame.index === -1) {
        if (++nodes > MAX_STAGED_MANIFEST_NODES) {
          this.truncated = true;
          this.add("$", `Manifest exceeds the maximum of ${MAX_STAGED_MANIFEST_NODES} JSON nodes.`);
          throw STOP;
        }
        if (frame.depth > MAX_STAGED_MANIFEST_DEPTH) {
          this.truncated = true;
          this.add(frame.path, `Manifest nesting must not exceed ${MAX_STAGED_MANIFEST_DEPTH} levels.`);
          stack.pop();
          continue;
        }
        if (typeof frame.value === "number" && !Number.isFinite(frame.value)) this.add(frame.path, "JSON numbers must be finite.");
        if (typeof frame.value === "string") this.storageString(frame.value, frame.path, false);
        if (frame.value === null || typeof frame.value !== "object") { stack.pop(); continue; }
        frame.keys = Array.isArray(frame.value) ? undefined : Object.keys(frame.value);
        frame.index = 0;
      }
      const array = Array.isArray(frame.value);
      const length = array ? (frame.value as unknown[]).length : frame.keys!.length;
      if (frame.index >= length) { stack.pop(); continue; }
      const key = array ? frame.index++ : frame.keys![frame.index++];
      const child = (frame.value as RecordValue)[key];
      const childPath = this.path(frame.path, key);
      if (typeof key === "string") this.storageString(key, childPath, true);
      stack.push({ value: child, path: childPath, index: -1, depth: frame.depth + 1 });
    }
  }
  private storageString(value: string, path: string, key: boolean) {
    if (value.includes("\0")) this.add(path, `${key ? "Object keys" : "Strings"} must not contain U+0000; PostgreSQL JSON storage does not support it.`);
    for (let index = 0; index < value.length; index++) {
      const code = value.charCodeAt(index);
      if (code < 0xd800 || code > 0xdfff) continue;
      if (code <= 0xdbff && index + 1 < value.length) {
        const next = value.charCodeAt(index + 1);
        if (next >= 0xdc00 && next <= 0xdfff) { index++; continue; }
      }
      this.add(path, `${key ? "Object keys" : "Strings"} must contain valid Unicode; unpaired surrogates cannot be stored as PostgreSQL JSON.`);
      return;
    }
  }
}
