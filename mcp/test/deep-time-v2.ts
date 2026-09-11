import assert from "node:assert/strict";
import { DeckRegistry } from "../../app/src/decks/registry";
import { BUNDLED_DECK_MANIFESTS } from "../../app/src/decks/bundled";
import { ArcanaEngine } from "../../app/src/engine/ArcanaEngine";
import { ArcanaToolAdapter } from "../../app/src/mcp/ArcanaToolAdapter";

async function main(): Promise<void> {
  const registry = new DeckRegistry();
  registry.registerDeck(BUNDLED_DECK_MANIFESTS["deep-time"]);
  const tools = new ArcanaToolAdapter(new ArcanaEngine(registry));

  const minor = await tools.call("get_card", {
    deckId: "deep-time",
    cardSlug: "faults-five",
  }) as any;

  assert.equal(minor.render.deck.version, "1.1.0");
  assert.match(minor.render.render.material.medium, /geological cross-section/i);
  assert.match(minor.render.render.material.surface, /rock face|core sample/i);
  assert.match(minor.render.render.form.familyComposition, /displaced|slip plane/i);
  assert.equal(minor.render.render.form.rank.composition_law, "Stress reveals the hidden inner structure.");
  assert.match(minor.render.render.legacy.rankContent, /strained|inner structure/i);
  assert.match(minor.render.render.environment.palette, /Warm silt/i);
  assert.match(minor.render.render.scene.description, /pond beds|horizon/i);
  assert.ok(minor.render.render.avoid.includes("generic fantasy landscape painting"));
  assert.deepEqual(minor.render.context.dialectic, [
    { axis: "Tempo", pole: "Sudden" },
    { axis: "Vector", pole: "Unmaking" },
  ]);

  const major = await tools.call("get_card", {
    deckId: "deep-time",
    cardSlug: "major-6",
  }) as any;

  assert.match(major.render.render.form.familyComposition, /cut through the planet/i);
  assert.match(major.render.render.form.numericLogic, /Pressure.*Heat|load axis.*gradient/i);
  assert.match(major.render.context.number.factorization.gloss, /Pressure meets Heat/i);
  assert.match(major.render.render.environment.atmosphere, /sealed|pressurized|airless/i);
  assert.equal(major.render.context.family.kind, "major");
  assert.equal(major.render.context.rank, undefined);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
