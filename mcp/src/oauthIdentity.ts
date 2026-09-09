import { createRemoteJWKSet, jwtVerify, type JWTPayload } from "jose";
import type { ArcanaPrincipal, PrincipalRequest, PrincipalResolver } from "./principal";

export interface ExternalIdentity {
  issuer: string;
  subject: string;
}

export interface ExternalIdentityRepository {
  resolveOrCreate(identity: ExternalIdentity): Promise<string>;
}

export interface VerifiedBearerIdentity extends ExternalIdentity {
  scopes: string[];
}

export interface BearerIdentityVerifier {
  verify(token: string): Promise<VerifiedBearerIdentity>;
}

export class OAuthPrincipalError extends Error {
  constructor(
    readonly statusCode: 401 | 403,
    readonly oauthError: "invalid_request" | "invalid_token" | "insufficient_scope",
    message: string,
    readonly scopes: readonly string[] = [],
  ) {
    super(message);
    this.name = "OAuthPrincipalError";
  }
}

/** Small development/test identity map with the same stable-principal semantics as the Neon adapter. */
export class InMemoryExternalIdentityRepository implements ExternalIdentityRepository {
  private readonly identities = new Map<string, string>();
  private nextId = 1;

  async resolveOrCreate(identity: ExternalIdentity): Promise<string> {
    const issuer = requireIssuer(identity.issuer);
    const subject = requireSubject(identity.subject);
    const key = `${issuer}\u0000${subject}`;
    const existing = this.identities.get(key);
    if (existing) return existing;
    const principalId = `usr_test_${this.nextId++}`;
    this.identities.set(key, principalId);
    return principalId;
  }
}

/**
 * Provider-neutral bearer resolver.
 *
 * The verifier owns token cryptography/protocol details. The identity repository owns the mapping
 * from an external `(issuer, subject)` pair to Generative Arcana's stable opaque principal id.
 */
export class OAuthPrincipalResolver implements PrincipalResolver {
  constructor(
    private readonly verifier: BearerIdentityVerifier,
    private readonly identities: ExternalIdentityRepository,
    private readonly requiredScopes: readonly string[] = ["decks:read"],
  ) {}

  async resolve(request: PrincipalRequest): Promise<ArcanaPrincipal | null> {
    const authorization = request.headers.get("authorization");
    if (!authorization) return null;

    const match = /^Bearer\s+(.+)$/i.exec(authorization);
    if (!match || !match[1]?.trim()) {
      throw new OAuthPrincipalError(401, "invalid_request", "Authorization must use a Bearer token.");
    }

    const identity = await this.verifier.verify(match[1].trim());
    const scopes = normalizeScopes(identity.scopes);
    const missing = this.requiredScopes.filter((scope) => !scopes.includes(scope));
    if (missing.length) {
      throw new OAuthPrincipalError(
        403,
        "insufficient_scope",
        `Access token is missing required scope${missing.length === 1 ? "" : "s"}: ${missing.join(", ")}.`,
        this.requiredScopes,
      );
    }

    const id = await this.identities.resolveOrCreate({
      issuer: requireIssuer(identity.issuer),
      subject: requireSubject(identity.subject),
    });
    return { id, scopes };
  }
}

/**
 * Standard OIDC JWT verifier. It either uses an explicitly configured JWKS URI or discovers one
 * from the issuer's OpenID Provider Configuration document, then validates issuer + audience.
 */
export class OidcJwtBearerIdentityVerifier implements BearerIdentityVerifier {
  private keySetPromise?: Promise<ReturnType<typeof createRemoteJWKSet>>;

  constructor(
    private readonly issuer: string,
    private readonly audience: string,
    private readonly jwksUri?: string,
  ) {
    requireIssuer(issuer);
    requireAudience(audience);
    if (jwksUri !== undefined) requireHttpsUrl(jwksUri, "OIDC JWKS URI");
  }

  async verify(token: string): Promise<VerifiedBearerIdentity> {
    if (typeof token !== "string" || !token.trim()) {
      throw new OAuthPrincipalError(401, "invalid_token", "Bearer token must be non-empty.");
    }

    try {
      const keySet = await this.getKeySet();
      const { payload } = await jwtVerify(token, keySet, {
        issuer: this.issuer,
        audience: this.audience,
      });
      return identityFromPayload(payload);
    } catch (error) {
      if (error instanceof OAuthPrincipalError) throw error;
      throw new OAuthPrincipalError(
        401,
        "invalid_token",
        error instanceof Error ? `Access token validation failed: ${error.message}` : "Access token validation failed.",
      );
    }
  }

  private getKeySet(): Promise<ReturnType<typeof createRemoteJWKSet>> {
    this.keySetPromise ??= (async () => {
      const uri = this.jwksUri ?? await discoverJwksUri(this.issuer);
      return createRemoteJWKSet(new URL(uri));
    })();
    return this.keySetPromise;
  }
}

function identityFromPayload(payload: JWTPayload): VerifiedBearerIdentity {
  if (typeof payload.iss !== "string" || !payload.iss.trim()) {
    throw new OAuthPrincipalError(401, "invalid_token", "Access token is missing issuer.");
  }
  if (typeof payload.sub !== "string" || !payload.sub.trim()) {
    throw new OAuthPrincipalError(401, "invalid_token", "Access token is missing subject.");
  }
  return {
    issuer: payload.iss,
    subject: payload.sub,
    scopes: scopesFromPayload(payload),
  };
}

function scopesFromPayload(payload: JWTPayload): string[] {
  const values: string[] = [];
  const scope = payload.scope;
  if (typeof scope === "string") values.push(...scope.split(/\s+/));

  const scp = payload.scp;
  if (typeof scp === "string") values.push(...scp.split(/\s+/));
  else if (Array.isArray(scp)) {
    for (const item of scp) if (typeof item === "string") values.push(item);
  }
  return normalizeScopes(values);
}

async function discoverJwksUri(issuer: string): Promise<string> {
  const response = await fetch(openIdConfigurationUrl(issuer), {
    headers: { accept: "application/json" },
  });
  if (!response.ok) throw new Error(`OIDC discovery failed with HTTP ${response.status}.`);
  const metadata = await response.json() as Record<string, unknown>;
  if (metadata.issuer !== issuer) {
    throw new Error("OIDC discovery issuer does not exactly match MCP_OAUTH_ISSUER.");
  }
  if (typeof metadata.jwks_uri !== "string") throw new Error("OIDC discovery metadata is missing jwks_uri.");
  return requireHttpsUrl(metadata.jwks_uri, "OIDC jwks_uri");
}

function openIdConfigurationUrl(issuer: string): URL {
  const url = new URL(requireIssuer(issuer));
  const basePath = url.pathname.replace(/\/$/, "");
  url.pathname = `${basePath}/.well-known/openid-configuration`;
  url.search = "";
  url.hash = "";
  return url;
}

function normalizeScopes(scopes: readonly string[]): string[] {
  return [...new Set(scopes.map((scope) => scope.trim()).filter(Boolean))].sort();
}

function requireIssuer(value: string): string {
  return requireHttpsUrl(value, "OIDC issuer");
}

function requireAudience(value: string): string {
  if (typeof value !== "string" || !value.trim()) throw new Error("OIDC audience must be non-empty.");
  return value.trim();
}

function requireSubject(value: string): string {
  if (typeof value !== "string" || !value.trim()) throw new Error("OIDC subject must be non-empty.");
  return value.trim();
}

function requireHttpsUrl(value: string, label: string): string {
  if (typeof value !== "string" || !value.trim()) throw new Error(`${label} must be non-empty.`);
  const url = new URL(value.trim());
  const loopback = url.hostname === "localhost" || url.hostname === "127.0.0.1" || url.hostname === "::1";
  if (url.protocol !== "https:" && !(loopback && url.protocol === "http:")) {
    throw new Error(`${label} must use HTTPS (or HTTP on loopback).`);
  }
  if (url.username || url.password || url.hash) throw new Error(`${label} must not contain credentials or a fragment.`);
  return url.href;
}
