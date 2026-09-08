export interface RateLimitDecision {
  allowed: boolean;
  retryAfterSeconds: number;
}

/** Small in-process fixed-window limiter for private-alpha abuse protection. */
export class FixedWindowRateLimiter {
  private readonly buckets = new Map<string, { startedAt: number; count: number }>();

  constructor(
    readonly limit: number,
    readonly windowMs = 60_000,
    private readonly maxBuckets = 10_000,
  ) {
    if (!Number.isSafeInteger(limit) || limit < 1) throw new Error("Rate limit must be a positive integer.");
    if (!Number.isSafeInteger(windowMs) || windowMs < 1) throw new Error("Rate-limit window must be a positive integer.");
  }

  check(key: string, now = Date.now()): RateLimitDecision {
    const bucketKey = key || "unknown";
    const existing = this.buckets.get(bucketKey);
    if (!existing || now - existing.startedAt >= this.windowMs) {
      this.buckets.set(bucketKey, { startedAt: now, count: 1 });
      this.trim(now);
      return { allowed: true, retryAfterSeconds: 0 };
    }

    existing.count += 1;
    if (existing.count <= this.limit) return { allowed: true, retryAfterSeconds: 0 };
    const remainingMs = Math.max(1, this.windowMs - (now - existing.startedAt));
    return { allowed: false, retryAfterSeconds: Math.ceil(remainingMs / 1000) };
  }

  get size(): number {
    return this.buckets.size;
  }

  private trim(now: number): void {
    if (this.buckets.size <= this.maxBuckets) return;
    for (const [key, bucket] of this.buckets) {
      if (now - bucket.startedAt >= this.windowMs) this.buckets.delete(key);
      if (this.buckets.size <= this.maxBuckets) break;
    }
    while (this.buckets.size > this.maxBuckets) {
      const first = this.buckets.keys().next().value as string | undefined;
      if (first === undefined) break;
      this.buckets.delete(first);
    }
  }
}

export function parseContentLength(value: string | string[] | undefined): number | undefined {
  const raw = Array.isArray(value) ? value[0] : value;
  if (raw === undefined) return undefined;
  if (!/^\d+$/.test(raw)) return undefined;
  const parsed = Number(raw);
  return Number.isSafeInteger(parsed) ? parsed : undefined;
}

export function positiveIntEnv(value: string | undefined, fallback: number, name: string): number {
  if (value === undefined || !value.trim()) return fallback;
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < 1) throw new Error(`${name} must be a positive integer.`);
  return parsed;
}
