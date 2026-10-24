import type { AxisEntry, DeckModule } from "../decks/types";
import { authoredSentence } from "./cardDetails";

export const DECK_SHORTCUT_NOTE = "Three button presses to learn about the deck, five to reset the reading";
const brief = (text?: string) => authoredSentence(text, 500) || (text && text.length <= 240 ? text : "");
const ordered = <T extends AxisEntry>(entries: Record<string, T>) => Object.entries(entries).sort((a, b) => a[1].index - b[1].index);
const describe = (entry: AxisEntry) => [entry.name, brief(entry.description)].filter(Boolean).join(" — ");

/** Uses the selected deck's authored taxonomy, never the cards in the reading.
 * No special party-deck copy is shipped or inferred for unrelated decks. */
export function deckIntroduction(deck: DeckModule): string {
  const data = deck.data, suits = ordered(data.suits), ranks = ordered(data.ranks);
  const majors = deck.cards.filter(card => card.arcana === "major").length;
  const minors = deck.cards.filter(card => card.arcana === "minor").length;
  const sections = [deck.name, brief(data.theme.description) || deck.tagline];
  if (majors) sections.push([`${majors} Major Arcana`, brief(data.major_arcana.story)].filter(Boolean).join("\n"));
  if (minors) {
    sections.push(`${minors} Minor Arcana${suits.length ? ` · ${suits.length} suits` : ""}\n${suits.slice(0, 24).map(([, suit]) => describe(suit)).join("\n")}${suits.length > 24 ? "\nFurther suits are listed in the deck browser." : ""}`);
    // Recognize the authored year/court structure, not a conventional Tarot assumption.
    const years = ranks.filter(([, rank]) => /^192[0-9]$/u.test(rank.name));
    const courts = ranks.filter(([slug]) => ["ingenue", "daredevil", "host", "magnate"].includes(slug));
    const jazzYears = years.length === 10 && years.every(([, rank], index) => rank.name === String(1920 + index) && rank.numeric_value === index + 1) && courts.length === 4 && ranks.length === 14;
    if (jazzYears) sections.push(`Numbered ranks\n1920–1929: ten years of the decade, in order, replace ranks one through ten.\n\nCourt ranks\n${courts.map(([, court]) => describe(court)).join("\n")}`);
    else if (ranks.length) sections.push(`Ranks\n${ranks.slice(0, 32).map(([, rank]) => rank.name).join(" · ")}${ranks.length > 32 ? "\nFurther ranks are listed in the deck browser." : ""}`);
  }
  return sections.filter(Boolean).join("\n\n");
}
