import assert from "node:assert/strict";
import { Client, InMemoryTransport } from "@modelcontextprotocol/client";
import deepTime from "../../decks/deep-time/deck.json";
import type { UserDeckRecord } from "../../app/src/decks/catalog";
import { PersistentArcanaHostStore } from "../src/hostStore";
import { createArcanaMcpServer, type ArcanaMcpServerOptions } from "../src/server";
import { InMemoryUserDeckCatalogRepository } from "../src/userDeckCatalog";

const legacy = { load: async () => null, save: async () => undefined, delete: async () => false };

async function main() {
  const catalog = new FaultInjectingCatalog();
  const a = await new PersistentArcanaHostStore(legacy, undefined, catalog).get("alice");
  const b = await new PersistentArcanaHostStore(legacy, undefined, catalog).get("alice");
  const bobAdapter = await new PersistentArcanaHostStore(legacy, undefined, catalog).get("bob");
  // Keep both connections open for the whole sequence. Reconnecting/getting a new host must not
  // be necessary for freshness, and a host warmed before creation must observe later imports.
  const aliceA = await connect({ adapter: a, catalog, principal: { id: "alice" } });
  const aliceB = await connect({ adapter: b, catalog, principal: { id: "alice" } });
  const bob = await connect({ adapter: bobAdapter, catalog, principal: { id: "bob" } });
  const publicViewer = await connect({ catalog, principal: null, includeStatefulTools: false });
  try {
    const created = await call<{ id: string }>(aliceA.client, "import_deck", { data: data("Revision One") });
    const id = created.id;
    assert.equal((await call<Array<{ id: string }>>(aliceB.client, "list_decks")).some(d => d.id === id), true);
    assert.equal((await call<{ name: string }>(aliceB.client, "get_deck", { deckId: id })).name, "Revision One");
    assert.equal((await call<{ id: string }>(aliceB.client, "get_deck", { deckId: "replica-deck" })).id, id);

    const replacement = await call<{ id: string }>(aliceA.client, "import_deck", { data: data("Revision Two"), replaceExisting: true });
    assert.equal(replacement.id, id);
    // Direct adapter reads cover the historical reproduction, in addition to the real MCP wrapper.
    assert.equal((await b.call("get_deck", { deckId: id }) as { name: string }).name, "Revision Two");
    assert.equal((await call<{ name: string }>(aliceB.client, "get_deck", { deckId: id })).name, "Revision Two");
    assert.equal((await call<{ name: string }>(aliceB.client, "get_deck", { deckId: "replica-deck" })).name, "Revision Two");
    const reading = await call<{ token: string; deckName: string }>(aliceB.client, "cast_reading", { deckId: id, spread: "single" });
    assert.equal(reading.deckName, "Revision Two");
    assert.equal((await call<{ deckName: string }>(aliceB.client, "resolve_reading", { token: reading.token })).deckName, "Revision Two");
    assert.equal((await call<Array<{ id: string; revision: number }>>(aliceB.client, "list_my_decks"))[0]?.revision, 2);

    // Identical authored slugs remain account-local; no cross-principal CRUD or read leakage.
    const bobDeck = await call<{ id: string }>(bob.client, "import_deck", { data: data("Bob's Deck") });
    assert.notEqual(bobDeck.id, id);
    assert.equal((await call<{ name: string }>(bob.client, "get_deck", { deckId: "replica-deck" })).name, "Bob's Deck");
    for (const name of ["get_deck", "get_shared_deck", "delete_my_deck"]) {
      await denied(bob.client, name, { deckId: id });
    }
    await denied(bob.client, "set_deck_visibility", { deckId: id, visibility: "public" });
    assert.equal((await call<Array<{ id: string }>>(bob.client, "list_decks")).some(d => d.id === id), false);
    await denied(publicViewer.client, "get_deck", { deckId: id });

    await call(aliceA.client, "set_deck_visibility", { deckId: id, visibility: "unlisted" });
    assert.equal((await call<Array<{ id: string }>>(publicViewer.client, "list_public_decks")).some(d => d.id === id), false);
    assert.equal((await call<{ name: string }>(publicViewer.client, "get_deck", { deckId: id })).name, "Revision Two");
    await call(aliceA.client, "set_deck_visibility", { deckId: id, visibility: "public" });
    assert.equal((await call<Array<{ id: string }>>(publicViewer.client, "list_public_decks")).some(d => d.id === id), true);
    await call(aliceA.client, "import_deck", { data: data("Revision Three"), replaceExisting: true });
    assert.equal((await call<{ name: string }>(publicViewer.client, "get_deck", { deckId: id })).name, "Revision Three");
    await call(aliceA.client, "set_deck_visibility", { deckId: id, visibility: "private" });
    await denied(publicViewer.client, "get_deck", { deckId: id });
    await denied(bob.client, "get_deck", { deckId: id });

    // Failure must never return old private content or poison the serialized operation queue.
    catalog.failReads = true;
    await assert.rejects(b.call("get_deck", { deckId: id }), /catalog unavailable/);
    catalog.failReads = false;
    assert.equal((await b.call("get_deck", { deckId: id }) as { name: string }).name, "Revision Three");
    catalog.wrongOwner = true;
    await assert.rejects(b.call("list_decks"), /another principal/);
    catalog.wrongOwner = false;
    const beforeCorrupt = b.engine.getDeck(id);
    catalog.corruptRead = true;
    await assert.rejects(b.call("get_deck", { deckId: id }), /name|required|must|missing|deck/i);
    assert.equal(b.engine.getDeck(id), beforeCorrupt, "invalid rows must not partly replace the live snapshot");
    catalog.corruptRead = false;
    await assert.rejects(b.call("import_deck", { data: {} }), /required|must|missing|deck/i);
    const outcomes = await Promise.allSettled([
      b.call("import_deck", { data: data("duplicate") }),
      b.call("import_deck", { data: data("Revision Four"), replaceExisting: true }),
      b.call("get_deck", { deckId: id }),
    ]);
    assert.equal(outcomes[0].status, "rejected");
    assert.equal(outcomes[1].status, "fulfilled");
    assert.equal(outcomes[2].status, "fulfilled");
    if (outcomes[2].status === "fulfilled") assert.equal((outcomes[2].value as { name: string }).name, "Revision Four");

    await call(aliceA.client, "set_deck_visibility", { deckId: id, visibility: "public" });
    assert.equal((await call<{ name: string }>(publicViewer.client, "get_deck", { deckId: id })).name, "Revision Four");
    await call(aliceA.client, "delete_my_deck", { deckId: id });
    await denied(publicViewer.client, "get_deck", { deckId: id });
    assert.equal((await call<Array<{ id: string }>>(aliceB.client, "list_decks")).some(d => d.id === id), false);
    assert.deepEqual(await call(aliceB.client, "list_my_decks"), []);
    for (const deckId of [id, "replica-deck"]) {
      await denied(aliceB.client, "get_deck", { deckId });
      await denied(aliceB.client, "cast_reading", { deckId, spread: "single" });
    }
    await denied(aliceB.client, "resolve_reading", { token: reading.token });
    // Reusing the deleted slug creates a new resource; old links stay revoked.
    const recreated = await call<{ id: string }>(aliceA.client, "import_deck", { data: data("Recreated") });
    assert.notEqual(recreated.id, id);
    assert.equal((await call<{ id: string }>(aliceB.client, "get_deck", { deckId: "replica-deck" })).id, recreated.id);
    await denied(aliceB.client, "get_deck", { deckId: id });
    assert.equal((await call<{ name: string }>(bob.client, "get_deck", { deckId: bobDeck.id })).name, "Bob's Deck");
  } finally {
    await Promise.all([aliceA, aliceB, bob, publicViewer].map(connection => connection.close()));
  }
  console.log("Catalog freshness: warm replicas, reads/dealing, replacement/deletion, isolation, sharing revocation, and failure recovery passed.");
}

class FaultInjectingCatalog extends InMemoryUserDeckCatalogRepository {
  failReads = false;
  wrongOwner = false;
  corruptRead = false;
  override async listOwned(ownerId: string): Promise<UserDeckRecord[]> {
    if (this.failReads) throw new Error("catalog unavailable");
    const records = await super.listOwned(ownerId);
    if (this.corruptRead) return records.map(record => ({ ...record, revision: record.revision + 1,
      manifest: { ...record.manifest, data: { ...record.manifest.data, name: "" } } }));
    return this.wrongOwner ? records.map(record => ({ ...record, ownerId: "intruder" })) : records;
  }
}

function data(name: string) {
  return { ...structuredClone(deepTime), slug: "replica-deck", name };
}

async function connect(options: ArcanaMcpServerOptions) {
  const server = createArcanaMcpServer(options);
  const client = new Client({ name: "catalog-freshness-test", version: "0.2.0" });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await Promise.all([server.connect(serverTransport), client.connect(clientTransport)]);
  return { client, async close() { await client.close(); await server.close(); } };
}

async function call<T = unknown>(client: Client, name: string, args: Record<string, unknown> = {}): Promise<T> {
  const response = await client.callTool({ name, arguments: args });
  assert.notEqual(response.isError, true, JSON.stringify(response));
  return (response.structuredContent as { result: T }).result;
}
async function denied(client: Client, name: string, args: Record<string, unknown>) {
  assert.equal((await client.callTool({ name, arguments: args })).isError, true, `${name} should fail closed`);
}

main().catch(error => { console.error(error); process.exitCode = 1; });
