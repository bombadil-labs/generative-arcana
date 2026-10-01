/**
 * Side-effect-free deck domain surface.
 * The public app starts with an empty registry; decks enter through user imports or the catalog.
 * Historical deck modules remain in source, but must not be imported by the public runtime.
 */
export * from "./registry";
export * from "./manifest";
export * from "./authoring";
export * from "./renderSpec";
export type { DeckVisibility, UserDeckManifest, UserDeckRecord } from "./catalog";
export type {
  DeckModule,
  DeckDataFile,
  DeckVisualLanguage,
  VisualFamilyGrammar,
  RankVisualForm,
  StationVisualEnvironment,
} from "./types";
