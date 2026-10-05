const test = require("node:test");
const assert = require("node:assert/strict");
const { getReadableArtwork, getPackArtworkAsset, getPackArtworkImage, uploadPackArtworkAsset, packArtworkPath } = require("../.test-build/artwork/api.js");
const { resolveArtworkPack } = require("../.test-build/artwork/selection.js");
const asset = (extra = {}) => ({ id: "asset-1", deckId: "deck", packId: "watercolor", slot: "cover", mediaType: "image/webp", width: 1600, height: 400, byteLength: 4, integrity: "sha256-test", deckRevision: 1, ...extra });
const packs = [
  { id: "saved-artwork", label: "Saved artwork", cardCount: 0, complete: false, hasCover: false, hasCardBack: false },
  { id: "watercolor", label: "Watercolor", cardCount: 0, complete: false, hasCover: true, hasCardBack: false },
];
const catalog = (extra = {}) => ({ enabled: true, deckRevision: 1, packId: "watercolor", packs, cards: [], cover: asset(), cardBack: null, ...extra });
const json = (body, status = 200) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

test("pack assets use fixed same-origin routes and strip arbitrary URL/renderer fields", async () => {
  const original = global.fetch, calls = [];
  global.fetch = async (path, init) => {
    calls.push([path, init]);
    return path.includes("/image?") ? new Response("test", { headers: { "content-type": "image/webp" } }) : json(asset({ imageUrl: "https://bad.test/script.svg", draw: "evil()" }));
  };
  try {
    const signal = new AbortController().signal;
    const metadata = await getPackArtworkAsset("deck", "cover", signal, "watercolor");
    assert.equal(metadata.imageUrl, undefined); assert.equal(metadata.draw, undefined); assert.equal(metadata.cardSlug, undefined);
    await getPackArtworkImage(metadata, signal);
    await uploadPackArtworkAsset("deck", "cover", new File(["data"], "cover.png", { type: "image/png" }), 1, "asset-1", signal, "watercolor");
    assert.deepEqual(calls.map(([path]) => path), ["/api/decks/deck/artwork/assets/cover?packId=watercolor", "/api/decks/deck/artwork/assets/cover/image?version=asset-1&packId=watercolor", "/api/me/decks/deck/artwork/assets/cover?packId=watercolor"]);
    assert.ok(calls.every(([, init]) => init.signal === signal && init.credentials === "same-origin" && init.redirect === "error" && init.cache === "no-store"));
    assert.equal(calls[2][1].method, "PUT"); assert.equal(calls[2][1].headers["x-arcana-artwork-version"], "asset-1"); assert.equal(calls[2][1].headers["x-arcana-deck-revision"], "1");
    assert.equal(packArtworkPath("deck /?", "cardBack"), "/api/decks/deck%20%2F%3F/artwork/assets/cardBack");
    assert.throws(() => packArtworkPath("deck", "../cover"), /Unknown/);
  } finally { global.fetch = original; }
});

test("cover/back metadata is optional for older catalogs and never changes front completeness", async () => {
  const original = global.fetch;
  try {
    global.fetch = async () => json({ enabled: true, deckRevision: 1, cards: [{ slug: "fool", name: "Fool", artwork: null }] });
    const legacy = await getReadableArtwork("deck");
    assert.equal(legacy.cover, null); assert.equal(legacy.cardBack, null); assert.equal(legacy.packs[0].cardCount, 0); assert.equal(legacy.packs[0].complete, false);
    global.fetch = async () => json(catalog({ cardBack: asset({ id: "back-1", slot: "cardBack" }) }));
    const current = await getReadableArtwork("deck", undefined, "watercolor");
    assert.equal(current.cover.slot, "cover"); assert.equal(current.cardBack.slot, "cardBack");
    assert.equal(current.packs[1].cardCount, 0); assert.equal(current.packs[1].complete, false);
    assert.equal(resolveArtworkPack(current.packs), "watercolor");
    assert.equal(resolveArtworkPack([{ ...packs[0], hasCardBack: true }, packs[1]]), "");
    assert.equal(resolveArtworkPack([{ ...packs[0], hasCardBack: true }, packs[1]], "saved-artwork"), "saved-artwork");
  } finally { global.fetch = original; }
});

test("asset metadata rejects mismatched pack/slot/deck/revision, invalid flags and unsafe image responses", async () => {
  const original = global.fetch;
  try {
    for (const extra of [{ slot: "cardBack" }, { deckId: "other" }, { packId: "saved-artwork" }, { width: 0 }, { height: 100000 }, { mediaType: "image/svg+xml" }, { id: "bad\nheader" }]) {
      global.fetch = async () => json(asset(extra));
      await assert.rejects(getPackArtworkAsset("deck", "cover", undefined, "watercolor"), /invalid artwork/);
    }
    for (const extra of [{ cover: asset({ deckRevision: 2 }) }, { cardBack: asset() }, { packs: [packs[0], { ...packs[1], hasCover: "yes" }] }]) {
      global.fetch = async () => json(catalog(extra));
      await assert.rejects(getReadableArtwork("deck", undefined, "watercolor"), /invalid artwork/);
    }
    global.fetch = async () => new Response("svg!", { headers: { "content-type": "image/svg+xml" } });
    await assert.rejects(getPackArtworkImage(asset()), /Unsupported/);
    global.fetch = async () => new Response("longer", { headers: { "content-type": "image/webp" } });
    await assert.rejects(getPackArtworkImage(asset()), /changed while loading/);
    global.fetch = async () => assert.fail("invalid upload must never fetch");
    await assert.rejects(uploadPackArtworkAsset("deck", "cardBack", new File(["svg"], "bad.svg", { type: "image/svg+xml" }), 1, null), /PNG/);
    await assert.rejects(uploadPackArtworkAsset("deck", "cardBack", new File(["png"], "ok.png", { type: "image/png" }), 0, null), /Refresh/);
  } finally { global.fetch = original; }
});
