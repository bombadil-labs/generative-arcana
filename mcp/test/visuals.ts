import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { Script } from "node:vm";
import { Client, InMemoryTransport } from "@modelcontextprotocol/client";
import { createArcanaAdapter } from "../src/hostStore";
import { buildLivingSpreadResult, type ResolvedReadingForLivingSpread } from "../src/livingSpreadPayload";
import { createArcanaMcpServer } from "../src/server";
import { ARCANA_SPREAD_WIDGET_URI } from "../src/spreadWidget";
import { createStaticVisualStore, StaticVisualStore } from "../src/staticVisuals";
import { FORMER_BUNDLED_DECK_IDS, neutralManifest, TEST_DECK_ID } from "./protocol-fixtures";

async function main(): Promise<void> {
  const defaults = createStaticVisualStore();
  for (const deckId of FORMER_BUNDLED_DECK_IDS) {
    assert.deepEqual(defaults.listPacks(deckId), [], `${deckId} must not expose built-in packs`);
    assert.equal(await defaults.loadCardArt(deckId, "major-0"), null);
    assert.equal(defaults.resolveSpreadScene(deckId, "core-sample"), null);
  }

  const dir = await mkdtemp(join(tmpdir(), "arcana-custom-art-"));
  const png = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aXioAAAAASUVORK5CYII=", "base64");
  try {
    await writeFile(join(dir, "major-0.png"), png);
    const pack = {
      deckId: TEST_DECK_ID, id: "test-png", label: "Test PNG", mimeType: "image/png",
      extension: ".png", directory: pathToFileURL(`${dir}/`), complete: false, cardCount: 1,
    };
    const scenePack = {
      deckId: TEST_DECK_ID, id: "custom-scene", label: "Custom Scene",
      format: "generative-arcana/custom-test@1", spreadIds: ["single"],
    };
    const visuals = new StaticVisualStore([pack], [scenePack]);
    assert.deepEqual(visuals.listPacks(TEST_DECK_ID), [{
      deckId: TEST_DECK_ID, id: "test-png", label: "Test PNG", renderer: "static-image",
      mimeType: "image/png", complete: false, cardCount: 1,
    }, { ...scenePack, renderer: "living-spread", interactive: true }]);
    const scene = visuals.resolveSpreadScene(TEST_DECK_ID, "single");
    assert.deepEqual(scene, {
      deckId: TEST_DECK_ID, spreadId: "single", packId: "custom-scene",
      packLabel: "Custom Scene", format: "generative-arcana/custom-test@1",
    });
    assert.equal(visuals.resolveSpreadScene(TEST_DECK_ID, "three-card"), null);
    assert.equal(visuals.resolveSpreadScene(TEST_DECK_ID, "three-card", "test-png"), null);

    const adapter = createArcanaAdapter();
    await adapter.call("import_deck", { manifest: neutralManifest() });
    const cast = await adapter.call("cast_reading", { deckId: TEST_DECK_ID, spread: "single", question: "What needs attention?" }) as { token: string };
    const reading = await adapter.call("resolve_reading", { token: cast.token }) as ResolvedReadingForLivingSpread;
    const payload = buildLivingSpreadResult(reading, scene!);
    assert.equal(payload.layout.kind, "living-spread");
    assert.equal(payload.layout.format, scenePack.format);
    assert.equal(payload.placements.length, 1);
    assert.equal(payload.placements[0].position, "The Card");
    assert.equal(payload.placements[0].visual.stationSlug, "still");
    assert.ok(payload.placements[0].visual.family.kind);
    assert.ok(payload.placements[0].visual.sceneDescription);
    assert.throws(() => buildLivingSpreadResult(reading, { ...scene!, deckId: "other-deck" }), /does not match/);

    const art = await visuals.loadCardArt(TEST_DECK_ID, "major-0");
    assert.ok(art, "Explicitly registered custom art remains available");
    assert.equal(art.packId, "test-png");
    assert.equal(art.mimeType, "image/png");
    assert.deepEqual(art.data, png);
    assert.equal(await visuals.loadCardArt(TEST_DECK_ID, "missing-card"), null);
    await assert.rejects(() => visuals.loadCardArt(TEST_DECK_ID, "../major-0"), /not safe for static asset lookup/);
    await assert.rejects(() => visuals.loadCardArt(TEST_DECK_ID, "major-0", "missing-pack"), /Unknown server-renderable visual pack/);
    assert.throws(() => new StaticVisualStore([pack, pack]), /Duplicate static visual pack/);
    assert.throws(() => new StaticVisualStore([], [scenePack, scenePack]), /Duplicate Living Spread pack/);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }

  const server = createArcanaMcpServer();
  const client = new Client({ name: "visual-regression", version: "1.0.0" });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await Promise.all([server.connect(serverTransport), client.connect(clientTransport)]);
  try {
    const resource = await client.readResource({ uri: ARCANA_SPREAD_WIDGET_URI });
    const html = resource.contents.map((content) => "text" in content ? content.text : "").join("\n");
    assert.doesNotMatch(html, /deep-time|mountCoreSample|crystallization|metamorphism/);
    assert.match(html, /element\("details", "living-detail"\)/, "Generic custom Living Spread details remain interactive");
    const script = html.match(/<script>([\s\S]*?)<\/script>/)?.[1];
    assert.ok(script);
    new Script(script); // Check the emitted widget's JavaScript, not just its TypeScript wrapper.
  } finally {
    await client.close();
    await server.close();
  }
}

main().catch((error) => { console.error(error); process.exitCode = 1; });
