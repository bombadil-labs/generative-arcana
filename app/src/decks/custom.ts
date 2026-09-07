/** Import renderer-independent deck JSON. Registration itself owns validation and canonicalization. */
import { registerDeck } from "./registry";
import type { DeckModule } from "./types";

type Result = { ok: true; deck: DeckModule } | { ok: false; error: string };

export function loadCustomDeck(jsonText: string): Result {
  let value: unknown;
  try {
    value = JSON.parse(jsonText);
  } catch {
    return { ok: false, error: "That isn't valid JSON." };
  }

  try {
    const deck = registerDeck({ data: value, custom: true }, { replaceExisting: true });
    return { ok: true, deck };
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : "Invalid deck." };
  }
}
