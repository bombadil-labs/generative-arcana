export const DEFAULT_DECK_READ_SCOPES = ["decks:read"] as const;
export const DEFAULT_DECK_WRITE_SCOPES = ["decks:write"] as const;

export type ToolSecurityScheme =
  | { type: "noauth" }
  | { type: "oauth2"; scopes: string[] };

export interface OAuthResourceConfiguration {
  issuer: string;
  resource: string;
  readScopes: readonly string[];
  writeScopes: readonly string[];
}

export function protectedResourceMetadata(config: OAuthResourceConfiguration): Record<string, unknown> {
  return {
    resource: config.resource,
    authorization_servers: [config.issuer],
    scopes_supported: uniqueScopes([...config.readScopes, ...config.writeScopes]),
    bearer_methods_supported: ["header"],
  };
}

/** RFC 9728 path-specific location for an MCP resource URL. */
export function protectedResourceMetadataUrl(resource: string): string {
  const url = new URL(resource);
  const suffix = url.pathname === "/" ? "" : url.pathname.replace(/\/$/, "");
  url.pathname = `/.well-known/oauth-protected-resource${suffix}`;
  url.search = "";
  url.hash = "";
  return url.href;
}

/** Serve both the path-specific RFC 9728 URL and the root compatibility location. */
export function protectedResourceMetadataPaths(resource: string): string[] {
  const canonical = new URL(protectedResourceMetadataUrl(resource)).pathname;
  return [...new Set([canonical, "/.well-known/oauth-protected-resource"])];
}

/** RFC 8414 authorization-server metadata URL derived from an issuer identifier. */
export function authorizationServerMetadataUrl(issuer: string): string {
  const url = new URL(issuer);
  const suffix = url.pathname === "/" ? "" : url.pathname.replace(/^\/+|\/+$/g, "");
  url.pathname = `/.well-known/oauth-authorization-server${suffix ? `/${suffix}` : ""}`;
  url.search = "";
  url.hash = "";
  return url.href;
}

/**
 * Fetch and validate upstream authorization-server metadata for legacy MCP discovery clients.
 * The issuer is deployment configuration, not request input, so this is not an open proxy.
 */
export async function loadAuthorizationServerMetadata(
  issuer: string,
  fetcher: typeof fetch = fetch,
): Promise<Record<string, unknown>> {
  const response = await fetcher(authorizationServerMetadataUrl(issuer), {
    headers: { accept: "application/json" },
  });
  if (!response.ok) throw new Error(`Authorization-server metadata fetch failed with HTTP ${response.status}.`);
  const metadata = await response.json() as Record<string, unknown>;
  if (metadata.issuer !== issuer) {
    throw new Error("Authorization-server metadata issuer does not exactly match MCP_OAUTH_ISSUER.");
  }
  return metadata;
}

export function optionalOAuthSecuritySchemes(readScopes: readonly string[]): ToolSecurityScheme[] {
  return [
    { type: "noauth" },
    { type: "oauth2", scopes: uniqueScopes(readScopes) },
  ];
}

export function requiredOAuthSecuritySchemes(scopes: readonly string[]): ToolSecurityScheme[] {
  return [{ type: "oauth2", scopes: uniqueScopes(scopes) }];
}

export function bearerChallenge(input: {
  resourceMetadataUrl: string;
  scopes?: readonly string[];
  error?: "invalid_request" | "invalid_token" | "insufficient_scope";
  description?: string;
}): string {
  const params = [`resource_metadata="${escapeAuthValue(input.resourceMetadataUrl)}"`];
  const scopes = uniqueScopes(input.scopes ?? []);
  if (scopes.length) params.push(`scope="${escapeAuthValue(scopes.join(" "))}"`);
  if (input.error) params.push(`error="${input.error}"`);
  if (input.description) params.push(`error_description="${escapeAuthValue(input.description)}"`);
  return `Bearer ${params.join(", ")}`;
}

export function oauthToolError(input: {
  resourceMetadataUrl: string;
  scopes: readonly string[];
  description: string;
  error?: "invalid_request" | "invalid_token" | "insufficient_scope";
}) {
  return {
    content: [{ type: "text" as const, text: input.description }],
    isError: true as const,
    _meta: {
      "mcp/www_authenticate": [
        bearerChallenge({
          resourceMetadataUrl: input.resourceMetadataUrl,
          scopes: input.scopes,
          error: input.error ?? "insufficient_scope",
          description: input.description,
        }),
      ],
    },
  };
}

function uniqueScopes(scopes: readonly string[]): string[] {
  return [...new Set(scopes.map((scope) => scope.trim()).filter(Boolean))].sort();
}

function escapeAuthValue(value: string): string {
  return value.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
}
