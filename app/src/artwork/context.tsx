import { createContext, useContext, useEffect, useLayoutEffect, useMemo, useSyncExternalStore } from "react";
import { ArtworkStore, EMPTY_ARTWORK } from "./store";
const ArtworkContext = createContext<ArtworkStore | null>(null);
const noSubscribe = () => () => {};
const zero = () => 0;
export function CatalogArtworkProvider({ deckId, deckRevision, children }: { deckId: string; deckRevision: number; children: React.ReactNode }) {
  const store = useMemo(() => new ArtworkStore(deckId, deckRevision), [deckId, deckRevision]);
  useLayoutEffect(() => () => store.clear(), [store]);
  return <ArtworkContext.Provider value={store}>{children}</ArtworkContext.Provider>;
}
export function useArtworkStore(): ArtworkStore | null { return useContext(ArtworkContext); }
export function useArtworkVersion(): number {
  const store = useArtworkStore();
  return useSyncExternalStore(store?.subscribe ?? noSubscribe, store?.getVersion ?? zero, zero);
}
export function useCardArtwork(deckId: string | undefined, cardSlug: string) {
  const store = useArtworkStore();
  useArtworkVersion();
  const matching = store && store.deckId === deckId ? store : null;
  useEffect(() => { void matching?.load(cardSlug); }, [matching, cardSlug]);
  return { state: matching?.get(cardSlug) ?? EMPTY_ARTWORK, fail: () => matching?.fail(cardSlug) };
}
