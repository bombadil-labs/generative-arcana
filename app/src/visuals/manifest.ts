import { immutableJsonSnapshot } from "../decks/jsonSnapshot";
import type { DeckManifest } from "../decks/manifest";
import { spreadsForDeck } from "../decks/spreads";

export const CURRENT_VISUAL_PACK_SCHEMA_VERSION = 1 as const;

export type VisualProgramCapability = "time" | "pointer" | "resize" | "signals";

export interface ImageVisualAsset {
  kind: "image";
  /** Relative path inside the portable visual-pack bundle. Never a URL. */
  path: string;
  mediaType: string;
  /** Optional Subresource-Integrity style digest, e.g. `sha256-<base64>`. */
  integrity?: string;
}

export interface ProgramVisualAsset {
  kind: "program";
  /** Relative path inside the portable visual-pack bundle. Never a URL. */
  path: string;
  mediaType: string;
  /** Stable namespaced program format understood only by hosts that explicitly support it. */
  format: string;
  /** Capabilities requested by the program. Declaration is not permission to execute. */
  capabilities?: VisualProgramCapability[];
  /** Additional asset keys the program may need at runtime. */
  dependencies?: string[];
  /** Optional Subresource-Integrity style digest, e.g. `sha256-<base64>`. */
  integrity?: string;
}

export type VisualAssetDeclaration = ImageVisualAsset | ProgramVisualAsset;

/** One card/spread slot bound to a primary asset and, optionally, a static image fallback. */
export interface VisualAssetBinding {
  asset: string;
  fallback?: string;
}

/**
 * Portable authored visual bundle metadata.
 *
 * This artifact intentionally does not contain a deck resource id. It is attached to a deck by the
 * import/catalog operation so the same bundle can travel between installations before GA assigns
 * opaque resource identity. Card slugs and spread ids are resolved within that owning deck.
 */
export interface VisualPackManifest {
  schemaVersion: typeof CURRENT_VISUAL_PACK_SCHEMA_VERSION;
  /** Authored pack-local id; not a globally canonical resource identity. */
  id: string;
  label: string;
  description?: string;
  /** Logical asset key -> bundle-local declaration. */
  assets: Record<string, VisualAssetDeclaration>;
  cards?: Record<string, VisualAssetBinding>;
  spreads?: Record<string, VisualAssetBinding>;
}

export type VisualPackValidation =
  | { ok: true; pack: VisualPackManifest }
  | { ok: false; error: string };

const KEY = /^[a-z0-9]+(?:[-_.][a-z0-9]+)*$/;
const MEDIA_TYPE = /^[A-Za-z0-9!#$&^_.+-]+\/[A-Za-z0-9!#$&^_.+-]+(?:\s*;.*)?$/;
const SRI_SHA256 = /^sha256-[A-Za-z0-9+/]+={0,2}$/;
const CAPABILITIES = new Set<VisualProgramCapability>(["time", "pointer", "resize", "signals"]);

export function validateVisualPackManifest(value: unknown): VisualPackValidation {
  try {
    const pack = record(value, "visualPack");
    if (pack.schemaVersion !== CURRENT_VISUAL_PACK_SCHEMA_VERSION) {
      fail("visualPack.schemaVersion", `must be ${CURRENT_VISUAL_PACK_SCHEMA_VERSION}`);
    }
    const id = key(pack.id, "visualPack.id");
    const label = text(pack.label, "visualPack.label");
    const description = pack.description === undefined ? undefined : stringValue(pack.description, "visualPack.description");

    const rawAssets = record(pack.assets, "visualPack.assets");
    if (!Object.keys(rawAssets).length) fail("visualPack.assets", "must not be empty");
    const assets: Record<string, VisualAssetDeclaration> = {};
    const paths = new Set<string>();

    for (const [assetKey, raw] of Object.entries(rawAssets)) {
      key(assetKey, `visualPack.assets.${assetKey}`);
      const asset = record(raw, `visualPack.assets.${assetKey}`);
      if (asset.kind !== "image" && asset.kind !== "program") {
        fail(`visualPack.assets.${assetKey}.kind`, "must be image or program");
      }
      const path = relativeAssetPath(asset.path, `visualPack.assets.${assetKey}.path`);
      if (paths.has(path)) fail(`visualPack.assets.${assetKey}.path`, "duplicates another asset path");
      paths.add(path);
      const mediaType = mediaTypeValue(asset.mediaType, `visualPack.assets.${assetKey}.mediaType`);
      const integrity = asset.integrity === undefined
        ? undefined
        : integrityValue(asset.integrity, `visualPack.assets.${assetKey}.integrity`);

      if (asset.kind === "image") {
        if (!mediaType.toLowerCase().startsWith("image/")) {
          fail(`visualPack.assets.${assetKey}.mediaType`, "image assets must use an image/* media type");
        }
        assets[assetKey] = {
          kind: "image",
          path,
          mediaType,
          ...(integrity ? { integrity } : {}),
        };
      } else {
        const format = text(asset.format, `visualPack.assets.${assetKey}.format`);
        const capabilities = optionalCapabilities(asset.capabilities, `visualPack.assets.${assetKey}.capabilities`);
        const dependencies = optionalKeyList(asset.dependencies, `visualPack.assets.${assetKey}.dependencies`);
        assets[assetKey] = {
          kind: "program",
          path,
          mediaType,
          format,
          ...(capabilities ? { capabilities } : {}),
          ...(dependencies ? { dependencies } : {}),
          ...(integrity ? { integrity } : {}),
        };
      }
    }

    for (const [assetKey, asset] of Object.entries(assets)) {
      if (asset.kind !== "program") continue;
      for (const dependency of asset.dependencies ?? []) {
        if (!assets[dependency]) fail(`visualPack.assets.${assetKey}.dependencies`, `references unknown asset “${dependency}”`);
        if (dependency === assetKey) fail(`visualPack.assets.${assetKey}.dependencies`, "must not reference itself");
      }
    }

    const cards = optionalBindings(pack.cards, "visualPack.cards", assets);
    const spreads = optionalBindings(pack.spreads, "visualPack.spreads", assets);
    if (!cards && !spreads) fail("visualPack", "must bind at least one card or spread");

    const normalized: VisualPackManifest = {
      schemaVersion: CURRENT_VISUAL_PACK_SCHEMA_VERSION,
      id,
      label,
      ...(description === undefined ? {} : { description }),
      assets,
      ...(cards ? { cards } : {}),
      ...(spreads ? { spreads } : {}),
    };
    return { ok: true, pack: immutableJsonSnapshot(normalized, "Visual pack manifest") };
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : "Invalid visual pack manifest." };
  }
}

/** Validate a portable pack and additionally prove its card/spread bindings belong to one deck. */
export function validateVisualPackForDeck(value: unknown, deck: DeckManifest): VisualPackValidation {
  const result = validateVisualPackManifest(value);
  if (!result.ok) return result;
  try {
    for (const slug of Object.keys(result.pack.cards ?? {})) {
      if (!deck.data.cards[slug]) fail(`visualPack.cards.${slug}`, "references a card that does not exist in the owning deck");
    }
    const spreadIds = new Set(spreadsForDeck(deck.spreads).map((spread) => spread.id));
    for (const spreadId of Object.keys(result.pack.spreads ?? {})) {
      if (!spreadIds.has(spreadId)) fail(`visualPack.spreads.${spreadId}`, "references a spread that does not exist for the owning deck");
    }
    return result;
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : "Visual pack does not match the owning deck." };
  }
}

function optionalBindings(
  value: unknown,
  path: string,
  assets: Record<string, VisualAssetDeclaration>,
): Record<string, VisualAssetBinding> | undefined {
  if (value === undefined) return undefined;
  const raw = record(value, path);
  if (!Object.keys(raw).length) fail(path, "must not be empty when provided");
  const result: Record<string, VisualAssetBinding> = {};
  for (const [slot, rawBinding] of Object.entries(raw)) {
    key(slot, `${path}.${slot}`);
    const binding = record(rawBinding, `${path}.${slot}`);
    const asset = key(binding.asset, `${path}.${slot}.asset`);
    if (!assets[asset]) fail(`${path}.${slot}.asset`, `references unknown asset “${asset}”`);
    let fallback: string | undefined;
    if (binding.fallback !== undefined) {
      fallback = key(binding.fallback, `${path}.${slot}.fallback`);
      const fallbackAsset = assets[fallback];
      if (!fallbackAsset) fail(`${path}.${slot}.fallback`, `references unknown asset “${fallback}”`);
      if (fallbackAsset.kind !== "image") fail(`${path}.${slot}.fallback`, "must reference an image asset");
      if (fallback === asset) fail(`${path}.${slot}.fallback`, "must differ from the primary asset");
    }
    result[slot] = { asset, ...(fallback ? { fallback } : {}) };
  }
  return result;
}

function optionalCapabilities(value: unknown, path: string): VisualProgramCapability[] | undefined {
  if (value === undefined) return undefined;
  if (!Array.isArray(value) || !value.length) fail(path, "must be a non-empty array when provided");
  const seen = new Set<string>();
  return value.map((raw, index) => {
    const capability = stringValue(raw, `${path}[${index}]`) as VisualProgramCapability;
    if (!CAPABILITIES.has(capability)) fail(`${path}[${index}]`, "is not a supported declared capability");
    if (seen.has(capability)) fail(`${path}[${index}]`, "duplicates another capability");
    seen.add(capability);
    return capability;
  });
}

function optionalKeyList(value: unknown, path: string): string[] | undefined {
  if (value === undefined) return undefined;
  if (!Array.isArray(value) || !value.length) fail(path, "must be a non-empty array when provided");
  const seen = new Set<string>();
  return value.map((raw, index) => {
    const entry = key(raw, `${path}[${index}]`);
    if (seen.has(entry)) fail(`${path}[${index}]`, "duplicates another asset key");
    seen.add(entry);
    return entry;
  });
}

function relativeAssetPath(value: unknown, path: string): string {
  const result = text(value, path);
  if (result.startsWith("/") || result.includes("\\") || result.includes("?") || result.includes("#")) {
    fail(path, "must be a relative POSIX bundle path without query or fragment");
  }
  if (/^[A-Za-z][A-Za-z0-9+.-]*:/.test(result)) fail(path, "must not be a URL or URI");
  const segments = result.split("/");
  if (segments.some((segment) => !segment || segment === "." || segment === "..")) {
    fail(path, "must not contain empty, dot, or parent-directory segments");
  }
  return result;
}

function mediaTypeValue(value: unknown, path: string): string {
  const result = text(value, path);
  if (!MEDIA_TYPE.test(result)) fail(path, "must be a valid media type");
  return result;
}

function integrityValue(value: unknown, path: string): string {
  const result = text(value, path);
  if (!SRI_SHA256.test(result)) fail(path, "must use sha256 Subresource Integrity syntax");
  return result;
}

function key(value: unknown, path: string): string {
  const result = text(value, path);
  if (!KEY.test(result)) fail(path, "must be a lowercase key using letters, digits, hyphens, underscores, or dots");
  return result;
}

function text(value: unknown, path: string): string {
  const result = stringValue(value, path);
  if (!result.trim()) fail(path, "must contain text");
  return result.trim();
}

function stringValue(value: unknown, path: string): string {
  if (typeof value !== "string") fail(path, "must be a string");
  return value;
}

function record(value: unknown, path: string): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) fail(path, "must be an object");
  return value as Record<string, unknown>;
}

function fail(path: string, message: string): never {
  throw new Error(`${path}: ${message}.`);
}
