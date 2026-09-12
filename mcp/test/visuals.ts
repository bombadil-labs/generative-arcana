import assert from "node:assert/strict";
import { createBundledArcanaAdapter } from "../src/hostStore";
import { buildLivingSpreadResult, type ResolvedReadingForLivingSpread } from "../src/livingSpreadPayload";
import { createBundledStaticVisualStore } from "../src/staticVisuals";

async function main(): Promise<void> {
  const visuals = createBundledStaticVisualStore();

  const finalFantasy = visuals.listPacks("final-fantasy-tarot");
  assert.equal(finalFantasy.length, 1);
  assert.deepEqual(finalFantasy[0], {
    deckId: "final-fantasy-tarot",
    id: "pixel",
    label: "Pixel",
    description: "Chibi pixel art, each card lit by its element.",
    renderer: "static-image",
    mimeType: "image/png",
    complete: true,
    cardCount: 78,
  });

  const deepTime = visuals.listPacks("deep-time");
  assert.deepEqual(deepTime, [{
    deckId: "deep-time",
    id: "core-sample",
    label: "Core Sample",
    description: "A Living Spread that composes the five dealt layers into one animated geological column.",
    renderer: "living-spread",
    format: "generative-arcana/deep-time-core-sample@1",
    spreadIds: ["core-sample"],
    interactive: true,
  }]);

  const scene = visuals.resolveSpreadScene("deep-time", "core-sample");
  assert.deepEqual(scene, {
    deckId: "deep-time",
    spreadId: "core-sample",
    packId: "core-sample",
    packLabel: "Core Sample",
    format: "generative-arcana/deep-time-core-sample@1",
  });
  assert.equal(visuals.resolveSpreadScene("deep-time", "three-card"), null);
  assert.equal(visuals.resolveSpreadScene("final-fantasy-tarot", "three-card", "pixel"), null);

  const adapter = createBundledArcanaAdapter();
  const cast = await adapter.call("cast_reading", {
    deckId: "deep-time",
    spread: "core-sample",
    question: "What is shaping this layer?",
  }) as { token: string };
  const reading = await adapter.call("resolve_reading", { token: cast.token }) as ResolvedReadingForLivingSpread;
  const payload = buildLivingSpreadResult(reading, scene!);
  assert.equal(payload.layout.kind, "living-spread");
  assert.equal(payload.layout.format, "generative-arcana/deep-time-core-sample@1");
  assert.equal(payload.placements.length, 5);
  assert.equal(payload.placements[0].position, "The Basement");
  assert.ok(payload.placements.every((placement) => placement.visual.stationSlug));
  assert.ok(payload.placements.every((placement) => placement.visual.family.kind));
  assert.ok(payload.placements.every((placement) => placement.visual.sceneDescription));

  const art = await visuals.loadCardArt("final-fantasy-tarot", "major-0");
  assert.ok(art, "expected Final Fantasy major-0 art");
  assert.equal(art.packId, "pixel");
  assert.equal(art.mimeType, "image/png");
  assert.deepEqual([...art.data.subarray(0, 8)], [137, 80, 78, 71, 13, 10, 26, 10]);

  assert.equal(await visuals.loadCardArt("final-fantasy-tarot", "not-a-real-card"), null);
  assert.equal(await visuals.loadCardArt("deep-time", "major-0", "core-sample"), null);
  await assert.rejects(
    () => visuals.loadCardArt("final-fantasy-tarot", "../major-0"),
    /not safe for static asset lookup/,
  );
  await assert.rejects(
    () => visuals.loadCardArt("final-fantasy-tarot", "major-0", "missing-pack"),
    /Unknown server-renderable visual pack/,
  );
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
