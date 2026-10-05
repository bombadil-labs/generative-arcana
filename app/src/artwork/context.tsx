import { createContext, useContext, useEffect, useLayoutEffect, useMemo, useSyncExternalStore } from "react";
import { ArtworkStore, EMPTY_ARTWORK } from "./store";
import { visibleArtworkPacks } from "./selection";
const ArtworkContext = createContext<ArtworkStore | null>(null);
const noSubscribe = () => () => {};
const zero = () => 0;
const preferenceKey = (deckId: string) => `arcana:artwork-set:${deckId}`;
export function getArtworkPackId(deckId: string): string {
  try { return window.localStorage.getItem(preferenceKey(deckId)) || ""; } catch { return ""; }
}
export function setArtworkPackId(deckId: string, packId: string): void {
  try { window.localStorage.setItem(preferenceKey(deckId), packId); } catch { /* selection still works with storage disabled */ }
}
export function CatalogArtworkProvider({ deckId, deckRevision, selectedPackId, children }: { deckId: string; deckRevision: number; selectedPackId?: string; children: React.ReactNode }) {
  const store = useMemo(() => {
    const next = new ArtworkStore(deckId, deckRevision, undefined, getArtworkPackId(deckId));
    if (selectedPackId) next.selectPack(selectedPackId);
    return next;
  }, [deckId, deckRevision, selectedPackId]);
  useLayoutEffect(() => () => store.clear(), [store]);
  return <ArtworkContext.Provider value={store}>{children}</ArtworkContext.Provider>;
}
export function useArtworkStore(): ArtworkStore | null { return useContext(ArtworkContext); }
export function useArtworkVersion(): number {
  const store = useArtworkStore();
  return useSyncExternalStore(store?.subscribe ?? noSubscribe, store?.getVersion ?? zero, zero);
}
/** The same selection drives the browser, editor, card modal, and reading. */
export function useArtworkSelection() {
  const store = useArtworkStore();
  useArtworkVersion();
  const packId = store?.packId;
  useEffect(() => { void store?.loadCatalog().catch(() => {}); }, [store, packId]);
  return store ? {
    packId: store.packId, packs: store.packs, status: store.catalogStatus, error: store.catalogError,
    resolved: store.selectionReady,
    visiblePacks: visibleArtworkPacks(store.packs, store.packId),
    selectPack: (id: string) => { setArtworkPackId(store.deckId, id); store.selectPack(id); },
    refresh: () => { store.clear(); void store.loadCatalog().catch(() => {}); },
  } : null;
}
export function useCardArtwork(deckId: string | undefined, cardSlug: string) {
  const store = useArtworkStore();
  useArtworkVersion();
  const matching = store && store.deckId === deckId ? store : null;
  const state = matching?.get(cardSlug) ?? EMPTY_ARTWORK;
  const packId = matching?.packId;
  useEffect(() => { if (state.status === "idle") void matching?.load(cardSlug); }, [matching, cardSlug, packId, state.status]);
  return {
    state,
    selected: !!matching,
    pending: !!matching && (state.status === "idle" || state.status === "loading"),
    // A late error from a discarded <img> must not evict its newer replacement.
    fail: () => { if (matching?.packId === packId && matching?.get(cardSlug) === state) matching.fail(cardSlug); },
  };
}
