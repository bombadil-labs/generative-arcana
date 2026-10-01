const test = require("node:test");
const assert = require("node:assert/strict");
const { resolve } = require("node:path");
const React = require("react");
const { JSDOM } = require("jsdom");
// Exact neutral single-card artifact used in preview acceptance, not a richer historical deck.
const fixture = require("./fixtures/minimal-artwork-manifest.json");
const { act } = React;
const dom = new JSDOM('<div id="root"></div>', { url: "http://localhost/" });
const saved = Object.fromEntries(["window", "document", "navigator", "fetch", "IS_REACT_ACT_ENVIRONMENT"].map((name) => [name, Object.getOwnPropertyDescriptor(global, name)]));
for (const [name, value] of Object.entries({ window: dom.window, document: dom.window.document, navigator: dom.window.navigator, IS_REACT_ACT_ENVIRONMENT: true })) Object.defineProperty(global, name, { configurable: true, writable: true, value });
window.matchMedia = () => ({ matches: false, addEventListener() {}, removeEventListener() {} });
const { createRoot } = require("react-dom/client");
let vite, root, App, Provider, domain, runtime, inspect, manifest, errors;
const deckId = "minimal-rendering-fixture";
const json = (body) => new Response(JSON.stringify(body), { headers: { "content-type": "application/json" } });
const copy = (value) => JSON.parse(JSON.stringify(value));
class CatchRenderError extends React.Component {
  state = { error: false };
  static getDerivedStateFromError() { return { error: true }; }
  componentDidCatch(error) { errors.push(error); }
  render() { return this.state.error ? React.createElement("p", null, "Render failed") : this.props.children; }
}
async function flush() { await act(async () => { await new Promise((done) => setTimeout(done, 0)); }); }
async function mount(path = `/deck/${deckId}`) {
  window.history.replaceState(null, "", `/#${path}`);
  await act(async () => root.render(React.createElement(CatchRenderError, null, React.createElement(Provider, null, React.createElement(App)))));
  await flush(); await flush();
  assert.deepEqual(errors.map((error) => error.message), [], "valid manifests must render without a React exception");
}
async function click(selector) {
  const element = document.querySelector(selector); assert.ok(element, selector);
  await act(async () => element.click()); await flush();
  assert.deepEqual(errors.map((error) => error.message), []);
}
async function go(path) {
  await act(async () => { window.location.hash = path; window.dispatchEvent(new dom.window.HashChangeEvent("hashchange")); });
  await flush(); await flush();
  assert.deepEqual(errors.map((error) => error.message), []);
}
test.before(async () => {
  const { createServer } = await import("vite");
  vite = await createServer({ root: resolve(__dirname, ".."), server: { middlewareMode: true }, appType: "custom", optimizeDeps: { noDiscovery: true, include: [] } });
  ({ App } = await vite.ssrLoadModule("/src/app/App.tsx"));
  ({ BrowserSessionProvider: Provider } = await vite.ssrLoadModule("/src/auth/session.tsx"));
  domain = await vite.ssrLoadModule("/src/decks/registry.ts");
  ({ catalogDeckRuntime: runtime } = await vite.ssrLoadModule("/src/catalog/runtime.ts"));
  ({ inspectDeckAuthoringArtifact: inspect } = await vite.ssrLoadModule("/src/decks/authoring.ts"));
});
test.beforeEach(() => {
  manifest = copy(fixture); errors = [];
  global.fetch = async (path, init = {}) => {
    assert.ok(!init.method || init.method === "GET", "render/navigation must not mutate the catalog");
    if (path === "/auth/session") return json({ authenticated: true, accountId: "fixture-account", user: { email: "fixture@example.invalid" } });
    if (path === `/api/decks/${deckId}`) return json({ id: deckId, slug: manifest.data.slug, name: manifest.data.name, tagline: manifest.tagline, visibility: "private", revision: 1, manifest });
    if (path === `/api/decks/${deckId}/artwork` || path === `/api/me/decks/${deckId}/artwork`) return json({ enabled: true, deckRevision: 1, cards: Object.values(manifest.data.cards).map((card) => ({ slug: card.slug, name: card.name, artwork: null })) });
    throw new Error(`Unexpected request ${path}`);
  };
  root = createRoot(document.getElementById("root"));
});
test.afterEach(async () => {
  await act(async () => root.unmount()); runtime.clear();
  document.getElementById("root").replaceChildren();
});
test.after(async () => {
  await vite?.close(); dom.window.close();
  for (const [name, descriptor] of Object.entries(saved)) { if (descriptor) Object.defineProperty(global, name, descriptor); else delete global[name]; }
});

test("exact valid preview manifest renders its full deck route, all axes, card dialog and artwork navigation", async () => {
  assert.equal(inspect(manifest).valid, true);
  await mount();
  assert.match(document.querySelector("main").textContent, /Artwork Preview Check/);
  for (let index = 0; index < 4; index++) await click(`#axis-tab-${index}`);
  await go(`/deck/${deckId}/browse`);
  assert.match(document.querySelector("main").textContent, /1 of 1 cards/);
  await click('button[aria-label="Open An Open Circle"]');
  assert.match(document.querySelector('[role="dialog"]').textContent, /Notice the space available/);
  assert.match(document.querySelector('[role="dialog"]').textContent, /A single open circle on plain paper/);
  await click('button[aria-label="Close"]');
  assert.equal(document.querySelector('[role="dialog"]'), null);
  await go(`/deck/${deckId}/artwork`);
  assert.equal(document.querySelector('#artwork-card').value, "major-0");
  assert.match(document.querySelector('label[for="artwork-file"]').textContent, /An Open Circle/);
  assert.equal(document.querySelector('button[type="submit"]').disabled, true);
  await go(`/deck/${deckId}`);
  assert.match(document.querySelector("main").textContent, /The four axes/);
  assert.deepEqual(manifest, fixture, "navigation must preserve the authored artifact");
  assert.deepEqual(domain.getDeck(deckId).data, fixture.data);
});

test("card dialog accepts a station without optional description or meaning", async () => {
  assert.equal(inspect(manifest).valid, true);
  await mount(`/deck/${deckId}/browse`);
  await click('button[aria-label="Open An Open Circle"]');
  assert.match(document.querySelector('[role="dialog"]').textContent, /Still/);
  assert.doesNotMatch(document.querySelector('[role="dialog"]').textContent, /undefined/);
});

test("optional rank numbers and prose stay optional for minor cards across axes and dialog", async () => {
  manifest.data.minor_number_origin = "card";
  for (const rank of Object.values(manifest.data.ranks)) delete rank.numeric_value;
  manifest.data.cards["lines-1"] = { ...copy(manifest.data.cards["major-0"]), slug: "lines-1", name: "First Line", number: "1", arcana: "minor", suit_slug: "lines", rank_slug: "one" };
  assert.equal(inspect(manifest).valid, true);
  await mount();
  await click("#axis-tab-1");
  assert.match(document.querySelector('[role="tabpanel"]').textContent, /Minor ranks/);
  assert.doesNotMatch(document.querySelector('[role="tabpanel"]').textContent, /undefined|NaN/);
  await go(`/deck/${deckId}/browse`);
  await click('button[aria-label="Open First Line"]');
  assert.match(document.querySelector('[role="dialog"]').textContent, /One of Lines/);
});

for (const explicit of [true, false]) test(`${explicit ? "explicit" : "legacy description"} suit dialectic uses canonical map identities without requiring optional slugs`, async () => {
  manifest.data.suits = Object.fromEntries(["World", "Soul"].flatMap((realm, r) => ["Still", "Moving"].map((motion, m) => [
    `${realm.toLowerCase()}-${motion.toLowerCase()}`,
    { name: `${realm} ${motion}`, index: r * 2 + m, ...(!explicit ? { description: `${realm} x ${motion}. Authored suit description.` } : {}) },
  ])));
  if (explicit) manifest.data.dialectic = { axes: [{ name: "Realm", poles: ["World", "Soul"] }, { name: "Motion", poles: ["Still", "Moving"] }], cells: { "world-still": ["World", "Still"], "world-moving": ["World", "Moving"], "soul-still": ["Soul", "Still"], "soul-moving": ["Soul", "Moving"] } };
  assert.equal(inspect(manifest).valid, true);
  const original = copy(manifest);
  await mount();
  assert.match(document.querySelector('[role="tabpanel"]').textContent, /four form a true cross-product/);
  assert.match(document.querySelector('[role="tabpanel"]').textContent, explicit ? /Realm \(World \/ Soul\)/ : /Authored suit description/);
  await click("#axis-tab-2");
  assert.match(document.querySelector('[role="tabpanel"]').textContent, /Still/);
  assert.deepEqual(domain.getDeck(deckId).data, original.data, "derived axis identity must not rewrite the manifest");
});

for (const description of [undefined, "Authored station description", ""]) test(`card dialog preserves station description/meaning semantics (${String(description)})`, async () => {
  const station = manifest.data.transversal.stations.still;
  station.meaning = { upright: ["Quiet", "Balance", "Attention", "Fourth"], inverted: [] };
  if (description !== undefined) station.description = description;
  assert.equal(inspect(manifest).valid, true);
  await mount(`/deck/${deckId}/browse`);
  await click('button[aria-label="Open An Open Circle"]');
  const dialog = document.querySelector('[role="dialog"]').textContent;
  if (description === undefined) assert.match(dialog, /Quiet, Balance, Attention/);
  else { assert.doesNotMatch(dialog, /Quiet, Balance, Attention/); if (description) assert.match(dialog, /Authored station description/); }
  assert.doesNotMatch(dialog, /Fourth/);
});
