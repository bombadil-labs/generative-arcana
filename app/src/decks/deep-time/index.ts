/**
 * The Deep Time Tarot — registered for the app.
 *
 * A tarot of geology, designed start-to-finish by Fable (Claude): the Earth as an archive that
 * writes, buries, deforms, and rereads itself. Four axes:
 *   suits       — Vents / Strata / Grains / Faults, a dialectic of Tempo (Sudden↔Gradual) ×
 *                 Vector (Building↔Unmaking)
 *   transversal — "The Rock Cycle" (8 stations: melt → crystallization → uplift → weathering →
 *                 transport → deposition → burial → metamorphism; suit_stride 3)
 *   majors      — the forces of deep time built on the primes (2 Pressure, 3 Heat, 5 Water, 7 Life,
 *                 11 Time, 13 Extinction, 17 The Field, 19 The Sun; composites derived)
 *   ranks       — 14 (10 numbered questions + the Prospector/Surveyor/Reader/Witness court — the
 *                 deck's only human presences: in deep time, people appear in the last instant)
 *
 * 78/78 cards; the "Core Sample" generative skin (./cards) derives an animated p5 sketch for every
 * card from its coordinates — suit sets the form language, rank the composition, station the light,
 * and the prime/composite character whether the forms read singular or factored.
 */
import deckJson from "@decks/deep-time/deck.json";
import { registerDeck } from "../registry";
import type { DeckDataFile, DeckModule } from "../types";
import type { CardData } from "@/runtime/types";
import "./cards"; // side effect: registers the "Core Sample" generative visual skin under "deep-time"

const data = deckJson as unknown as DeckDataFile;

export const deepTimeDeck: DeckModule = registerDeck({
  id: "deep-time",
  name: data.name,
  tagline: "The Earth as an archive that writes itself — a reading is a core sample of the present.",
  data,
  cards: Object.values(data.cards) as CardData[],
  spreads: [
    {
      id: "core-sample",
      name: "The Core Sample",
      description:
        "Five cards read as a drill core, bottom to top: the situation as a stratigraphic column.",
      deckId: "deep-time",
      positions: [
        { name: "The Basement", prompt: "the oldest layer — the foundation nothing negotiates with" },
        { name: "The Buried Bed", prompt: "what was laid down long ago and sealed; still bearing weight" },
        { name: "The Unconformity", prompt: "the gap in the record — what went missing or unspoken" },
        { name: "The Living Surface", prompt: "the layer being deposited right now" },
        { name: "The Weather", prompt: "the force currently working the surface; what erodes or delivers" },
      ],
    },
  ],
});
