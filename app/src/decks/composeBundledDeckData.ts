/**
 * Compose trusted, JSON-only bundled source fragments without mutating the historical base payload.
 *
 * This is a repository authoring convenience, not a second public deck format: the registry validates
 * the fully merged object and every exported/runtime DeckManifest still contains one canonical data tree.
 * Arrays and scalar values replace; plain objects merge recursively.
 */
export function composeBundledDeckData(base: unknown, ...fragments: unknown[]): unknown {
  return fragments.reduce((current, fragment) => merge(current, fragment), clone(base));
}

function merge(base: unknown, patch: unknown): unknown {
  if (!record(base) || !record(patch)) return clone(patch);
  const result: Record<string, unknown> = { ...base };
  for (const [key, value] of Object.entries(patch)) {
    result[key] = Object.prototype.hasOwnProperty.call(result, key)
      ? merge(result[key], value)
      : clone(value);
  }
  return result;
}

function clone(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(clone);
  if (record(value)) return Object.fromEntries(Object.entries(value).map(([key, child]) => [key, clone(child)]));
  return value;
}

function record(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}
