import ultimaJson from "../../../decks/ultima/deck.json";
import byrneJson from "../../../decks/byrne/deck.json";
import ulyssesJson from "../../../decks/ulysses/deck.json";
import finalFantasyJson from "../../../decks/finalfantasy/deck.json";
import evolutionJson from "../../../decks/evolution/deck.json";
import ultimaOctaveJson from "../../../decks/ultima-octave/deck.json";
import deepTimeJson from "../../../decks/deep-time/deck.json";
import { DeckRegistry, deckRegistry } from "./registry";

export const BUNDLED_DECK_MANIFESTS = {
  ultima: {
    data: ultimaJson,
    tagline: "The Avatar's quest, from Stranger to Codex.",
    spreads: [
      {
        id: "three-principles",
        name: "The Three Principles",
        description: "Britannia's three roots of virtue — Truth, Love, and Courage — read the matter.",
        positions: [
          { name: "Truth", prompt: "what is honestly so; what must be seen clearly" },
          { name: "Love", prompt: "where compassion and connection lie" },
          { name: "Courage", prompt: "what valor the situation asks of you" },
        ],
      },
    ],
  },
  byrne: {
    data: byrneJson,
    tagline: "David Byrne's journey, from nervous art to embodied communion.",
  },
  ulysses: {
    data: ulyssesJson,
    tagline: "One Dublin day as odyssey — wisdom in one's relationship to the ordinary.",
  },
  finalfantasy: {
    data: finalFantasyJson,
    tagline: "Crystals, creatures, and the cycle of light — the recurring myth as a deck.",
  },
  evolution: {
    data: evolutionJson,
    tagline: "How speech bootstraps consciousness — Dewart's involution as a deck.",
  },
  "ultima-octave": {
    data: ultimaOctaveJson,
    tagline: "Eight virtues, eight octaves — Garriott's colour-cube of virtue as a lattice deck.",
  },
  "deep-time": {
    data: deepTimeJson,
    tagline: "The Earth as an archive that writes itself — a reading is a core sample of the present.",
    spreads: [
      {
        id: "core-sample",
        name: "The Core Sample",
        description: "Five cards read as a drill core, bottom to top: the situation as a stratigraphic column.",
        positions: [
          { name: "The Basement", prompt: "the oldest layer — the foundation nothing negotiates with" },
          { name: "The Buried Bed", prompt: "what was laid down long ago and sealed; still bearing weight" },
          { name: "The Unconformity", prompt: "the gap in the record — what went missing or unspoken" },
          { name: "The Living Surface", prompt: "the layer being deposited right now" },
          { name: "The Weather", prompt: "the force currently working the surface; what erodes or delivers" },
        ],
      },
    ],
  },
};

export type BundledDeckId = keyof typeof BUNDLED_DECK_MANIFESTS;

/** Register the shipped symbolic corpus without importing any browser visual packs. */
export function registerBundledDecks(registry: DeckRegistry = deckRegistry) {
  return Object.values(BUNDLED_DECK_MANIFESTS).map((manifest) => registry.registerDeck(manifest));
}
