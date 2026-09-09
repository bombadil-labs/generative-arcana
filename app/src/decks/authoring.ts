import type { DeckManifest } from "./manifest";
import { createDeckManifest, validateDeckManifest } from "./manifest";

export const DECK_MANIFEST_SPEC_VERSION = "1";

/**
 * Compact machine-readable description of the authored artifact boundary.
 *
 * This intentionally describes ownership of concerns rather than attempting to duplicate every
 * referential-integrity rule as JSON Schema. `validateDeckManifest` remains the executable source of
 * truth for the full contract.
 */
export const DECK_MANIFEST_SPEC = Object.freeze({
  kind: "generative-arcana/deck-manifest",
  version: DECK_MANIFEST_SPEC_VERSION,
  envelope: {
    required: ["data", "tagline"] as const,
    optional: ["spreads"] as const,
    data: "validated renderer-independent DeckDataFile",
    tagline: "non-empty human-facing string",
    spreads: "optional deck-native Spread array",
  },
  identity: {
    authoredSlug: "manifest.data.slug",
    stableResourceId: "assigned by a Generative Arcana catalog after import; never authored into the manifest",
  },
  excludedConcerns: [
    "catalog resource id",
    "owner/principal id",
    "visibility",
    "catalog revision or timestamps",
    "OAuth/OIDC/provider/session metadata",
    "host-specific MCP metadata",
    "renderer implementation objects",
  ] as const,
  compatibility: {
    rawDeckDataImportAccepted: true,
    rawDeckDataIsCanonicalManifest: false,
  },
  validation: {
    normalizesDeckData: true,
    derivesCanonicalRuntimeCardOrder: true,
    normalizesNativeSpreadOwnership: true,
    preservesUnknownDeckExtensions: true,
  },
  authoringProfiles: {
    runtimeCardinalityFixed: false,
    note: "Host/workflow authoring profiles may impose stronger generation constraints without changing DeckManifest.",
  },
} as const);

export interface DeckManifestSummary {
  name: string;
  slug: string;
  version: string;
  cardCount: number;
  suitCount: number;
  rankCount: number;
  stationCount: number;
  spreadCount: number;
}

export type DeckAuthoringInputKind = "manifest" | "legacy-raw-deck" | "unknown";

export type DeckAuthoringValidation =
  | {
      valid: true;
      specVersion: string;
      inputKind: Exclude<DeckAuthoringInputKind, "unknown">;
      canonical: boolean;
      summary: DeckManifestSummary;
      warning?: string;
      normalizedManifest?: DeckManifest;
    }
  | {
      valid: false;
      specVersion: string;
      inputKind: DeckAuthoringInputKind;
      canonical: boolean;
      error: string;
    };

export interface InspectDeckAuthoringOptions {
  includeNormalizedManifest?: boolean;
}

/**
 * Validate an authored artifact without importing it or mutating a caller's deck registry.
 *
 * Canonical DeckManifest is the producer contract. Bare DeckDataFile remains accepted here only so
 * upload/import compatibility can be diagnosed with the same validation boundary used by persistence.
 */
export function inspectDeckAuthoringArtifact(
  value: unknown,
  options: InspectDeckAuthoringOptions = {},
): DeckAuthoringValidation {
  const manifestCandidate = looksLikeManifestEnvelope(value);
  if (manifestCandidate) {
    const validation = validateDeckManifest(value);
    if (!validation.ok) {
      return invalid("manifest", true, validation.error);
    }
    return valid("manifest", true, validation.manifest, options);
  }

  try {
    const manifest = createDeckManifest(value);
    return valid("legacy-raw-deck", false, manifest, options, {
      warning: "Bare DeckDataFile is accepted for compatibility, but new authoring workflows should emit canonical DeckManifest { data, tagline, spreads? }.",
    });
  } catch (error) {
    return invalid(
      "legacy-raw-deck",
      false,
      error instanceof Error ? error.message : "Invalid deck authoring artifact.",
    );
  }
}

/** Build a stable invalid result for transport adapters that fail before JSON reaches domain validation. */
export function invalidDeckAuthoringArtifact(error: string): DeckAuthoringValidation {
  return invalid("unknown", false, error);
}

function valid(
  inputKind: "manifest" | "legacy-raw-deck",
  canonical: boolean,
  manifest: DeckManifest,
  options: InspectDeckAuthoringOptions,
  extra: { warning?: string } = {},
): DeckAuthoringValidation {
  const summary = summarize(manifest);
  return {
    valid: true,
    specVersion: DECK_MANIFEST_SPEC_VERSION,
    inputKind,
    canonical,
    summary,
    ...extra,
    ...(options.includeNormalizedManifest ? { normalizedManifest: manifest } : {}),
  };
}

function invalid(inputKind: DeckAuthoringInputKind, canonical: boolean, error: string): DeckAuthoringValidation {
  return {
    valid: false,
    specVersion: DECK_MANIFEST_SPEC_VERSION,
    inputKind,
    canonical,
    error,
  };
}

function summarize(manifest: DeckManifest): DeckManifestSummary {
  return {
    name: manifest.data.name,
    slug: manifest.data.slug,
    version: manifest.data.version,
    cardCount: Object.keys(manifest.data.cards).length,
    suitCount: Object.keys(manifest.data.suits).length,
    rankCount: Object.keys(manifest.data.ranks).length,
    stationCount: Object.keys(manifest.data.transversal.stations).length,
    spreadCount: manifest.spreads?.length ?? 0,
  };
}

function looksLikeManifestEnvelope(value: unknown): boolean {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const record = value as Record<string, unknown>;
  if (Object.prototype.hasOwnProperty.call(record, "data")) return true;
  // A half-authored envelope should receive manifest-specific diagnostics rather than being mistaken
  // for raw DeckDataFile. Real DeckDataFile always requires name/slug/version at the top level.
  return !Object.prototype.hasOwnProperty.call(record, "name")
    && (Object.prototype.hasOwnProperty.call(record, "tagline") || Object.prototype.hasOwnProperty.call(record, "spreads"));
}
