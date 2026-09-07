/** Import renderer-independent deck JSON. Registration itself owns validation and canonicalization. */
import { DeckRegistry, deckRegistry } from "./registry";
import type { DeckModule } from "./types";

type Result = { ok: true; deck: DeckModule } | { ok: false; error: string };

/**
 * Parse and register custom deck JSON into the supplied host registry. The browser defaults to the
 * application singleton; MCP/server callers can pass an isolated DeckRegistry instance.
 */
export function loadCustomDeck(jsonText: string, registry: DeckRegistry = deckRegistry): Result {
  let value: unknown;
  try {
    value = JSON.parse(jsonText);
  } catch {
    return { ok: false, error: "That isn't valid JSON." };
  }

  try {
    const deck = registry.registerDeck({ data: value, custom: true }, { replaceExisting: true });
    return { ok: true, deck };
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : "Invalid deck." };
  }
}
