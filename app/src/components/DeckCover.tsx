import { useEffect, useState } from "react";
import { useBrowserSession, type BrowserSessionState } from "../auth/session";
import { ArtworkApiError, DEFAULT_ARTWORK_PACK_ID, getReadableArtwork, type PackArtworkAsset } from "../artwork/api";
import { getArtworkPackId, useArtworkSelection, useArtworkStore } from "../artwork/context";
import { resolveArtworkPack } from "../artwork/selection";
import { PackAssetImage } from "../artwork/PackAssetImage";

type CoverState = { deckId: string; revision?: number; selected: string; session: BrowserSessionState; asset: PackArtworkAsset | null };
/** A cover belongs to the chosen set. No first-card or other-set fallback is allowed. */
export function DeckCover({ deckId, deckRevision, name, fallback }: { deckId: string; deckRevision?: number; name: string; fallback: React.ReactNode }) {
  const { session } = useBrowserSession();
  const store = useArtworkStore();
  const selection = useArtworkSelection();
  const sharedSelection = store?.deckId === deckId ? selection : null;
  const selected = sharedSelection?.packId ?? getArtworkPackId(deckId);
  const ready = !sharedSelection || sharedSelection.resolved;
  const [cover, setCover] = useState<CoverState | null>(null);
  const current = ready && cover?.deckId === deckId && cover.revision === deckRevision && cover.selected === selected && cover.session === session ? cover.asset : null;
  const hasSharedSelection = !!sharedSelection;
  useEffect(() => {
    const controller = new AbortController();
    if (!ready || (hasSharedSelection && !selected) || session.status === "loading") return () => controller.abort();
    const read = (packId: string) => getReadableArtwork(deckId, controller.signal, packId === DEFAULT_ARTWORK_PACK_ID ? undefined : packId);
    void (async () => {
      let catalog;
      try { catalog = await read(selected || DEFAULT_ARTWORK_PACK_ID); }
      catch (error) {
        if (hasSharedSelection || !selected || selected === DEFAULT_ARTWORK_PACK_ID || !(error instanceof ArtworkApiError) || (error.status !== 400 && error.status !== 404)) throw error;
        catalog = await read(DEFAULT_ARTWORK_PACK_ID);
      }
      if (controller.signal.aborted) return;
      const packId = hasSharedSelection ? selected : resolveArtworkPack(catalog.packs, selected);
      if (packId && packId !== catalog.packId) catalog = await read(packId);
      if (controller.signal.aborted) return;
      const asset = packId && (deckRevision === undefined || catalog.deckRevision === deckRevision) ? catalog.cover ?? null : null;
      setCover({ deckId, revision: deckRevision, selected, session, asset });
    })().catch(() => { if (!controller.signal.aborted) setCover({ deckId, revision: deckRevision, selected, session, asset: null }); });
    return () => controller.abort();
  }, [deckId, deckRevision, selected, ready, hasSharedSelection, session]);
  return <PackAssetImage asset={current} scope={session} alt={`${name} cover`} fallback={fallback} />;
}
