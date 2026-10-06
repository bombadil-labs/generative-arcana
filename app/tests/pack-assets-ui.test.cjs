const test = require("node:test");
const assert = require("node:assert/strict");
const { resolve } = require("node:path");
const React = require("react");
const { JSDOM } = require("jsdom");
const { act } = React;
const dom = new JSDOM('<div id="root"></div>', { url: "http://localhost/" });
const saved = { fetch: global.fetch, window: global.window, document: global.document, create: URL.createObjectURL, revoke: URL.revokeObjectURL, navigator: Object.getOwnPropertyDescriptor(global, "navigator") };
global.window = dom.window; global.document = dom.window.document; global.IS_REACT_ACT_ENVIRONMENT = true;
Object.defineProperty(global, "navigator", { configurable: true, value: dom.window.navigator });
const { createRoot } = require("react-dom/client");
let vite, root, Editor, Cover, Provider, useSession, ArtworkProvider, useSelection, Image, controls, selection, handler, images, revoked, anonymous, accountId;
const asset = (extra = {}) => ({ id: "cover-1", deckId: "deck", packId: "watercolor", slot: "cover", mediaType: "image/webp", width: 1600, height: 400, byteLength: 4, integrity: "sha256-test", deckRevision: 1, ...extra });
const packs = [
  { id: "saved-artwork", label: "Saved artwork", cardCount: 0, complete: false, hasCover: false, hasCardBack: false },
  { id: "watercolor", label: "Watercolor", cardCount: 0, complete: false, hasCover: true, hasCardBack: false },
  { id: "ink", label: "Ink", cardCount: 0, complete: false, hasCover: false, hasCardBack: false },
];
const catalog = (packId = "watercolor", extra = {}) => ({ enabled: true, deckRevision: 1, packId, packs, cards: [], cover: packId === "watercolor" ? asset() : null, cardBack: null, ...extra });
const json = (body, status = 200) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
const bytes = () => new Response("test", { headers: { "content-type": "image/webp" } });
function deferred() { let resolve; const promise = new Promise((yes) => { resolve = yes; }); return { promise, resolve }; }
async function flush() { await act(async () => { await new Promise((done) => setTimeout(done, 0)); }); }
function Capture({ children }) { controls = useSession(); return children; }
function CaptureSelection({ children }) { selection = useSelection(); return children; }
function EditorHarness({ packId = "watercolor" }) {
  const { session } = useSession();
  const [data, setData] = React.useState(catalog(packId));
  const current = data.packId === packId ? data : catalog(packId);
  if (session.status !== "authenticated") return React.createElement("p", null, "Signed out");
  return React.createElement(Editor, { deckId: "deck", packId, session, catalog: current, onSaved: (item) => setData((previous) => ({ ...previous, [item.slot]: item })), onRefresh: setData });
}
async function mount(content) { await act(async () => root.render(React.createElement(Provider, null, React.createElement(Capture, null, content)))); await flush(); }
function choose(slot = "cover", type = "image/png") {
  const input = document.getElementById(`artwork-${slot}-file`);
  Object.defineProperty(input, "files", { configurable: true, value: [new File(["data"], `${slot}.png`, { type })] });
  input.dispatchEvent(new dom.window.Event("change", { bubbles: true }));
}
function submit(slot = "cover") { document.getElementById(`artwork-${slot}-form`).dispatchEvent(new dom.window.Event("submit", { bubbles: true, cancelable: true })); }
function coverView() { return React.createElement(Cover, { deckId: "deck", deckRevision: 1, name: "Test deck", fallback: React.createElement("span", null, "✦") }); }

test.before(async () => {
  const { createServer } = await import("vite");
  vite = await createServer({ root: resolve(__dirname, ".."), server: { middlewareMode: true }, appType: "custom", optimizeDeps: { noDiscovery: true, include: [] } });
  ({ PackAssetEditor: Editor } = await vite.ssrLoadModule("/src/app/PackAssetEditor.tsx"));
  ({ DeckCover: Cover } = await vite.ssrLoadModule("/src/components/DeckCover.tsx"));
  ({ PackAssetImage: Image } = await vite.ssrLoadModule("/src/artwork/PackAssetImage.tsx"));
  ({ BrowserSessionProvider: Provider, useBrowserSession: useSession } = await vite.ssrLoadModule("/src/auth/session.tsx"));
  ({ CatalogArtworkProvider: ArtworkProvider, useArtworkSelection: useSelection } = await vite.ssrLoadModule("/src/artwork/context.tsx"));
});
test.beforeEach(() => {
  window.localStorage.clear(); images = []; revoked = []; anonymous = false; accountId = "one";
  URL.createObjectURL = () => { const url = `blob:asset-${images.length}`; images.push(url); return url; };
  URL.revokeObjectURL = (url) => revoked.push(url);
  handler = async (path) => path.includes("/image?") ? bytes() : json(catalog(new URL(path, "http://local").searchParams.get("packId") || "saved-artwork"));
  global.fetch = async (path, init) => {
    if (path === "/auth/session") return json(anonymous ? { authenticated: false } : { authenticated: true, accountId, user: { email: "owner@example.test" } });
    if (path === "/api/auth/sign-out") { anonymous = true; return json({ success: true }); }
    return handler(path, init);
  };
  root = createRoot(document.getElementById("root"));
});
test.afterEach(async () => { await act(async () => root.unmount()); document.getElementById("root").replaceChildren(); });
test.after(async () => {
  await vite?.close(); dom.window.close(); Object.assign(global, { fetch: saved.fetch, window: saved.window, document: saved.document });
  URL.createObjectURL = saved.create; URL.revokeObjectURL = saved.revoke; delete global.IS_REACT_ACT_ENVIRONMENT;
  if (saved.navigator) Object.defineProperty(global, "navigator", saved.navigator); else delete global.navigator;
});

test("cover-only sets are selected for tiles, use contained safe images, and release them on unmount", async () => {
  const paths = []; const originalHandler = handler; handler = (path, init) => { paths.push(path); return originalHandler(path, init); };
  await mount(coverView()); await flush();
  const img = document.querySelector("img"); assert.ok(img); assert.equal(img.style.objectFit, "contain"); assert.equal(img.style.opacity, "0");
  assert.equal(img.alt, "Test deck cover"); assert.match(document.body.textContent, /✦/);
  await act(async () => img.dispatchEvent(new dom.window.Event("load")));
  assert.equal(img.style.opacity, "1"); assert.doesNotMatch(document.body.textContent, /✦/);
  assert.ok(paths.includes("/api/decks/deck/artwork?packId=watercolor"));
  assert.ok(paths.includes("/api/decks/deck/artwork/assets/cover/image?version=cover-1&packId=watercolor"));
  await act(async () => root.render(React.createElement("p", null, "Away")));
  assert.deepEqual(revoked, images);
});

test("ambiguous sets and missing selected covers keep the glyph without borrowing images", async () => {
  let imageCalls = 0;
  handler = async (path) => {
    if (path.includes("/image?")) { imageCalls++; return bytes(); }
    const packId = new URL(path, "http://local").searchParams.get("packId") || "saved-artwork";
    return json(catalog(packId, { packs: [packs[0], packs[1], { ...packs[2], hasCardBack: true }] }));
  };
  await mount(coverView()); assert.equal(document.querySelector("img"), null); assert.match(document.body.textContent, /✦/);
  window.localStorage.setItem("arcana:artwork-set:deck", "ink");
  await mount(coverView()); assert.equal(document.querySelector("img"), null); assert.equal(imageCalls, 0);
});

test("rapid pack switches discard late cover bytes and release prior URLs immediately", async () => {
  await mount(React.createElement(ArtworkProvider, { deckId: "deck", deckRevision: 1 }, React.createElement(CaptureSelection, null, coverView())));
  const old = document.querySelector("img"); assert.ok(old);
  const late = deferred(); const prior = handler;
  handler = (path, init) => path.includes("/image?") && path.includes("packId=ink") ? late.promise : path.includes("/artwork?") && path.includes("packId=ink") ? Promise.resolve(json(catalog("ink", { cover: asset({ packId: "ink", id: "ink-cover" }) }))) : prior(path, init);
  await act(async () => selection.selectPack("ink")); await flush();
  assert.equal(document.querySelector("img"), null); assert.ok(revoked.includes(old.getAttribute("src")));
  await act(async () => selection.selectPack("saved-artwork")); await flush();
  await act(async () => late.resolve(bytes()));
  assert.equal(document.querySelector("img"), null); assert.equal(images.length, 1);
});

test("decode failure revokes its blob once and restores fallback", async () => {
  await mount(coverView()); const img = document.querySelector("img");
  await act(async () => img.dispatchEvent(new dom.window.Event("error")));
  assert.equal(document.querySelector("img"), null); assert.match(document.body.textContent, /✦/); assert.deepEqual(revoked, [images[0]]);
  await act(async () => root.render(React.createElement("p", null, "Away"))); assert.equal(revoked.length, 1);
});

test("asset editor validates, blocks duplicate submits, retries failures, and stores backs without reading behavior", async () => {
  let uploads = 0; const late = deferred(); const originalHandler = handler;
  handler = async (path, init) => {
    if (init.method === "PUT") { uploads++; assert.match(path, /assets\/cardBack\?packId=watercolor/); return uploads === 1 ? json({ message: "Temporary failure" }, 500) : late.promise; }
    return originalHandler(path, init);
  };
  await mount(React.createElement(EditorHarness));
  assert.match(document.body.textContent, /180° rotational symmetry/); assert.match(document.body.textContent, /not shown during readings yet/);
  await act(async () => choose("cardBack", "image/svg+xml")); assert.match(document.body.textContent, /Choose a PNG/);
  await act(async () => choose("cardBack")); await act(async () => submit("cardBack")); assert.equal(uploads, 1); assert.match(document.body.textContent, /Temporary failure/);
  await act(async () => { submit("cardBack"); submit("cardBack"); }); assert.equal(uploads, 2);
  await act(async () => late.resolve(json(asset({ slot: "cardBack", id: "back-1" }), 201))); await flush();
  assert.match(document.body.textContent, /Card back saved/); assert.equal(document.querySelector('#artwork-cardBack-form button[type="submit"]').disabled, true);
  assert.equal(document.querySelectorAll("img").length, 2);
});

test("conflicts reload asset versions and require a new image selection before replacement", async () => {
  let uploads = 0; const versions = []; const originalHandler = handler;
  handler = async (path, init) => {
    if (init.method === "PUT") { uploads++; versions.push(init.headers["x-arcana-artwork-version"]); return uploads === 1 ? json({ message: "Changed" }, 409) : json(asset({ id: "cover-3" }), 201); }
    if (path.startsWith("/api/me/")) return json(catalog("watercolor", { cover: asset({ id: "cover-2" }) }));
    return originalHandler(path, init);
  };
  await mount(React.createElement(EditorHarness)); await act(async () => choose()); await act(async () => submit()); await flush();
  assert.equal(uploads, 1); assert.match(document.body.textContent, /choose your image again/);
  assert.equal(document.querySelector('#artwork-cover-form button[type="submit"]').disabled, true);
  await act(async () => choose()); await act(async () => submit());
  assert.deepEqual(versions, ["cover-1", "cover-2"]);
});

for (const interruption of ["logout", "account", "pack", "navigation"]) test(`${interruption} during an upload aborts and ignores late success`, async () => {
  const pending = deferred(); let signal; const originalHandler = handler;
  handler = (path, init) => { if (init.method === "PUT") { signal = init.signal; return pending.promise; } return originalHandler(path, init); };
  await mount(React.createElement(EditorHarness)); await act(async () => choose()); await act(async () => submit());
  if (interruption === "logout") await act(async () => controls.signOut());
  if (interruption === "account") { accountId = "two"; await act(async () => controls.refresh()); }
  if (interruption === "pack") await mount(React.createElement(EditorHarness, { packId: "ink" }));
  if (interruption === "navigation") await act(async () => root.render(React.createElement("p", null, "Another page")));
  assert.equal(signal.aborted, true);
  await act(async () => pending.resolve(json(asset({ id: "late-success" }), 201)));
  assert.doesNotMatch(document.body.textContent, /Cover saved/); assert.doesNotMatch(document.body.textContent, /Ready: cover\.png/);
});

test("clearing file selection and same-account focus refresh preserve intended editor state", async () => {
  await mount(React.createElement(EditorHarness)); await act(async () => choose());
  await act(async () => controls.refresh()); assert.match(document.body.textContent, /Ready: cover.png/);
  const clear = [...document.querySelectorAll("button")].find((button) => button.textContent === "Clear selection");
  await act(async () => clear.click()); assert.doesNotMatch(document.body.textContent, /Ready: cover.png/);
  assert.equal(document.querySelector('#artwork-cover-form button[type="submit"]').disabled, true);
});

test("failed conflict refresh blocks uploads until latest metadata can be loaded, without automatic writes", async () => {
  let uploads = 0, reads = 0; const originalHandler = handler;
  handler = async (path, init) => {
    if (init.method === "PUT") { uploads++; return json({ message: "Changed" }, 409); }
    if (path.startsWith("/api/me/")) return ++reads === 1 ? json({ message: "Offline" }, 500) : json(catalog("watercolor", { cover: asset({ id: "cover-2" }) }));
    return originalHandler(path, init);
  };
  await mount(React.createElement(EditorHarness)); await act(async () => choose()); await act(async () => submit()); await flush();
  assert.equal(document.getElementById("artwork-cover-file").disabled, true);
  assert.match(document.body.textContent, /Reload the latest assets/); assert.equal(uploads, 1);
  const reload = [...document.querySelectorAll("button")].find((button) => button.textContent === "Reload latest assets");
  await act(async () => reload.click()); await flush();
  assert.equal(uploads, 1); assert.equal(reads, 2); assert.equal(document.getElementById("artwork-cover-file").disabled, false);
  assert.equal(document.querySelector('#artwork-cover-form button[type="submit"]').disabled, true);
  assert.match(document.body.textContent, /latest version is loaded/);
});
