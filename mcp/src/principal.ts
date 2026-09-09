import type { ArcanaToolAdapter } from "../../app/src/mcp/ArcanaToolAdapter";
import type { ArcanaHostStore } from "./hostStore";

export interface ArcanaPrincipal {
  /** Stable, opaque scope key. Do not use display names or bearer tokens directly. */
  id: string;
  /** OAuth scopes granted to this principal when the auth adapter exposes them. */
  scopes?: readonly string[];
}

export interface PrincipalRequest {
  method: string;
  url: string;
  headers: Headers;
}

/** Provider-neutral authentication boundary for the HTTP transport. */
export interface PrincipalResolver {
  resolve(request: PrincipalRequest): Promise<ArcanaPrincipal | null> | ArcanaPrincipal | null;
}

export interface ArcanaRequestAccess {
  adapter: ArcanaToolAdapter;
  includeStatefulTools: boolean;
  principal: ArcanaPrincipal | null;
}

/** Resolve one request onto either the anonymous stateless host or a principal-scoped persistent host. */
export async function resolveArcanaRequestAccess(
  request: PrincipalRequest,
  anonymousAdapter: ArcanaToolAdapter,
  hosts: ArcanaHostStore,
  resolver?: PrincipalResolver,
): Promise<ArcanaRequestAccess> {
  const principal = resolver ? await resolver.resolve(request) : null;
  if (!principal) return { adapter: anonymousAdapter, includeStatefulTools: false, principal: null };
  const id = requirePrincipalId(principal.id);
  const normalized: ArcanaPrincipal = {
    id,
    ...(principal.scopes ? { scopes: normalizeScopes(principal.scopes) } : {}),
  };
  return { adapter: await hosts.get(id), includeStatefulTools: true, principal: normalized };
}

export function principalHasScopes(principal: ArcanaPrincipal | null | undefined, required: readonly string[]): boolean {
  if (!principal) return false;
  if (!required.length) return true;
  if (!principal.scopes) return true; // Non-OAuth adapters (stdio/private alpha) retain their existing trusted semantics.
  const granted = new Set(principal.scopes);
  return required.every((scope) => granted.has(scope));
}

function normalizeScopes(scopes: readonly string[]): string[] {
  return [...new Set(scopes.map((scope) => scope.trim()).filter(Boolean))].sort();
}

function requirePrincipalId(value: string): string {
  if (typeof value !== "string" || !value.trim()) throw new Error("Resolved Arcana principal id must be a non-empty string.");
  return value;
}
