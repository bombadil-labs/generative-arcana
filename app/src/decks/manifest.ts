import type { DeckManifest } from "./catalog";
import { immutableJsonSnapshot } from "./jsonSnapshot";
import { DeckRegistry } from "./registry";
import type { Spread } from "./spreads";
import type { DeckModule } from "./types";

export interface DeckManifestOptions {
  tagline?: string;
  spreads?: Spread[];
}

export type DeckManifestValidation =
  | { ok: true; manifest: DeckManifest }
  | { ok: false; error: string };

/** Snapshot one validated runtime deck into the canonical renderer-independent authored artifact. */
export function snapshotDeckManifest(deck: DeckModule): DeckManifest {
  return immutableJsonSnapshot({
    data: deck.data,
    tagline: deck.tagline,
    ...(deck.spreads ? { spreads: deck.spreads } : {}),
  }, "Deck manifest");
}

/**
 * Normalize raw deck data plus optional authored envelope fields into a canonical manifest.
 *
 * This is the compatibility/construction path used by older raw-deck imports. The scratch registry
 * owns the same validation, canonical card ordering, spread normalization, and immutable snapshotting
 * used by ordinary runtime registration, without mutating a caller's registry.
 */
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
 * Validate the canonical authored envelope itself.
 *
 * Canonical authoring producers must provide an explicit non-empty tagline. Consumers may continue
 * to accept legacy raw DeckDataFile input by routing it through `createDeckManifest` first.
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

  try {
    return {
      ok: true,
      manifest: createDeckManifest(record.data, {
        tagline: record.tagline,
        ...(record.spreads === undefined ? {} : { spreads: record.spreads as Spread[] }),
      }),
    };
  } catch (error) {
    return {
      ok: false,
      error: error instanceof Error ? error.message : "Invalid deck manifest.",
    };
  }
}
