import { useState } from "react";
import type { DeckModule } from "../decks/types";
import { useArtworkStore, useArtworkVersion } from "../artwork/context";
import { PackAssetImage } from "../artwork/PackAssetImage";
import { CardArt } from "./CardArt";
import "./deckArtwork.css";

/** A still-life preview only: no draw, reading, storage write, or interactive card. */
export function DeckArtworkStage({ deck }: { deck: DeckModule }) {
  const store = useArtworkStore();
  useArtworkVersion();
  const [sample] = useState(() => Math.floor(Math.random() * 0xffffffff));
  const catalog = store?.deckId === deck.id ? store.currentCatalog : null;
  const available = catalog?.packId ? deck.cards.filter((card) => catalog.cards.some((entry) =>
    entry.slug === card.slug && entry.artwork && entry.artwork.deckRevision === store?.deckRevision &&
    entry.artwork.deckId === deck.id && (entry.artwork.packId ?? "saved-artwork") === catalog.packId)) : [];
  // Stable across rerenders and set round-trips during this mounted visit.
  const card = available.sort((a, b) => score(a.slug, sample) - score(b.slug, sample) || a.slug.localeCompare(b.slug))[0];
  return <div className="deck-artwork-stage" role="img" aria-label={`${deck.name} artwork preview${card ? `, featuring ${card.name}` : ""}`}>
    <div className="deck-artwork-cover">
      <PackAssetImage asset={catalog?.cover} scope={store} alt="" fallback={<DeckEmblem />} />
    </div>
    <div className="deck-artwork-stack">
      <div className="deck-artwork-card deck-artwork-back rear"><DeckEmblem /></div>
      <div className="deck-artwork-card deck-artwork-back middle">
        <PackAssetImage asset={catalog?.cardBack} scope={store} alt="" fallback={<DeckEmblem />} />
      </div>
      <div className="deck-artwork-card deck-artwork-back top">
        <PackAssetImage asset={catalog?.cardBack} scope={store} alt="" fallback={<DeckEmblem />} />
      </div>
      {card && <div className="deck-artwork-card deck-artwork-front" data-sample-slug={card.slug}>
        <CardArt key={`${catalog?.packId}/${card.slug}`} card={card} deckId={deck.id} deck={deck.data} mode="poster" fit="contain" paused />
      </div>}
    </div>
  </div>;
}

function DeckEmblem() {
  return <div className="deck-artwork-emblem"><span>✦</span></div>;
}

// A visit seed ranks stable identities, so shared fronts survive set changes.
function score(slug: string, seed: number): number {
  let hash = seed;
  for (const char of slug) hash = Math.imul(hash ^ char.charCodeAt(0), 16777619);
  return hash >>> 0;
}
