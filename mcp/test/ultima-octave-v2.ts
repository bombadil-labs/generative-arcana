import assert from "node:assert/strict";
import { DeckRegistry } from "../../app/src/decks/registry";
import { BUNDLED_DECK_MANIFESTS } from "../../app/src/decks/bundled";
import { ArcanaEngine } from "../../app/src/engine/ArcanaEngine";
import { ArcanaToolAdapter } from "../../app/src/mcp/ArcanaToolAdapter";

async function main(): Promise<void> {
  const manifest = BUNDLED_DECK_MANIFESTS["ultima-octave"];
  assert.equal(Object.keys(manifest.data.suits).length, 8, "Octave must remain an eight-suit virtue lattice");
  assert.equal(Object.keys(manifest.data.ranks).length, 8, "Octave must remain eight representational rank-octaves");
  assert.equal(Object.keys(manifest.data.cards).length, 86, "Octave must preserve its 8×8 + 22 corpus");

  const registry = new DeckRegistry();
  const deck = registry.registerDeck(manifest);
  assert.equal(deck.data.minor_number_origin, "suit");
  const tools = new ArcanaToolAdapter(new ArcanaEngine(registry));

  const sacrifice = await tools.call("get_card", {
    deckId: "ultima-octave",
    cardSlug: "sacrifice-companion",
  }) as any;

  assert.equal(sacrifice.number, "3");
  assert.equal(sacrifice.render.context.number.factorizationOwner, "suit");
  assert.equal(sacrifice.render.context.number.factorization.character, "prime");
  assert.match(sacrifice.render.context.number.factorization.gloss, /Love and Courage fused|irreducible giving/i);
  assert.match(sacrifice.render.render.form.numericLogic, /arithmetically prime|lattice 011|yellow outward transfer/i);
  assert.match(sacrifice.render.render.material.medium, /graphite|silverpoint|pigment|technical plate/i);
  assert.match(sacrifice.render.render.form.familyComposition, /outward|transfer|donor|receiv/i);
  assert.match(sacrifice.render.context.rank.legacyContent, /named companion|party-member|virtue/i);
  assert.match(sacrifice.render.render.form.rank.composition_law, /Relational character portrait/i);
  assert.match(sacrifice.render.render.environment.illumination, /silver-white|Maximum|lunar/i);
  assert.ok(sacrifice.render.render.avoid.includes("mere hue-swapped copies with identical composition"));

  const honesty = await tools.call("get_card", {
    deckId: "ultima-octave",
    cardSlug: "honesty-word",
  }) as any;
  assert.equal(honesty.render.context.number.factorizationOwner, "suit");
  assert.equal(honesty.render.context.number.factorization.character, "composite");
  assert.deepEqual(honesty.render.context.number.factorization.factors, [2, 2]);
  assert.match(honesty.render.render.form.numericLogic, /single Truth channel|four-square|2²/i);

  const analysis = await tools.call("analyze_card", { deckId: "ultima-octave", cardSlug: "justice-reagent" }) as any;
  assert.equal(analysis.number.factorizationOwner, "suit");
  assert.equal(analysis.number.factorization.character, "composite");
  assert.deepEqual(analysis.number.factorization.factors, [2, 3]);
  assert.match(analysis.number.factorization.gloss, /binary and prime parents disagree/i);

  const major = await tools.call("get_card", {
    deckId: "ultima-octave",
    cardSlug: "major-17",
  }) as any;
  assert.match(major.render.context.family.visualGrammar.medium_handling, /atlas|relic|graphite|silverpoint/i);
  assert.equal(major.render.context.number.factorizationOwner, "card");
  assert.equal(major.render.context.number.factorization.character, "prime");
  assert.match(major.render.context.number.factorization.gloss, /Bell, Book, and Candle|indivisible readiness/i);
  assert.match(major.render.render.form.numericLogic, /three objects|one tightly bound chord|prime/i);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
