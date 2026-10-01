/** Historical deck sources stay in the repository, outside all public distributions. */
export const ARCHIVED_DECK_DIRECTORIES = [
  "byrne", "deep-time", "evolution", "finalfantasy", "ultima", "ultima-octave", "ulysses",
] as const;

export function isArchivedDeckModule(path: string): boolean {
  const normalized = path.replace(/\\/g, "/").split(/[?#]/, 1)[0];
  return ARCHIVED_DECK_DIRECTORIES.some((name) => normalized.includes(`/decks/${name}/`))
    || /\/decks\/(?:bundled|composeBundledDeckData)\.[cm]?[jt]s$/.test(normalized);
}

/** Also block stale/source URLs rather than turning them into successful SPA responses. */
export function isArchivedPublicPath(path: string): boolean {
  const normalized = path.replace(/\\/g, "/").replace(/\/+/g, "/");
  return normalized === "/decks" || normalized.startsWith("/decks/")
    || isArchivedDeckModule(normalized)
    || /(?:^|\/)generative-arcana[^/]*\.zip$/i.test(normalized);
}
