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
  const upright = card.meaning.upright?.replace(/\s+/gu, " ").trim() || undefined;
  const inverted = card.meaning.inverted?.replace(/\s+/gu, " ").trim() || undefined;
  const meaning = reversed ? inverted : upright;
  const axes = [family, rank && `Rank: ${rank}`, station && `${data.transversal.name || "Station"}: ${station}`].filter(Boolean).join(" · ");
  const sections: DetailSection[] = [{kind:'context',text:[card.name, axes, scene && `Scene: ${scene}`].filter(Boolean).join('\n\n')}];
  if (upright) sections.push({kind:'upright',active:!reversed,text:`Upright meaning (${!reversed?'drawn':'not drawn'}):\n${upright}`});
  if (inverted) sections.push({kind:'reversed',active:reversed,text:`Reversed meaning (${reversed?'drawn':'not drawn'}):\n${inverted}`});
  return { slug: card.slug, name: card.name, orientation: reversed ? "Reversed" : "Upright", family, rank: rank || undefined, station, scene, meaning, sections,
    text: sections.map(section=>section.text).join('\n\n') };
}

export interface DetailSection { kind: 'context' | 'upright' | 'reversed'; text: string; active?: boolean }
/** Offsets are Unicode code points, matching measured paging. No text search or
 * label guessing: identical/repeated meanings still receive the correct style. */
export function detailPageRuns(sections: DetailSection[], start: number, length: number) {
  let offset = 0;
  return sections.flatMap((section,index)=>{
    const chars = Array.from(section.text + (index < sections.length-1 ? '\n\n' : ''));
    const from = Math.max(0,start-offset), to = Math.min(chars.length,start+length-offset); offset += chars.length;
    return to>from ? [{...section,text:chars.slice(from,to).join(''),index}] : [];
  });
}
