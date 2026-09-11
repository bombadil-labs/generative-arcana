import { immutableJsonSnapshot } from "./jsonSnapshot";
import { DeckRegistry } from "./registry";
import type { Spread } from "./spreads";
import type { DeckDataFile, DeckModule } from "./types";

export const CURRENT_DECK_MANIFEST_SCHEMA_VERSION = 2 as const;
export type DeckManifestSchemaVersion = 1 | typeof CURRENT_DECK_MANIFEST_SCHEMA_VERSION;

/** Canonical v2 authored artifact. */
export interface DeckManifest {
  schemaVersion: typeof CURRENT_DECK_MANIFEST_SCHEMA_VERSION;
  data: DeckDataFile;
  tagline: string;
  spreads?: Spread[];
}

/** Historical v1 envelope. Absence of `schemaVersion` is treated as v1 for compatibility. */
export interface LegacyDeckManifestV1 {
  schemaVersion?: 1;
  data: DeckDataFile;
  tagline: string;
  spreads?: Spread[];
}

export type DeckManifestInput = DeckManifest | LegacyDeckManifestV1;

export interface DeckManifestOptions {
  tagline?: string;
  spreads?: Spread[];
}

export type DeckManifestValidation =
  | {
      ok: true;
      manifest: DeckManifest;
      sourceSchemaVersion: DeckManifestSchemaVersion;
      migrated: boolean;
    }
  | { ok: false; error: string };

/** Snapshot one validated runtime deck into the current canonical authored artifact. */
export function snapshotDeckManifest(deck: DeckModule): DeckManifest {
  return immutableJsonSnapshot({
    schemaVersion: CURRENT_DECK_MANIFEST_SCHEMA_VERSION,
    data: deck.data,
    tagline: deck.tagline,
    ...(deck.spreads ? { spreads: deck.spreads } : {}),
  }, "Deck manifest");
}

/** Normalize raw deck data plus optional authored envelope fields into the current manifest schema. */
export function createDeckManifest(data: unknown, options: DeckManifestOptions = {}): DeckManifest {
  const scratch = new DeckRegistry();
  const deck = scratch.registerDeck({
    data,
    tagline: options.tagline,
    spreads: options.spreads,
    custom: true,
  });
  return snapshotDeckManifest(deck);
}

/**
 * Validate any supported manifest envelope and normalize it to the current canonical schema.
 *
 * v1 manifests omitted `schemaVersion`; v2 requires `schemaVersion: 2`. Future unsupported versions
 * fail closed rather than being silently interpreted as the current contract.
 */
export function validateDeckManifest(value: unknown): DeckManifestValidation {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return { ok: false, error: "manifest: must be an object." };
  }
  const record = value as Record<string, unknown>;
  if (!("data" in record)) return { ok: false, error: "manifest.data: is required." };
  if (typeof record.tagline !== "string" || !record.tagline.trim()) {
    return { ok: false, error: "manifest.tagline: must be a non-empty string." };
  }
  if (record.spreads !== undefined && !Array.isArray(record.spreads)) {
    return { ok: false, error: "manifest.spreads: must be an array when provided." };
  }

  const version = manifestSchemaVersion(record.schemaVersion);
  if (!version.ok) return version;

  try {
    return {
      ok: true,
      manifest: createDeckManifest(record.data, {
        tagline: record.tagline,
        ...(record.spreads === undefined ? {} : { spreads: record.spreads as Spread[] }),
      }),
      sourceSchemaVersion: version.version,
      migrated: version.version !== CURRENT_DECK_MANIFEST_SCHEMA_VERSION,
    };
  } catch (error) {
    return {
      ok: false,
      error: error instanceof Error ? error.message : "Invalid deck manifest.",
    };
  }
}

function manifestSchemaVersion(value: unknown):
  | { ok: true; version: DeckManifestSchemaVersion }
  | { ok: false; error: string } {
  if (value === undefined || value === 1) return { ok: true, version: 1 };
  if (value === CURRENT_DECK_MANIFEST_SCHEMA_VERSION) {
    return { ok: true, version: CURRENT_DECK_MANIFEST_SCHEMA_VERSION };
  }
  return { ok: false, error: `manifest.schemaVersion: unsupported schema version ${String(value)}.` };
}
