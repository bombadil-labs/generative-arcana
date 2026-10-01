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
let vite, root, Editor, Provider, useSession, ArtworkProvider, CardArt, Boundary, catalogRuntime, domain, controls, card, deck;
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
function submit() { document.querySelector("form").dispatchEvent(new dom.window.Event("submit", { bubbles: true, cancelable: true })); }

test.before(async () => {
  const { createServer } = await import("vite");
  vite = await createServer({ root: resolve(__dirname, ".."), server: { middlewareMode: true }, appType: "custom" });
  ({ ArtworkEditor: Editor } = await vite.ssrLoadModule("/src/app/ArtworkEditor.tsx"));
  ({ BrowserSessionProvider: Provider, useBrowserSession: useSession } = await vite.ssrLoadModule("/src/auth/session.tsx"));
  ({ CatalogArtworkProvider: ArtworkProvider } = await vite.ssrLoadModule("/src/artwork/context.tsx"));
  ({ CardArt } = await vite.ssrLoadModule("/src/components/CardArt.tsx"));
  ({ RemoteDeckBoundary: Boundary } = await vite.ssrLoadModule("/src/app/RemoteDeckBoundary.tsx"));
  ({ catalogDeckRuntime: catalogRuntime } = await vite.ssrLoadModule("/src/catalog/runtime.ts"));
  domain = await vite.ssrLoadModule("/src/decks/registry.ts");
  deck = domain.registerDeck({ data: rawDeck(), runtimeId: "deck", custom: true }); card = deck.cards[0];
});
test.beforeEach(() => {
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
  catalogRuntime.clear();
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
