/**
 * The Ultima Tarot deck — the app's renderer for it. Importing this module:
 *   1. imports the animated visual pack, whose index explicitly owns its card definitions
 *   2. registers the deck manifest into the global deck registry
 *
 * The canonical DATA lives in the top-level corpus (`/decks/ultima/deck.json`, via `@decks`);
 * the card sketches here are this app's *visual pack* for that data, paired by deck id.
 */
import deckJson from "@decks/ultima/deck.json";
import { registerDeck } from "../registry";
import type { DeckDataFile, DeckModule } from "../types";
import type { CardData } from "@/runtime/types";
import { registerPack } from "@/runtime/defineCard";
import "./cards"; // side effect: explicitly registers this deck's definitions under ultima/animated

registerPack("ultima", { id: "animated", label: "Animated", description: "kinetic generative sketches" });

const data = deckJson as unknown as DeckDataFile;

export const ultimaDeck: DeckModule = registerDeck({
  id: "ultima",
  name: data.name,
  tagline: "The Avatar's quest, from Stranger to Codex.",
  data,
  cards: Object.values(data.cards) as CardData[],
  spreads: [
    {
      id: "three-principles",
      name: "The Three Principles",
      description: "Britannia's three roots of virtue — Truth, Love, and Courage — read the matter.",
      deckId: "ultima",
      positions: [
        { name: "Truth", prompt: "what is honestly so; what must be seen clearly" },
        { name: "Love", prompt: "where compassion and connection lie" },
        { name: "Courage", prompt: "what valor the situation asks of you" },
      ],
    },
  ],
});
