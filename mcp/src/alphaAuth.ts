import { createHash, timingSafeEqual } from "node:crypto";
import type { ArcanaPrincipal, PrincipalRequest, PrincipalResolver } from "./principal";

/**
 * Deliberately small alpha/testing auth adapter.
 *
 * Absence of Authorization preserves anonymous access. A supplied malformed or incorrect credential
 * fails closed instead of silently downgrading to anonymous. The bearer secret is never used as the
 * Arcana scope key; a stable opaque principal id is returned after constant-time digest comparison.
 */
export class StaticBearerPrincipalResolver implements PrincipalResolver {
  private readonly expectedDigest: Buffer;

  constructor(token: string, private readonly principalId = "alpha-user-v1") {
    if (typeof token !== "string" || !token.trim()) throw new Error("Alpha bearer token must be non-empty.");
    if (typeof principalId !== "string" || !principalId.trim()) throw new Error("Alpha principal id must be non-empty.");
    this.expectedDigest = digest(token);
  }

  resolve(request: PrincipalRequest): ArcanaPrincipal | null {
    const authorization = request.headers.get("authorization");
    if (!authorization) return null;
    const match = /^Bearer\s+(.+)$/i.exec(authorization);
    if (!match || !match[1]?.trim()) throw new Error("Authorization must use a Bearer token.");
    const candidate = digest(match[1]);
    if (!timingSafeEqual(this.expectedDigest, candidate)) throw new Error("Invalid bearer token.");
    return { id: this.principalId };
  }
}

function digest(value: string): Buffer {
  return createHash("sha256").update(value, "utf8").digest();
}
