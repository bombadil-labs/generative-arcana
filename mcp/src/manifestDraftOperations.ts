import * as z from "zod/v4";
import { MAX_SPREAD_POSITIONS } from "../../app/src/decks/spreads.js";
import { MAX_STAGED_MANIFEST_DEPTH, MAX_STAGED_MANIFEST_NODES } from "./manifestDiagnostics.js";
import { MAX_MANIFEST_UPLOAD_BYTES } from "./manifestUploads.js";

export const MAX_DRAFT_UPDATE_BYTES = 64 * 1024;
export const MAX_DRAFT_OPERATIONS = 20;
export const MAX_DRAFT_READ_BYTES = 64 * 1024;
export const MAX_DRAFT_MUTATIONS = 512;
export const MAX_DRAFT_KEY_CHARS = 200;
const READ_WRAPPER_RESERVE_BYTES = 2048;
const RESERVED_KEYS = new Set(["__proto__", "prototype", "constructor"]);
const MANAGED_DATA_KEYS = new Set(["cards", "suits", "ranks", "transversal"]);
type JsonObject = Record<string, unknown>;
const own = (value: object, key: string) => Object.prototype.hasOwnProperty.call(value, key);
const isObject = (value: unknown): value is JsonObject => value !== null && typeof value === "object" && !Array.isArray(value);
const safeString = (value: string) => !value.includes("\0") && !/\p{Surrogate}/u.test(value);
const text = z.string().refine(safeString, "Strings must not contain NUL or unpaired Unicode surrogates.");
const content = text.refine(value => !!value.trim(), "Must contain non-whitespace text.");
const slug = content.max(200).regex(/^[a-z0-9]+(?:[-_][a-z0-9]+)*$/);
const key = content.max(256).refine(value => !RESERVED_KEYS.has(value), "Unsafe object key.");
const integer = z.number().int().min(0).max(Number.MAX_SAFE_INTEGER);
export const draftMutationIdSchema = z.string().min(1).max(128).regex(/^[A-Za-z0-9][A-Za-z0-9._:-]*$/);

// Loose objects intentionally retain canonical authoring-profile extension fields at every level.
const prose = (fields: string[], avoid = false) => z.looseObject({
  ...Object.fromEntries(fields.map(field => [field, content.optional()])),
  ...(avoid ? { avoid: z.array(content).optional() } : {}),
});
const symbol = z.looseObject({ name: text.optional(), description: text.optional(), svg: text.optional() });
const factorization = z.looseObject({
  character: z.enum(["identity", "prime", "composite"]),
  factors: z.array(integer.min(2)).optional(), gloss: text, visual_logic: content.optional(),
});
const visualGrammar = prose(["medium_handling", "composition", "edge_language", "value_structure", "camera_and_scale", "detail_distribution", "finish"], true);
const axisFields = {
  name: content, index: integer, slug: slug.optional(), description: text.optional(),
  visual_style: text.optional(), visual_content: text.optional(), visual_motif: text.optional(), question: text.optional(),
  meaning: z.looseObject({ upright: z.array(text), inverted: z.array(text) }).optional(),
  factorization: factorization.optional(),
};
const suit = z.looseObject({ ...axisFields, symbol: symbol.optional(), numeric_value: integer.optional(), visual_grammar: visualGrammar.optional() });
const rank = z.looseObject({ ...axisFields, symbol: text.optional(), numeric_value: integer.optional(), arcana: z.literal("minor").optional(), visual_form: prose(["composition_law", "spatial_logic", "rhythm", "density", "figure_ground"]).optional() });
const station = z.looseObject({ ...axisFields, symbol: symbol.optional(), visual_environment: prose(["illumination", "palette", "atmosphere", "motion", "density", "material_effects"]).optional() });
const cardFields = {
  slug, name: content,
  number: text.regex(/^(0|[1-9]\d*)$/).refine(value => Number.isSafeInteger(Number(value)), "Must be a safe decimal integer."),
  station_slug: slug, factorization: factorization.optional(),
  meaning: z.looseObject({ upright: content, inverted: content }),
  visuals: z.looseObject({ detailed_description: text, style_override: text.optional(), content_override: text.optional() }),
};
const card = z.discriminatedUnion("arcana", [
  z.looseObject({ ...cardFields, arcana: z.literal("major"), suit_slug: z.never().optional(), rank_slug: z.never().optional() }),
  z.looseObject({ ...cardFields, arcana: z.literal("minor"), suit_slug: slug, rank_slug: slug }),
]);
const spread = z.looseObject({
  id: content.max(200), name: content, description: text, deckId: content.optional(),
  positions: z.array(z.looseObject({ name: content, prompt: text })).min(1).max(MAX_SPREAD_POSITIONS),
});
const dialecticAxis = z.looseObject({ name: content, poles: z.tuple([content, content]) });
const dataMetadata = z.looseObject({
  name: content.optional(), slug: slug.optional(), version: content.optional(),
  theme: z.looseObject({ name: content, description: text, creator: text }).optional(),
  visual_language: prose(["medium", "surface", "mark_making", "signature_accent", "finish"], true).optional(),
  minor_number_origin: z.enum(["rank", "suit", "card"]).optional(),
  major_arcana: z.looseObject({ story: text.optional(), visual_style: text.optional(), visual_grammar: visualGrammar.optional(), symbol: symbol.optional() }).optional(),
  dialectic: z.looseObject({ axes: z.tuple([dialecticAxis, dialecticAxis]), cells: z.record(slug, z.tuple([content, content])) }).optional(),
}).refine(value => !Object.keys(value).some(field => MANAGED_DATA_KEYS.has(field)), "Use the named batch or transversal update for managed fields.");
const transversalMetadata = z.looseObject({ name: content.optional(), description: text.optional(), ordering_rationale: text.optional(), suit_stride: integer.min(1).optional() })
  .refine(value => !own(value, "stations"), "Use the stations batch to edit stations.");
const dataRemoveKey = key.refine(value => !MANAGED_DATA_KEYS.has(value), "Managed fields cannot be removed as metadata.");
const transversalRemoveKey = key.refine(value => value !== "stations", "Stations cannot be removed as transversal metadata.");
const batch = <T extends z.ZodType>(value: T, identity: z.ZodString = slug) => z.strictObject({
  upsert: z.array(value).max(MAX_DRAFT_OPERATIONS).optional(), remove: z.array(identity).max(MAX_DRAFT_OPERATIONS).optional(),
});
const axisUpdate = <T extends z.ZodType>(value: T) => z.strictObject({ key: slug, value }).refine(
  entry => {
    const pair = entry as { key: string; value: unknown };
    return !isObject(pair.value) || pair.value.slug === undefined || pair.value.slug === pair.key;
  },
  "An axis slug must match its key.",
);

const updateShape = z.strictObject({
  draftId: z.uuid(), expectedVersion: integer.min(1), mutationId: draftMutationIdSchema,
  metadata: z.strictObject({ schemaVersion: z.union([z.literal(1), z.literal(2)]).optional(), tagline: text.optional(), data: dataMetadata.optional(), remove: z.array(dataRemoveKey).max(MAX_DRAFT_OPERATIONS).optional() }).optional(),
  transversal: transversalMetadata.optional(), transversalRemove: z.array(transversalRemoveKey).max(MAX_DRAFT_OPERATIONS).optional(),
  cards: batch(card).optional(), suits: batch(axisUpdate(suit)).optional(), ranks: batch(axisUpdate(rank)).optional(), stations: batch(axisUpdate(station)).optional(), spreads: batch(spread, content.max(200)).optional(),
}).superRefine((value, ctx) => {
  let operations = Object.keys(value.metadata?.data ?? {}).length + (value.metadata?.remove?.length ?? 0)
    + Number(value.metadata?.schemaVersion !== undefined) + Number(value.metadata?.tagline !== undefined)
    + Object.keys(value.transversal ?? {}).length + (value.transversalRemove?.length ?? 0);
  const unique = (keys: string[], path: string) => {
    if (new Set(keys).size !== keys.length) ctx.addIssue({ code: "custom", path: [path], message: "Each identity may occur only once across upserts and removals." });
  };
  unique([...Object.keys(value.metadata?.data ?? {}), ...(value.metadata?.remove ?? [])], "metadata");
  unique([...Object.keys(value.transversal ?? {}), ...(value.transversalRemove ?? [])], "transversal");
  for (const section of ["cards", "suits", "ranks", "stations", "spreads"] as const) {
    const edits = value[section];
    operations += (edits?.upsert?.length ?? 0) + (edits?.remove?.length ?? 0);
    const identities = (edits?.upsert ?? []).map(entry => section === "cards" ? (entry as { slug: string }).slug : section === "spreads" ? (entry as { id: string }).id : (entry as { key: string }).key);
    unique([...identities, ...(edits?.remove ?? [])], section);
  }
  if (!operations || operations > MAX_DRAFT_OPERATIONS) ctx.addIssue({ code: "custom", message: `Supply between 1 and ${MAX_DRAFT_OPERATIONS} combined operations; each metadata field counts as one.` });
});

// Validate the raw value as well as the typed view: Zod's loose objects strip __proto__,
// so a post-parse refinement alone would silently discard unsafe extension fields.
export const draftUpdateSchema = z.preprocess((value, ctx) => {
  try { boundedJson(value, MAX_DRAFT_UPDATE_BYTES); }
  catch (error) {
    ctx.addIssue({ code: "custom", message: error instanceof Error ? error.message : "Unsafe draft update." });
    return z.NEVER;
  }
  return value;
}, updateShape);
export type DraftUpdate = z.infer<typeof draftUpdateSchema>;

export const draftReadSchema = z.strictObject({
  draftId: z.uuid(), section: z.enum(["metadata", "transversal", "cards", "suits", "ranks", "stations", "spreads"]).optional(),
  keys: z.array(key).min(1).max(MAX_DRAFT_OPERATIONS).optional(), offset: integer.optional(), limit: integer.min(1).max(MAX_DRAFT_OPERATIONS).optional(),
}).superRefine((value, ctx) => {
  if (!value.section && (value.keys !== undefined || value.offset !== undefined || value.limit !== undefined)) ctx.addIssue({ code: "custom", message: "Select an explicit section before requesting keys or pagination." });
  if (value.keys && new Set(value.keys).size !== value.keys.length) ctx.addIssue({ code: "custom", path: ["keys"], message: "Requested keys must be unique." });
});

/** JSON-only, storage-safe deterministic serialization. Array order is always preserved. */
export function canonicalDraftJson(value: unknown): string { return boundedJson(value, MAX_MANIFEST_UPLOAD_BYTES); }

function boundedJson(value: unknown, maxBytes: number): string {
  // Count and validate iteratively before recursion in JSON.stringify or sorting.
  const active = new Set<object>();
  const stack: Array<{ value: unknown; depth: number; exiting?: boolean }> = [{ value, depth: 0 }];
  let nodes = 0;
  while (stack.length) {
    const current = stack.pop()!;
    if (current.exiting) { active.delete(current.value as object); continue; }
    if (++nodes > MAX_STAGED_MANIFEST_NODES) throw new Error(`Draft exceeds ${MAX_STAGED_MANIFEST_NODES} JSON nodes.`);
    if (current.depth > MAX_STAGED_MANIFEST_DEPTH) throw new Error(`Draft nesting exceeds ${MAX_STAGED_MANIFEST_DEPTH} levels.`);
    const item = current.value;
    if (typeof item === "string") { if (!safeString(item)) throw new Error("Strings must not contain NUL or unpaired Unicode surrogates."); continue; }
    if (item === null || typeof item === "boolean") continue;
    if (typeof item === "number") { if (!Number.isFinite(item)) throw new Error("JSON numbers must be finite."); continue; }
    if (typeof item !== "object") throw new Error("Draft values must be JSON data; undefined, functions, symbols and bigint are not supported.");
    if (active.has(item)) throw new Error("Draft values must not contain cycles.");
    const array = Array.isArray(item);
    const prototype = Object.getPrototypeOf(item);
    if (prototype !== (array ? Array.prototype : Object.prototype) && !(prototype === null && !array)) throw new Error("Draft values must use plain JSON objects and arrays.");
    const keys = Reflect.ownKeys(item);
    if (keys.length + nodes > MAX_STAGED_MANIFEST_NODES + Number(array)) throw new Error(`Draft exceeds ${MAX_STAGED_MANIFEST_NODES} JSON nodes.`);
    active.add(item);
    stack.push({ ...current, exiting: true });
    let arrayEntries = 0;
    for (const field of keys) {
      if (array && field === "length") continue;
      if (typeof field !== "string" || !safeString(field) || RESERVED_KEYS.has(field)) throw new Error("Unsafe object key: NUL, unpaired surrogates and prototype keys are not allowed.");
      if (field.length > MAX_DRAFT_KEY_CHARS) throw new Error(`Draft object keys must be at most ${MAX_DRAFT_KEY_CHARS} characters.`);
      const descriptor = Object.getOwnPropertyDescriptor(item, field)!;
      if (!descriptor.enumerable || !("value" in descriptor)) throw new Error("Draft JSON must not contain accessors or non-enumerable properties.");
      if (array && (!/^(0|[1-9]\d*)$/.test(field) || Number(field) >= item.length)) throw new Error("Draft arrays must not contain named properties.");
      arrayEntries++;
      stack.push({ value: descriptor.value, depth: current.depth + 1 });
    }
    if (array && arrayEntries !== item.length) throw new Error("Draft arrays must not contain holes.");
  }
  const json = JSON.stringify(value);
  if (Buffer.byteLength(json, "utf8") > maxBytes) throw new Error(`Draft JSON must be at most ${maxBytes} UTF-8 JSON bytes.`);
  // Emit keys directly instead of relying on JS enumeration, which reorders integer keys.
  const sorted = (item: unknown): string => {
    if (item === null || typeof item !== "object") return JSON.stringify(item);
    if (Array.isArray(item)) return `[${item.map(sorted).join(",")}]`;
    return `{${Object.keys(item).sort().map(field => `${JSON.stringify(field)}:${sorted((item as JsonObject)[field])}`).join(",")}}`;
  };
  return sorted(value);
}

export const INITIAL_DRAFT_JSON = canonicalDraftJson({ schemaVersion: 2, tagline: "", data: { suits: {}, ranks: {}, transversal: { stations: {} }, major_arcana: {}, cards: {} } });

interface DraftDocument extends JsonObject {
  data: JsonObject & { cards: JsonObject; suits: JsonObject; ranks: JsonObject; transversal: JsonObject & { stations: JsonObject } };
  spreads?: JsonObject[];
}
function readDocument(json: string): DraftDocument {
  if (Buffer.byteLength(json, "utf8") > MAX_MANIFEST_UPLOAD_BYTES) throw new Error("Draft manifest exceeds the byte limit.");
  const value: unknown = JSON.parse(json);
  canonicalDraftJson(value);
  if (!isObject(value) || !isObject(value.data)) throw new Error("Draft must contain an object data field.");
  const data = value.data;
  if (![data.cards, data.suits, data.ranks, data.transversal].every(isObject) || !isObject((data.transversal as JsonObject).stations)) throw new Error("Draft must contain cards, suits, ranks and transversal.stations objects.");
  if (value.spreads !== undefined && (!Array.isArray(value.spreads) || !value.spreads.every(isObject))) throw new Error("Draft spreads must be an array of objects.");
  return value as DraftDocument;
}

/** Local shape checks only: an incomplete or cross-reference-invalid draft remains private. */
export function applyDraftUpdate(json: string, input: unknown): string {
  boundedJson(input, MAX_DRAFT_UPDATE_BYTES);
  const update = draftUpdateSchema.parse(input);
  const next = readDocument(json);
  if (update.metadata?.schemaVersion !== undefined) next.schemaVersion = update.metadata.schemaVersion;
  if (update.metadata?.tagline !== undefined) next.tagline = update.metadata.tagline;
  Object.assign(next.data, update.metadata?.data);
  for (const field of update.metadata?.remove ?? []) remove(next.data, field, "metadata");
  Object.assign(next.data.transversal, update.transversal);
  for (const field of update.transversalRemove ?? []) remove(next.data.transversal, field, "transversal metadata");
  for (const section of ["cards", "suits", "ranks", "stations"] as const) {
    const entries = section === "stations" ? next.data.transversal.stations : next.data[section];
    const edits = update[section];
    for (const field of edits?.remove ?? []) remove(entries, field, section);
    for (const entry of edits?.upsert ?? []) {
      const identity = section === "cards" ? (entry as { slug: string }).slug : (entry as { key: string }).key;
      entries[identity] = section === "cards" ? entry : (entry as { value: unknown }).value;
    }
  }
  if (update.spreads) {
    const entries = next.spreads ?? [];
    for (const id of update.spreads.remove ?? []) {
      const index = entries.findIndex(entry => entry.id === id);
      if (index < 0) throw new Error(`Unknown spread: ${id}.`);
      entries.splice(index, 1);
    }
    for (const entry of update.spreads.upsert ?? []) {
      const index = entries.findIndex(existing => existing.id === entry.id);
      if (index < 0) entries.push(entry); else entries[index] = entry;
    }
    next.spreads = entries;
  }
  return canonicalDraftJson(next);
}
function remove(entries: JsonObject, key: string, section: string): void {
  if (!own(entries, key)) throw new Error(`Unknown ${section} key: ${key}.`);
  delete entries[key];
}

export function draftSummary(json: string) {
  const value = readDocument(json);
  return { cardCount: Object.keys(value.data.cards).length, suitCount: Object.keys(value.data.suits).length, rankCount: Object.keys(value.data.ranks).length, stationCount: Object.keys(value.data.transversal.stations).length, spreadCount: value.spreads?.length ?? 0, byteLength: Buffer.byteLength(json, "utf8") };
}

/** No section returns counts only; explicit reads never expose an unbounded whole manifest. */
export function readDraftPart(json: string, input: unknown) {
  const read = draftReadSchema.parse(input);
  if (!read.section) return draftSummary(json);
  const document = readDocument(json);
  let entries: Array<{ key: string; value: unknown }>;
  switch (read.section) {
    case "metadata": entries = [
      ...Object.keys(document).filter(field => field !== "data" && field !== "spreads").map(field => ({ key: field, value: document[field] })),
      ...Object.keys(document.data).filter(field => !MANAGED_DATA_KEYS.has(field)).map(field => ({ key: `data.${field}`, value: document.data[field] })),
    ].sort((a, b) => a.key < b.key ? -1 : a.key > b.key ? 1 : 0); break;
    case "transversal": entries = Object.keys(document.data.transversal).filter(field => field !== "stations").sort().map(field => ({ key: field, value: document.data.transversal[field] })); break;
    case "spreads": entries = (document.spreads ?? []).map(spread => ({ key: spread.id as string, value: spread })); break;
    default: {
      const section = read.section === "stations" ? document.data.transversal.stations : document.data[read.section];
      entries = Object.keys(section).sort().map(field => ({ key: field, value: section[field] }));
    }
  }
  if (read.keys) {
    const byKey = new Map(entries.map(entry => [entry.key, entry]));
    entries = read.keys.map(key => {
      const entry = byKey.get(key);
      if (!entry) throw new Error(`Unknown ${read.section} key: ${key}.`);
      return entry;
    });
  }
  const offset = read.offset ?? 0;
  const limit = read.limit ?? MAX_DRAFT_OPERATIONS;
  const result = { section: read.section, entries: [] as typeof entries, offset, nextOffset: null as number | null, total: entries.length };
  for (let index = offset; index < Math.min(entries.length, offset + limit); index++) {
    result.entries.push(entries[index]);
    result.nextOffset = index + 1 < entries.length ? index + 1 : null;
    if (Buffer.byteLength(JSON.stringify(result), "utf8") > MAX_DRAFT_READ_BYTES - 2048 - READ_WRAPPER_RESERVE_BYTES) {
      result.entries.pop();
      if (!result.entries.length) throw new Error("A single draft entry exceeds the bounded read limit; replace it with a smaller named value.");
      result.nextOffset = index;
      break;
    }
  }
  return result;
}
