import assert from "node:assert/strict";
import { summarizeToolResult, toolResult } from "../src/toolResult";

for (const value of [{ name: "Deck", nested: { cards: [1, 2, 3] } }, [], "hello", null]) {
  const response = toolResult(value);
  assert.deepEqual(JSON.parse(response.content[0].text), value, "text-only hosts keep the whole parseable result");
  assert.deepEqual(response.structuredContent, { result: value });
  assert.equal(response.content[0].text, JSON.stringify(value), "JSON text has no pretty-printing overhead");
  assert.deepEqual(toolResult(value, { responseFormat: "json" }), response);
}

const value = { name: "Example deck", cardCount: 78, payload: "x".repeat(10_000) };
const summary = summarizeToolResult("get_deck", value);
const structured = toolResult(value, { responseFormat: "structured", summary });
assert.deepEqual(structured.structuredContent.result, value);
assert.equal(structured.content.length, 1);
assert.equal(structured.content[0].text, summary);
assert.match(summary, /Example deck \(78 cards\)/);
assert.ok(!structured.content[0].text.includes(value.payload));
assert.ok(JSON.stringify(structured).length < JSON.stringify(toolResult(value)).length * 0.6,
  "structured mode sends the full payload once rather than twice");
assert.throws(() => toolResult(value, { responseFormat: "structured" }), /summary/);
assert.throws(() => toolResult(value, { responseFormat: "structured", summary: " " }), /summary/);
assert.throws(() => toolResult(undefined), /JSON-serializable/);
assert.throws(() => toolResult(value, { responseFormat: "invalid" as "json" }), /responseFormat/);

assert.match(summarizeToolResult("query_cards", [1, 2]), /2 matching cards/);
assert.match(summarizeToolResult("get_deck", { schemaVersion: 2, data: { name: "Manifest", cards: { a: {}, b: {} } } }), /Manifest \(2 cards\)/);
assert.match(summarizeToolResult("get_deck", { summary: { name: "Structure", cardCount: 2 }, data: {} }), /Structure \(2 cards\)/);
assert.match(summarizeToolResult("validate_deck_manifest", { valid: false, error: "tagline is required" }), /invalid: tagline is required/);
assert.match(summarizeToolResult("validate_deck_manifest", { valid: true, summary: { name: "Valid", cardCount: 2 } }), /valid: Valid \(2 cards\)/);
assert.match(summarizeToolResult("get_deck_authoring_spec", { schema: { current: 2 } }), /schema version 2/);
assert.match(summarizeToolResult("get_card", { name: "Card", slug: "card" }), /Card: Card/);
assert.match(summarizeToolResult("analyze_card", { card: { name: "Card" } }), /Full analysis/);
assert.match(summarizeToolResult("cast_reading", { deckName: "Example", placements: [1, 2] }), /Example: 2 placements/);
assert.match(summarizeToolResult("interpretation_context", { deckId: "example" }), /context for example/);
assert.ok(summarizeToolResult("get_deck", { name: "x".repeat(1_000) }).length < 250, "summaries bound authored labels");

console.log("Compact and backward-compatible MCP result tests passed.");
