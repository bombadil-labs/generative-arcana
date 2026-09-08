import assert from "node:assert/strict";
import { createBundledArcanaAdapter } from "../src/hostStore";

interface EvalResult { name: string; ok: boolean; error?: string }
const results: EvalResult[] = [];
const adapter = createBundledArcanaAdapter();

await check("bundled corpus exposes seven authored decks", async () => {
  const decks = await adapter.call("list_decks") as Array<{ id: string; cardCount: number; spreadCount: number }>;
  assert.equal(decks.length, 7);
  assert.deepEqual(new Set(decks.map((deck) => deck.id)), new Set([
    "byrne-journey-tarot",
    "deep-time",
    "evolution-and-consciousness",
    "final-fantasy-tarot",
    "ultima-octave",
    "ultima-tarot",
    "ulysses-tarot",
  ]));
  assert.ok(decks.every((deck) => deck.cardCount > 0 && deck.spreadCount > 0));
});

let selectedCardSlug = "";
let selectedStation = "";
let selectedArcana: "major" | "minor" = "major";

await check("card analysis preserves authored symbolic coordinates", async () => {
  const deck = await adapter.call("get_deck", { deckId: "deep-time" }) as {
    cards: Array<{ slug: string; arcana: "major" | "minor"; station_slug: string }>;
  };
  const card = deck.cards[0];
  assert.ok(card);
  selectedCardSlug = card.slug;
  selectedStation = card.station_slug;
  selectedArcana = card.arcana;
  const analysis = await adapter.call("analyze_card", { deckId: "deep-time", cardSlug: card.slug }) as {
    deckId: string;
    card: { slug: string };
    axes: { station: unknown };
  };
  assert.equal(analysis.deckId, "deep-time");
  assert.equal(analysis.card.slug, card.slug);
  assert.ok(analysis.axes.station);
});

await check("exact symbolic query returns the analyzed card", async () => {
  const matches = await adapter.call("query_cards", {
    deckId: "deep-time",
    query: { arcana: selectedArcana, station: selectedStation },
  }) as Array<{ card: { slug: string } }>;
  assert.ok(matches.some((match) => match.card.slug === selectedCardSlug));
});

await check("generic reading spreads are discoverable", async () => {
  const spreads = await adapter.call("list_spreads", { deckId: "deep-time" }) as Array<{ id: string }>;
  assert.ok(spreads.some((spread) => spread.id === "single"));
  assert.ok(spreads.some((spread) => spread.id === "three-card"));
});

let token = "";
let castCardSlug = "";
const question = "What pattern is asking for my attention?";

await check("cast reading returns a stable one-card placement", async () => {
  const reading = await adapter.call("cast_reading", {
    deckId: "deep-time",
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
  const resolved = await adapter.call("resolve_reading", { token, deckId: "deep-time" }) as {
    question: string;
    placements: Array<{ card: { slug: string } }>;
  };
  assert.equal(resolved.question, question);
  assert.equal(resolved.placements[0]?.card.slug, castCardSlug);
});

await check("interpretation context is a projection of the resolved reading", async () => {
  const projected = await adapter.call("interpretation_context", { token, deckId: "deep-time" }) as { context: string };
  assert.ok(projected.context.includes(question));
  assert.ok(projected.context.length > 100);
});

await check("unknown deck fails explicitly", async () => {
  await assert.rejects(adapter.call("get_deck", { deckId: "does-not-exist" }), /Unknown deck/);
});

await check("invalid numeric query fails explicitly", async () => {
  await assert.rejects(adapter.call("query_cards", { deckId: "deep-time", query: { omega: -1 } }), /non-negative integer/);
});

await check("reading cannot be resolved against the wrong routed deck", async () => {
  await assert.rejects(adapter.call("resolve_reading", { token, deckId: "ultima-tarot" }), /different deck than the route/);
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
