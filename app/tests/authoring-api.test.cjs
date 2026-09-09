const test = require("node:test");
const assert = require("node:assert/strict");
const { validateAuthoringArtifact } = require("../.test-build/authoring/api.js");

test("browser authoring client posts the artifact directly to the public validation boundary", async () => {
  const original = global.fetch;
  global.fetch = async (input, init) => {
    assert.equal(input, "/api/authoring/validate");
    assert.equal(init.method, "POST");
    assert.equal(init.credentials, "same-origin");
    assert.deepEqual(JSON.parse(init.body), { data: { slug: "test" }, tagline: "Test" });
    return new Response(JSON.stringify({
      valid: true,
      specVersion: "1",
      inputKind: "manifest",
      canonical: true,
      summary: {
        name: "Test",
        slug: "test",
        version: "1.0.0",
        cardCount: 78,
        suitCount: 4,
        rankCount: 14,
        stationCount: 7,
        spreadCount: 0,
      },
    }), { status: 200, headers: { "content-type": "application/json" } });
  };
  try {
    const result = await validateAuthoringArtifact({ data: { slug: "test" }, tagline: "Test" });
    assert.equal(result.valid, true);
    assert.equal(result.canonical, true);
  } finally {
    global.fetch = original;
  }
});

test("browser authoring client keeps transport failures distinct from domain-invalid results", async () => {
  const original = global.fetch;
  global.fetch = async () => new Response(JSON.stringify({ message: "Request body exceeds the configured size limit." }), {
    status: 400,
    headers: { "content-type": "application/json" },
  });
  try {
    await assert.rejects(
      validateAuthoringArtifact({}),
      /exceeds the configured size limit/,
    );
  } finally {
    global.fetch = original;
  }
});
