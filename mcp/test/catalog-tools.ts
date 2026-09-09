import assert from "node:assert/strict";
import { Client, InMemoryTransport } from "@modelcontextprotocol/client";
import deepTime from "../../decks/deep-time/deck.json";
import type { DeckDataFile } from "../../app/src/decks/types";
import { createBundledArcanaAdapter } from "../src/hostStore";
import { createArcanaMcpServer, type ArcanaMcpServerOptions } from "../src/server";
import { InMemoryUserDeckCatalogRepository, restoreUserDeckRecords } from "../src/userDeckCatalog";

const RESOURCE_METADATA = "https://arcana.example/.well-known/oauth-protected-resource/mcp";
const OAUTH = {
  resourceMetadataUrl: RESOURCE_METADATA,
  readScopes: ["decks:read"],
  writeScopes: ["decks:write"],
} as const;

async function main(): Promise<void> {
  const catalog = new InMemoryUserDeckCatalogRepository();
  const alicePrivate = await catalog.createImported("alice", manifest("alice-private", "Alice Private"));
  const bobPublic = await catalog.createImported("bob", manifest("shared-name", "Bob Public"));
  const bobUnlisted = await catalog.createImported("bob", manifest("bob-unlisted", "Bob Unlisted"));
  await catalog.setVisibility("bob", bobPublic.id, "public");
  await catalog.setVisibility("bob", bobUnlisted.id, "unlisted");

  const anonymous = await connect({
    catalog,
    principal: null,
    oauth: { principal: null, ...OAUTH },
    includeStatefulTools: false,
  });
  try {
    const tools = await anonymous.client.listTools();
    const publicTool = tools.tools.find((tool) => tool.name === "list_public_decks");
    assert.ok(publicTool);
    assert.deepEqual((publicTool._meta as { securitySchemes?: unknown[] })?.securitySchemes, [
      { type: "noauth" },
      { type: "oauth2", scopes: ["decks:read"] },
    ]);
    const writeTool = tools.tools.find((tool) => tool.name === "set_deck_visibility");
    assert.ok(writeTool, "OAuth personal tools remain discoverable before login");
    assert.deepEqual((writeTool._meta as { securitySchemes?: unknown[] })?.securitySchemes, [
      { type: "oauth2", scopes: ["decks:read", "decks:write"] },
    ]);

    const publicList = await anonymous.client.callTool({ name: "list_public_decks", arguments: {} });
    const publicRows = result<Array<{ id: string }>>(publicList);
    assert.deepEqual(publicRows.map((deck) => deck.id), [bobPublic.id]);
    assert.equal(JSON.stringify(publicRows).includes("ownerId"), false, "catalog outputs do not leak internal owner ids");

    const shared = await anonymous.client.callTool({ name: "get_shared_deck", arguments: { deckId: bobUnlisted.id } });
    assert.equal(shared.isError, undefined);
    assert.equal(result<{ id: string }>(shared).id, bobUnlisted.id, "unlisted decks resolve by stable link/id");

    const hidden = await anonymous.client.callTool({ name: "get_shared_deck", arguments: { deckId: alicePrivate.id } });
    assert.equal(hidden.isError, true, "private deck existence is hidden from anonymous viewers");

    const deniedMine = await anonymous.client.callTool({ name: "list_my_decks", arguments: {} });
    assert.equal(deniedMine.isError, true);
    const deniedMeta = deniedMine._meta as { "mcp/www_authenticate"?: string[] } | undefined;
    assert.ok(deniedMeta?.["mcp/www_authenticate"]?.[0]?.includes("decks:read"));
  } finally {
    await anonymous.close();
  }

  const aliceAdapter = createBundledArcanaAdapter();
  restoreUserDeckRecords(aliceAdapter, "alice", await catalog.listOwned("alice"));
  const alice = await connect({
    adapter: aliceAdapter,
    catalog,
    principal: { id: "alice", scopes: ["decks:read", "decks:write"] },
    oauth: { principal: { id: "alice", scopes: ["decks:read", "decks:write"] }, ...OAUTH },
    includeStatefulTools: true,
  });
  try {
    const mine = await alice.client.callTool({ name: "list_my_decks", arguments: {} });
    const mineRows = result<Array<{ id: string; visibility: string }>>(mine);
    assert.deepEqual(mineRows.map((deck) => deck.id), [alicePrivate.id]);
    assert.equal(mineRows[0]?.visibility, "private");

    const ownerCanResolvePrivate = await alice.client.callTool({
      name: "get_shared_deck",
      arguments: { deckId: alicePrivate.id },
    });
    assert.equal(ownerCanResolvePrivate.isError, undefined);

    const published = await alice.client.callTool({
      name: "set_deck_visibility",
      arguments: { deckId: alicePrivate.id, visibility: "public" },
    });
    assert.equal(result<{ visibility: string }>(published).visibility, "public");
    assert.equal((await catalog.get(alicePrivate.id))?.visibility, "public");

    const deleted = await alice.client.callTool({ name: "delete_my_deck", arguments: { deckId: alicePrivate.id } });
    assert.deepEqual(result<{ id: string; deleted: boolean }>(deleted), { id: alicePrivate.id, deleted: true });
    assert.equal(await catalog.get(alicePrivate.id), null);

    const ghost = await alice.client.callTool({ name: "get_deck", arguments: { deckId: alicePrivate.id } });
    assert.equal(ghost.isError, true, "catalog deletion unregisters the deck from the current runtime immediately");
  } finally {
    await alice.close();
  }

  const reader = await connect({
    catalog,
    principal: { id: "reader", scopes: ["decks:read"] },
    oauth: { principal: { id: "reader", scopes: ["decks:read"] }, ...OAUTH },
    includeStatefulTools: true,
  });
  try {
    const deniedWrite = await reader.client.callTool({
      name: "set_deck_visibility",
      arguments: { deckId: bobPublic.id, visibility: "private" },
    });
    assert.equal(deniedWrite.isError, true);
    const meta = deniedWrite._meta as { "mcp/www_authenticate"?: string[] } | undefined;
    assert.ok(meta?.["mcp/www_authenticate"]?.[0]?.includes("decks:write"));
    assert.equal((await catalog.get(bobPublic.id))?.visibility, "public");
  } finally {
    await reader.close();
  }
}

function manifest(slug: string, name: string) {
  const data = structuredClone(deepTime) as unknown as DeckDataFile;
  data.slug = slug;
  data.name = name;
  return { data, tagline: `${name} tagline` };
}

async function connect(options: ArcanaMcpServerOptions) {
  const server = createArcanaMcpServer(options);
  const client = new Client({ name: "catalog-tools-test", version: "0.2.0" });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await Promise.all([server.connect(serverTransport), client.connect(clientTransport)]);
  return {
    client,
    async close() {
      await client.close().catch(() => undefined);
      await server.close().catch(() => undefined);
    },
  };
}

function result<T>(response: { structuredContent?: unknown }): T {
  const structured = response.structuredContent as { result?: unknown } | undefined;
  assert.ok(structured && "result" in structured, "tool response should contain structured result");
  return structured.result as T;
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
