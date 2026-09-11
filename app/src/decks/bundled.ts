import ultimaJson from "../../../decks/ultima/deck.json";
import ultimaVisualLanguage from "../../../decks/ultima/v2/visual-language.json";
import ultimaSuits from "../../../decks/ultima/v2/suits.json";
import ultimaRanks from "../../../decks/ultima/v2/ranks.json";
import ultimaStations from "../../../decks/ultima/v2/stations.json";
import ultimaMajorArcana from "../../../decks/ultima/v2/major-arcana.json";
import byrneJson from "../../../decks/byrne/deck.json";
import byrneVisualLanguage from "../../../decks/byrne/v2/visual-language.json";
import byrneSuits from "../../../decks/byrne/v2/suits.json";
import byrneRanks from "../../../decks/byrne/v2/ranks.json";
import byrneStations from "../../../decks/byrne/v2/stations.json";
import byrneMajorArcana from "../../../decks/byrne/v2/major-arcana.json";
import ulyssesJson from "../../../decks/ulysses/deck.json";
import finalFantasyJson from "../../../decks/finalfantasy/deck.json";
import finalFantasyVisualLanguage from "../../../decks/finalfantasy/v2/visual-language.json";
import finalFantasySuits from "../../../decks/finalfantasy/v2/suits.json";
import finalFantasyRanks from "../../../decks/finalfantasy/v2/ranks.json";
import finalFantasyStations from "../../../decks/finalfantasy/v2/stations.json";
import finalFantasyMajorArcana from "../../../decks/finalfantasy/v2/major-arcana.json";
import evolutionJson from "../../../decks/evolution/deck.json";
import evolutionVisualLanguage from "../../../decks/evolution/v2/visual-language.json";
import evolutionSuits from "../../../decks/evolution/v2/suits.json";
import evolutionRanks from "../../../decks/evolution/v2/ranks.json";
import evolutionStations from "../../../decks/evolution/v2/stations.json";
import evolutionMajorArcana from "../../../decks/evolution/v2/major-arcana.json";
import ultimaOctaveJson from "../../../decks/ultima-octave/deck.json";
import deepTimeJson from "../../../decks/deep-time/deck.json";
import deepTimeVisualLanguage from "../../../decks/deep-time/v2/visual-language.json";
import deepTimeSuits from "../../../decks/deep-time/v2/suits.json";
import deepTimeRanks from "../../../decks/deep-time/v2/ranks.json";
import deepTimeStations from "../../../decks/deep-time/v2/stations.json";
import deepTimeMajorArcana from "../../../decks/deep-time/v2/major-arcana.json";
import { composeBundledDeckData } from "./composeBundledDeckData";
import { DeckRegistry, deckRegistry } from "./registry";

const ultimaV2 = composeBundledDeckData(
  ultimaJson,
  ultimaVisualLanguage,
  ultimaSuits,
  ultimaRanks,
  ultimaStations,
  ultimaMajorArcana,
);

const byrneV2 = composeBundledDeckData(
  byrneJson,
  byrneVisualLanguage,
  byrneSuits,
  byrneRanks,
  byrneStations,
  byrneMajorArcana,
);

const finalFantasyV2 = composeBundledDeckData(
  finalFantasyJson,
  finalFantasyVisualLanguage,
  finalFantasySuits,
  finalFantasyRanks,
  finalFantasyStations,
  finalFantasyMajorArcana,
);

const deepTimeV2 = composeBundledDeckData(
  deepTimeJson,
  deepTimeVisualLanguage,
  deepTimeSuits,
  deepTimeRanks,
  deepTimeStations,
  deepTimeMajorArcana,
);

const evolutionV2 = composeBundledDeckData(
  evolutionJson,
  evolutionVisualLanguage,
  evolutionSuits,
  evolutionRanks,
  evolutionStations,
  evolutionMajorArcana,
);

export const BUNDLED_DECK_MANIFESTS = {
  ultima: {
    data: ultimaV2,
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
    data: byrneV2,
    tagline: "David Byrne's journey, from nervous art to embodied communion.",
  },
  ulysses: {
    data: ulyssesJson,
    tagline: "One Dublin day as odyssey — wisdom in one's relationship to the ordinary.",
  },
  finalfantasy: {
    data: finalFantasyV2,
    tagline: "Crystals, creatures, and the cycle of light — the recurring myth as a deck.",
  },
  evolution: {
    data: evolutionV2,
    tagline: "How speech bootstraps consciousness — Dewart's involution as a deck.",
  },
  "ultima-octave": {
    data: ultimaOctaveJson,
    tagline: "Eight virtues, eight octaves — Garriott's colour-cube of virtue as a lattice deck.",
  },
  "deep-time": {
    data: deepTimeV2,
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
