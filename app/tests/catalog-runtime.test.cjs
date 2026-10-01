const test = require("node:test");
const assert = require("node:assert/strict");
const { DeckRegistry } = require("../.test-build/decks/registry.js");
const { CatalogDeckRuntime } = require("../.test-build/catalog/runtime.js");
const { rawDeck } = require("./fixtures.cjs");

function remote(id = "catalog-resource", revision = 1, visibility = "private") {
  const data = rawDeck();
  data.slug = "authored-deck";
  data.name = `Catalog revision ${revision}`;
  return { id, revision, visibility, manifest: { data, tagline: `Revision ${revision}` } };
}
function controller() { return new AbortController(); }
function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}

test("catalog provenance is explicit and every resolution replaces the previous revision", async () => {
  const registry = new DeckRegistry();
  let revision = 1;
  const runtime = new CatalogDeckRuntime(registry, async (id) => remote(id, revision++));
  const first = await runtime.resolve("not-a-uuid", controller().signal);
  assert.deepEqual(runtime.source(first), { id: "not-a-uuid", revision: 1, visibility: "private" });
  assert.equal(runtime.localDeck(first.id), undefined);
  const second = await runtime.resolve(first.id, controller().signal);
  assert.notEqual(first, second);
  assert.equal(registry.getDeck(first.id), second);
  assert.equal(second.name, "Catalog revision 2");
  assert.equal(runtime.source(second).revision, 2);
});

test("bundled and browser-local imports bypass the catalog even with UUID-shaped ids", async () => {
  const registry = new DeckRegistry();
  const bundled = registry.registerDeck({ data: rawDeck(), runtimeId: "bundled" });
  const local = registry.registerDeck({ data: rawDeck(), custom: true, runtimeId: "11111111-1111-4111-8111-111111111111" });
  const runtime = new CatalogDeckRuntime(registry, async () => assert.fail("local decks must not be fetched"));
  assert.equal(await runtime.resolve(bundled.id, controller().signal), bundled);
  assert.equal(await runtime.resolve(local.id, controller().signal), local);
  runtime.clear();
  assert.equal(registry.getDeck(bundled.id), bundled);
  assert.equal(registry.getDeck(local.id), local);
});

test("the old catalog snapshot is unavailable throughout revalidation", async () => {
  const registry = new DeckRegistry();
  let response = Promise.resolve(remote());
  const runtime = new CatalogDeckRuntime(registry, () => response);
  await runtime.resolve("catalog-resource", controller().signal);
  const pending = deferred();
  response = pending.promise;
  const loading = runtime.resolve("catalog-resource", controller().signal);
  assert.equal(registry.getDeck("catalog-resource"), undefined);
  assert.equal(registry.getDeck("authored-deck"), undefined);
  pending.resolve(remote("catalog-resource", 2));
  await loading;
  assert.equal(registry.getDeck("catalog-resource").name, "Catalog revision 2");
});

for (const status of [401, 403, 404, 503]) {
  test(`a failed catalog refresh (${status}) evicts inaccessible or stale content`, async () => {
    const registry = new DeckRegistry();
    let failure = false;
    const runtime = new CatalogDeckRuntime(registry, async (id) => {
      if (failure) throw Object.assign(new Error("Unavailable"), { status });
      return remote(id);
    });
    await runtime.resolve("catalog-resource", controller().signal);
    failure = true;
    await assert.rejects(runtime.resolve("catalog-resource", controller().signal), { status });
    assert.equal(registry.getDeck("catalog-resource"), undefined);
    assert.equal(registry.getDeck("authored-deck"), undefined);
  });
}

test("an interrupted request cannot register a late response even if its transport ignores abort", async () => {
  const registry = new DeckRegistry();
  const pending = deferred();
  const runtime = new CatalogDeckRuntime(registry, () => pending.promise);
  const request = controller();
  const loading = runtime.resolve("catalog-resource", request.signal);
  request.abort();
  pending.resolve(remote());
  await assert.rejects(loading, { name: "AbortError" });
  assert.equal(registry.getDeck("catalog-resource"), undefined);
});

test("out-of-order responses cannot replace a newer route's catalog revision", async () => {
  const registry = new DeckRegistry();
  const older = deferred();
  const newer = deferred();
  let calls = 0;
  const runtime = new CatalogDeckRuntime(registry, () => ++calls === 1 ? older.promise : newer.promise);
  const first = runtime.resolve("catalog-resource", controller().signal);
  const second = runtime.resolve("catalog-resource", controller().signal);
  newer.resolve(remote("catalog-resource", 2));
  const current = await second;
  older.resolve(remote("catalog-resource", 1));
  await assert.rejects(first, { name: "AbortError" });
  assert.equal(registry.getDeck("catalog-resource"), current);
});

test("session changes clear all catalog snapshots and invalidate pending responses", async () => {
  const registry = new DeckRegistry();
  const pending = deferred();
  const runtime = new CatalogDeckRuntime(registry, async (id) => id === "pending" ? pending.promise : remote(id));
  const privateDeck = await runtime.resolve("private", controller().signal);
  const publicDeck = await runtime.resolve("public", controller().signal);
  const loading = runtime.resolve("pending", controller().signal);
  runtime.clear();
  assert.equal(registry.getDeck(privateDeck.id), undefined);
  assert.equal(registry.getDeck(publicDeck.id), undefined);
  pending.resolve(remote("pending"));
  await assert.rejects(loading, { name: "AbortError" });
  assert.equal(registry.listDecks().length, 0);
});

test("clearing a session preserves a later local replacement and its local provenance", async () => {
  const registry = new DeckRegistry();
  const runtime = new CatalogDeckRuntime(registry, async (id) => remote(id));
  await runtime.resolve("catalog-resource", controller().signal);
  const local = registry.registerDeck({ data: rawDeck(), custom: true, runtimeId: "catalog-resource" }, { replaceExisting: true });
  assert.equal(runtime.source(local), undefined);
  runtime.clear();
  assert.equal(registry.getDeck(local.id), local);
  assert.equal(await runtime.resolve(local.id, controller().signal), local);
});

test("a local import wins over a catalog request that was already in flight", async () => {
  const registry = new DeckRegistry();
  const pending = deferred();
  const runtime = new CatalogDeckRuntime(registry, () => pending.promise);
  const loading = runtime.resolve("catalog-resource", controller().signal);
  const local = registry.registerDeck({ data: rawDeck(), custom: true, runtimeId: "catalog-resource" });
  pending.resolve(remote());
  assert.equal(await loading, local);
  assert.equal(registry.getDeck(local.id), local);
  assert.equal(runtime.source(local), undefined);
});

test("compatibility aliases refresh the canonical resource id", async () => {
  const registry = new DeckRegistry();
  const requests = [];
  const runtime = new CatalogDeckRuntime(registry, async (id) => { requests.push(id); return remote(id); });
  await runtime.resolve("catalog-resource", controller().signal);
  const deck = await runtime.resolve("authored-deck", controller().signal);
  assert.equal(deck.id, "catalog-resource");
  assert.deepEqual(requests, ["catalog-resource", "catalog-resource"]);
});

test("a response for a different catalog identity is rejected", async () => {
  const registry = new DeckRegistry();
  const runtime = new CatalogDeckRuntime(registry, async () => remote("unexpected-id"));
  await assert.rejects(runtime.resolve("requested-id", controller().signal), /different deck identity/);
  assert.equal(registry.listDecks().length, 0);
});


test("alias routes can revalidate after session clearing without requesting an authored slug", async () => {
  const registry = new DeckRegistry();
  const requests = [];
  const runtime = new CatalogDeckRuntime(registry, async (id) => { requests.push(id); return remote(id); });
  await runtime.resolve("catalog-resource", controller().signal);
  runtime.clear();
  await runtime.resolve("authored-deck", controller().signal);
  assert.deepEqual(requests, ["catalog-resource", "catalog-resource"]);
});

test("remembered ambiguous aliases fail closed instead of picking a previous catalog owner", async () => {
  const registry = new DeckRegistry();
  const requests = [];
  const runtime = new CatalogDeckRuntime(registry, async (id) => {
    requests.push(id);
    if (id === "authored-deck") throw Object.assign(new Error("Not found"), { status: 404 });
    return remote(id);
  });
  await runtime.resolve("first-owner", controller().signal);
  await runtime.resolve("second-owner", controller().signal);
  runtime.clear();
  await assert.rejects(runtime.resolve("authored-deck", controller().signal), { status: 404 });
  assert.deepEqual(requests, ["first-owner", "second-owner", "authored-deck"]);
  assert.equal(registry.listDecks().length, 0);
});
