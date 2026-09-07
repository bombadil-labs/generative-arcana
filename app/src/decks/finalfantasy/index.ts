/**
 * Final Fantasy Tarot — registered for the app.
 *
 * Built with the generative-arcana skill around the recurring FF mythos. Four axes:
 *   suits     — Chocobo / Moogle / Cactuar / Tonberry, a dialectic of Boon↔Bane × Place↔Journey
 *   transversal — "The Elemental Wheel" (8 magicks: Fire/Thunder/Earth/Holy/Ice/Water/Wind/Dark)
 *   majors    — the FF monomyth cast through the prime/composite number axis
 *   ranks     — 14 (10 numbered questions + the Freelancer/Knight/Sage/Warrior of Light court)
 *
 * 78/78 cards; the "Pixel" chibi skin (./cards) gives every card art lit by its element.
 */
import deckJson from "@decks/finalfantasy/deck.json";
import { registerDeck } from "../registry";
import "./cards"; // side effect: registers the "Pixel" chibi visual skin under "finalfantasy"

export const finalFantasyDeck = registerDeck({
  data: deckJson,
  tagline: "Crystals, creatures, and the cycle of light — the recurring myth as a deck.",
});
