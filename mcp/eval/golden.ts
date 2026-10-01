import assert from "node:assert/strict";
import { createArcanaAdapter } from "../src/hostStore";
import { FORMER_BUNDLED_DECK_IDS, legacyReadingToken, neutralManifest, TEST_DECK_ID } from "../test/protocol-fixtures";

interface EvalResult { name: string; ok: boolean; error?: string }
const results: EvalResult[] = [];
const adapter = createArcanaAdapter();

await check("default host exposes an empty catalog", async () => {
  assert.deepEqual(await adapter.call("list_decks"), []);
});

await check("removed deck ids and legacy reading links cannot recover bundled content", async () => {
  for (const deckId of FORMER_BUNDLED_DECK_IDS) {
    await assert.rejects(adapter.call("get_deck", { deckId }), /Unknown deck/);
    await assert.rejects(adapter.call("get_card", { deckId, cardSlug: "major-0" }), /Unknown deck/);
    await assert.rejects(adapter.call("cast_reading", { deckId, spread: "single" }), /Unknown deck/);
    await assert.rejects(adapter.call("resolve_reading", { token: legacyReadingToken(deckId) }), /unknown deck/);
  }
});

await check("explicit neutral authoring import is the only available deck", async () => {
  const imported = await adapter.call("import_deck", { manifest: neutralManifest() }) as { id: string; custom: boolean };
  assert.equal(imported.id, TEST_DECK_ID);
  assert.equal(imported.custom, true);
  const decks = await adapter.call("list_decks") as Array<{ id: string; cardCount: number; spreadCount: number }>;
  assert.deepEqual(decks.map((deck) => deck.id), [TEST_DECK_ID]);
  assert.equal(decks[0]?.cardCount, 4);
  assert.ok(decks[0]!.spreadCount > 0);
});

let selectedCardSlug = "";
let selectedStation = "";
let selectedArcana: "major" | "minor" = "major";

await check("card analysis preserves authored symbolic coordinates", async () => {
  const deck = await adapter.call("get_deck", { deckId: TEST_DECK_ID }) as {
    cards: Array<{ slug: string; arcana: "major" | "minor"; station_slug: string }>;
  };
  const card = deck.cards[0];
  assert.ok(card);
  selectedCardSlug = card.slug;
  selectedStation = card.station_slug;
  selectedArcana = card.arcana;
  const analysis = await adapter.call("analyze_card", { deckId: TEST_DECK_ID, cardSlug: card.slug }) as {
    deckId: string;
    card: { slug: string };
    axes: { station: unknown };
  };
  assert.equal(analysis.deckId, TEST_DECK_ID);
  assert.equal(analysis.card.slug, card.slug);
  assert.ok(analysis.axes.station);
});

await check("exact symbolic query returns the analyzed card", async () => {
  const matches = await adapter.call("query_cards", {
    deckId: TEST_DECK_ID,
    query: { arcana: selectedArcana, station: selectedStation },
  }) as Array<{ card: { slug: string } }>;
  assert.ok(matches.some((match) => match.card.slug === selectedCardSlug));
});

await check("generic reading spreads are discoverable", async () => {
  const spreads = await adapter.call("list_spreads", { deckId: TEST_DECK_ID }) as Array<{ id: string }>;
  assert.ok(spreads.some((spread) => spread.id === "single"));
  assert.ok(spreads.some((spread) => spread.id === "three-card"));
});

let token = "";
let castCardSlug = "";
const question = "What pattern is asking for my attention?";

await check("cast reading returns a stable one-card placement", async () => {
  const reading = await adapter.call("cast_reading", {
    deckId: TEST_DECK_ID,
    spread: "single",
    question,
    reversalRate: 0,
  }) as {
    token: string;
    question: string;
    placements: Array<{ card: { slug: string }; reversed: boolean }>;
  };
  token = reading.token;
  assert.ok(token.length > 20);
  assert.equal(reading.question, question);
  assert.equal(reading.placements.length, 1);
  assert.equal(reading.placements[0]?.reversed, false);
  castCardSlug = reading.placements[0]!.card.slug;
});

await check("reading token resolves to the same stable card identity", async () => {
  const resolved = await adapter.call("resolve_reading", { token, deckId: TEST_DECK_ID }) as {
    question: string;
    placements: Array<{ card: { slug: string } }>;
  };
  assert.equal(resolved.question, question);
  assert.equal(resolved.placements[0]?.card.slug, castCardSlug);
});

await check("interpretation context is a projection of the resolved reading", async () => {
  const projected = await adapter.call("interpretation_context", { token, deckId: TEST_DECK_ID }) as { context: string };
  assert.ok(projected.context.includes(question));
  assert.ok(projected.context.length > 100);
});

await check("unknown deck fails explicitly", async () => {
  await assert.rejects(adapter.call("get_deck", { deckId: "does-not-exist" }), /Unknown deck/);
});

await check("invalid numeric query fails explicitly", async () => {
  await assert.rejects(adapter.call("query_cards", { deckId: TEST_DECK_ID, query: { omega: -1 } }), /non-negative integer/);
});

await check("reading cannot be resolved against the wrong routed deck", async () => {
  await assert.rejects(adapter.call("resolve_reading", { token, deckId: "another-route" }), /different deck than the route/);
});

console.log(JSON.stringify({
  suite: "generative-arcana-golden",
  passed: results.filter((result) => result.ok).length,
  failed: results.filter((result) => !result.ok).length,
  results,
}, null, 2));

if (results.some((result) => !result.ok)) process.exitCode = 1;

async function check(name: string, fn: () => Promise<void>): Promise<void> {
  try {
    await fn();
    results.push({ name, ok: true });
  } catch (error) {
    results.push({ name, ok: false, error: error instanceof Error ? error.message : String(error) });
  }
}
