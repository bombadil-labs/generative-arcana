const test = require("node:test");
const assert = require("node:assert/strict");
const { readFileSync, readdirSync } = require("node:fs");
const { resolve } = require("node:path");
const React = require("react");
const { renderToStaticMarkup } = require("react-dom/server");
const { JSDOM } = require("jsdom");
const { sanitizeGlyphSvg } = require("../.test-build/components/safeSvg.js");
const { Svg, Glyph, AxisGlyph } = require("../.test-build/components/cardMeta.js");
const { CardPlaceholder } = require("../.test-build/components/CardPlaceholder.js");
const { validateDeck } = require("../.test-build/decks/validate.js");
const { rawDeck } = require("./fixtures.cjs");

// Inert DOM only: do not enable runScripts, resource loading, or dispatch attack events.
// Attack strings are data inspected after sanitization, never executed or sent to a live service.
const dom = new JSDOM("");
function withDOM(callback) {
  const previous = global.window;
  global.window = dom.window;
  try { return callback(); } finally {
    if (previous === undefined) delete global.window;
    else global.window = previous;
  }
}
const shape = '<path d="M0 0L10 10" stroke="currentColor" fill="none"/>';
function svg(contents = shape, attributes = "") {
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100" ${attributes}>${contents}</svg>`;
}
function inspect(html) {
  const template = dom.window.document.createElement("template");
  template.innerHTML = html;
  return template.content;
}
function assertInert(output) {
  if (output === null) return;
  const fragment = inspect(output);
  assert.equal(fragment.children.length, 1);
  assert.equal(fragment.firstElementChild.localName, "svg");
  assert.equal(fragment.querySelector("script,style,foreignObject,image,feImage,filter,animate,animateTransform,animateMotion,set,a,iframe,object,embed,html,img"), null);
  for (const element of fragment.querySelectorAll("*")) {
    assert.equal(element.namespaceURI, "http://www.w3.org/2000/svg");
    for (const { name, value } of element.attributes) {
      assert.doesNotMatch(name, /^on|^style$|^class$|^data-/i);
      assert.doesNotMatch(value, /javascript:|data:|https?:\/\/(?!www\.w3\.org\/)|\/\/attacker|@import|\\/i);
      if (name === "id") assert.match(value, /^arcana-[\w-]+-\d+$/);
      if (name === "href" || name === "xlink:href") assert.ok(fragment.querySelector(`[id="${value.slice(1)}"]`));
      if (value.startsWith("url(")) {
        const id = /^url\(#([\w-]+)\)$/.exec(value)?.[1];
        assert.ok(id);
        assert.ok(fragment.querySelector(`[id="${id}"]`));
      }
    }
  }
}

test("SSR and unavailable DOM fail closed to a trusted glyph, including size and fallback inputs", () => {
  assert.equal(typeof global.window, "undefined");
  const dirty = svg(shape, 'onload="UNTRUSTED_HANDLER()"');
  assert.equal(sanitizeGlyphSvg(dirty, "ssr", 16), null);
  const html = renderToStaticMarkup(React.createElement(Svg, { svg: dirty }));
  assert.doesNotMatch(html, /UNTRUSTED|onload/);
  assert.match(html, /M50|cx="50"/);
  assert.match(renderToStaticMarkup(React.createElement(Glyph, { which: "__proto__", size: '1" onload="UNTRUSTED' })), /width="16"/);
  global.window = {};
  try { assert.equal(sanitizeGlyphSvg(dirty, "missing", 16), null); }
  finally { delete global.window; }
});

test("static shapes and safe paint survive, arbitrary sizing is replaced", () => withDOM(() => {
  const output = sanitizeGlyphSvg(svg(shape, "width='5000' height='7000'"), "safe", 24);
  assert.ok(output);
  const root = inspect(output).firstElementChild;
  assert.equal(root.getAttribute("width"), "24");
  assert.equal(root.getAttribute("height"), "24");
  assert.equal(root.getAttribute("viewBox"), "0 0 100 100");
  assert.equal(root.querySelector("path").getAttribute("stroke"), "currentColor");
  assertInert(output);
  for (const size of [NaN, Infinity, -1, '16" onload="UNTRUSTED']) {
    assert.equal(inspect(sanitizeGlyphSvg(svg(), "size", size)).firstElementChild.getAttribute("width"), "16");
  }
}));

const attacks = [
  svg(`${shape}<script>UNTRUSTED_SCRIPT()</script>`, 'onload="UNTRUSTED_HANDLER()"'),
  svg(`<g onmouseover="UNTRUSTED_HANDLER()">${shape}</g>`),
  svg(`<foreignObject><div xmlns="http://www.w3.org/1999/xhtml"><img src="x" onerror="UNTRUSTED_HANDLER()"></div></foreignObject>${shape}`),
  svg(`<a href="javascript:UNTRUSTED_HANDLER()">${shape}</a>${shape}`),
  svg(`<use href="https://attacker.invalid/external.svg#x"/>${shape}`),
  svg(`<use xmlns:xlink="http://www.w3.org/1999/xlink" xlink:href="//attacker.invalid/x"/>${shape}`),
  svg(`<use href="data:image/svg+xml;base64,PHN2Zy8+"/>${shape}`),
  svg(`<use href="&#106;avascript:UNTRUSTED_HANDLER()"/>${shape}`),
  svg(`<image href="https://attacker.invalid/image"/><filter id="f"><feImage href="https://attacker.invalid/f"/></filter>${shape}`),
  svg(`<style>@import 'https://attacker.invalid/css'; path{fill:url(https://attacker.invalid/paint)}</style>${shape}`),
  svg(`<path d="M0 0L10 10" style="fill:url(https://attacker.invalid/paint)"/>`),
  svg(`<path d="M0 0L10 10" fill="url(https://attacker.invalid/paint)" stroke="url(data:image/svg+xml;base64,abc)"/>`),
  svg(`<path d="M0 0L10 10" fill="u&#114;l(//attacker.invalid/p)" mask="url(//attacker.invalid/m)" clip-path="url(data:abc)"/>`),
  svg(String.raw`<path d="M0 0L10 10" fill="u\72l(https://attacker.invalid/p)" stroke="var(--untrusted-paint)"/>`),
  svg(`<path d="M0 0L10 10" fill="url(#missing) red"/><use href="#missing"/>`),
  svg(`<set attributeName="onload" to="UNTRUSTED_HANDLER()"/><animate attributeName="href" values="javascript:UNTRUSTED_HANDLER()"/><animateTransform attributeName="transform"/><animateMotion path="M0 0L1 1"/>${shape}`),
  svg(`<g xmlns="http://www.w3.org/1999/xhtml"><script>UNTRUSTED_SCRIPT()</script>${shape}</g>`),
  `<svg><title><img src=x onerror="UNTRUSTED_HANDLER()"></title>${shape}</svg>`,
  `<svg><desc><![CDATA[</desc><img src=x onerror="UNTRUSTED_HANDLER()">]]></desc>${shape}</svg>`,
  `<svg><g><style><img src=x onerror="UNTRUSTED_HANDLER()"></style>${shape}</g></svg>`,
  `<math><mtext><table><mglyph><style><!--</style><img title="--><img src=x onerror=UNTRUSTED_HANDLER()>">`,
  `${svg()}<img src=x onerror="UNTRUSTED_HANDLER()">`,
  svg(shape, 'ONLOAD="UNTRUSTED_HANDLER()" data-payload="x" class="overlay"'),
  `<svg xmlns="https://attacker.invalid/namespace" xmlns:xlink="https://attacker.invalid/xlink">${shape}</svg>`,
];
for (const [index, dirty] of attacks.entries()) {
  test(`untrusted SVG fixture ${index + 1} stays inert`, () => withDOM(() => {
    const output = sanitizeGlyphSvg(dirty, "attack", 24);
    assertInert(output);
    assert.doesNotMatch(output || "", /UNTRUSTED|attacker\.invalid/);
  }));
}

test("local gradients, masks, clips and use references survive and are isolated per instance", () => withDOM(() => {
  const source = svg(`<defs>
    <linearGradient id='paint'><stop offset='0' stop-color='#fff'/><stop offset='1' stop-color='rgb(0, 0, 0)'/></linearGradient>
    <radialGradient id="radial" href="#paint"/>
    <mask id="mask"><rect width="100" height="100" fill="white"/></mask>
    <clipPath id="clip"><circle r="40"/></clipPath>
    <symbol id="shape">${shape}</symbol>
    </defs><g mask="url('#mask')" clip-path="url( #clip )"><path d="M0 0L10 10" fill="url(#paint)"/><use href='#shape'/><use xmlns:xlink="http://www.w3.org/1999/xlink" xlink:href='#shape'/></g>`);
  const a = sanitizeGlyphSvg(source, ":r1:", 24);
  const b = sanitizeGlyphSvg(source, ":r2:", 24);
  assertInert(a); assertInert(b);
  const root = inspect(a);
  assert.equal(root.querySelectorAll("[id]").length, 5);
  assert.equal([...root.querySelectorAll("*")].filter((element) => element.hasAttribute("href") || element.hasAttribute("xlink:href")).length, 3);
  assert.match(a, /fill="url\(#arcana-r1-/);
  assert.match(a, /mask="url\(#arcana-r1-/);
  assert.match(a, /clip-path="url\(#arcana-r1-/);
  assert.doesNotMatch(b, /arcana-r1-/);
  assert.doesNotMatch(a, /id="(?:paint|mask|clip|shape)"/);
}));

test("duplicate, missing and page-global ID references cannot escape the glyph", () => withDOM(() => {
  const source = svg(`<defs><path id="duplicate" d="M0 0L1 1"/><path id="duplicate" d="M1 1L2 2"/></defs><use href="#duplicate"/><use href="#outside-page"/><path d="M0 0L10 10" fill="url(#outside-page)"/>`);
  const output = sanitizeGlyphSvg(source, 'x" onload="UNTRUSTED', 16);
  assertInert(output);
  const root = inspect(output);
  assert.equal(root.querySelectorAll("[id]").length, 1);
  assert.equal(root.querySelectorAll("use[href]").length, 1);
  assert.equal(root.querySelector("svg > path").hasAttribute("fill"), false);
}));

test("empty, malformed, non-SVG and excessive glyphs use the safe fallback", () => withDOM(() => {
  for (const source of ["", "<svg/>", "plain text", "<img src=x>", "<svg><script>UNTRUSTED()</script></svg>", "x".repeat(100_001), svg("<g/>".repeat(1_001)), svg() + svg()]) {
    assert.equal(sanitizeGlyphSvg(source, "empty", 16), null);
  }
}));

test("all archived valid glyphs preserve their static geometry and masks", () => withDOM(() => {
  let count = 0;
  for (const deckName of readdirSync(resolve(__dirname, "../../decks"))) {
    const deck = JSON.parse(readFileSync(resolve(__dirname, "../../decks", deckName, "deck.json"), "utf8"));
    const glyphs = [...Object.values(deck.suits).map((suit) => suit.symbol?.svg), deck.major_arcana.symbol?.svg].filter(Boolean);
    for (const source of glyphs) {
      const output = sanitizeGlyphSvg(source, `corpus-${count++}`, 44);
      assert.ok(output, deckName);
      assertInert(output);
      for (const tag of ["path", "rect", "circle", "ellipse", "line", "polygon", "mask"]) {
        // Corpus inputs are trusted repository fixtures; never use this path for attack strings.
        assert.equal(inspect(output).querySelectorAll(tag).length, inspect(source).querySelectorAll(tag).length, `${deckName}: ${tag}`);
      }
    }
  }
  assert.ok(count >= 36);
}));

test("stored/local manifests need no migration: suit, major and placeholder rendering use the boundary", () => withDOM(() => {
  const deck = rawDeck();
  const suit = Object.keys(deck.suits)[0];
  const dirty = svg(`${shape}<script>UNTRUSTED_SCRIPT()</script>`, 'onload="UNTRUSTED_HANDLER()"');
  deck.suits[suit].symbol = { ...deck.suits[suit].symbol, svg: dirty };
  deck.major_arcana.symbol = { ...deck.major_arcana.symbol, svg: dirty };
  // Validation intentionally preserves portable JSON. Rendering must protect all stored versions.
  assert.equal(validateDeck(deck).ok, true);
  for (const card of [{ arcana: "minor", suit_slug: suit, name: "Minor" }, { arcana: "major", name: "Major" }]) {
    for (const Component of [AxisGlyph, CardPlaceholder]) {
      const html = renderToStaticMarkup(React.createElement(Component, { deck, card }));
      assert.doesNotMatch(html, /UNTRUSTED|onload|<script/);
      assert.match(html, /stroke="currentColor"/);
    }
  }
  const two = renderToStaticMarkup(React.createElement(React.Fragment, null,
    React.createElement(Svg, { svg: svg('<defs><mask id="m"><rect width="10" height="10"/></mask></defs><circle r="5" mask="url(#m)"/>') }),
    React.createElement(Svg, { svg: svg('<defs><mask id="m"><rect width="10" height="10"/></mask></defs><circle r="5" mask="url(#m)"/>') })));
  const ids = [...two.matchAll(/id="([^"]+)"/g)].map((m) => m[1]);
  assert.equal(new Set(ids).size, 2);
}));
