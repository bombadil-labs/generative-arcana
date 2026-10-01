const test = require("node:test");
const assert = require("node:assert/strict");
const { getCardArtwork, getReadableArtwork, getOwnedArtwork, getArtworkImage, uploadCardArtwork, validateArtworkFile, MAX_ARTWORK_INPUT_BYTES } = require("../.test-build/artwork/api.js");
const { ArtworkStore } = require("../.test-build/artwork/store.js");
const metadata = (overrides = {}) => ({ id: "asset-1", deckId: "deck", cardSlug: "major-0", mediaType: "image/webp", width: 100, height: 150, byteLength: 4, integrity: "sha256-test", deckRevision: 1, ...overrides });
const catalog = (artwork = metadata()) => ({ enabled: true, deckRevision: 1, cards: [{ slug: "major-0", name: "The Fool", artwork }] });
function response(body, status = 200) { return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } }); }
function deferred() { let resolve, reject; const promise = new Promise((yes, no) => { resolve = yes; reject = no; }); return { promise, resolve, reject }; }
function fixture(overrides = {}) {
  const revoked = [], calls = [];
  const transport = { catalog: async (id, signal) => { calls.push(id); return catalog(); }, image: async () => new Blob(["test"], { type: "image/webp" }), createUrl: () => `blob:trusted-${calls.length}`, revokeUrl: (url) => revoked.push(url), ...overrides };
  return { store: new ArtworkStore("deck", 1, transport), revoked, calls };
}

test("artwork API uses fixed same-origin routes, no-store credentials and ignores returned URLs", async () => {
  const original = global.fetch; const calls = [];
  global.fetch = async (path, init) => { calls.push([path, init]); return response(metadata({ imageUrl: "https://evil.example/code.svg", code: "evil()" })); };
  try {
    const result = await getCardArtwork("deck", "major-0");
    assert.equal(result.imageUrl, undefined); assert.equal(result.code, undefined);
    assert.equal(calls[0][0], "/api/decks/deck/cards/major-0/artwork");
    assert.equal(calls[0][1].credentials, "same-origin"); assert.equal(calls[0][1].redirect, "error"); assert.equal(calls[0][1].cache, "no-store");
    global.fetch = async (path, init) => { calls.push([path, init]); return new Response("test", { headers: { "content-type": "image/webp" } }); };
    await getArtworkImage(result);
    assert.equal(calls[1][0], "/api/decks/deck/cards/major-0/artwork/image?version=asset-1");
  } finally { global.fetch = original; }
});

test("metadata identity, MIME, dimensions, stale bytes and feature-unavailable fail closed", async () => {
  const original = global.fetch;
  try {
    for (const invalid of [{ deckId: "other" }, { cardSlug: "other" }, { mediaType: "image/svg+xml" }, { width: 200000 }, { deckRevision: 0 }]) {
      global.fetch = async () => response(metadata(invalid));
      await assert.rejects(getCardArtwork("deck", "major-0"), /invalid artwork metadata/);
    }
    global.fetch = async () => new Response("<svg/>", { headers: { "content-type": "image/svg+xml" } });
    await assert.rejects(getArtworkImage(metadata()), /Unsupported/);
    global.fetch = async () => new Response("wrongsize", { headers: { "content-type": "image/webp" } });
    await assert.rejects(getArtworkImage(metadata()), /changed while loading/);
    global.fetch = async () => response({ message: "Disabled" }, 503);
    await assert.rejects(getReadableArtwork("deck"), { status: 503 });
  } finally { global.fetch = original; }
});

test("upload validates bounded raster input and includes explicit replace preconditions", async () => {
  assert.equal(MAX_ARTWORK_INPUT_BYTES, 3_000_000);
  for (const invalid of [{ type: "image/svg+xml", size: 1 }, { type: "image/png", size: 0 }, { type: "image/jpeg", size: 3_000_001 }]) assert.ok(validateArtworkFile(invalid));
  const original = global.fetch; let called = 0;
  global.fetch = async (path, init) => {
    ++called; assert.equal(path, "/api/me/decks/deck/cards/major-0/artwork"); assert.equal(init.method, "PUT");
    assert.equal(init.headers["content-type"], "image/png"); assert.equal(init.headers["x-arcana-deck-revision"], "1"); assert.equal(init.headers["x-arcana-artwork-version"], called === 1 ? "none" : "asset-1");
    return response(metadata(), 201);
  };
  try {
    const file = new File(["png"], "card.png", { type: "image/png" });
    await uploadCardArtwork("deck", "major-0", file, 1, null);
    await uploadCardArtwork("deck", "major-0", file, 1, "asset-1");
    await assert.rejects(uploadCardArtwork("deck", "major-0", new File(["svg"], "bad.svg", { type: "image/svg+xml" }), 1, null), /PNG/);
    assert.equal(called, 2);
  } finally { global.fetch = original; }
});

test("owner and readable artwork catalogs preserve stable card identities", async () => {
  const original = global.fetch; const calls = [];
  global.fetch = async (path) => { calls.push(path); return response(catalog()); };
  try {
    assert.equal((await getOwnedArtwork("deck")).cards[0].artwork.cardSlug, "major-0");
    await getReadableArtwork("deck");
    assert.deepEqual(calls, ["/api/me/decks/deck/artwork", "/api/decks/deck/artwork"]);
    global.fetch = async () => response({ ...catalog(), cards: [...catalog().cards, ...catalog().cards] });
    await assert.rejects(getOwnedArtwork("deck"), /invalid artwork card/);
  } finally { global.fetch = original; }
});

test("one metadata request is shared across cards and a disabled feature makes no image requests", async () => {
  let catalogCalls = 0; let imageCalls = 0;
  const { store } = fixture({ catalog: async () => { ++catalogCalls; throw Object.assign(new Error("disabled"), { status: 503 }); }, image: async () => { ++imageCalls; return new Blob(); } });
  await Promise.all(Array.from({ length: 78 }, (_, index) => store.load(`card-${index}`)));
  assert.equal(catalogCalls, 1); assert.equal(imageCalls, 0);
  assert.equal(store.get("card-1").status, "missing");
});

test("refresh removes stale image immediately; failure leaves semantic fallback and revokes bytes", async () => {
  let fail = false;
  const { store, revoked } = fixture({ catalog: async () => { if (fail) throw new Error("offline"); return catalog(); } });
  await store.load("major-0"); assert.equal(store.has("major-0"), true);
  fail = true; const pending = store.load("major-0", true);
  assert.equal(store.get("major-0").status, "loading"); assert.equal(revoked.length, 1);
  await pending; assert.equal(store.get("major-0").status, "error");
  fail = false; await store.load("major-0", true); assert.equal(store.has("major-0"), true);
});

test("logout/navigation clears blobs and ignored-abort responses cannot recreate private images", async () => {
  const pending = deferred(); let created = 0;
  const { store } = fixture({ image: () => pending.promise, createUrl: () => { ++created; return "blob:private"; } });
  const load = store.load("major-0"); await Promise.resolve(); await Promise.resolve();
  store.clear(); pending.resolve(new Blob(["test"])); await load;
  assert.equal(created, 0); assert.equal(store.get("major-0").status, "idle");
  const normal = fixture(); await normal.store.load("major-0"); normal.store.clear();
  assert.equal(normal.revoked.length, 1); assert.equal(normal.store.has("major-0"), false);
});

test("an older upload refresh cannot overwrite a newer artwork response", async () => {
  const first = deferred(); let count = 0;
  const { store } = fixture({ image: async () => ++count === 1 ? first.promise : new Blob(["test"]) });
  const old = store.load("major-0"); await Promise.resolve(); await Promise.resolve();
  await store.load("major-0", true); const latest = store.get("major-0");
  first.resolve(new Blob(["old!"])); await old;
  assert.equal(store.get("major-0"), latest);
});

test("deck revision mismatch never requests image bytes or acquires an object URL", async () => {
  const { store } = fixture({ catalog: async () => catalog(metadata({ deckRevision: 2 })), image: async () => assert.fail("stale revision must not fetch image") });
  await store.load("major-0"); assert.equal(store.get("major-0").status, "error");
});
