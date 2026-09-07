/** Load portable deck JSON with placeholder faces and full browsing/reading support. */
import { getDeck, registerDeck } from "./registry";
import type { DeckModule } from "./types";
import { MAX_DECK_JSON_LENGTH, orderedCards, validateDeck } from "./validate";

type Result = { ok: true; deck: DeckModule } | { ok: false; error: string };

export function loadCustomDeck(jsonText: string): Result {
  if (jsonText.length > MAX_DECK_JSON_LENGTH) return { ok: false, error: "This deck JSON is too large (maximum 5 million characters)." };
  let parsed: unknown;
  try { parsed = JSON.parse(jsonText); }
  catch { return { ok: false, error: "That isn't valid JSON." }; }
  const result = validateDeck(parsed);
  if (!result.ok) return result;
  const data = result.data;
  // Never replace a bundled deck or another imported revision under its existing route.
  const id = data.slug;
  if (getDeck(id)) return { ok: false, error: `A deck named "${id}" is already loaded. Use a unique deck slug rather than replacing it.` };
  const description = data.theme.description;
  const first = description.match(/^.*?[.!?](\s|$)/);
  const deck = registerDeck({
    id, name: data.name,
    tagline: (first ? first[0] : description).trim() || "A custom deck.",
    data, cards: orderedCards(data), custom: true,
  });
  return { ok: true, deck };
}
