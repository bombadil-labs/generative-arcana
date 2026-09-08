import type { ArcanaToolAdapter } from "../../app/src/mcp/ArcanaToolAdapter";
import type { ArcanaHostStore } from "./hostStore";

export interface ArcanaPrincipal {
  /** Stable, opaque scope key. Do not use display names or bearer tokens directly. */
  id: string;
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

/**
 * Resolve one request onto either the anonymous stateless host or a principal-scoped persistent host.
 * Authentication policy stays outside Arcana; this function only translates an already-resolved
 * principal into the correct host/state lifetime.
 */
export async function resolveArcanaRequestAccess(
  request: PrincipalRequest,
  anonymousAdapter: ArcanaToolAdapter,
  hosts: ArcanaHostStore,
  resolver?: PrincipalResolver,
): Promise<ArcanaRequestAccess> {
  const principal = resolver ? await resolver.resolve(request) : null;
  if (!principal) return { adapter: anonymousAdapter, includeStatefulTools: false, principal: null };
  const id = requirePrincipalId(principal.id);
  return { adapter: hosts.get(id), includeStatefulTools: true, principal: { id } };
}

function requirePrincipalId(value: string): string {
  if (typeof value !== "string" || !value.trim()) throw new Error("Resolved Arcana principal id must be a non-empty string.");
  return value;
}
