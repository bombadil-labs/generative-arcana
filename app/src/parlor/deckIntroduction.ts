import type { AxisEntry, DeckModule } from "../decks/types";
import { authoredSentence } from "./cardDetails";

export const DECK_SHORTCUT_NOTE = "Three button presses to learn about the deck, five to reset the reading";
const ordered = <T extends AxisEntry>(entries: Record<string, T>) => Object.entries(entries).sort((a, b) => a[1].index - b[1].index);
// Omit prose without a complete authored summary; never slice a visual prompt.
const brief = (text?: string, limit = 240) => authoredSentence(text, limit) || (text && text.length <= limit ? text : "");
const courtSlugs = ["ingenue", "daredevil", "host", "magnate"];
const partySuits: Record<string, string> = {
  martini: "Pleasure & improvisation", zeppelin: "Engineering & audacity",
  "world-clock": "Empire, markets & law", atom: "Physics & mystery",
};
const partyCourts: Record<string, string> = { ingenue: "Newcomer", daredevil: "Wager", host: "Gathering", magnate: "World-maker" };

/** Three sections independent of the encounter. Party copy is limited to the
 * verified authored taxonomy; other decks use their own descriptions/ranks. */
export function deckIntroduction(deck: DeckModule) {
  const data = deck.data, suits = ordered(data.suits), ranks = ordered(data.ranks);
  const years = ranks.filter(([, rank]) => /^192[0-9]$/u.test(rank.name));
  const courts = ranks.filter(([slug]) => courtSlugs.includes(slug));
  const yearRanks = years.length === 10 && years.every(([, rank], i) => rank.name === String(1920 + i) && rank.numeric_value === i + 1) && courts.length === 4 && ranks.length === 14;
  const party = data.slug === "the-roaring-twenties" && yearRanks && suits.length === 4 && suits.every(([slug]) => Object.prototype.hasOwnProperty.call(partySuits, slug));
  const majors = deck.cards.filter(card => card.arcana === "major");
  const example = (party && majors.find(card => card.slug === "major-17")) || majors[0];
  return {
    name: deck.name,
    intro: party ? "A custom deck crafted for this evening's festivities." : "A guide to the selected deck's themes and structure.",
    theme: brief(data.theme.description) || brief(deck.tagline),
    tagline: party ? brief(deck.tagline, 120) : "",
    majorCount: majors.length,
    majorStory: brief(data.major_arcana.story, 260) || (majors.length ? "These are the deck's major themes and turning points." : "This deck has no Major Arcana."),
    example,
    suits: suits.slice(0, 4).map(([slug, suit]) => ({ slug, name: party ? suit.name.replace(/^The /u, "") : suit.name, description: party ? partySuits[slug] : brief(suit.description, 100), svg: suit.symbol?.svg, icon: party ? slug : undefined })),
    moreSuits: Math.max(0, suits.length - 4),
    ranks: yearRanks ? "1920–1929 replace ranks 1–10: ten years of the decade." : ranks.length ? ranks.slice(0, 14).map(([, rank]) => rank.name).join(" · ") : "No numbered ranks are specified.",
    moreRanks: yearRanks ? 0 : Math.max(0, ranks.length - 14),
    courts: yearRanks ? courts.map(([slug, court]) => ({name: party ? court.name.replace(/^The /u, "") : court.name, description: party ? partyCourts[slug] : brief(court.description, 80)})) : [],
  };
}

export function deckGuideCue(page: number) {
  return page === 2 ? "Press again to finish (Page 3/3)" : `Press again to advance (Page ${page + 1}/3)`;
}
