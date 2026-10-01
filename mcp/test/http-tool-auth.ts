import assert from "node:assert/strict";
import { createServer, request as httpRequest } from "node:http";
import { once } from "node:events";
import { createMcpHandler } from "@modelcontextprotocol/server";
import { toNodeHandler } from "@modelcontextprotocol/node";
import { withArcanaHttpToolAuthorization } from "../src/httpToolAuthorization";
import { createArcanaMcpServer } from "../src/server";
import { createArcanaAdapter } from "../src/hostStore";
import type { ArcanaPrincipal } from "../src/principal";
import { CatalogPersistingArcanaToolAdapter, InMemoryUserDeckCatalogRepository } from "../src/userDeckCatalog";
import { neutralManifest } from "./protocol-fixtures";

const oauth = {
  resourceMetadataUrl: "https://arcana.example/.well-known/oauth-protected-resource/mcp",
  readScopes: ["decks:read"],
  writeScopes: ["decks:write"],
};
const maxRequestBodySize = 16_384;
const headers = {
  "content-type": "application/json",
  accept: "application/json, text/event-stream",
  "mcp-protocol-version": "2025-11-25",
};

async function main(): Promise<void> {
  const catalog = new InMemoryUserDeckCatalogRepository();
  const privateDeck = await catalog.createImported("alice", neutralManifest("private-shapes"));
  const publicDeck = await catalog.createImported("bob", neutralManifest("public-shapes"));
  await catalog.setVisibility("bob", publicDeck.id, "public");
  const adapter = new CatalogPersistingArcanaToolAdapter(createArcanaAdapter(), "alice", catalog);
  let sdkRequests = 0;
  let inspectedBodies = 0;
  const failures: unknown[] = [];
  // Authentication is an upstream boundary. These fixtures represent its verified principals.
  const principals: Record<string, ArcanaPrincipal> = {
    "Bearer writer": { id: "alice", scopes: ["decks:read", "decks:write"] },
    "Bearer reader": { id: "alice", scopes: ["decks:read"] },
    "Bearer write-only": { id: "alice", scopes: ["decks:write"] },
    "Bearer unscoped": { id: "alice", scopes: [] },
  };
  const server = createServer((req, res) => {
    const principal = principals[req.headers.authorization ?? ""] ?? null;
    const handler = createMcpHandler(() => createArcanaMcpServer({
      adapter: principal ? adapter : createArcanaAdapter(),
      catalog,
      principal,
      includeStatefulTools: !!principal,
      oauth: { principal, ...oauth },
    }), { maxRequestBodySize });
    const guarded = withArcanaHttpToolAuthorization({
      async fetch(request, options) {
        sdkRequests++;
        return handler.fetch(request, options);
      },
    }, principal, oauth);
    const nodeHandler = toNodeHandler({
      async fetch(request, options) {
        inspectedBodies++;
        return guarded.fetch(request, options);
      },
    }, { maxRequestBodySize });
    res.once("finish", () => void handler.close());
    res.once("close", () => void handler.close());
    void nodeHandler(req, res).catch((error) => { failures.push(error); res.destroy(); });
  });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const address = server.address();
  assert.ok(address && typeof address !== "string");
  const endpoint = `http://127.0.0.1:${address.port}/mcp`;
  let nextId = 1;
  const call = (name: string, args: Record<string, unknown> = {}) => ({
    jsonrpc: "2.0", id: nextId++, method: "tools/call", params: { name, arguments: args },
  });
  const post = (body: unknown, token?: string, contentType = "application/json") => fetch(endpoint, {
    method: "POST",
    headers: { ...headers, "content-type": contentType, ...(token ? { authorization: `Bearer ${token}` } : {}) },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(5_000),
  });

  try {
    const initialized = await rpcResult(await post({
      jsonrpc: "2.0", id: nextId++, method: "initialize",
      params: { protocolVersion: "2025-11-25", capabilities: {}, clientInfo: { name: "lazy-auth-test", version: "1" } },
    }));
    assert.equal(initialized.protocolVersion, "2025-11-25");
    const listed = await rpcResult(await post({ jsonrpc: "2.0", id: nextId++, method: "tools/list", params: {} }));
    const tools = listed.tools as Array<{ name: string }>;
    for (const name of ["import_deck", "list_my_decks", "set_deck_visibility", "delete_my_deck"]) {
      assert.ok(tools.some((tool) => tool.name === name), `${name} remains discoverable before sign-in`);
    }

    for (const token of [undefined, "unscoped", "writer"]) {
      await toolSuccess(await post(call("list_decks"), token));
      await toolSuccess(await post(call("get_deck_authoring_spec"), token));
      await toolSuccess(await post(call("get_deck_authoring_guide"), token));
      await toolSuccess(await post(call("get_deck_authoring_guide", { toc: true }), token));
      await toolSuccess(await post(call("get_deck_authoring_guide", { files: ["skill/generative-arcana/SKILL.md"] }), token));
      await toolSuccess(await post(call("validate_deck_manifest", { manifest: neutralManifest() }), token));
      await toolSuccess(await post(call("list_public_decks"), token));
      await toolSuccess(await post(call("get_shared_deck", { deckId: publicDeck.id }), token));
      await toolSuccess(await post(call("get_deck", { deckId: publicDeck.id }), token));
      await toolSuccess(await post(call("get_card", { deckId: publicDeck.id, cardSlug: "major-0" }), token));
    }

    const protectedCalls = [
      call("list_my_decks"),
      call("import_deck", { manifest: neutralManifest("unauthorized-shapes") }),
      call("set_deck_visibility", { deckId: privateDeck.id, visibility: "public" }),
      call("delete_my_deck", { deckId: privateDeck.id }),
    ];
    const beforeDenied = sdkRequests;
    for (const body of protectedCalls) {
      const requiredScopes = body.params.name === "list_my_decks" ? "decks:read" : "decks:read decks:write";
      await challenge(await post(body), 401, "invalid_token", requiredScopes);
      await challenge(await post(body, "unscoped"), 403, "insufficient_scope", requiredScopes);
      await challenge(await post(body, "write-only"), 403, "insufficient_scope", requiredScopes);
      if (body.params.name !== "list_my_decks") {
        await challenge(await post(body, "reader"), 403, "insufficient_scope", requiredScopes);
      }
    }
    assert.equal(sdkRequests, beforeDenied, "denials happen before SDK routing/tool execution");
    assert.equal((await catalog.get(privateDeck.id))?.visibility, "private");
    assert.equal((await catalog.listOwned("alice")).length, 1);

    const batch = [call("list_decks"), call("list_my_decks"), protectedCalls[2]];
    await challenge(await post(batch), 401, "invalid_token", "decks:read decks:write");
    await challenge(await post([null, [], ...batch], "reader"), 403, "insufficient_scope", "decks:read decks:write");
    assert.equal(sdkRequests, beforeDenied, "a public or malformed batch member cannot hide a protected call");

    // Parameters on application/json are supported; other media types stay SDK errors.
    await challenge(await post(protectedCalls[0], undefined, "Application/JSON; charset=utf-8"), 401, "invalid_token", "decks:read");
    const wrongType = await post(protectedCalls[0], undefined, "text/plain");
    assert.equal(wrongType.status, 415);
    assert.equal(wrongType.headers.get("www-authenticate"), null);
    await wrongType.text();
    const malformed = await fetch(endpoint, { method: "POST", headers, body: '{"method":"tools/call",', signal: AbortSignal.timeout(5_000) });
    assert.equal(malformed.status, 400);
    assert.equal(malformed.headers.get("www-authenticate"), null);
    await malformed.text();
    const invalidEnvelopes = [
      null, [],
      { method: "tools/call", params: { name: "import_deck" } },
      { ...protectedCalls[1], id: undefined },
      { ...protectedCalls[1], id: null },
      { ...protectedCalls[1], id: {} },
      { ...protectedCalls[1], params: [] },
      { jsonrpc: "2.0", id: 1, method: "tools/call", params: null },
    ];
    for (const body of invalidEnvelopes) {
      const invalid = await post(body);
      assert.equal(invalid.headers.get("www-authenticate"), null, "invalid request envelopes do not prompt for sign-in");
      assert.notEqual(invalid.status, 500);
      await invalid.text();
    }
    assert.equal((await catalog.listOwned("alice")).length, 1, "malformed requests and tool notifications do not mutate the catalog");

    // Both announced and chunked oversize bodies must be rejected before cloning/parsing.
    const beforeOversize = inspectedBodies;
    const oversizedBody = JSON.stringify(call("import_deck", { json: "x".repeat(maxRequestBodySize) }));
    const oversized = await fetch(endpoint, { method: "POST", headers, body: oversizedBody, signal: AbortSignal.timeout(5_000) });
    assert.equal(oversized.status, 413);
    assert.equal(oversized.headers.get("www-authenticate"), null);
    await oversized.text();
    const chunkedStatus = await chunkedPost(endpoint, oversizedBody);
    assert.equal(chunkedStatus, 413);
    assert.equal(inspectedBodies, beforeOversize, "oversize bodies never reach the authorization preflight");
    assert.equal((await catalog.listOwned("alice")).length, 1, "oversize requests do not mutate the catalog");

    const mine = await toolSuccess(await post(call("list_my_decks"), "reader"));
    assert.ok(JSON.stringify(mine).includes(privateDeck.id), "read-scoped credentials can list owned decks");
    await toolSuccess(await post(call("import_deck", { manifest: neutralManifest("imported-shapes") }), "writer"));
    const imported = (await catalog.listOwned("alice")).find((deck) => deck.slug === "imported-shapes");
    assert.ok(imported, "the cloned preflight body does not consume or corrupt the valid import payload");
    await toolSuccess(await post(call("set_deck_visibility", { deckId: imported.id, visibility: "public" }), "writer"));
    assert.equal((await catalog.get(imported.id))?.visibility, "public");
    await toolSuccess(await post(call("delete_my_deck", { deckId: imported.id }), "writer"));
    assert.equal(await catalog.get(imported.id), null);
    assert.deepEqual(failures, []);

    const unchanged = { fetch: async () => Response.json({ ok: true }) };
    assert.equal(withArcanaHttpToolAuthorization(unchanged, null), unchanged, "non-OAuth/alpha behavior is unchanged");
    console.log("HTTP lazy authorization: public discovery/tools, protected 401/403, bounded bodies, and authorized writes passed.");
  } finally {
    await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  }
}

async function challenge(response: Response, status: number, error: string, scope: string): Promise<void> {
  assert.equal(response.status, status);
  const header = response.headers.get("www-authenticate");
  assert.ok(header);
  assert.ok(header.startsWith("Bearer "));
  assert.ok(header.includes(`resource_metadata="${oauth.resourceMetadataUrl}"`));
  assert.ok(header.includes(`error="${error}"`));
  assert.ok(header.includes(`scope="${scope}"`));
  assert.equal(response.headers.get("cache-control"), "no-store");
  assert.equal((await response.json() as { error: string }).error, error);
}

async function rpcResult(response: Response): Promise<Record<string, unknown>> {
  assert.equal(response.status, 200);
  assert.equal(response.headers.get("www-authenticate"), null);
  const text = await response.text();
  const messages = response.headers.get("content-type")?.startsWith("text/event-stream")
    ? text.split("\n").filter((line) => line.startsWith("data: ")).map((line) => JSON.parse(line.slice(6)))
    : [JSON.parse(text)];
  const message = messages.find((value) => value.result || value.error);
  assert.ok(message, text);
  assert.equal(message.error, undefined, JSON.stringify(message));
  return message.result;
}

async function toolSuccess(response: Response): Promise<Record<string, unknown>> {
  const result = await rpcResult(response);
  assert.equal(result.isError, undefined, JSON.stringify(result));
  return result;
}

function chunkedPost(endpoint: string, body: string): Promise<number> {
  return new Promise((resolve, reject) => {
    const req = httpRequest(endpoint, { method: "POST", headers, timeout: 5_000 }, (res) => {
      res.resume();
      res.once("end", () => resolve(res.statusCode!));
      res.once("error", reject);
    });
    req.once("error", reject);
    req.once("timeout", () => req.destroy(new Error("Chunked request timed out")));
    req.write(body.slice(0, 100));
    req.end(body.slice(100));
  });
}

main().catch((error) => { console.error(error); process.exitCode = 1; });
