import { registerDeck } from "../registry";
import { BUNDLED_DECK_MANIFESTS } from "../bundled";
import "./cards";

export const byrneDeck = registerDeck(BUNDLED_DECK_MANIFESTS.byrne);
