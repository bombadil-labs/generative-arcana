import assert from "node:assert/strict";
import type { Client } from "@modelcontextprotocol/client";
import type { DeckManifest } from "../../app/src/decks/manifest";
import type { ServerVisualStore } from "../src/staticVisuals";

/** Regression identifiers only: no shipped deck source is loaded by these protocol tests. */
export const FORMER_BUNDLED_DECK_IDS = [
  "byrne-journey-tarot",
  "deep-time",
  "evolution-and-consciousness",
  "final-fantasy-tarot",
  "ultima-octave",
  "ultima-tarot",
  "ulysses-tarot",
] as const;

export const TEST_DECK_ID = "protocol-shapes";

/** Original, deliberately small authored content. This file must remain test-only. */
export function neutralManifest(slug = TEST_DECK_ID): DeckManifest {
  return {
    schemaVersion: 2,
    tagline: "A neutral fixture for protocol tests.",
    data: {
      name: "Protocol Shapes",
      slug,
      version: "1.0.0",
      theme: { name: "Shapes", description: "Simple shapes explore attention and balance.", creator: "Protocol tests" },
      visual_language: { medium: "Ink", surface: "Plain paper", avoid: ["lettering"] },
      minor_number_origin: "rank",
      suits: {
        lines: {
          name: "Lines", index: 0,
          visual_grammar: { composition: "A horizontal field of simple lines." },
        },
      },
      ranks: {
        one: { name: "One", index: 0, numeric_value: 1 },
        four: {
          name: "Four", index: 1, numeric_value: 4,
          visual_content: "Four equal marks.",
          visual_form: { composition_law: "A balanced square." },
        },
      },
      transversal: {
        name: "Attention", description: "One quiet station.",
        stations: {
          still: { name: "Still", index: 0, visual_environment: { palette: "Gray and white." } },
        },
      },
      major_arcana: {
        story: "A shape finds its place.",
        visual_grammar: { composition: "One centered arrangement." },
      },
      cards: {
        "major-0": {
          slug: "major-0", name: "An Open Circle", number: "0", arcana: "major", station_slug: "still",
          meaning: { upright: "Notice the space available.", inverted: "Consider what is overlooked." },
          visuals: { detailed_description: "A single open circle on plain paper." },
        },
        "major-6": {
          slug: "major-6", name: "Two Triangles", number: "6", arcana: "major", station_slug: "still",
          factorization: { character: "composite", factors: [2, 3], gloss: "Two groups of three.", visual_logic: "Pair two triangular groups." },
          meaning: { upright: "Bring separate parts into balance.", inverted: "Check an uneven relationship." },
          visuals: { detailed_description: "Two matching triangles share a center line." },
        },
        "lines-1": {
          slug: "lines-1", name: "First Line", number: "1", arcana: "minor", station_slug: "still", suit_slug: "lines", rank_slug: "one",
          meaning: { upright: "Choose one clear direction.", inverted: "Pause before drawing a boundary." },
          visuals: { detailed_description: "A single straight line on plain paper." },
        },
        "lines-4": {
          slug: "lines-4", name: "Four Lines", number: "4", arcana: "minor", station_slug: "still", suit_slug: "lines", rank_slug: "four",
          meaning: { upright: "Build a useful structure.", inverted: "Leave room for change." },
          visuals: { detailed_description: "Four lines form a simple square." },
        },
      },
    },
  };
}

export function toolResult<T>(response: Awaited<ReturnType<Client["callTool"]>>): T {
  assert.equal(response.isError, undefined, textContent(response));
  const text = response.content.find((part) => part.type === "text");
  assert.ok(text && text.type === "text", "tool response should contain JSON text");
  const value = JSON.parse(text.text) as T;
  assert.deepEqual((response.structuredContent as { result?: unknown } | undefined)?.result, value);
  return value;
}

export function textContent(response: Awaited<ReturnType<Client["callTool"]>>): string {
  return response.content.filter((part) => part.type === "text").map((part) => part.text).join("\n");
}

export function legacyReadingToken(deckId: string): string {
  return Buffer.from(JSON.stringify({ v: 1, d: deckId, s: "single", q: "", c: [[0, 0]] })).toString("base64url");
}

/** Direct identifiers and old reading links must not recover any removed default content. */
export async function assertFormerDecksUnavailable(client: Client): Promise<void> {
  for (const deckId of FORMER_BUNDLED_DECK_IDS) {
    const token = legacyReadingToken(deckId);
    const calls = [
      { name: "get_deck", arguments: { deckId } },
      { name: "get_card", arguments: { deckId, cardSlug: "major-0" } },
      { name: "analyze_card", arguments: { deckId, cardSlug: "major-0" } },
      { name: "query_cards", arguments: { deckId } },
      { name: "list_spreads", arguments: { deckId } },
      { name: "cast_reading", arguments: { deckId, spread: "single" } },
      { name: "list_visual_packs", arguments: { deckId } },
      { name: "get_card_art", arguments: { deckId, cardSlug: "major-0" } },
      { name: "resolve_reading", arguments: { token } },
      { name: "interpretation_context", arguments: { token } },
      { name: "render_reading", arguments: { token } },
    ];
    for (const call of calls) {
      const response = await client.callTool(call);
      assert.equal(response.isError, true, `${call.name} must not expose removed deck ${deckId}`);
      assert.match(textContent(response), /unknown deck/i, `${call.name} must fail because ${deckId} is unavailable`);
      assert.equal(response.content.some((part) => part.type === "image"), false);
    }
  }
}

/** A tiny PNG injected only into an explicitly configured test server, never a default host. */
export function neutralVisualStore(): ServerVisualStore {
  const cardSlugs = new Set(Object.keys(neutralManifest().data.cards));
  const image = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+ip1sAAAAASUVORK5CYII=", "base64");
  return {
    listPacks(deckId) {
      return deckId === TEST_DECK_ID ? [{
        deckId, id: "test-png", label: "Test PNG", renderer: "static-image", mimeType: "image/png", complete: true, cardCount: cardSlugs.size,
      }] : [];
    },
    async loadCardArt(deckId, cardSlug, packId) {
      if (deckId !== TEST_DECK_ID || !cardSlugs.has(cardSlug) || (packId && packId !== "test-png")) return null;
      return { deckId, cardSlug, packId: "test-png", packLabel: "Test PNG", mimeType: "image/png", data: image };
    },
    resolveSpreadScene() { return null; },
  };
}
