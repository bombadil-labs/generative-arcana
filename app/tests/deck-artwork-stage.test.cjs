const test = require("node:test");
const assert = require("node:assert/strict");
const { resolve } = require("node:path");
const React = require("react");
const { JSDOM } = require("jsdom");
const { act } = React;
const manifest = require("./fixtures/minimal-artwork-manifest.json");
const dom = new JSDOM('<div id="root"></div>', { url: "http://localhost/" });
const saved = Object.fromEntries(["window", "document", "navigator", "fetch", "IS_REACT_ACT_ENVIRONMENT"].map(name => [name, Object.getOwnPropertyDescriptor(global, name)]));
const savedUrls = { create: URL.createObjectURL, revoke: URL.revokeObjectURL };
for (const [name, value] of Object.entries({ window: dom.window, document: dom.window.document, navigator: dom.window.navigator, IS_REACT_ACT_ENVIRONMENT: true })) Object.defineProperty(global, name, { configurable: true, writable: true, value });
const { createRoot } = require("react-dom/client");
let vite, root, Stage, Provider, useSelection, useStore, selection, store, handler, calls, urls, revoked;
const cards = [0, 1, 2].map(n => ({ ...manifest.data.cards["major-0"], slug: `major-${n}`, number: String(n), name: `Card ${n}` }));
const deck = { id: "stage-deck", name: "Stage deck", tagline: "A preview", cards, data: manifest.data };
const packs = ["saved-artwork", "ink", "empty"].map(id => ({ id, label: id, cardCount: id === "empty" ? 0 : 2, complete: false, hasCover: id !== "empty", hasCardBack: id !== "empty" }));
function asset(packId, slot, revision = 1) { return { id: `${packId}-${slot}-${revision}`, deckId: deck.id, packId, slot, mediaType: "image/webp", width: 1024, height: 1536, byteLength: 4, integrity: "sha256-test", deckRevision: revision }; }
function catalog(packId, { slugs = ["major-1", "major-2"], revision = 1, extras = true } = {}) {
  if (packId === "empty") { slugs = []; extras = false; }
  return { enabled: true, deckRevision: revision, packId, packs,
    cover: extras ? asset(packId, "cover", revision) : null, cardBack: extras ? asset(packId, "cardBack", revision) : null,
    cards: cards.map(card => ({ slug: card.slug, name: card.name, artwork: slugs.includes(card.slug) ? { ...asset(packId, card.slug, revision), cardSlug: card.slug } : null })) };
}
const json = value => new Response(JSON.stringify(value), { headers: { "content-type": "application/json" } });
const bytes = () => new Response("test", { headers: { "content-type": "image/webp" } });
function deferred() { let resolve; const promise = new Promise(yes => { resolve = yes; }); return { promise, resolve }; }
async function flush() { await act(async () => { await new Promise(resolve => setTimeout(resolve, 0)); }); }
function Capture({ tick }) { selection = useSelection(); store = useStore(); return React.createElement(Stage, { deck, "data-tick": tick }); }
async function render({ revision = 1, tick = 0 } = {}) {
  await act(async () => root.render(React.createElement(Provider, { deckId: deck.id, deckRevision: revision, selectedPackId: "saved-artwork" }, React.createElement(Capture, { tick }))));
  await flush(); await flush();
}
const slug = () => document.querySelector("[data-sample-slug]")?.dataset.sampleSlug;
test.before(async () => {
  const { createServer } = await import("vite");
  vite = await createServer({ root: resolve(__dirname, ".."), server: { middlewareMode: true }, appType: "custom", optimizeDeps: { noDiscovery: true, include: [] } });
  ({ DeckArtworkStage: Stage } = await vite.ssrLoadModule("/src/components/DeckArtworkStage.tsx"));
  ({ CatalogArtworkProvider: Provider, useArtworkSelection: useSelection, useArtworkStore: useStore } = await vite.ssrLoadModule("/src/artwork/context.tsx"));
});
test.beforeEach(() => {
  calls = []; urls = []; revoked = []; window.localStorage.clear();
  URL.createObjectURL = () => { const url = `blob:stage-${urls.length}`; urls.push(url); return url; };
  URL.revokeObjectURL = url => revoked.push(url);
  handler = async path => path.includes("/image?") ? bytes() : json(catalog(new URL(path, "http://local").searchParams.get("packId") || "saved-artwork"));
  global.fetch = async (path, init = {}) => {
    calls.push(path);
    assert.ok(!init.method || init.method === "GET", "stage never writes data");
    assert.ok(!/reading|draw/.test(path), "stage never starts a reading");
    return handler(path, init);
  };
  root = createRoot(document.getElementById("root"));
});
test.afterEach(async () => { await act(async () => root.unmount()); document.getElementById("root").replaceChildren(); });
test.after(async () => {
  await vite.close(); dom.window.close(); URL.createObjectURL = savedUrls.create; URL.revokeObjectURL = savedUrls.revoke;
  for (const [name, descriptor] of Object.entries(saved)) { if (descriptor) Object.defineProperty(global, name, descriptor); else delete global[name]; }
});

test("featured front survives parent rerenders, loading notifications, and pack round-trips", async () => {
  await render(); const first = slug(); assert.ok(["major-1", "major-2"].includes(first));
  for (let tick = 1; tick <= 4; tick++) { await render({ tick }); assert.equal(slug(), first); }
  await act(async () => store.load(first, true)); await flush(); assert.equal(slug(), first);
  await act(async () => selection.selectPack("ink")); await flush(); assert.equal(slug(), first);
  await act(async () => selection.selectPack("saved-artwork")); await flush(); assert.equal(slug(), first);
  assert.ok(calls.filter(path => path.includes("/cards/")).every(path => path.includes(first)));
});

test("a pack without the sampled front chooses only its own available front; no fronts shows no sample", async () => {
  await render(); const first = slug(), other = first === "major-1" ? "major-2" : "major-1";
  handler = async path => path.includes("/image?") ? bytes() : json(catalog(new URL(path, "http://local").searchParams.get("packId") || "saved-artwork", { slugs: [other] }));
  await act(async () => selection.selectPack("ink")); await flush(); assert.equal(slug(), other);
  const start = calls.length;
  await act(async () => selection.selectPack("empty")); await flush();
  assert.equal(slug(), undefined); assert.equal(document.querySelectorAll("img").length, 0);
  assert.ok(calls.slice(start).every(path => !path.includes("/image?")));
});

test("revision replacement rejects stale catalogs and cannot retain old featured artwork", async () => {
  await render(); const first = slug(), oldUrls = [...urls];
  await render({ revision: 2 });
  assert.equal(store.catalogStatus, "error"); assert.equal(slug(), undefined); assert.equal(document.querySelectorAll("img").length, 0);
  assert.ok(oldUrls.every(url => revoked.includes(url)));
  const other = first === "major-1" ? "major-2" : "major-1";
  handler = async path => path.includes("/image?") ? bytes() : json(catalog("saved-artwork", { revision: 2, slugs: [other] }));
  await act(async () => selection.refresh()); await flush();
  assert.equal(slug(), other); assert.equal(store.currentCatalog.deckRevision, 2);
});

test("missing extras and front decode failure retain semantic fallbacks without borrowing", async () => {
  handler = async path => path.includes("/image?") ? bytes() : json(catalog("saved-artwork", { extras: false }));
  await render(); const first = slug();
  assert.equal(document.querySelectorAll(".deck-artwork-cover img,.deck-artwork-back img").length, 0);
  const img = document.querySelector(".deck-artwork-front img"); assert.ok(img);
  await act(async () => img.dispatchEvent(new dom.window.Event("error"))); await flush();
  assert.equal(slug(), first); assert.equal(document.querySelectorAll("img").length, 0);
  assert.match(document.querySelector(".deck-artwork-front").textContent, /Card [12]/);
  assert.ok(calls.every(path => !path.includes("packId=ink")));
});

test("late catalogs and image bytes from discarded sets cannot resurrect featured artwork", async () => {
  await render(); const lateCatalog = deferred(), lateImage = deferred(); let catalogSignal, imageSignal;
  const prior = handler;
  handler = (path, init) => {
    if (path.includes("packId=ink") && !path.includes("/image?")) { catalogSignal = init.signal; return lateCatalog.promise; }
    return prior(path, init);
  };
  await act(async () => selection.selectPack("ink")); await flush();
  await act(async () => selection.selectPack("empty")); await flush();
  await act(async () => lateCatalog.resolve(json(catalog("ink")))); await flush();
  assert.equal(catalogSignal.aborted, true); assert.equal(slug(), undefined);
  handler = (path, init) => {
    if (path.includes("/cards/") && path.includes("/image?")) { imageSignal = init.signal; return lateImage.promise; }
    return prior(path, init);
  };
  await act(async () => selection.selectPack("saved-artwork")); await flush(); assert.ok(slug());
  await act(async () => root.render(React.createElement("p", null, "Away")));
  await act(async () => lateImage.resolve(bytes())); await flush();
  assert.equal(imageSignal.aborted, true); assert.equal(document.querySelectorAll("img").length, 0);
});
