import { registerDeck } from "../registry";
import { BUNDLED_DECK_MANIFESTS } from "../bundled";
import "./cards";

export const evolutionDeck = registerDeck(BUNDLED_DECK_MANIFESTS.evolution);
