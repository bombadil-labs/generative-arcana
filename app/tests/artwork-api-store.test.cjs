const test = require("node:test");
const assert = require("node:assert/strict");
const { getCardArtwork, getReadableArtwork, getOwnedArtwork, getArtworkImage, uploadCardArtwork, createArtworkSet, validateArtworkFile, MAX_ARTWORK_INPUT_BYTES } = require("../.test-build/artwork/api.js");
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
    assert.equal(calls[1][0], "/api/decks/deck/cards/major-0/artwork/image?version=asset-1&packId=saved-artwork");
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
  const load = store.load("major-0"); await new Promise(setImmediate);
  store.clear(); pending.resolve(new Blob(["test"])); await load;
  assert.equal(created, 0); assert.equal(store.get("major-0").status, "idle");
  const normal = fixture(); await normal.store.load("major-0"); normal.store.clear();
  assert.equal(normal.revoked.length, 1); assert.equal(normal.store.has("major-0"), false);
});

test("an older upload refresh cannot overwrite a newer artwork response", async () => {
  const first = deferred(); let count = 0;
  const { store } = fixture({ image: async () => ++count === 1 ? first.promise : new Blob(["test"]) });
  const old = store.load("major-0"); await new Promise(setImmediate);
  await store.load("major-0", true); const latest = store.get("major-0");
  first.resolve(new Blob(["old!"])); await old;
  assert.equal(store.get("major-0"), latest);
});

test("deck revision mismatch never requests image bytes or acquires an object URL", async () => {
  const { store } = fixture({ catalog: async () => catalog(metadata({ deckRevision: 2 })), image: async () => assert.fail("stale revision must not fetch image") });
  await store.load("major-0"); assert.equal(store.get("major-0").status, "error");
});

function namedCatalog(packId, art = metadata({ packId })) {
  return { ...catalog(art), packId, packs: [
    { id: "saved-artwork", label: "Saved artwork", cardCount: 1, complete: true },
    { id: "watercolor", label: "Watercolor", description: "Soft washes", cardCount: art ? 1 : 0, complete: !!art },
    { id: "ink", label: "Ink", cardCount: 0, complete: false },
  ] };
}

test("legacy catalogs and metadata normalize into Saved artwork", async () => {
  const original = global.fetch;
  global.fetch = async () => response(catalog());
  try {
    const result = await getReadableArtwork("deck");
    assert.equal(result.packId, "saved-artwork"); assert.equal(result.cards[0].artwork.packId, "saved-artwork");
    assert.deepEqual(result.packs, [{ id: "saved-artwork", label: "Saved artwork", cardCount: 1, complete: true }]);
  } finally { global.fetch = original; }
});

test("named artwork API scopes catalogs, individual cards, image bytes and uploads to one set", async () => {
  const original = global.fetch, calls = []; const signal = new AbortController().signal;
  global.fetch = async (path, init) => {
    calls.push([path, init]);
    if (path.includes("/image?")) return new Response("test", { headers: { "content-type": "image/webp" } });
    return response(path.includes("/cards/") ? metadata({ packId: "watercolor" }) : namedCatalog("watercolor"));
  };
  try {
    await getOwnedArtwork("deck", signal, "watercolor"); await getReadableArtwork("deck", signal, "watercolor");
    const result = await getCardArtwork("deck", "major-0", signal, "watercolor");
    await getArtworkImage(result, signal);
    await uploadCardArtwork("deck", "major-0", new File(["png"], "card.png", { type: "image/png" }), 1, null, signal, "watercolor");
    assert.deepEqual(calls.map(([path]) => path), [
      "/api/me/decks/deck/artwork?packId=watercolor", "/api/decks/deck/artwork?packId=watercolor",
      "/api/decks/deck/cards/major-0/artwork?packId=watercolor", "/api/decks/deck/cards/major-0/artwork/image?version=asset-1&packId=watercolor",
      "/api/me/decks/deck/cards/major-0/artwork?packId=watercolor",
    ]);
    assert.ok(calls.every(([, init]) => init.signal === signal));
  } finally { global.fetch = original; }
});

test("another or omitted set identity never silently satisfies a named artwork request", async () => {
  const original = global.fetch;
  try {
    for (const invalid of [catalog(), namedCatalog("ink"), namedCatalog("watercolor", metadata())]) {
      global.fetch = async () => response(invalid);
      await assert.rejects(getReadableArtwork("deck", undefined, "watercolor"), /invalid artwork/);
    }
    global.fetch = async () => response(metadata());
    await assert.rejects(getCardArtwork("deck", "major-0", undefined, "watercolor"), /invalid artwork metadata/);
    const duplicate = namedCatalog("watercolor"); duplicate.packs.push(duplicate.packs[1]);
    global.fetch = async () => response(duplicate);
    await assert.rejects(getOwnedArtwork("deck", undefined, "watercolor"), /invalid artwork set catalog/);
  } finally { global.fetch = original; }
});

test("creating a named set sends bounded metadata and its deck revision, never executable visual content", async () => {
  const original = global.fetch; let calls = 0;
  global.fetch = async (path, init) => {
    ++calls; assert.equal(path, "/api/me/decks/deck/artwork/sets"); assert.equal(init.method, "POST");
    assert.deepEqual(JSON.parse(init.body), { id: "water.color_v2", label: "Watercolor", description: "Soft washes", expectedDeckRevision: 1 });
    return response({ id: "water.color_v2", label: "Watercolor", description: "Soft washes", cardCount: 0, complete: false, imageUrl: "https://bad.test" });
  };
  try {
    const result = await createArtworkSet("deck", { id: "water.color_v2", label: " Watercolor ", description: " Soft washes ", expectedDeckRevision: 1 });
    assert.equal(result.imageUrl, undefined); assert.equal(result.complete, false);
    for (const invalid of [{ id: "saved-artwork" }, { id: "../water" }, { label: " " }, { label: "x".repeat(81) }, { description: "x".repeat(501) }, { expectedDeckRevision: 0 }]) {
      await assert.rejects(createArtworkSet("deck", { id: "watercolor", label: "Watercolor", expectedDeckRevision: 1, ...invalid }));
    }
    assert.equal(calls, 1);
  } finally { global.fetch = original; }
});

test("switching sets revokes the old image immediately and isolates the same card and asset IDs", async () => {
  const seen = [];
  const { store, revoked } = fixture({ catalog: async (deckId, signal, packId = "saved-artwork") => { seen.push(packId); return namedCatalog(packId); } });
  store.selectPack("saved-artwork");
  await store.load("major-0"); assert.equal(store.has("major-0"), true);
  store.selectPack("watercolor"); assert.equal(store.get("major-0").status, "idle"); assert.equal(revoked.length, 1);
  await store.load("major-0"); assert.equal(store.get("major-0").artwork.packId, "watercolor");
  assert.deepEqual(seen, ["saved-artwork", "watercolor"]);
});

test("rapid set switching ignores late catalog and image responses even when abort is ignored", async () => {
  const oldBytes = deferred(), oldCatalog = deferred(); let created = 0;
  const { store } = fixture({
    catalog: async (deckId, signal, packId = "saved-artwork") => packId === "watercolor" ? oldCatalog.promise : namedCatalog(packId),
    image: async (art) => art.packId === "saved-artwork" ? oldBytes.promise : new Blob(["test"]),
    createUrl: () => `blob:${++created}`,
  });
  const first = store.load("major-0"); await new Promise(setImmediate);
  store.selectPack("watercolor"); const second = store.load("major-0");
  store.selectPack("ink"); await store.load("major-0"); const current = store.get("major-0");
  oldCatalog.resolve(namedCatalog("watercolor")); oldBytes.resolve(new Blob(["test"])); await Promise.all([first, second]);
  assert.equal(store.get("major-0"), current); assert.equal(current.artwork.packId, "ink"); assert.equal(created, 1);
  assert.equal(store.packId, "ink"); assert.equal(store.catalogStatus, "ready");
});

test("set mismatches and missing slots never fetch another set's images", async () => {
  const { store } = fixture({ catalog: async () => namedCatalog("watercolor", null), image: async () => assert.fail("must not fetch image bytes") });
  store.selectPack("watercolor"); await store.load("major-0"); assert.equal(store.get("major-0").status, "missing");
  const mismatch = fixture({ catalog: async () => namedCatalog("watercolor", metadata({ packId: "ink" })), image: async () => assert.fail("must not fetch mismatched bytes") });
  mismatch.store.selectPack("watercolor"); await mismatch.store.load("major-0"); assert.equal(mismatch.store.get("major-0").status, "error");
});


const summary = (id, cardCount) => ({ id, label: id, cardCount, complete: false });
function selectionFixture(packs, preferred, overrides = {}) {
  const requests = [], imagePacks = [];
  const transport = {
    catalog: async (_deckId, _signal, packId = "saved-artwork") => {
      requests.push(packId);
      if (!packs.some(pack => pack.id === packId)) throw Object.assign(new Error("missing"), { status: 404 });
      const art = packs.find(pack => pack.id === packId).cardCount ? metadata({ packId }) : null;
      return { ...catalog(art), packId, packs };
    },
    image: async (art) => { imagePacks.push(art.packId); return new Blob(["test"]); },
    createUrl: () => "blob:chosen", revokeUrl: () => {}, ...overrides,
  };
  return { store: new ArtworkStore("deck", 1, transport, preferred), requests, imagePacks };
}

test("sole populated set becomes the default despite empty legacy/named sets and is not per-card fallback", async () => {
  for (const preferred of [undefined, "saved-artwork", "empty", "deleted"]) {
    const { store, imagePacks } = selectionFixture([summary("saved-artwork", 0), summary("empty", 0), summary("gpt", 1)], preferred);
    await Promise.all([store.load("major-0"), store.load("major-6")]);
    assert.equal(store.packId, "gpt"); assert.equal(store.get("major-0").status, "ready");
    assert.equal(store.get("major-6").status, "missing"); assert.deepEqual(imagePacks, ["gpt"]);
  }
});

test("multiple populated sets require a choice and never load an arbitrary image", async () => {
  for (const preferred of [undefined, "saved-artwork", "deleted"]) {
    const { store, imagePacks } = selectionFixture([summary("saved-artwork", 0), summary("gpt", 1), summary("claude", 1)], preferred);
    await store.load("major-0");
    assert.equal(store.packId, ""); assert.equal(store.catalogStatus, "ready");
    assert.equal(store.hasArtwork("major-0"), false); assert.deepEqual(imagePacks, []);
    store.selectPack("claude"); await store.load("major-0");
    assert.equal(store.get("major-0").artwork.packId, "claude");
  }
  const populatedDefault = selectionFixture([summary("saved-artwork", 1), summary("gpt", 1)]);
  await populatedDefault.store.load("major-0"); assert.equal(populatedDefault.store.packId, "");
});

test("valid populated preferences survive multiple packs; empty decks retain an editable fallback", async () => {
  for (const preferred of ["saved-artwork", "gpt"]) {
    const { store } = selectionFixture([summary("saved-artwork", 1), summary("gpt", 1)], preferred);
    await store.load("major-0"); assert.equal(store.packId, preferred); assert.equal(store.has("major-0"), true);
  }
  for (const [preferred, expected] of [[undefined, "saved-artwork"], ["empty", "empty"], ["deleted", "saved-artwork"]]) {
    const { store, imagePacks } = selectionFixture([summary("saved-artwork", 0), summary("empty", 0)], preferred);
    await store.load("major-0"); assert.equal(store.packId, expected); assert.deepEqual(imagePacks, []);
  }
});

test("a manual empty upload destination is not auto-switched, and late discovery cannot undo a choice", async () => {
  const packs = [summary("saved-artwork", 0), summary("gpt", 1), summary("empty", 0)];
  const { store } = selectionFixture(packs);
  await store.loadCatalog(); store.selectPack("empty"); await store.load("major-0");
  assert.equal(store.packId, "empty"); assert.equal(store.get("major-0").status, "missing");
  const pending = deferred();
  const late = selectionFixture(packs, undefined, { catalog: async (_id, _signal, id = "saved-artwork") => id === "saved-artwork" ? pending.promise : { ...catalog(null), packId: id, packs } });
  const first = late.store.load("major-0");
  late.store.selectPack("empty"); await late.store.load("major-0");
  pending.resolve({ ...catalog(null), packId: "saved-artwork", packs }); await first;
  assert.equal(late.store.packId, "empty"); assert.equal(late.store.get("major-0").status, "missing");
});

test("selection discovery does not mask access/server failures or accept a wrong pack/revision", async () => {
  for (const status of [401, 403, 500, 503]) {
    const calls = [];
    const { store } = selectionFixture([], "deleted", { catalog: async (_id, _signal, packId) => { calls.push(packId); throw Object.assign(new Error("unavailable"), { status }); } });
    await assert.rejects(store.loadCatalog(), /unavailable/); assert.equal(calls.length, 1);
  }
  for (const invalid of [{ packId: "other", deckRevision: 1 }, { packId: "gpt", deckRevision: 2 }]) {
    const { store, imagePacks } = selectionFixture([summary("saved-artwork", 0), summary("gpt", 1)], undefined, {
      catalog: async (_id, _signal, packId = "saved-artwork") => ({ ...catalog(null), packId, packs: [summary("saved-artwork", 0), summary("gpt", 1)], ...(packId === "gpt" ? invalid : {}) }),
    });
    await assert.rejects(store.loadCatalog(), /mismatch/); assert.deepEqual(imagePacks, []);
  }
});

test("pack content can include optional cover/back assets without redefining front coverage", () => {
  const { resolveArtworkPack, hasArtworkContent } = require("../.test-build/artwork/selection.js");
  for (const flag of ["hasCover", "hasCardBack"]) {
    const pack = { ...summary("assets-only", 0), [flag]: true };
    assert.equal(hasArtworkContent(pack), true);
    assert.equal(resolveArtworkPack([summary("saved-artwork", 0), pack]), "assets-only");
  }
  assert.equal(hasArtworkContent({ cardCount: 0, hasCover: false, hasCardBack: false }), false);
});

test("selecting the current empty destination cancels an in-flight automatic switch", async () => {
  const pending = deferred(); const packs = [summary("saved-artwork", 0), summary("gpt", 1)];
  const { store } = selectionFixture(packs, undefined, { catalog: async (_id, _signal, id = "saved-artwork") => id === "gpt" ? pending.promise : { ...catalog(null), packId: id, packs } });
  const first = store.load("major-0"); await new Promise(setImmediate);
  store.selectPack("saved-artwork"); await store.load("major-0");
  pending.resolve({ ...catalog(metadata({ packId: "gpt" })), packId: "gpt", packs }); await first;
  assert.equal(store.packId, "saved-artwork"); assert.equal(store.get("major-0").status, "missing");
});
