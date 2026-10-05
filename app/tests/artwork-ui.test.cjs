const test = require("node:test");
const assert = require("node:assert/strict");
const { resolve } = require("node:path");
const React = require("react");
const { JSDOM } = require("jsdom");
const { rawDeck } = require("./fixtures.cjs");
const { act } = React;
const dom = new JSDOM('<div id="root"></div>', { url: "http://localhost/" });
const originalFetch = global.fetch;
const originalWindow = global.window;
const originalDocument = global.document;
const originalNavigatorDescriptor = Object.getOwnPropertyDescriptor(global, "navigator");
const originalCreate = URL.createObjectURL;
const originalRevoke = URL.revokeObjectURL;
global.window = dom.window; global.document = dom.window.document; global.IS_REACT_ACT_ENVIRONMENT = true;
// Node 20 has no global navigator; newer Node versions expose a getter-only property.
Object.defineProperty(global, "navigator", { configurable: true, value: dom.window.navigator });
const { createRoot } = require("react-dom/client");
let vite, root, Editor, Provider, useSession, ArtworkProvider, useArtworkStore, useArtworkSelection, useCardArtwork, CardArt, CardBrowser, Reading, visuals, Boundary, catalogRuntime, domain, controls, card, deck;
let handler, images, revoked, anonymous = false;
let accountId = "account-one";
function json(body, status = 200) { return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } }); }
function metadata(overrides = {}) { return { id: "asset-1", deckId: "deck", cardSlug: card.slug, mediaType: "image/webp", width: 100, height: 150, byteLength: 4, integrity: "sha256-test", deckRevision: 1, ...overrides }; }
function catalog(artwork = null, revision = 1) { return { enabled: true, deckRevision: revision, cards: [{ slug: card.slug, name: card.name, artwork }] }; }
function deferred() { let resolve; const promise = new Promise((yes) => { resolve = yes; }); return { promise, resolve }; }
async function flush() { await act(async () => { await new Promise((done) => setTimeout(done, 0)); }); }
function Capture({ children }) { controls = useSession(); return children; }
function view(content = React.createElement(Editor, { deckId: "deck" })) {
  return React.createElement(Provider, null, React.createElement(Capture, null, React.createElement(ArtworkProvider, { deckId: "deck", deckRevision: 1 }, content)));
}
async function mount(content) { await act(async () => root.render(view(content))); await flush(); }
function inputFile(type = "image/png") {
  const input = document.getElementById("artwork-file");
  assert.ok(input, "file picker should be visible");
  Object.defineProperty(input, "files", { configurable: true, value: [new File(["data"], "card.png", { type })] });
  input.dispatchEvent(new dom.window.Event("change", { bubbles: true }));
}
function submit() { document.getElementById("artwork-upload-form").dispatchEvent(new dom.window.Event("submit", { bubbles: true, cancelable: true })); }

test.before(async () => {
  const { createServer } = await import("vite");
  vite = await createServer({ root: resolve(__dirname, ".."), server: { middlewareMode: true }, appType: "custom", optimizeDeps: { noDiscovery: true, include: [] } });
  ({ ArtworkEditor: Editor } = await vite.ssrLoadModule("/src/app/ArtworkEditor.tsx"));
  ({ BrowserSessionProvider: Provider, useBrowserSession: useSession } = await vite.ssrLoadModule("/src/auth/session.tsx"));
  ({ CatalogArtworkProvider: ArtworkProvider, useArtworkStore, useArtworkSelection, useCardArtwork } = await vite.ssrLoadModule("/src/artwork/context.tsx"));
  ({ CardArt } = await vite.ssrLoadModule("/src/components/CardArt.tsx"));
  ({ CardBrowser } = await vite.ssrLoadModule("/src/app/CardBrowser.tsx"));
  ({ Reading } = await vite.ssrLoadModule("/src/app/Reading.tsx"));
  visuals = await vite.ssrLoadModule("/src/runtime/defineCard.ts");
  ({ RemoteDeckBoundary: Boundary } = await vite.ssrLoadModule("/src/app/RemoteDeckBoundary.tsx"));
  ({ catalogDeckRuntime: catalogRuntime } = await vite.ssrLoadModule("/src/catalog/runtime.ts"));
  domain = await vite.ssrLoadModule("/src/decks/registry.ts");
  deck = domain.registerDeck({ data: rawDeck(), runtimeId: "deck", custom: true }); card = deck.cards[0];
});
test.beforeEach(() => {
  window.localStorage.clear();
  anonymous = false; accountId = "account-one"; images = []; revoked = [];
  URL.createObjectURL = () => { const url = `blob:trusted-${images.length}`; images.push(url); return url; };
  URL.revokeObjectURL = (url) => revoked.push(url);
  handler = async (path, init) => {
    if (path === "/api/me/decks/deck/artwork") return json(catalog());
    if (path === "/api/decks/deck/artwork") return json(catalog());
    throw new Error(`Unexpected request ${path}`);
  };
  global.fetch = async (path, init) => {
    if (path === "/auth/session") return json(anonymous ? { authenticated: false } : { authenticated: true, accountId, user: { email: "owner@example.test" } });
    if (path === "/api/auth/sign-out") { anonymous = true; return json({ success: true }); }
    return handler(path, init);
  };
  root = createRoot(document.getElementById("root"));
});
test.afterEach(async () => {
  await act(async () => root.unmount()); document.getElementById("root").replaceChildren();
  catalogRuntime.clear(); visuals.visualRegistry.clearDeck("deck");
  if (!domain.getDeck("deck")) domain.registerDeck({ data: deck.data, runtimeId: "deck", custom: true });
});
test.after(async () => {
  await vite?.close(); dom.window.close(); global.fetch = originalFetch; global.window = originalWindow; global.document = originalDocument;
  URL.createObjectURL = originalCreate; URL.revokeObjectURL = originalRevoke; delete global.IS_REACT_ACT_ENVIRONMENT;
  if (originalNavigatorDescriptor) Object.defineProperty(global, "navigator", originalNavigatorDescriptor);
  else delete global.navigator;
});

test("upload UI labels inputs, blocks invalid files and retries a recoverable error without duplicate submissions", async () => {
  let uploads = 0; const pending = deferred();
  handler = async (path, init) => {
    if (init.method === "PUT") { ++uploads; return uploads === 1 ? json({ message: "Temporary failure" }, 500) : pending.promise; }
    return json(catalog());
  };
  await mount();
  assert.match(document.body.textContent, /Maximum 3 MB and 16 megapixels/);
  assert.equal(document.querySelector('label[for="artwork-file"]').textContent, `Image for ${card.name}`);
  assert.equal(document.querySelector('button[type="submit"]').disabled, true);
  await act(async () => inputFile("image/svg+xml"));
  assert.match(document.querySelector('[role="alert"]').textContent, /PNG, JPEG, or WebP/);
  await act(async () => inputFile()); await act(async () => submit());
  assert.equal(uploads, 1); assert.match(document.querySelector('[role="alert"]').textContent, /Temporary failure/);
  assert.equal(document.querySelector('button[type="submit"]').disabled, false);
  await act(async () => { submit(); submit(); });
  assert.equal(uploads, 2); assert.equal(document.querySelector('button[type="submit"]').disabled, true);
  await act(async () => pending.resolve(json(metadata(), 201))); await flush();
  assert.match(document.body.textContent, /Artwork saved/);
  assert.equal(document.querySelector('button[type="submit"]').disabled, true);
});

test("a conflict reloads preconditions and requires a fresh explicit upload", async () => {
  let ownerReads = 0; let uploads = 0; const versions = [];
  handler = async (path, init) => {
    if (init.method === "PUT") { ++uploads; versions.push(init.headers["x-arcana-artwork-version"]); return uploads === 1 ? json({ message: "Changed" }, 409) : json(metadata({ id: "asset-3" }), 201); }
    if (path.startsWith("/api/me/")) return json(++ownerReads === 1 ? catalog() : catalog(metadata({ id: "asset-2" })));
    if (path.includes("/image?version=")) return new Response("test", { headers: { "content-type": "image/webp" } });
    return json(catalog(metadata({ id: "asset-2" })));
  };
  await mount(); await act(async () => inputFile()); await act(async () => submit()); await flush();
  assert.equal(uploads, 1); assert.equal(ownerReads, 2);
  assert.match(document.body.textContent, /choose your image again/);
  assert.equal(document.querySelector('button[type="submit"]').disabled, true);
  await act(async () => inputFile()); await act(async () => submit());
  assert.deepEqual(versions, ["none", "asset-2"]);
});

test("logout during an upload hides owner UI and ignores the late success", async () => {
  const pending = deferred(); let uploadSignal;
  handler = async (path, init) => {
    if (init.method === "PUT") { uploadSignal = init.signal; return pending.promise; }
    return json(catalog());
  };
  await mount(); await act(async () => inputFile()); await act(async () => submit());
  await act(async () => controls.signOut());
  assert.equal(document.querySelector('input[type="file"]'), null);
  assert.match(document.body.textContent, /Sign in to upload/); assert.equal(uploadSignal.aborted, true);
  await act(async () => pending.resolve(json(metadata(), 201)));
  assert.doesNotMatch(document.body.textContent, /Artwork saved/);
});

test("navigation cancels loading and late owner responses cannot reveal the previous card", async () => {
  const pending = deferred(); let signal;
  handler = async (path, init) => { signal = init.signal; return pending.promise; };
  await mount(); assert.match(document.body.textContent, /Loading the latest cards/);
  await act(async () => root.render(React.createElement("p", null, "Another page")));
  assert.equal(signal.aborted, true);
  await act(async () => pending.resolve(json(catalog())));
  assert.equal(document.body.textContent, "Another page");
});

test("raster artwork wins over the semantic face; failed image decoding restores semantic fallback", async () => {
  handler = async (path) => path.includes("/image?version=") ? new Response("test", { headers: { "content-type": "image/webp" } }) : json(catalog(metadata({ imageUrl: "https://evil.test/unsafe.svg" })));
  await mount(React.createElement(CardArt, { card, deckId: "deck", deck: deck.data }));
  const img = document.querySelector("img"); assert.ok(img); assert.equal(img.getAttribute("src"), images[0]); assert.equal(img.alt, `${card.name} artwork`);
  assert.doesNotMatch(document.body.innerHTML, /evil\.test/);
  await act(async () => img.dispatchEvent(new dom.window.Event("error")));
  assert.equal(document.querySelector("img"), null); assert.match(document.body.textContent, new RegExp(card.name)); assert.equal(revoked.length, 1);
});

test("slow saved artwork stays neutral through metadata, bytes and image decoding, without flashing the semantic face", async () => {
  const meta = deferred(), bytes = deferred();
  handler = async (path) => path.includes("/image?version=") ? bytes.promise : meta.promise;
  await mount(React.createElement(CardArt, { card, deckId: "deck", deck: deck.data }));
  assert.ok(document.querySelector('[aria-busy="true"]'));
  assert.equal(document.querySelector('[aria-busy="true"]').getAttribute("aria-label"), `Loading artwork for ${card.name}`);
  assert.doesNotMatch(document.body.textContent, new RegExp(card.name));
  await act(async () => meta.resolve(json(catalog(metadata()))));
  assert.ok(document.querySelector('[aria-busy="true"]')); assert.equal(document.querySelector("img"), null);
  await act(async () => bytes.resolve(new Response("test", { headers: { "content-type": "image/webp" } })));
  const img = document.querySelector("img"); assert.ok(img);
  assert.equal(img.style.opacity, "0"); assert.equal(img.getAttribute("aria-hidden"), "true");
  assert.ok(document.querySelector('[aria-busy="true"]'));
  await act(async () => img.dispatchEvent(new dom.window.Event("load")));
  assert.equal(document.querySelector('[aria-busy="true"]'), null);
  assert.equal(img.style.opacity, "1"); assert.equal(img.getAttribute("aria-hidden"), "false");
  assert.doesNotMatch(document.body.textContent, new RegExp(card.name));
});

for (const outcome of ["missing", "disabled", "error"]) test(`pending artwork resolves to the semantic face when ${outcome}`, async () => {
  const pending = deferred(); handler = () => pending.promise;
  await mount(React.createElement(CardArt, { card, deckId: "deck", deck: deck.data }));
  assert.ok(document.querySelector('[aria-busy="true"]'));
  await act(async () => pending.resolve(outcome === "missing" ? json(catalog()) : json({ message: outcome }, outcome === "disabled" ? 503 : 500)));
  assert.equal(document.querySelector('[aria-busy="true"]'), null);
  assert.equal(document.querySelector("img"), null); assert.match(document.body.textContent, new RegExp(card.name));
});

test("cards without saved art render independently while another card image is still loading", async () => {
  const second = deck.cards[1], bytes = deferred();
  handler = async (path) => path.includes("/image?version=") ? bytes.promise : json({ enabled: true, deckRevision: 1, cards: [{ slug: card.slug, name: card.name, artwork: metadata() }, { slug: second.slug, name: second.name, artwork: null }] });
  await mount(React.createElement("div", null, React.createElement(CardArt, { card, deckId: "deck", deck: deck.data }), React.createElement(CardArt, { card: second, deckId: "deck", deck: deck.data })));
  assert.equal(document.querySelectorAll('[aria-busy="true"]').length, 1);
  assert.match(document.body.textContent, new RegExp(second.name));
  assert.doesNotMatch(document.body.textContent, new RegExp(card.name));
});

test("refresh removes previous art immediately and ignores late decode events until the new image loads", async () => {
  let store;
  function CaptureArtwork() { store = useArtworkStore(); return React.createElement(CardArt, { card, deckId: "deck", deck: deck.data }); }
  handler = async (path) => path.includes("/image?version=") ? new Response("test", { headers: { "content-type": "image/webp" } }) : json(catalog(metadata()));
  await mount(React.createElement(CaptureArtwork));
  const oldImage = document.querySelector("img");
  await act(async () => oldImage.dispatchEvent(new dom.window.Event("load")));
  const meta = deferred(), bytes = deferred();
  handler = async (path) => path.includes("/image?version=") ? bytes.promise : meta.promise;
  let refresh;
  await act(async () => { refresh = store.load(card.slug, true); });
  assert.equal(document.querySelector("img"), null); assert.deepEqual(revoked, [images[0]]);
  assert.ok(document.querySelector('[aria-busy="true"]')); assert.doesNotMatch(document.body.textContent, new RegExp(card.name));
  await act(async () => { oldImage.dispatchEvent(new dom.window.Event("load")); oldImage.dispatchEvent(new dom.window.Event("error")); });
  await act(async () => meta.resolve(json(catalog(metadata({ id: "asset-2" })))));
  await act(async () => { bytes.resolve(new Response("test", { headers: { "content-type": "image/webp" } })); await refresh; });
  const latest = document.querySelector("img"); assert.notEqual(latest, oldImage);
  assert.equal(latest.style.opacity, "0"); assert.ok(document.querySelector('[aria-busy="true"]'));
  await act(async () => oldImage.dispatchEvent(new dom.window.Event("error")));
  assert.equal(document.querySelector("img"), latest);
  await act(async () => latest.dispatchEvent(new dom.window.Event("load")));
  assert.equal(latest.style.opacity, "1"); assert.equal(document.querySelector('[aria-busy="true"]'), null);
});

test("local cards without a catalog artwork context keep their immediate semantic face", async () => {
  await act(async () => root.render(React.createElement(CardArt, { card, deckId: "deck", deck: deck.data })));
  assert.equal(document.querySelector('[aria-busy="true"]'), null);
  assert.match(document.body.textContent, new RegExp(card.name));
});

test("a late error callback from a superseded artwork resource cannot discard the latest image", async () => {
  let store, artwork;
  function CaptureArtwork() { store = useArtworkStore(); artwork = useCardArtwork("deck", card.slug); return React.createElement(CardArt, { card, deckId: "deck", deck: deck.data }); }
  handler = async (path) => path.includes("/image?version=") ? new Response("test", { headers: { "content-type": "image/webp" } }) : json(catalog(metadata()));
  await mount(React.createElement(CaptureArtwork));
  const oldFailure = artwork.fail;
  await act(async () => store.load(card.slug, true));
  const latest = document.querySelector("img"); const currentState = store.get(card.slug);
  await act(async () => oldFailure());
  assert.equal(store.get(card.slug), currentState); assert.equal(document.querySelector("img"), latest);
  await act(async () => artwork.fail());
  assert.equal(document.querySelector("img"), null); assert.match(document.body.textContent, new RegExp(card.name));
});

test("image fetch failure ends the loading state and restores the semantic face", async () => {
  const bytes = deferred();
  handler = async (path) => path.includes("/image?version=") ? bytes.promise : json(catalog(metadata()));
  await mount(React.createElement(CardArt, { card, deckId: "deck", deck: deck.data }));
  assert.ok(document.querySelector('[aria-busy="true"]'));
  await act(async () => bytes.resolve(json({ message: "Image unavailable" }, 500)));
  assert.equal(document.querySelector('[aria-busy="true"]'), null);
  assert.match(document.body.textContent, new RegExp(card.name));
});

test("deck switching removes the former decoded image while the next deck loads", async () => {
  handler = async (path) => path.includes("/image?version=") ? new Response("test", { headers: { "content-type": "image/webp" } }) : json(catalog(metadata()));
  await mount(React.createElement(CardArt, { card, deckId: "deck", deck: deck.data }));
  const oldImage = document.querySelector("img");
  await act(async () => oldImage.dispatchEvent(new dom.window.Event("load")));
  const pending = deferred(); handler = () => pending.promise;
  await act(async () => root.render(React.createElement(ArtworkProvider, { deckId: "other-deck", deckRevision: 1 }, React.createElement(CardArt, { card, deckId: "other-deck", deck: deck.data }))));
  assert.equal(document.querySelector("img"), null); assert.ok(document.querySelector('[aria-busy="true"]'));
  assert.deepEqual(revoked, [images[0]]);
  await act(async () => oldImage.dispatchEvent(new dom.window.Event("load")));
  assert.equal(document.querySelector("img"), null);
  await act(async () => pending.resolve(json(catalog())));
  assert.equal(document.querySelector('[aria-busy="true"]'), null);
  assert.match(document.body.textContent, new RegExp(card.name));
});

test("a mismatched catalog provider cannot hide an unrelated card behind its loading state", async () => {
  await mount(React.createElement(CardArt, { card, deckId: "local-other-deck", deck: deck.data }));
  assert.equal(document.querySelector('[aria-busy="true"]'), null);
  assert.match(document.body.textContent, new RegExp(card.name));
});

test("raster bytes from a superseded card never display after card navigation", async () => {
  const pending = deferred(); const second = deck.cards[1];
  handler = async (path) => path.includes("/image?version=") ? pending.promise : json(catalog(metadata()));
  await mount(React.createElement(CardArt, { card, deckId: "deck", deck: deck.data }));
  await mount(React.createElement(CardArt, { card: second, deckId: "deck", deck: deck.data }));
  await act(async () => pending.resolve(new Response("test", { headers: { "content-type": "image/webp" } })));
  assert.equal(document.querySelector("img"), null); assert.match(document.body.textContent, new RegExp(second.name));
});


test("Strict Mode teardown and replay leaves one working, revocable artwork resource", async () => {
  handler = async (path) => path.includes("/image?version=") ? new Response("test", { headers: { "content-type": "image/webp" } }) : json(catalog(metadata()));
  await act(async () => root.render(React.createElement(React.StrictMode, null, view(React.createElement(CardArt, { card, deckId: "deck", deck: deck.data })))));
  await flush();
  assert.ok(document.querySelector("img"));
  await act(async () => root.render(React.createElement("p", null, "Other page")));
  assert.equal(revoked.length, images.length);
});


test("same-account focus preserves the selected file and an active upload", async () => {
  const pending = deferred(); let signal; let reads = 0;
  handler = async (path, init) => {
    if (init.method === "PUT") { signal = init.signal; return pending.promise; }
    if (path.startsWith("/api/me/")) ++reads;
    return json(catalog());
  };
  await mount(); await act(async () => inputFile());
  await act(async () => window.dispatchEvent(new dom.window.Event("focus"))); await flush();
  assert.equal(document.querySelector('button[type="submit"]').disabled, false);
  assert.match(document.body.textContent, /Ready: card.png/); assert.equal(reads, 1);
  await act(async () => submit());
  await act(async () => window.dispatchEvent(new dom.window.Event("focus"))); await flush();
  assert.equal(signal.aborted, false); assert.equal(reads, 1);
  await act(async () => pending.resolve(json(metadata(), 201)));
  assert.match(document.body.textContent, /Artwork saved/);
});

test("a different account ID invalidates a chosen file even when its email is identical", async () => {
  let reads = 0;
  handler = async () => { ++reads; return json(catalog()); };
  await mount(); await act(async () => inputFile());
  accountId = "account-two";
  await act(async () => controls.refresh()); await flush();
  assert.equal(document.querySelector('button[type="submit"]').disabled, true);
  assert.doesNotMatch(document.body.textContent, /Ready: card.png/);
  assert.ok(reads >= 3);
});


function remote(revision = 1) {
  return { id: "deck", slug: deck.data.slug, name: deck.name, visibility: "private", revision, manifest: { data: deck.data, tagline: "A test deck" } };
}
async function mountRemoteEditor() {
  domain.unregisterDeck("deck");
  await act(async () => root.render(React.createElement(Provider, null, React.createElement(Capture, null,
    React.createElement(Boundary, { deckId: "deck", routeKey: "/deck/deck/artwork" }, React.createElement(Editor, { deckId: "deck" }))))));
  await flush();
}

test("catalog focus checks preserve a same-revision owner's file but revoked access evicts private artwork", async () => {
  let allowed = true, sharedReads = 0, ownerReads = 0;
  handler = async (path) => {
    if (path === "/api/decks/deck") { ++sharedReads; return allowed ? json(remote()) : json({ message: "Not found" }, 404); }
    if (path === "/api/me/decks/deck/artwork") ++ownerReads;
    if (path.includes("/image?version=")) return new Response("test", { headers: { "content-type": "image/webp" } });
    return json(catalog(metadata()));
  };
  await mountRemoteEditor(); assert.ok(document.querySelector("img"));
  const snapshot = domain.getDeck("deck");
  await act(async () => inputFile());
  await act(async () => window.dispatchEvent(new dom.window.Event("focus"))); await flush();
  assert.equal(domain.getDeck("deck"), snapshot); assert.equal(sharedReads, 2); assert.equal(ownerReads, 1);
  assert.match(document.body.textContent, /Ready: card.png/);
  allowed = false;
  await act(async () => window.dispatchEvent(new dom.window.Event("focus"))); await flush();
  assert.equal(domain.getDeck("deck"), undefined); assert.equal(document.querySelector("img"), null);
  assert.equal(document.querySelector('input[type="file"]'), null); assert.equal(revoked.length, images.length);
  assert.match(document.body.textContent, /Deck unavailable/);
});

test("visibility checks replace changed deck revisions and discard the stale editor", async () => {
  let revision = 1, sharedReads = 0;
  handler = async (path) => {
    if (path === "/api/decks/deck") { ++sharedReads; return json(remote(revision)); }
    return json(catalog(null, revision));
  };
  await mountRemoteEditor(); const previous = domain.getDeck("deck");
  await act(async () => inputFile()); revision = 2;
  Object.defineProperty(document, "visibilityState", { configurable: true, value: "visible" });
  await act(async () => document.dispatchEvent(new dom.window.Event("visibilitychange"))); await flush();
  assert.notEqual(domain.getDeck("deck"), previous); assert.equal(catalogRuntime.source(domain.getDeck("deck")).revision, 2);
  assert.equal(sharedReads, 3); assert.doesNotMatch(document.body.textContent, /Ready: card.png/);
  assert.equal(document.querySelector('button[type="submit"]').disabled, true);
});

test("a superseded focus permission response cannot evict the newer authorized snapshot", async () => {
  const older = deferred(); let sharedReads = 0; let oldSignal;
  handler = async (path, init) => {
    if (path === "/api/decks/deck") { ++sharedReads; if (sharedReads === 2) { oldSignal = init.signal; return older.promise; } return json(remote()); }
    return json(catalog());
  };
  await mountRemoteEditor(); const snapshot = domain.getDeck("deck");
  await act(async () => inputFile());
  await act(async () => window.dispatchEvent(new dom.window.Event("focus")));
  await act(async () => window.dispatchEvent(new dom.window.Event("focus"))); await flush();
  assert.equal(oldSignal.aborted, true);
  await act(async () => older.resolve(json({ message: "Revoked in an old response" }, 404)));
  assert.equal(domain.getDeck("deck"), snapshot); assert.match(document.body.textContent, /Ready: card.png/);
});

test("navigation aborts focus checks and late permission failures cannot evict a newer local import", async () => {
  const pending = deferred(); let checks = 0, signal;
  handler = async (path, init) => {
    if (path === "/api/decks/deck") { if (++checks === 2) { signal = init.signal; return pending.promise; } return json(remote()); }
    return json(catalog());
  };
  await mountRemoteEditor();
  await act(async () => window.dispatchEvent(new dom.window.Event("focus")));
  await act(async () => root.render(React.createElement("p", null, "Other page")));
  const local = domain.registerDeck({ data: deck.data, runtimeId: "deck", custom: true }, { replaceExisting: true });
  assert.equal(signal.aborted, true);
  await act(async () => pending.resolve(json({ message: "Not found" }, 404)));
  assert.equal(domain.getDeck("deck"), local); assert.equal(document.body.textContent, "Other page");
});


for (const recovery of ["focus", "retry button"]) {
  test(`failed focus revalidation recovers through ${recovery} without exposing the revoked snapshot`, async () => {
    let healthy = true; let pendingRecovery = null; let sharedReads = 0;
    handler = async (path) => {
      if (path === "/api/decks/deck") {
        ++sharedReads;
        if (pendingRecovery) return pendingRecovery.promise;
        return healthy ? json(remote()) : json({ message: "Temporary catalog outage" }, 503);
      }
      if (path.includes("/image?version=")) return new Response("test", { headers: { "content-type": "image/webp" } });
      return json(catalog(metadata()));
    };
    await mountRemoteEditor(); const previous = domain.getDeck("deck");
    assert.ok(document.querySelector("img"));
    healthy = false;
    await act(async () => window.dispatchEvent(new dom.window.Event("focus"))); await flush();
    assert.equal(domain.getDeck("deck"), undefined); assert.equal(document.querySelector("img"), null);
    assert.match(document.body.textContent, /Temporary catalog outage/); assert.equal(revoked.length, images.length);
    healthy = true; pendingRecovery = deferred();
    await act(async () => {
      if (recovery === "focus") window.dispatchEvent(new dom.window.Event("focus"));
      else Array.from(document.querySelectorAll("button")).find((button) => button.textContent === "Try again").click();
    });
    assert.equal(domain.getDeck("deck"), undefined); assert.equal(document.querySelector("img"), null);
    assert.equal(document.querySelector('input[type="file"]'), null); assert.match(document.body.textContent, /Opening deck/);
    await act(async () => pendingRecovery.resolve(json(remote()))); await flush();
    assert.equal(sharedReads, 3); assert.notEqual(domain.getDeck("deck"), previous);
    assert.ok(document.querySelector('input[type="file"]')); assert.ok(document.querySelector("img"));
    assert.doesNotMatch(document.body.textContent, /Temporary catalog outage/);
  });
}

const packInfo = (id, overrides = {}) => ({ id, label: id === "saved-artwork" ? "Saved artwork" : id === "watercolor" ? "Watercolor" : "Ink", cardCount: 0, complete: false, ...overrides });
function setCatalog(packId, art = null, packs = [packInfo("saved-artwork"), packInfo("watercolor"), packInfo("ink")]) {
  return { ...catalog(art), packId, packs };
}
function requestedPack(path) { return new URL(path, "http://localhost").searchParams.get("packId") || "saved-artwork"; }
function changeSelect(id, value) {
  const input = document.getElementById(id); assert.ok(input); input.value = value;
  input.dispatchEvent(new dom.window.Event("change", { bubbles: true }));
}
function enterText(id, value) {
  const input = document.getElementById(id); assert.ok(input);
  Object.getOwnPropertyDescriptor(dom.window.HTMLInputElement.prototype, "value").set.call(input, value);
  input.dispatchEvent(new dom.window.Event("input", { bubbles: true }));
}
function clickButton(text) {
  const button = Array.from(document.querySelectorAll("button")).find((item) => item.textContent === text);
  assert.ok(button, `Expected button: ${text}`); button.click();
}

for (const outcome of ["missing", "failed"]) test(`a selected saved set never falls back to runtime imagery when ${outcome}`, async () => {
  visuals.registerPack("deck", { id: "runtime", label: "Runtime" });
  visuals.registerImagePack("deck", "runtime", { [card.slug]: "https://example.test/unrelated.png" });
  window.localStorage.setItem("arcana:artwork-set:deck", "watercolor");
  handler = async (path) => {
    assert.equal(requestedPack(path), "watercolor");
    return outcome === "missing" ? json(setCatalog("watercolor")) : json({ message: "offline" }, 500);
  };
  await mount(React.createElement(CardArt, { card, deckId: "deck", deck: deck.data, prefer: "runtime" }));
  assert.equal(document.querySelector("img"), null); assert.match(document.body.textContent, new RegExp(card.name));
  assert.doesNotMatch(document.body.innerHTML, /unrelated\.png/);
});

test("editor creates a set once, selects it, and uploads only into the new set", async () => {
  const pending = deferred(); const calls = []; let created = false, uploaded = false;
  handler = async (path, init) => {
    const packId = requestedPack(path); calls.push([path, init]);
    if (init.method === "POST") return pending.promise;
    if (init.method === "PUT") { uploaded = true; return json(metadata({ packId })); }
    if (path.includes("/image?")) return new Response("test", { headers: { "content-type": "image/webp" } });
    const packs = [packInfo("saved-artwork", { cardCount: 1, complete: true }), ...(created ? [packInfo("watercolor")] : [])];
    const art = packId === "saved-artwork" || uploaded ? metadata({ packId }) : null;
    return json(setCatalog(packId, art, packs));
  };
  await mount();
  await act(async () => clickButton("New artwork set"));
  await act(async () => enterText("artwork-set-name", "Watercolor"));
  assert.equal(document.getElementById("artwork-set-id").value, "watercolor");
  await act(async () => enterText("artwork-set-description", "Soft washes"));
  await act(async () => {
    const form = document.querySelector(".artwork-create-set");
    form.dispatchEvent(new dom.window.Event("submit", { bubbles: true, cancelable: true }));
    form.dispatchEvent(new dom.window.Event("submit", { bubbles: true, cancelable: true }));
  });
  const posts = calls.filter(([, init]) => init.method === "POST"); assert.equal(posts.length, 1);
  assert.deepEqual(JSON.parse(posts[0][1].body), { id: "watercolor", label: "Watercolor", description: "Soft washes", expectedDeckRevision: 1 });
  created = true;
  await act(async () => pending.resolve(json(packInfo("watercolor", { description: "Soft washes" }), 201))); await flush();
  assert.equal(document.getElementById("artwork-set").value, "watercolor");
  assert.equal(window.localStorage.getItem("arcana:artwork-set:deck"), "watercolor");
  assert.equal(document.querySelector(".artwork-create-set"), null); assert.equal(document.querySelector("img"), null);
  await act(async () => inputFile()); await act(async () => submit()); await flush();
  const put = calls.find(([, init]) => init.method === "PUT");
  assert.equal(put[0], `/api/me/decks/deck/cards/${card.slug}/artwork?packId=watercolor`);
  assert.equal(put[1].headers["x-arcana-artwork-version"], "none");
  assert.match(document.body.textContent, /saved in Watercolor/); assert.ok(document.querySelector("img"));
  assert.match(document.querySelector("#artwork-set option:checked").textContent, /Watercolor · 1 illustrated · complete/);
});

test("switching sets cancels an upload and never applies its late response to the new set", async () => {
  const pending = deferred(); let signal;
  handler = async (path, init) => {
    if (init.method === "PUT") { signal = init.signal; return pending.promise; }
    return json(setCatalog(requestedPack(path)));
  };
  await mount(); await act(async () => inputFile()); await act(async () => submit());
  await act(async () => changeSelect("artwork-set", "watercolor")); await flush();
  assert.equal(signal.aborted, true); assert.equal(document.querySelector("#artwork-upload-form button[type=submit]").disabled, true);
  assert.doesNotMatch(document.body.textContent, /Ready: card.png/);
  await act(async () => pending.resolve(json(metadata({ packId: "saved-artwork" }), 201)));
  assert.equal(document.getElementById("artwork-set").value, "watercolor"); assert.equal(document.querySelector("img"), null);
  assert.doesNotMatch(document.body.textContent, /Artwork saved/);
});

test("a late set creation after selection changes cannot switch the editor back", async () => {
  const pending = deferred(); let signal;
  handler = async (path, init) => {
    if (init.method === "POST") { signal = init.signal; return pending.promise; }
    return json(setCatalog(requestedPack(path)));
  };
  await mount(); await act(async () => clickButton("New artwork set"));
  await act(async () => enterText("artwork-set-name", "Pastel"));
  await act(async () => document.querySelector(".artwork-create-set").dispatchEvent(new dom.window.Event("submit", { bubbles: true, cancelable: true })));
  await act(async () => changeSelect("artwork-set", "ink")); await flush();
  assert.equal(signal.aborted, true);
  await act(async () => pending.resolve(json(packInfo("pastel", { label: "Pastel" }), 201)));
  assert.equal(document.getElementById("artwork-set").value, "ink"); assert.equal(document.querySelector(".artwork-create-set"), null);
});

test("idempotent create of the current set refreshes without leaving the editor busy", async () => {
  window.localStorage.setItem("arcana:artwork-set:deck", "watercolor");
  handler = async (path, init) => init.method === "POST" ? json(packInfo("watercolor")) : json(setCatalog(requestedPack(path)));
  await mount(); await act(async () => clickButton("New artwork set"));
  await act(async () => enterText("artwork-set-name", "Watercolor"));
  await act(async () => document.querySelector(".artwork-create-set").dispatchEvent(new dom.window.Event("submit", { bubbles: true, cancelable: true })));
  await flush();
  assert.equal(document.getElementById("artwork-set").value, "watercolor"); assert.equal(document.querySelector(".artwork-create-set"), null);
  assert.equal(document.getElementById("artwork-file").disabled, false);
});

test("rapid set switching removes decoded images and ignores old metadata, bytes, and decode events", async () => {
  let selection; const watercolor = deferred(), ink = deferred();
  function CaptureSelection() { selection = useArtworkSelection(); return React.createElement(CardArt, { card, deckId: "deck", deck: deck.data }); }
  handler = async (path) => {
    const packId = requestedPack(path);
    if (path.includes("/image?")) return packId === "ink" ? ink.promise : new Response("test", { headers: { "content-type": "image/webp" } });
    return packId === "watercolor" ? watercolor.promise : json(setCatalog(packId, metadata({ packId })));
  };
  await mount(React.createElement(CaptureSelection));
  const oldImage = document.querySelector("img"); await act(async () => oldImage.dispatchEvent(new dom.window.Event("load")));
  await act(async () => selection.selectPack("watercolor"));
  assert.equal(document.querySelector("img"), null); assert.ok(revoked.includes(oldImage.getAttribute("src")));
  await act(async () => selection.selectPack("ink"));
  await act(async () => watercolor.resolve(json(setCatalog("watercolor", metadata({ packId: "watercolor" })))));
  assert.equal(document.querySelector("img"), null);
  await act(async () => ink.resolve(new Response("test", { headers: { "content-type": "image/webp" } })));
  const latest = document.querySelector("img"); assert.ok(latest); assert.notEqual(latest, oldImage); assert.equal(latest.style.opacity, "0");
  await act(async () => { oldImage.dispatchEvent(new dom.window.Event("error")); oldImage.dispatchEvent(new dom.window.Event("load")); });
  assert.equal(document.querySelector("img"), latest); assert.equal(latest.style.opacity, "0");
  await act(async () => latest.dispatchEvent(new dom.window.Event("load"))); assert.equal(latest.style.opacity, "1");
});

test("browser and reading restore the per-deck selection, filter only the selected set, and preserve semantic identity", async () => {
  const before = JSON.stringify(deck.data); let catalogReads = 0;
  handler = async (path) => {
    if (path.includes("/image?")) return new Response("test", { headers: { "content-type": "image/webp" } });
    ++catalogReads;
    const packId = requestedPack(path), art = packId === "saved-artwork" ? metadata({ packId }) : null;
    return json({ ...setCatalog(packId), cards: deck.cards.map((item) => ({ slug: item.slug, name: item.name, artwork: item.slug === card.slug ? art : null })) });
  };
  await mount(React.createElement(CardBrowser, { deckId: "deck" }));
  assert.equal(document.getElementById("browser-artwork-set").value, "saved-artwork"); assert.equal(catalogReads, 1);
  await act(async () => changeSelect("browser-artwork-set", "watercolor"));
  await act(async () => clickButton("Illustrated"));
  assert.match(document.body.textContent, /No cards match/); assert.equal(document.querySelector("img"), null);
  await act(async () => root.render(React.createElement("p", null, "Another page")));
  await mount(React.createElement(Reading, { deckId: "deck" }));
  assert.equal(document.getElementById("reading-artwork-set").value, "watercolor");
  assert.equal(JSON.stringify(deck.data), before);
});

test("reading cards use the saved set without substituting a runtime spread or changing the dealt reading", async () => {
  visuals.registerPack("deck", { id: "runtime", label: "Runtime" });
  visuals.registerImagePack("deck", "runtime", { [card.slug]: "https://example.test/unrelated-reading.png" });
  visuals.registerSpreadKitPack("deck", "runtime", [{ spreadId: "single", draw: () => {} }]);
  window.localStorage.setItem("arcana:artwork-set:deck", "watercolor");
  const imagePacks = [];
  handler = async (path) => {
    const packId = requestedPack(path);
    if (path.includes("/image?")) { imagePacks.push(packId); return new Response("test", { headers: { "content-type": "image/webp" } }); }
    return json(setCatalog(packId, packId === "watercolor" ? metadata({ packId }) : null));
  };
  const { encodeReading } = await vite.ssrLoadModule("/src/reading/encode.ts");
  const token = await encodeReading(domain.getDeck("deck"), "single", "What matters?", [{ slug: card.slug, reversed: false }]);
  await mount(React.createElement(Reading, { deckId: "deck", token })); await flush();
  assert.ok(document.querySelector("img"), document.body.textContent); assert.deepEqual(imagePacks, ["watercolor"]);
  assert.doesNotMatch(document.body.textContent, /Living Spread/);
  const prompt = document.querySelector("pre").textContent;
  await act(async () => changeSelect("reading-artwork-set", "saved-artwork")); await flush();
  assert.equal(document.querySelector("img"), null); assert.doesNotMatch(document.body.innerHTML, /unrelated-reading\.png/);
  assert.equal(document.querySelector("pre").textContent, prompt);
});

function populatedHandler(populated, calls = []) {
  const packs = [packInfo("saved-artwork"), packInfo("watercolor"), packInfo("ink")].map(pack => ({ ...pack, cardCount: populated.includes(pack.id) ? 1 : 0 }));
  return async (path, init) => {
    calls.push([path, init]);
    const packId = requestedPack(path);
    if (path.includes("/image?")) return new Response("test", { headers: { "content-type": "image/webp" } });
    if (!packs.some(pack => pack.id === packId)) return json({ message: "missing set" }, 404);
    return json(setCatalog(packId, populated.includes(packId) ? metadata({ packId }) : null, packs));
  };
}

for (const surface of ["browser", "reading", "editor"]) test(`${surface} automatically chooses the only populated set without storing an invented preference`, async () => {
  const calls = []; handler = populatedHandler(["watercolor"], calls);
  const component = surface === "browser" ? CardBrowser : surface === "reading" ? Reading : Editor;
  await mount(React.createElement(component, { deckId: "deck" })); await flush();
  const select = document.getElementById(surface === "editor" ? "artwork-set" : `${surface}-artwork-set`);
  assert.equal(select.value, "watercolor");
  assert.equal(window.localStorage.getItem("arcana:artwork-set:deck"), null);
  if (surface !== "editor") assert.equal(select.options.length, 1);
  else {
    assert.equal(select.options.length, 3, "empty destinations remain available for uploads");
    await act(async () => changeSelect("artwork-set", "ink")); await flush();
    assert.equal(document.getElementById("artwork-set").value, "ink");
    assert.ok(document.getElementById("artwork-file"));
  }
  assert.ok(calls.every(([path, init]) => !init.method || init.method === "GET"), "selection makes no server writes");
});

for (const surface of ["browser", "reading", "editor"]) test(`${surface} asks for an explicit choice when multiple populated sets exist`, async () => {
  handler = populatedHandler(["watercolor", "ink"]);
  const component = surface === "browser" ? CardBrowser : surface === "reading" ? Reading : Editor;
  await mount(React.createElement(component, { deckId: "deck" })); await flush();
  const id = surface === "editor" ? "artwork-set" : `${surface}-artwork-set`;
  assert.equal(document.getElementById(id).value, ""); assert.equal(document.querySelector("img"), null);
  assert.match(document.body.textContent, /Choose.*artwork/);
  if (surface === "editor") assert.equal(document.getElementById("artwork-file"), null, "no implicit default upload target");
  await act(async () => changeSelect(id, "ink")); await flush();
  assert.equal(document.getElementById(id).value, "ink");
  assert.equal(window.localStorage.getItem("arcana:artwork-set:deck"), "ink");
});

for (const [preferred, expected] of [["saved-artwork", "watercolor"], ["removed", "watercolor"], ["watercolor", "watercolor"]]) test(`saved selection ${preferred} resolves to ${expected} using actual coverage`, async () => {
  window.localStorage.setItem("arcana:artwork-set:deck", preferred);
  handler = populatedHandler(["watercolor"]);
  await mount(React.createElement(CardBrowser, { deckId: "deck" })); await flush();
  assert.equal(document.getElementById("browser-artwork-set").value, expected); assert.ok(document.querySelector("img"));
});

test("a populated remembered selection is preserved across reloads with multiple options", async () => {
  window.localStorage.setItem("arcana:artwork-set:deck", "ink");
  handler = populatedHandler(["watercolor", "ink"]);
  await mount(React.createElement(CardBrowser, { deckId: "deck" }));
  assert.equal(document.getElementById("browser-artwork-set").value, "ink");
  await act(async () => root.render(React.createElement("p", null, "Other route")));
  await mount(React.createElement(Reading, { deckId: "deck" }));
  assert.equal(document.getElementById("reading-artwork-set").value, "ink");
});

test("standalone editor resolves a stale remembered set and keeps empty destinations editable", async () => {
  window.localStorage.setItem("arcana:artwork-set:deck", "removed");
  handler = populatedHandler(["watercolor"]);
  await act(async () => root.render(React.createElement(Provider, null, React.createElement(Editor, { deckId: "deck" }))));
  await flush(); await flush();
  assert.equal(document.getElementById("artwork-set").value, "watercolor");
  await act(async () => changeSelect("artwork-set", "ink")); await flush();
  assert.equal(document.getElementById("artwork-set").value, "ink"); assert.ok(document.getElementById("artwork-file"));
});

test("standalone editor preview stays within its explicit empty upload destination", async () => {
  handler = populatedHandler(["watercolor"]);
  await act(async () => root.render(React.createElement(Provider, null, React.createElement(Editor, { deckId: "deck" }))));
  await flush(); await flush();
  assert.ok(document.querySelector("img"));
  await act(async () => changeSelect("artwork-set", "ink")); await flush();
  assert.equal(document.getElementById("artwork-set").value, "ink");
  assert.equal(document.querySelector("img"), null);
});

for (const conflict of [false, true]) test(`delayed artwork refresh preserves the ${conflict ? "conflict recovery instruction" : "upload success"}`, async () => {
  const pending = deferred(); let refreshing = false, reads = 0;
  handler = async (path, init) => {
    if (init.method === "PUT") { refreshing = true; return conflict ? json({ message: "Changed" }, 409) : json(metadata()); }
    if (path.includes("/image?")) return new Response("test", { headers: { "content-type": "image/webp" } });
    if (path.startsWith("/api/me/")) { reads++; return json(catalog(refreshing ? metadata() : null)); }
    return refreshing ? pending.promise : json(catalog());
  };
  await mount(); await act(async () => inputFile()); await act(async () => submit()); await flush();
  const expected = conflict ? /Review the card, choose your image again/ : /Artwork saved/;
  assert.match(document.body.textContent, expected);
  assert.ok(document.getElementById("artwork-file"));
  const ownerReads = reads;
  await act(async () => pending.resolve(json(catalog(metadata())))); await flush();
  assert.match(document.body.textContent, expected);
  assert.equal(reads, ownerReads, "background preview refresh does not reload the owner editor");
});
