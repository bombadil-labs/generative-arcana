import { registerDeck } from "../registry";
import { BUNDLED_DECK_MANIFESTS } from "../bundled";
import "./cards";

export const ultimaOctaveDeck = registerDeck(BUNDLED_DECK_MANIFESTS["ultima-octave"]);
