const { test, before, after } = require("node:test");
const assert = require("node:assert/strict");
const { resolve } = require("node:path");
const React = require("react");
const { renderToStaticMarkup } = require("react-dom/server");
const { rawDeck } = require("./fixtures.cjs");

const legacyIds = ["ultima", "byrne", "ulysses", "finalfantasy", "evolution", "ultima-octave", "deep-time"];
let server;
let domain;
let visuals;
let loadCustomDeck;
let Landing;

before(async () => {
  const { createServer } = await import("vite");
  server = await createServer({
    root: resolve(__dirname, ".."),
    server: { middlewareMode: true },
    appType: "custom",
  });
  domain = await server.ssrLoadModule("/src/decks/index.ts");
  visuals = await server.ssrLoadModule("/src/runtime/defineCard.ts");
  ({ loadCustomDeck } = await server.ssrLoadModule("/src/decks/custom.ts"));
  ({ Landing } = await server.ssrLoadModule("/src/app/Landing.tsx"));
});

after(async () => { await server?.close(); });

test("the browser domain starts with no built-in decks or artwork registrations", () => {
  assert.deepEqual(domain.listDecks(), []);
  for (const id of legacyIds) {
    assert.equal(domain.getDeck(id), undefined);
    assert.deepEqual(visuals.listPacks(id), []);
    assert.equal(visuals.isIllustrated(id, "major-0"), false);
  }
});

test("an empty landing points to existing imports, account library, and MCP authoring", () => {
  const html = renderToStaticMarkup(React.createElement(Landing));
  assert.match(html, /Start with your own deck/);
  assert.match(html, /No decks are loaded in this browser session/);
  assert.match(html, /Load browser-local JSON/);
  assert.match(html, /My account decks/);
  assert.match(html, /Browse community decks/);
  assert.match(html, /href="https:\/\/github.com\/bombadil-labs\/generative-arcana\/blob\/main\/docs\/authoring-hosts.md"/);
  assert.match(html, /Where accounts are enabled/);
  assert.doesNotMatch(html, /reference decks|Ultima Tarot|Byrne Journey|Ulysses Tarot|Final Fantasy Tarot|Evolution and Consciousness|Deep Time Tarot/);
});

test("user imports still register, appear on the landing page, and replace cleanly", () => {
  const data = rawDeck();
  data.slug = "browser-import-regression";
  data.name = "My Original Deck";
  try {
    const first = loadCustomDeck(JSON.stringify(data));
    assert.equal(first.ok, true);
    assert.equal(first.deck.custom, true);
    assert.equal(domain.getDeck(data.slug), first.deck);
    const html = renderToStaticMarkup(React.createElement(Landing));
    assert.match(html, /My Original Deck/);
    assert.match(html, /browser-local deck/);
    assert.doesNotMatch(html, /No decks are loaded in this browser session/);

    data.name = "My Revised Deck";
    const replacement = loadCustomDeck(JSON.stringify(data));
    assert.equal(replacement.ok, true);
    assert.equal(domain.listDecks().length, 1);
    assert.match(renderToStaticMarkup(React.createElement(Landing)), /My Revised Deck/);
    const invalid = loadCustomDeck("not valid JSON");
    assert.equal(invalid.ok, false);
    assert.equal(domain.getDeck(data.slug), replacement.deck);
  } finally {
    domain.unregisterDeck(data.slug);
  }
  assert.deepEqual(domain.listDecks(), []);
});
