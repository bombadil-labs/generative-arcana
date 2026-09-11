import { registerDeck } from "../registry";
import { BUNDLED_DECK_MANIFESTS } from "../bundled";
import "./cards";
import "./scenes";

export const deepTimeDeck = registerDeck(BUNDLED_DECK_MANIFESTS["deep-time"]);
