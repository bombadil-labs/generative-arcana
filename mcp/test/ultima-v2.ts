import assert from "node:assert/strict";
import { DeckRegistry } from "../../app/src/decks/registry";
import { BUNDLED_DECK_MANIFESTS } from "../../app/src/decks/bundled";
import { ArcanaEngine } from "../../app/src/engine/ArcanaEngine";
import { ArcanaToolAdapter } from "../../app/src/mcp/ArcanaToolAdapter";

async function main(): Promise<void> {
  const registry = new DeckRegistry();
  registry.registerDeck(BUNDLED_DECK_MANIFESTS.ultima);
  const tools = new ArcanaToolAdapter(new ArcanaEngine(registry));

  const minor = await tools.call("get_card", {
    deckId: "ultima-tarot",
    cardSlug: "crowns-five",
  }) as any;

  assert.equal(minor.render.deck.version, "2.1.0");
  assert.match(minor.render.render.material.medium, /illuminated|codex/i);
  assert.match(minor.render.render.form.familyComposition, /frontal|symmetrical|civic/i);
  assert.match(minor.render.render.form.rank.composition_law, /breaks under an irreducible trial/i);
  assert.match(minor.render.render.environment.atmosphere, /costly|diminishing|offered/i);
  assert.match(minor.render.render.scene.description, /granary|coffer/i);
  assert.ok(minor.render.render.avoid.includes("photorealistic medieval reenactment"));
  assert.deepEqual(minor.render.context.dialectic, [
    { axis: "Realm", pole: "World" },
    { axis: "Way", pole: "Throne" },
  ]);

  const major = await tools.call("get_card", {
    deckId: "ultima-tarot",
    cardSlug: "major-15",
  }) as any;

  assert.match(major.render.render.form.familyComposition, /mythic hieratic|frontispiece/i);
  assert.match(major.render.render.form.numericLogic, /Principles.*sovereignty|triadic.*monolithic/i);
  assert.match(major.render.context.number.factorization.gloss, /Three Principles.*Lord of Britannia/i);
  assert.match(major.render.render.environment.atmosphere, /grounded|right-sized|teachable/i);
  assert.equal(major.render.context.family.kind, "major");
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
