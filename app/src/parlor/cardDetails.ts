import type { ArcanaReading } from "../engine/types";
import { focusedCard } from "./cardFocus";
import type { State } from "./machine";

const preferenceKey = (account: string) => `arcana:parlor:presentation:v1:${account}`;
export function readDetailsPreference(storage: Pick<Storage, "getItem">, account: string): boolean {
  try { return JSON.parse(storage.getItem(preferenceKey(account)) || "null")?.cardDetails === true; } catch { return false; }
}
export function saveDetailsPreference(storage: Pick<Storage, "setItem">, account: string, enabled: boolean): boolean {
  try { storage.setItem(preferenceKey(account), JSON.stringify({ cardDetails: enabled })); return true; } catch { return false; }
}

/** Extract, never invent or cut a sentence to fit. Long/directive-only scenes
 * are omitted rather than turning a rendering instruction into depicted fact. */
export function authoredSentence(value: string | undefined, limit = 340): string | undefined {
  const text = value?.replace(/\s+/gu, " ").trim();
  if (!text) return;
  const Segmenter = (Intl as unknown as { Segmenter?: new (locale: string, options: { granularity: "sentence" }) => { segment(text: string): Iterable<{ segment: string }> } }).Segmenter;
  const segments = Segmenter ? Array.from(new Segmenter("en", { granularity: "sentence" }).segment(text), item => item.segment.trim()) : text.match(/.*?[.!?](?:["'”’])?(?=\s|$)/gu) || [];
  let sentence = "";
  for (const segment of segments) {
    sentence += (sentence ? " " : "") + segment.trim();
    // ICU can split common honorifics and initials from the rest of a sentence.
    if (!/\b(?:Mr|Mrs|Ms|Dr|Prof|St|Sr|Jr|vs|etc|[A-Z])\.$/u.test(sentence)) break;
  }
  return sentence && sentence.length <= limit && /[.!?]["'”’]?$/u.test(sentence) ? sentence : undefined;
}
export function currentCardDetails(state: Pick<State, "phase" | "revealed" | "segment" | "pendingQuestion" | "reading">) {
  const index = focusedCard(state);
  if (index === null || !state.reading || index >= state.revealed) return null;
  return cardDetails(state.reading, index);
}
function cardDetails(reading: ArcanaReading, index: number) {
  const { card, reversed } = reading.placements[index], data = reading.deck.data;
  const suit = card.suit_slug && data.suits[card.suit_slug]?.name;
  const rank = card.rank_slug && data.ranks[card.rank_slug]?.name;
  const station = data.transversal.stations[card.station_slug]?.name;
  const family = card.arcana === "major" ? "Major Arcana" : suit || undefined;
  let scene = authoredSentence(card.visuals?.detailed_description);
  if (scene && /^(?:render|draw|paint|style|composition|use|avoid|do not|the image should)\b/iu.test(scene)) scene = undefined;
  const upright = card.meaning.upright?.trim() || undefined;
  const inverted = card.meaning.inverted?.trim() || undefined;
  return { slug: card.slug, name: card.name, orientation: reversed ? "Reversed" : "Upright", reversed, family, rank: rank || undefined, station, scene, upright, inverted,
    card, deck: data, deckId: reading.deck.id };
}

/** A labelled authored excerpt, never a generated paraphrase. Prefer a complete
 * sentence; an ellipsis explicitly marks a word-boundary excerpt when necessary. */
export function detailExcerpt(value: string | undefined, limit: number) {
  const text = value?.replace(/\s+/gu, ' ').trim();
  if (!text) return;
  const sentence = authoredSentence(text, limit);
  if (sentence) return sentence;
  if (Array.from(text).length <= limit) return text;
  const prefix = Array.from(text).slice(0, limit - 1).join('');
  const boundary = prefix.lastIndexOf(' ');
  return (boundary > limit / 2 ? prefix.slice(0, boundary) : prefix).trimEnd() + '…';
}

export function detailSummary(details: NonNullable<ReturnType<typeof currentCardDetails>>, level: number) {
  const compact = level > 0, smallest = level > 1, minimal = level > 2;
  return {
    name: detailExcerpt(details.name, minimal ? 24 : smallest ? 40 : compact ? 72 : 100),
    axes: smallest ? undefined : detailExcerpt([details.family, details.rank, details.station].filter(Boolean).join(' · '), compact ? 72 : 120),
    scene: compact ? undefined : detailExcerpt(details.scene, 150),
    upright: detailExcerpt(details.upright, minimal ? 24 : smallest ? 40 : compact ? 80 : 140),
    inverted: detailExcerpt(details.inverted, minimal ? 24 : smallest ? 40 : compact ? 80 : 140),
  };
}
