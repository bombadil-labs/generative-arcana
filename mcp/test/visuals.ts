import assert from "node:assert/strict";
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
  assert.deepEqual(visuals.listPacks("deep-time"), []);

  const art = await visuals.loadCardArt("final-fantasy-tarot", "major-0");
  assert.ok(art, "expected Final Fantasy major-0 art");
  assert.equal(art.packId, "pixel");
  assert.equal(art.mimeType, "image/png");
  assert.deepEqual([...art.data.subarray(0, 8)], [137, 80, 78, 71, 13, 10, 26, 10]);

  assert.equal(await visuals.loadCardArt("final-fantasy-tarot", "not-a-real-card"), null);
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
