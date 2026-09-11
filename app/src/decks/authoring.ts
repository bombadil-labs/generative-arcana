import type { DeckManifest } from "./manifest";
import {
  CURRENT_DECK_MANIFEST_SCHEMA_VERSION,
  createDeckManifest,
  validateDeckManifest,
} from "./manifest";

export const DECK_MANIFEST_SPEC_VERSION = "2";

/** Compact machine-readable description of the authored artifact boundary. */
export const DECK_MANIFEST_SPEC = Object.freeze({
  kind: "generative-arcana/deck-manifest",
  version: DECK_MANIFEST_SPEC_VERSION,
  schema: {
    current: CURRENT_DECK_MANIFEST_SCHEMA_VERSION,
    legacyManifestV1Accepted: true,
    legacyRawDeckAccepted: true,
  },
  envelope: {
    required: ["schemaVersion", "data", "tagline"] as const,
    optional: ["spreads"] as const,
    schemaVersion: `must be ${CURRENT_DECK_MANIFEST_SCHEMA_VERSION} for new authored manifests`,
    data: "validated renderer-independent DeckDataFile",
    tagline: "non-empty human-facing string",
    spreads: "optional deck-native Spread array",
  },
  identity: {
    authoredSlug: "manifest.data.slug",
    stableResourceId: "assigned by a Generative Arcana catalog after import; never authored into the manifest",
  },
  projections: {
    cardRenderSpec: "derived, denormalized read view embedding deck/family/rank/station/number/card visual context",
    storageIndependence: "physical database normalization is a repository concern, not part of DeckManifest semantics",
  },
  numericOwnership: {
    minorOriginField: "manifest.data.minor_numeric_origin",
    allowed: ["rank", "suit", "card"] as const,
    ownerValueField: "numeric_value",
    ownerFactorizationField: "factorization",
    legacyInference: "when minor_numeric_origin is omitted, infer matching rank numeric_value, then suit numeric_value, then card-local numbering",
    note: "Majors always originate their number on the card; alternate minor profiles may originate it on rank, suit, or card.",
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
    v1ManifestAcceptedAndMigrated: true,
    v1ManifestIsCanonical: false,
  },
  validation: {
    normalizesDeckData: true,
    derivesCanonicalRuntimeCardOrder: true,
    normalizesNativeSpreadOwnership: true,
    preservesUnknownDeckExtensions: true,
    migratesSupportedLegacyManifestVersions: true,
  },
  authoringProfiles: {
    runtimeCardinalityFixed: false,
    note: "Host/workflow authoring profiles may impose stronger generation constraints without changing DeckManifest.",
  },
} as const);

export interface DeckManifestSummary {
  schemaVersion: number;
  name: string;
  slug: string;
  version: string;
  cardCount: number;
  suitCount: number;
  rankCount: number;
  stationCount: number;
  spreadCount: number;
}

export type DeckAuthoringInputKind = "manifest-v2" | "legacy-manifest-v1" | "legacy-raw-deck" | "unknown";

export type DeckAuthoringValidation =
  | {
      valid: true;
      specVersion: string;
      inputKind: Exclude<DeckAuthoringInputKind, "unknown">;
      canonical: boolean;
      migrated: boolean;
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

/** Validate authored input without importing it or mutating runtime/catalog state. */
export function inspectDeckAuthoringArtifact(
  value: unknown,
  options: InspectDeckAuthoringOptions = {},
): DeckAuthoringValidation {
  const manifestCandidate = looksLikeManifestEnvelope(value);
  if (manifestCandidate) {
    const validation = validateDeckManifest(value);
    if (!validation.ok) {
      return invalid("manifest-v2", true, validation.error);
    }
    const canonical = validation.sourceSchemaVersion === CURRENT_DECK_MANIFEST_SCHEMA_VERSION;
    return valid(
      canonical ? "manifest-v2" : "legacy-manifest-v1",
      canonical,
      validation.manifest,
      validation.migrated,
      options,
      canonical
        ? {}
        : { warning: "DeckManifest v1 is accepted for compatibility and normalized to schemaVersion 2. New authoring should emit schemaVersion: 2." },
    );
  }

  try {
    const manifest = createDeckManifest(value);
    return valid("legacy-raw-deck", false, manifest, true, options, {
      warning: "Bare DeckDataFile is accepted for compatibility, but new authoring workflows should emit schemaVersion 2 DeckManifest.",
    });
  } catch (error) {
    return invalid(
      "legacy-raw-deck",
      false,
      error instanceof Error ? error.message : "Invalid deck authoring artifact.",
    );
  }
}

export function invalidDeckAuthoringArtifact(error: string): DeckAuthoringValidation {
  return invalid("unknown", false, error);
}

function valid(
  inputKind: Exclude<DeckAuthoringInputKind, "unknown">,
  canonical: boolean,
  manifest: DeckManifest,
  migrated: boolean,
  options: InspectDeckAuthoringOptions,
  extra: { warning?: string } = {},
): DeckAuthoringValidation {
  return {
    valid: true,
    specVersion: DECK_MANIFEST_SPEC_VERSION,
    inputKind,
    canonical,
    migrated,
    summary: summarize(manifest),
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
    schemaVersion: manifest.schemaVersion,
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
  if (Object.prototype.hasOwnProperty.call(record, "schemaVersion")) return true;
  return !Object.prototype.hasOwnProperty.call(record, "name")
    && (Object.prototype.hasOwnProperty.call(record, "tagline") || Object.prototype.hasOwnProperty.call(record, "spreads"));
}
