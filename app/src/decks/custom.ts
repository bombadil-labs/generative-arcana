/** Import renderer-independent deck JSON. No registration occurs until validation succeeds. */
import { getDeck, registerDeck } from "./registry";
import { canonicalCards, validateDeck } from "./validate";
import type { DeckModule } from "./types";

type Result = { ok: true; deck: DeckModule } | { ok: false; error: string };

export function loadCustomDeck(jsonText: string): Result {
  let value: unknown;
  try {
    value = JSON.parse(jsonText);
  } catch {
    return { ok: false, error: "That isn't valid JSON." };
  }
  const result = validateDeck(value);
  if (!result.ok) return result;
  const data = result.data;
  const existing = getDeck(data.slug);
  if (existing && !existing.custom) {
    return { ok: false, error: `The slug “${data.slug}” belongs to a bundled deck. Choose a different slug to import a custom version.` };
  }
  const deck = registerDeck({
    id: data.slug,
    name: data.name,
    tagline: firstSentence(data.theme.description) || "A custom deck.",
    data,
    cards: canonicalCards(data),
    custom: true,
  }, { replaceExisting: !!existing });
  return { ok: true, deck };
}

function firstSentence(text: string): string {
  const m = text.match(/^.*?[.!?](\s|$)/);
  return (m ? m[0] : text).trim();
}
