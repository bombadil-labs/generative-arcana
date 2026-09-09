import assert from "node:assert/strict";
import { Client, InMemoryTransport } from "@modelcontextprotocol/client";
import { createBundledArcanaAdapter } from "../src/hostStore";
import {
  InMemoryExternalIdentityRepository,
  OAuthPrincipalError,
  OAuthPrincipalResolver,
  type BearerIdentityVerifier,
} from "../src/oauthIdentity";
import {
  authorizationServerMetadataUrl,
  bearerChallenge,
  loadAuthorizationServerMetadata,
  protectedResourceMetadata,
  protectedResourceMetadataPaths,
  protectedResourceMetadataUrl,
} from "../src/oauthResource";
import { createArcanaMcpServer } from "../src/server";
import type { PrincipalRequest } from "../src/principal";

const RESOURCE = "https://arcana.example/mcp";
const METADATA_URL = "https://arcana.example/.well-known/oauth-protected-resource/mcp";

async function main(): Promise<void> {
  await identityResolution();
  await metadataContract();
  await toolAuthContract();
}

async function identityResolution(): Promise<void> {
  const identities = new InMemoryExternalIdentityRepository();
  const verifier: BearerIdentityVerifier = {
    async verify(token) {
      assert.equal(token, "valid-token");
      return {
        issuer: "https://identity.example/",
        subject: "subject-123",
        scopes: ["decks:write", "decks:read", "decks:read"],
      };
    },
  };
  const resolver = new OAuthPrincipalResolver(verifier, identities, ["decks:read"]);
  const request = principalRequest("Bearer valid-token");

  const first = await resolver.resolve(request);
  const second = await resolver.resolve(request);
  assert.ok(first);
  assert.equal(first.id, second?.id, "same issuer+subject must resolve to one stable Arcana principal");
  assert.deepEqual(first.scopes, ["decks:read", "decks:write"]);

  const anonymous = await resolver.resolve(principalRequest());
  assert.equal(anonymous, null);

  await assert.rejects(
    resolver.resolve(principalRequest("Basic nope")),
    (error: unknown) => error instanceof OAuthPrincipalError
      && error.statusCode === 401
      && error.oauthError === "invalid_request",
  );

  const insufficient = new OAuthPrincipalResolver({
    async verify() {
      return {
        issuer: "https://identity.example/",
        subject: "subject-123",
        scopes: ["profile"],
      };
    },
  }, identities, ["decks:read"]);

  await assert.rejects(
    insufficient.resolve(principalRequest("Bearer other-token")),
    (error: unknown) => error instanceof OAuthPrincipalError
      && error.statusCode === 403
      && error.oauthError === "insufficient_scope"
      && error.scopes.includes("decks:read"),
  );
}

async function metadataContract(): Promise<void> {
  assert.equal(protectedResourceMetadataUrl(RESOURCE), METADATA_URL);
  assert.equal(
    authorizationServerMetadataUrl("https://identity.example/tenant"),
    "https://identity.example/.well-known/oauth-authorization-server/tenant",
  );
  assert.deepEqual(
    protectedResourceMetadataPaths(RESOURCE),
    ["/.well-known/oauth-protected-resource/mcp", "/.well-known/oauth-protected-resource"],
  );
  assert.deepEqual(protectedResourceMetadata({
    issuer: "https://identity.example/",
    resource: RESOURCE,
    readScopes: ["decks:read"],
    writeScopes: ["decks:write"],
  }), {
    resource: RESOURCE,
    authorization_servers: ["https://identity.example/"],
    scopes_supported: ["decks:read", "decks:write"],
    bearer_methods_supported: ["header"],
  });

  const proxied = await loadAuthorizationServerMetadata("https://identity.example/", async (input) => {
    assert.equal(String(input), "https://identity.example/.well-known/oauth-authorization-server");
    return new Response(JSON.stringify({
      issuer: "https://identity.example/",
      authorization_endpoint: "https://identity.example/oauth2/authorize",
      token_endpoint: "https://identity.example/oauth2/token",
    }), { status: 200, headers: { "content-type": "application/json" } });
  });
  assert.equal(proxied.issuer, "https://identity.example/");

  await assert.rejects(
    loadAuthorizationServerMetadata("https://identity.example/", async () => new Response(
      JSON.stringify({ issuer: "https://evil.example/" }),
      { status: 200, headers: { "content-type": "application/json" } },
    )),
    /issuer does not exactly match/,
  );

  const challenge = bearerChallenge({
    resourceMetadataUrl: METADATA_URL,
    scopes: ["decks:read", "decks:write"],
    error: "insufficient_scope",
    description: "Sign in to continue.",
  });
  assert.match(challenge, /^Bearer /);
  assert.match(challenge, /resource_metadata="https:\/\/arcana\.example\/\.well-known\/oauth-protected-resource\/mcp"/);
  assert.match(challenge, /scope="decks:read decks:write"/);
  assert.match(challenge, /error="insufficient_scope"/);
}

async function toolAuthContract(): Promise<void> {
  const server = createArcanaMcpServer({
    adapter: createBundledArcanaAdapter(),
    includeStatefulTools: false,
    oauth: {
      principal: null,
      resourceMetadataUrl: METADATA_URL,
      readScopes: ["decks:read"],
      writeScopes: ["decks:write"],
    },
  });
  const client = new Client({ name: "oauth-contract-test", version: "0.2.0" });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();

  try {
    await Promise.all([server.connect(serverTransport), client.connect(clientTransport)]);
    const listed = await client.listTools();

    const publicTool = listed.tools.find((tool) => tool.name === "list_decks");
    const publicSchemes = (publicTool?._meta as { securitySchemes?: Array<{ type: string; scopes?: string[] }> } | undefined)?.securitySchemes;
    assert.deepEqual(publicSchemes, [
      { type: "noauth" },
      { type: "oauth2", scopes: ["decks:read"] },
    ]);

    const importTool = listed.tools.find((tool) => tool.name === "import_deck");
    assert.ok(importTool, "OAuth-capable HTTP servers must advertise protected stateful tools before login");
    const importSchemes = (importTool._meta as { securitySchemes?: Array<{ type: string; scopes?: string[] }> } | undefined)?.securitySchemes;
    assert.deepEqual(importSchemes, [
      { type: "oauth2", scopes: ["decks:read", "decks:write"] },
    ]);

    const denied = await client.callTool({
      name: "import_deck",
      arguments: { data: {} },
    });
    assert.equal(denied.isError, true);
    const meta = denied._meta as { "mcp/www_authenticate"?: string[] } | undefined;
    assert.ok(meta?.["mcp/www_authenticate"]?.[0]?.includes("resource_metadata="));
  } finally {
    await client.close().catch(() => undefined);
    await server.close().catch(() => undefined);
  }
}

function principalRequest(authorization?: string): PrincipalRequest {
  return {
    method: "POST",
    url: "/mcp",
    headers: new Headers(authorization ? { authorization } : undefined),
  };
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
