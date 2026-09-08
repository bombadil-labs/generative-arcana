/**
 * Detach runtime domain data from caller-owned objects while enforcing the repository's JSON-data
 * contract. The returned graph is deeply frozen, so successful validation remains true for the
 * lifetime of a registered snapshot.
 */
export function immutableJsonSnapshot<T>(value: T, root = "value"): T {
  return cloneJson(value, root, new WeakSet<object>()) as T;
}

function cloneJson(value: unknown, path: string, ancestors: WeakSet<object>): unknown {
  if (value === null || typeof value === "string" || typeof value === "boolean") return value;
  if (typeof value === "number") {
    if (!Number.isFinite(value)) throw new Error(`${path}: JSON numbers must be finite.`);
    return value;
  }
  if (typeof value !== "object") {
    throw new Error(`${path}: must contain only JSON-compatible values.`);
  }

  if (ancestors.has(value)) throw new Error(`${path}: JSON data cannot contain cycles.`);
  ancestors.add(value);
  try {
    if (Array.isArray(value)) {
      const copy = value.map((entry, index) => cloneJson(entry, `${path}[${index}]`, ancestors));
      return Object.freeze(copy);
    }

    const proto = Object.getPrototypeOf(value);
    if (proto !== Object.prototype && proto !== null) {
      throw new Error(`${path}: JSON objects must be plain objects.`);
    }
    if (Object.getOwnPropertySymbols(value).length) {
      throw new Error(`${path}: JSON objects cannot contain symbol keys.`);
    }

    const copy: Record<string, unknown> = {};
    for (const key of Object.keys(value)) {
      const descriptor = Object.getOwnPropertyDescriptor(value, key);
      if (!descriptor || !("value" in descriptor)) {
        throw new Error(`${path}.${key}: JSON data cannot contain accessors.`);
      }
      copy[key] = cloneJson(descriptor.value, `${path}.${key}`, ancestors);
    }
    return Object.freeze(copy);
  } finally {
    ancestors.delete(value);
  }
}
