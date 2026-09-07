const { test } = require("node:test");
const assert = require("node:assert/strict");
const {
  registerCard,
  registerKitPack,
  registerRawPack,
  registerImagePack,
  registerPack,
  listPacks,
  resolveVisual,
  isIllustrated,
} = require("../.test-build/runtime/defineCard.js");

const sketch = (slug) => ({ slug, draw() {} });

test("card definition is pure until an owning pack registers it", () => {
  const card = registerCard(sketch("major-0"));
  registerPack("visual-pure", { id: "animated", label: "Animated" });
  assert.equal(resolveVisual("visual-pure", card.slug), null);
  registerKitPack("visual-pure", "animated", [card]);
  assert.equal(resolveVisual("visual-pure", card.slug).kind, "kit");
});

test("a mixed skin may use different renderers for different cards", () => {
  registerPack("visual-mixed", { id: "mixed", label: "Mixed" });
  registerRawPack("visual-mixed", "mixed", { alpha: "function sketch(p) {}" });
  registerImagePack("visual-mixed", "mixed", { beta: "/beta.png" });
  assert.equal(resolveVisual("visual-mixed", "alpha").kind, "p5");
  assert.equal(resolveVisual("visual-mixed", "beta").kind, "image");
});

test("one card cannot silently acquire two renderer kinds in the same skin", () => {
  registerPack("visual-collision", { id: "mixed", label: "Mixed" });
  registerRawPack("visual-collision", "mixed", { alpha: "code" });
  assert.throws(() => registerImagePack("visual-collision", "mixed", { alpha: "/alpha.png" }), /different renderer/);
  const resolved = resolveVisual("visual-collision", "alpha");
  assert.equal(resolved.kind, "p5");
  assert.equal(resolved.code, "code");
});

test("re-registering one renderer slice replaces stale entries atomically", () => {
  registerPack("visual-replace", { id: "raw", label: "Raw" });
  registerRawPack("visual-replace", "raw", { alpha: "one", beta: "two" });
  registerRawPack("visual-replace", "raw", { alpha: "updated" });
  assert.equal(resolveVisual("visual-replace", "alpha").code, "updated");
  assert.equal(resolveVisual("visual-replace", "beta"), null);
});

test("pack metadata updates in place and listPacks returns defensive copies", () => {
  registerPack("visual-meta", { id: "a", label: "First" });
  registerPack("visual-meta", { id: "b", label: "Second" });
  registerPack("visual-meta", { id: "a", label: "Updated" });
  const packs = listPacks("visual-meta");
  assert.deepEqual(packs.map((p) => [p.id, p.label]), [["a", "Updated"], ["b", "Second"]]);
  packs.reverse();
  packs[0].label = "Mutated";
  assert.deepEqual(listPacks("visual-meta").map((p) => [p.id, p.label]), [["a", "Updated"], ["b", "Second"]]);
});

test("preferred-pack fallback still follows registered pack order", () => {
  registerPack("visual-fallback", { id: "first", label: "First" });
  registerPack("visual-fallback", { id: "second", label: "Second" });
  registerImagePack("visual-fallback", "first", { alpha: "/first.png", beta: "/beta.png" });
  registerImagePack("visual-fallback", "second", { alpha: "/second.png" });
  assert.equal(resolveVisual("visual-fallback", "alpha").packId, "first");
  assert.equal(resolveVisual("visual-fallback", "alpha", "second").packId, "second");
  assert.equal(resolveVisual("visual-fallback", "beta", "second").packId, "first");
  assert.equal(isIllustrated("visual-fallback", "beta"), true);
  assert.equal(isIllustrated("visual-fallback", "missing"), false);
});
