import assert from "node:assert/strict";
import { DeckRegistry } from "../../app/src/decks/registry";
import { BUNDLED_DECK_MANIFESTS } from "../../app/src/decks/bundled";
import { ArcanaEngine } from "../../app/src/engine/ArcanaEngine";
import { ArcanaToolAdapter } from "../../app/src/mcp/ArcanaToolAdapter";

async function main(): Promise<void> {
  const manifest = BUNDLED_DECK_MANIFESTS.ulysses;
  assert.equal(Object.keys(manifest.data.cards).length, 77, "migration must preserve the authored 77-card corpus");
  assert.equal(
    Object.values(manifest.data.cards).filter((card) => card.arcana === "major").length,
    21,
    "migration must not invent a synthetic Major 21",
  );

  const registry = new DeckRegistry();
  registry.registerDeck(manifest);
  const tools = new ArcanaToolAdapter(new ArcanaEngine(registry));

  const minor = await tools.call("get_card", {
    deckId: "ulysses-tarot",
    cardSlug: "towers-4",
  }) as any;

  assert.equal(minor.render.deck.version, "2.1.0");
  assert.match(minor.render.render.material.medium, /letterpress|lithographic|etched/i);
  assert.match(minor.render.render.form.familyComposition, /vertical|angular|tower|spire/i);
  assert.match(minor.render.render.form.rank.composition_law, /outsider|non-tessellating/i);
  assert.match(minor.render.render.environment.atmosphere, /theocratic|primal|terrifying/i);
  assert.match(minor.render.render.scene.description, /Martello Tower|Dublin/i);
  assert.ok(minor.render.render.avoid.includes("generic fantasy tarot ornament"));
  assert.deepEqual(minor.render.context.dialectic, [
    { axis: "Register", pole: "Mythic" },
    { axis: "Stance", pole: "Resistance" },
  ]);

  const major = await tools.call("get_card", {
    deckId: "ulysses-tarot",
    cardSlug: "major-14",
  }) as any;

  assert.match(major.render.context.family.visualGrammar.medium_handling, /modernist book plate|letterpress|lithographic/i);
  assert.match(major.render.context.family.visualGrammar.composition, /Oxen|historical style-bands|episode/i);
  assert.equal(major.render.context.number.factorization.character, "composite");
  assert.deepEqual(major.render.context.number.factorization.factors, [2, 7]);
  assert.match(major.render.context.number.factorization.gloss, /Nestor|Aeolus|history|language/i);
  assert.match(major.render.render.form.numericLogic, /rhetoric|print register|birth|language/i);
  assert.match(major.render.render.environment.atmosphere, /Prosaic|civic|human-scale/i);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
