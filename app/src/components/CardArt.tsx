/**
 * <CardArt> — resolves and renders a card's visual for a given deck and selected pack.
 * `prefer` is the selected pack's id; resolveVisual() honors it but falls back per-card to any other
 * pack that has this card (so a partial pack degrades gracefully), or a placeholder if none does.
 *   kit -> <TarotCard>  ·  p5 -> <RawP5Card>  ·  image -> <img>  ·  none -> <CardPlaceholder>
 */
import { TarotCard } from "./TarotCard";
import { RawP5Card } from "./RawP5Card";
import { CardPlaceholder } from "./CardPlaceholder";
import { resolveVisual } from "../runtime/defineCard";
import { useCardArtwork } from "../artwork/context";
import { useEffect, useRef, useState } from "react";
import type { CardData } from "@/runtime/types";
import type { DeckDataFile } from "@/decks/types";

const FILL: React.CSSProperties = { position: "absolute", inset: 0 };

export interface CardArtProps {
  card: CardData;
  /** registry id of the deck (namespaces its visual packs). */
  deckId?: string;
  /** deck data, for the placeholder's glyph/labels when there's no art. */
  deck?: DeckDataFile;
  /** the selected pack's id, preferred during resolution. */
  prefer?: string;
  mode?: "live" | "poster";
  paused?: boolean;
  onSignal?: (name: string, detail?: unknown) => void;
}

export function CardArt({ card, deckId, deck, prefer, mode = "live", paused, onSignal }: CardArtProps) {
  const { state: artwork, pending, fail } = useCardArtwork(deckId, card.slug);
  // The semantic face means "no saved art", not "we have not checked yet".
  if (pending) return <LoadingArtwork name={card.name} />;
  if (artwork.status === "ready") {
    return <SavedArtwork key={`${deckId}/${card.slug}/${artwork.url}`} url={artwork.url} name={card.name} onError={fail} />;
  }
  const visual = deckId ? resolveVisual(deckId, card.slug, prefer) : null;

  if (visual?.kind === "kit") {
    return <TarotCard card={card} sketch={visual.sketch} mode={mode} paused={paused} onSignal={onSignal} style={FILL} />;
  }
  if (visual?.kind === "p5") {
    return <RawP5Card slug={card.slug} code={visual.code} mode={mode} paused={paused} style={FILL} />;
  }
  if (visual?.kind === "image") {
    return <img src={visual.url} alt={card.name} loading="lazy" draggable={false}
      style={{ ...FILL, width: "100%", height: "100%", objectFit: "cover", display: "block" }} />;
  }
  return <CardPlaceholder card={card} deck={deck} />;
}

/** Static, per-card loading state: no animated shimmer and no guessed/stale artwork. */
function LoadingArtwork({ name }: { name: string }) {
  return <div role="img" aria-label={`Loading artwork for ${name}`} aria-busy="true"
    style={{ ...FILL, display: "grid", placeItems: "center", padding: 16, textAlign: "center", background: "var(--paper-2)", color: "var(--ink-3)", font: "400 12px/1.5 var(--font-body)" }}>
    <span aria-hidden="true">Loading artwork…</span>
  </div>;
}

function SavedArtwork({ url, name, onError }: { url: string; name: string; onError: () => void }) {
  const [loaded, setLoaded] = useState(false);
  const image = useRef<HTMLImageElement>(null);
  // A shared blob may already be decoded when another card view mounts.
  useEffect(() => { if (image.current?.complete && image.current.naturalWidth > 0) setLoaded(true); }, [url]);
  return <>
    {!loaded && <LoadingArtwork name={name} />}
    <img ref={image} src={url} alt={`${name} artwork`} onLoad={() => setLoaded(true)} onError={onError}
      aria-hidden={!loaded} loading="lazy" draggable={false}
      style={{ ...FILL, width: "100%", height: "100%", objectFit: "cover", display: "block", opacity: loaded ? 1 : 0 }} />
  </>;
}
