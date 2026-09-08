import { registerDeck } from "../registry";
import { BUNDLED_DECK_MANIFESTS } from "../bundled";
import "./cards";

export const finalFantasyDeck = registerDeck(BUNDLED_DECK_MANIFESTS.finalfantasy);
