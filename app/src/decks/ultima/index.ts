import { registerDeck } from "../registry";
import { BUNDLED_DECK_MANIFESTS } from "../bundled";
import { registerPack } from "@/runtime/defineCard";
import "./cards";

registerPack("ultima", { id: "animated", label: "Animated", description: "kinetic generative sketches" });
export const ultimaDeck = registerDeck(BUNDLED_DECK_MANIFESTS.ultima);
