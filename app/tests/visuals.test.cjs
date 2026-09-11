const { test } = require("node:test");
const assert = require("node:assert/strict");
const {
  VisualRegistry,
  registerCard,
  registerPack,
  registerImagePack,
  resolveVisual,
} = require("../.test-build/runtime/defineCard.js");

const sketch = (slug) => ({ slug, draw() {} });
const registry = () => new VisualRegistry();

test("card definition is pure until an owning pack registers it", () => {
  const r = registry();
  const card = registerCard(sketch("major-0"));
  r.registerPack("deck", { id: "animated", label: "Animated" });
  assert.equal(r.resolveVisual("deck", card.slug), null);
  r.registerKitPack("deck", "animated", [card]);
  assert.equal(r.resolveVisual("deck", card.slug).kind, "kit");
});

test("registry instances do not share visual or pack state", () => {
  const a = registry();
  const b = registry();
  a.registerPack("deck", { id: "images", label: "Images" });
  a.registerImagePack("deck", "images", { alpha: "/alpha.png" });
  assert.equal(a.resolveVisual("deck", "alpha").kind, "image");
  assert.deepEqual(b.listPacks("deck"), []);
  assert.equal(b.resolveVisual("deck", "alpha"), null);
});

test("a mixed skin may use different renderers for different cards", () => {
  const r = registry();
  r.registerPack("deck", { id: "mixed", label: "Mixed" });
  r.registerRawPack("deck", "mixed", { alpha: "function sketch(p) {}" });
  r.registerImagePack("deck", "mixed", { beta: "/beta.png" });
  assert.equal(r.resolveVisual("deck", "alpha").kind, "p5");
  assert.equal(r.resolveVisual("deck", "beta").kind, "image");
});

test("one card cannot silently acquire two renderer kinds in the same skin", () => {
  const r = registry();
  r.registerPack("deck", { id: "mixed", label: "Mixed" });
  r.registerRawPack("deck", "mixed", { alpha: "code" });
  assert.throws(() => r.registerImagePack("deck", "mixed", { alpha: "/alpha.png" }), /different renderer/);
  const resolved = r.resolveVisual("deck", "alpha");
  assert.equal(resolved.kind, "p5");
  assert.equal(resolved.code, "code");
});

test("re-registering one renderer slice replaces stale entries atomically", () => {
  const r = registry();
  r.registerPack("deck", { id: "raw", label: "Raw" });
  r.registerRawPack("deck", "raw", { alpha: "one", beta: "two" });
  r.registerRawPack("deck", "raw", { alpha: "updated" });
  assert.equal(r.resolveVisual("deck", "alpha").code, "updated");
  assert.equal(r.resolveVisual("deck", "beta"), null);
});

test("pack metadata updates in place and listPacks returns defensive copies", () => {
  const r = registry();
  r.registerPack("deck", { id: "a", label: "First" });
  r.registerPack("deck", { id: "b", label: "Second" });
  r.registerPack("deck", { id: "a", label: "Updated" });
  const packs = r.listPacks("deck");
  assert.deepEqual(packs.map((p) => [p.id, p.label]), [["a", "Updated"], ["b", "Second"]]);
  packs.reverse();
  packs[0].label = "Mutated";
  assert.deepEqual(r.listPacks("deck").map((p) => [p.id, p.label]), [["a", "Updated"], ["b", "Second"]]);
});

test("preferred-pack fallback still follows registered pack order", () => {
  const r = registry();
  r.registerPack("deck", { id: "first", label: "First" });
  r.registerPack("deck", { id: "second", label: "Second" });
  r.registerImagePack("deck", "first", { alpha: "/first.png", beta: "/beta.png" });
  r.registerImagePack("deck", "second", { alpha: "/second.png" });
  assert.equal(r.resolveVisual("deck", "alpha").packId, "first");
  assert.equal(r.resolveVisual("deck", "alpha", "second").packId, "second");
  assert.equal(r.resolveVisual("deck", "beta", "second").packId, "first");
  assert.equal(r.isIllustrated("deck", "beta"), true);
  assert.equal(r.isIllustrated("deck", "missing"), false);
});

test("clearing a deck removes metadata and content without affecting other decks", () => {
  const r = registry();
  r.registerPack("one", { id: "images", label: "Images" });
  r.registerImagePack("one", "images", { alpha: "/one.png" });
  r.registerPack("two", { id: "images", label: "Images" });
  r.registerImagePack("two", "images", { alpha: "/two.png" });
  r.clearDeck("one");
  assert.deepEqual(r.listPacks("one"), []);
  assert.equal(r.resolveVisual("one", "alpha"), null);
  assert.equal(r.resolveVisual("two", "alpha").url, "/two.png");
});

test("the legacy module facade still delegates to the app default registry", () => {
  registerPack("facade-test", { id: "images", label: "Images" });
  registerImagePack("facade-test", "images", { alpha: "/alpha.png" });
  assert.equal(resolveVisual("facade-test", "alpha").kind, "image");
});

test("spread scenes share pack preference/fallback semantics without colliding with card visuals", () => {
  const r = registry();
  const firstScene = { spreadId: "three-card", draw() {} };
  const secondScene = { spreadId: "three-card", draw() {} };
  r.registerPack("deck", { id: "first", label: "First" });
  r.registerPack("deck", { id: "second", label: "Second" });
  r.registerImagePack("deck", "first", { "three-card": "/card-with-same-slug.png" });
  r.registerSpreadKitPack("deck", "first", [firstScene]);
  r.registerSpreadKitPack("deck", "second", [secondScene]);

  assert.equal(r.resolveVisual("deck", "three-card").kind, "image", "card and spread namespaces are independent");
  assert.equal(r.resolveSpreadVisual("deck", "three-card").scene, firstScene);
  assert.equal(r.resolveSpreadVisual("deck", "three-card", "second").scene, secondScene);
  assert.equal(r.hasSpreadVisual("deck", "three-card"), true);
  assert.equal(r.hasSpreadVisual("deck", "missing"), false);
});

test("re-registering a spread scene pack replaces stale spread entries atomically", () => {
  const r = registry();
  r.registerPack("deck", { id: "living", label: "Living" });
  r.registerSpreadKitPack("deck", "living", [
    { spreadId: "three-card", draw() {} },
    { spreadId: "core-sample", draw() {} },
  ]);
  const replacement = { spreadId: "three-card", draw() {} };
  r.registerSpreadKitPack("deck", "living", [replacement]);
  assert.equal(r.resolveSpreadVisual("deck", "three-card").scene, replacement);
  assert.equal(r.resolveSpreadVisual("deck", "core-sample"), null);
});

test("spread scene registration rejects duplicate ids and clearDeck removes scenes", () => {
  const r = registry();
  r.registerPack("deck", { id: "living", label: "Living" });
  assert.throws(() => r.registerSpreadKitPack("deck", "living", [
    { spreadId: "three-card", draw() {} },
    { spreadId: "three-card", draw() {} },
  ]), /Duplicate spread scene/);

  r.registerSpreadKitPack("deck", "living", [{ spreadId: "three-card", draw() {} }]);
  assert.ok(r.resolveSpreadVisual("deck", "three-card"));
  r.clearDeck("deck");
  assert.equal(r.resolveSpreadVisual("deck", "three-card"), null);
});
