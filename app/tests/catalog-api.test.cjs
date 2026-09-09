const test = require("node:test");
const assert = require("node:assert/strict");
const { importRequestFromJson } = require("../.test-build/catalog/api.js");

test("canonical manifest imports preserve manifest metadata", () => {
  const data = { slug: "my-deck" };
  const spreads = [{ id: "three" }];
  assert.deepEqual(importRequestFromJson({ data, tagline: "hello", spreads }, true), {
    data,
    tagline: "hello",
    spreads,
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
