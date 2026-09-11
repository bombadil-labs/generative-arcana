import assert from "node:assert/strict";
import { DeckRegistry } from "../../app/src/decks/registry";
import { BUNDLED_DECK_MANIFESTS } from "../../app/src/decks/bundled";
import { ArcanaEngine } from "../../app/src/engine/ArcanaEngine";
import { ArcanaToolAdapter } from "../../app/src/mcp/ArcanaToolAdapter";

async function main(): Promise<void> {
  const registry = new DeckRegistry();
  registry.registerDeck(BUNDLED_DECK_MANIFESTS.byrne);
  const tools = new ArcanaToolAdapter(new ArcanaEngine(registry));

  const minor = await tools.call("get_card", {
    deckId: "byrne-journey-tarot",
    cardSlug: "structures-4",
  }) as any;

  assert.equal(minor.render.deck.version, "2.1.0");
  assert.match(minor.render.render.material.medium, /documentary|film|editorial/i);
  assert.match(minor.render.render.form.familyComposition, /orthographic|grid|architectural/i);
  assert.match(minor.render.render.form.rank.composition_law, /order visibly disrupted/i);
  assert.match(minor.render.render.environment.atmosphere, /breathable|communal|unroofed/i);
  assert.match(minor.render.render.scene.description, /cracks|architectural/i);
  assert.ok(minor.render.render.avoid.includes("glossy celebrity portrait retouching"));
  assert.deepEqual(minor.render.context.dialectic, [
    { axis: "Stance", pole: "Observe" },
    { axis: "Faculty", pole: "Mind" },
  ]);

  const major = await tools.call("get_card", {
    deckId: "byrne-journey-tarot",
    cardSlug: "major-21",
  }) as any;

  assert.match(major.render.context.family.visualGrammar.medium_handling, /David Byrne|documentary/i);
  assert.match(major.render.context.family.visualGrammar.composition, /chronological documentary arc/i);
  assert.equal(major.render.context.number.factorization.character, "composite");
  assert.deepEqual(major.render.context.number.factorization.factors, [3, 7]);
  assert.match(major.render.context.number.factorization.gloss, /Big Country|Once in a Lifetime|participatory/i);
  assert.match(major.render.render.form.numericLogic, /triad|participation|observer/i);
  assert.match(major.render.render.environment.atmosphere, /Interior|hyper-attentive|private/i);
  assert.equal(major.render.context.family.kind, "major");
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
