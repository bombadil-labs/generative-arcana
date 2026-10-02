import assert from "node:assert/strict";
import { Client, InMemoryTransport } from "@modelcontextprotocol/client";
import { createArcanaAdapter } from "../src/hostStore";
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
  optionalOAuthSecuritySchemes,
  requiredOAuthSecuritySchemes,
  type ToolSecurityScheme,
  protectedResourceMetadata,
  protectedResourceMetadataPaths,
  protectedResourceMetadataUrl,
} from "../src/oauthResource";
import { createArcanaMcpServer } from "../src/server";
import type { PrincipalRequest } from "../src/principal";
import { InMemoryUserDeckCatalogRepository } from "../src/userDeckCatalog";

const RESOURCE = "https://arcana.example/mcp";
const METADATA_URL = "https://arcana.example/.well-known/oauth-protected-resource/mcp";

async function main(): Promise<void> {
  await identityResolution();
  await metadataContract();
  await toolAuthContract();
  await renewableToolMetadataContract();
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
  assert.equal(challenge.includes("offline_access"), false);

  const readScopes = Object.freeze(["decks:read", "decks:read"]);
  assert.deepEqual(optionalOAuthSecuritySchemes(readScopes), [
    { type: "noauth" }, { type: "oauth2", scopes: ["decks:read"] },
  ], "external providers do not request offline_access without opting in");
  assert.deepEqual(requiredOAuthSecuritySchemes(["decks:read", "offline_access"], true), [
    { type: "oauth2", scopes: ["decks:read", "offline_access"] },
  ], "renewal scopes are deduplicated");
  optionalOAuthSecuritySchemes(readScopes, true);
  assert.deepEqual(readScopes, ["decks:read", "decks:read"], "metadata never mutates enforced scopes");
}

async function toolAuthContract(): Promise<void> {
  const server = createArcanaMcpServer({
    adapter: createArcanaAdapter(),
    includeStatefulTools: false,
    oauth: {
      principal: null,
      requestOfflineAccess: true,
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
      { type: "oauth2", scopes: ["decks:read", "offline_access"] },
    ]);

    const importTool = listed.tools.find((tool) => tool.name === "import_deck");
    assert.ok(importTool, "OAuth-capable HTTP servers must advertise protected stateful tools before login");
    const importSchemes = (importTool._meta as { securitySchemes?: Array<{ type: string; scopes?: string[] }> } | undefined)?.securitySchemes;
    assert.deepEqual(importSchemes, [
      { type: "oauth2", scopes: ["decks:read", "decks:write", "offline_access"] },
    ]);

    const denied = await client.callTool({
      name: "import_deck",
      arguments: { data: {} },
    });
    assert.equal(denied.isError, true);
    const meta = denied._meta as { "mcp/www_authenticate"?: string[] } | undefined;
    assert.ok(meta?.["mcp/www_authenticate"]?.[0]?.includes("resource_metadata="));
    assert.ok(meta?.["mcp/www_authenticate"]?.[0]?.includes('scope="decks:read decks:write"'));
    assert.equal(JSON.stringify(meta).includes("offline_access"), false, "tool challenges use only resource scopes");
  } finally {
    await client.close().catch(() => undefined);
    await server.close().catch(() => undefined);
  }
}


async function renewableToolMetadataContract(): Promise<void> {
  const unused = async (): Promise<never> => { throw new Error("Discovery must not touch private state."); };
  const collectTools = async (requestOfflineAccess?: boolean, withOAuth = true) => {
    const server = createArcanaMcpServer({
      catalog: new InMemoryUserDeckCatalogRepository(),
      includeStatefulTools: false,
      manifestUploads: {
        uploads: { create: unused, finalize: unused, read: unused, import: unused },
        drafts: { start: unused, update: unused, read: unused, validate: unused, commit: unused },
      },
      ...(withOAuth ? { oauth: {
        principal: null, resourceMetadataUrl: METADATA_URL,
        readScopes: ["decks:read"], writeScopes: ["decks:write"], requestOfflineAccess,
      } } : {}),
    });
    const client = new Client({ name: "renewable-metadata-test", version: "1" });
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    try {
      await Promise.all([server.connect(serverTransport), client.connect(clientTransport)]);
      return (await client.listTools()).tools;
    } finally {
      await client.close();
      await server.close();
    }
  };
  const legacy = await collectTools();
  const renewable = await collectTools(true);
  assert.deepEqual(await collectTools(false), legacy, "external-provider default stays unchanged");
  assert.deepEqual(renewable.map(tool => tool.name), legacy.map(tool => tool.name));
  let oauthCount = 0;
  for (let i = 0; i < legacy.length; i++) {
    const tool = legacy[i];
    const schemes = tool._meta?.securitySchemes as ToolSecurityScheme[] | undefined;
    const expected = structuredClone(tool);
    if (schemes?.some(scheme => scheme.type === "oauth2")) {
      oauthCount++;
      expected._meta!.securitySchemes = schemes.map(scheme => scheme.type === "oauth2"
        ? { type: "oauth2", scopes: [...scheme.scopes, "offline_access"] }
        : scheme);
    }
    assert.deepEqual(renewable[i], expected, `${tool.name}: only OAuth request scopes may change`);
  }
  assert.ok(oauthCount > 25, "cover the complete catalog, draft, upload, artwork, and reading surface");
  for (const name of ["list_my_decks", "get_card_artwork", "get_deck", "get_deck_draft", "validate_deck_draft"]) {
    const tool = renewable.find(tool => tool.name === name);
    assert.ok(tool, `${name} is covered`);
    const schemes = tool._meta?.securitySchemes as ToolSecurityScheme[];
    assert.ok(schemes.some(scheme => scheme.type === "oauth2" && scheme.scopes.includes("offline_access")),
      `${name} requests renewable authorization even when read-only`);
  }
  assert.deepEqual(renewable.find(tool => tool.name === "get_deck_authoring_guide")?._meta?.securitySchemes,
    [{ type: "noauth" }], "the public guide stays noauth-only");
  for (const tool of await collectTools(true, false)) {
    const schemes = tool._meta?.securitySchemes as ToolSecurityScheme[] | undefined;
    assert.ok(!schemes?.some(scheme => scheme.type === "oauth2"), `${tool.name}: non-OAuth metadata stays unchanged`);
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
