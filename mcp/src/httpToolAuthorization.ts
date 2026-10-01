import type { FetchLikeMcpHandler } from "@modelcontextprotocol/node";
import { bearerChallenge } from "./oauthResource";
import { principalHasScopes, type ArcanaPrincipal } from "./principal";

export interface ArcanaHttpOAuthOptions {
  resourceMetadataUrl: string;
  readScopes: readonly string[];
  writeScopes: readonly string[];
}

const WRITE_TOOLS = new Set(["import_deck", "set_deck_visibility", "delete_my_deck"]);

/**
 * Mount inside toNodeHandler, after its bounded Node-to-Request conversion. A cloned
 * body leaves the original intact for SDK validation, routing, and tool execution.
 * Tool-result authentication metadata alone does not start Claude's lazy OAuth flow.
 */
export function withArcanaHttpToolAuthorization(
  handler: FetchLikeMcpHandler,
  principal: ArcanaPrincipal | null,
  oauth?: ArcanaHttpOAuthOptions,
): FetchLikeMcpHandler {
  if (!oauth) return handler;
  return {
    async fetch(request, options) {
      const mediaType = request.headers.get("content-type")?.split(";", 1)[0]?.trim().toLowerCase();
      if (request.method === "POST" && mediaType === "application/json") {
        let body: unknown;
        try {
          body = await request.clone().json();
        } catch {
          // Malformed JSON remains the SDK's protocol error, never an OAuth prompt.
          return handler.fetch(request, options);
        }
        const required = protectedToolScopes(body, oauth);
        if (required !== undefined && !principalHasScopes(principal, required)) {
          const error = principal ? "insufficient_scope" : "invalid_token";
          const description = principal
            ? "This tool requires additional deck permissions."
            : "Sign in to use your Generative Arcana account.";
          return Response.json({ error, error_description: description }, {
            status: principal ? 403 : 401,
            headers: {
              "cache-control": "no-store",
              "www-authenticate": bearerChallenge({
                resourceMetadataUrl: oauth.resourceMetadataUrl,
                scopes: required,
                error,
                description,
              }),
            },
          });
        }
      }
      return handler.fetch(request, options);
    },
  };
}

function protectedToolScopes(body: unknown, oauth: ArcanaHttpOAuthOptions): string[] | undefined {
  const required = new Set<string>();
  let protectedCall = false;
  // Inspect every batch member before dispatch so a public call cannot hide a write.
  for (const message of Array.isArray(body) ? body : [body]) {
    if (!isRecord(message) || message.jsonrpc !== "2.0" || message.method !== "tools/call"
      || (typeof message.id !== "string" && typeof message.id !== "number")
      || !isRecord(message.params) || typeof message.params.name !== "string") continue;
    const name = message.params.name;
    if (name !== "list_my_decks" && !WRITE_TOOLS.has(name)) continue;
    protectedCall = true;
    for (const scope of oauth.readScopes) required.add(scope);
    if (WRITE_TOOLS.has(name)) for (const scope of oauth.writeScopes) required.add(scope);
  }
  return protectedCall ? [...required] : undefined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}
