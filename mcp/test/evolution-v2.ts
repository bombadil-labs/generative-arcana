import assert from "node:assert/strict";
import { DeckRegistry } from "../../app/src/decks/registry";
import { BUNDLED_DECK_MANIFESTS } from "../../app/src/decks/bundled";
import { ArcanaEngine } from "../../app/src/engine/ArcanaEngine";
import { ArcanaToolAdapter } from "../../app/src/mcp/ArcanaToolAdapter";

async function main(): Promise<void> {
  const registry = new DeckRegistry();
  registry.registerDeck(BUNDLED_DECK_MANIFESTS.evolution);
  const tools = new ArcanaToolAdapter(new ArcanaEngine(registry));

  const minor = await tools.call("get_card", {
    deckId: "evolution-and-consciousness",
    cardSlug: "avowals-five",
  }) as any;

  assert.equal(minor.render.deck.version, "1.1.0");
  assert.match(minor.render.render.material.medium, /editorial-diagram/i);
  assert.match(minor.render.render.form.familyComposition, /centered|reflexive|self-enclosing/i);
  assert.match(minor.render.render.form.rank.composition_law, /pressure strains/i);
  assert.match(minor.render.render.environment.atmosphere, /before speech|received|settles/i);
  assert.match(minor.render.render.scene.description, /ringed upright form|cannot claim/i);
  assert.ok(minor.render.render.avoid.includes("generic sci-fi interface graphics"));
  assert.deepEqual(minor.render.context.dialectic, [
    { axis: "Force", pole: "Assert" },
    { axis: "Object", pole: "Self" },
  ]);

  const major = await tools.call("get_card", {
    deckId: "evolution-and-consciousness",
    cardSlug: "major-6",
  }) as any;

  assert.match(major.render.render.form.familyComposition, /centered and iconic/i);
  assert.match(major.render.render.form.numericLogic, /Difference.*Utterance|division and production/i);
  assert.match(major.render.context.number.factorization.gloss, /Two times three/i);
  assert.match(major.render.render.environment.atmosphere, /settled|habitual|substrate/i);
  assert.equal(major.render.context.family.kind, "major");
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
