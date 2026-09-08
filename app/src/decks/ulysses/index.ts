import { registerDeck } from "../registry";
import { BUNDLED_DECK_MANIFESTS } from "../bundled";
import "./cards";

export const ulyssesDeck = registerDeck(BUNDLED_DECK_MANIFESTS.ulysses);
