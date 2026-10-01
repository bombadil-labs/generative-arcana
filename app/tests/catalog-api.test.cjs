const test = require("node:test");
const assert = require("node:assert/strict");
const { importRequestFromJson, getSharedDeck } = require("../.test-build/catalog/api.js");

test("canonical manifest imports stay intact as the native import payload", () => {
  const data = { slug: "my-deck" };
  const spreads = [{ id: "three" }];
  const manifest = { data, tagline: "hello", spreads };
  assert.deepEqual(importRequestFromJson(manifest, true), {
    manifest,
    replaceExisting: true,
  });
});

test("raw deck JSON remains a compatibility import", () => {
  const data = { slug: "legacy-deck", name: "Legacy" };
  assert.deepEqual(importRequestFromJson(data), { data });
});

test("manifest spreads must remain an array", () => {
  assert.throws(
    () => importRequestFromJson({ data: { slug: "bad" }, tagline: "bad", spreads: {} }),
    /spreads must be an array/i,
  );
});


test("shared deck refreshes bypass the HTTP cache and carry the current browser session", async () => {
  const original = global.fetch;
  const controller = new AbortController();
  global.fetch = async (input, init) => {
    assert.equal(input, "/api/decks/catalog%2Fid");
    assert.equal(init.cache, "no-store");
    assert.equal(init.credentials, "same-origin");
    assert.equal(init.signal, controller.signal);
    return new Response(JSON.stringify({ id: "catalog/id" }), { status: 200 });
  };
  try {
    assert.deepEqual(await getSharedDeck("catalog/id", controller.signal), { id: "catalog/id" });
  } finally {
    global.fetch = original;
  }
});
