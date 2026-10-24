import { useLayoutEffect, useMemo, useRef } from "react";
import type { DeckModule } from "../decks/types";
import { useCardArtwork } from "../artwork/context";
import { Svg } from "../components/cardMeta";
import { deckGuideCue, deckIntroduction } from "./deckIntroduction";

function SuitIcon({ icon, svg }: { icon?: string; svg?: string }) {
  if (svg) return <Svg svg={svg} size={30} />;
  if (!icon) return null;
  return <svg className="parlor-guide-icon" viewBox="0 0 48 48" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="2.5">
    {icon === "martini" && <><path d="M7 9h34L24 27 7 9ZM24 27v13M14 40h20" /><path d="m28 4-8 17" /></>}
    {icon === "zeppelin" && <><ellipse cx="24" cy="20" rx="20" ry="10" /><path d="M4 20h40M12 13c10 8 14 8 25 0M17 30l4 7h9l3-8M5 16l-3-4M5 24l-3 5" /></>}
    {icon === "world-clock" && <><circle cx="24" cy="24" r="19" /><path d="M24 9v15l10 6M24 5v4M24 39v4M5 24h4M39 24h4" /></>}
    {icon === "atom" && <><ellipse cx="24" cy="24" rx="21" ry="8" /><ellipse cx="24" cy="24" rx="21" ry="8" transform="rotate(60 24 24)" /><ellipse cx="24" cy="24" rx="21" ry="8" transform="rotate(120 24 24)" /><circle cx="24" cy="24" r="3" fill="currentColor" /></>}
  </svg>;
}

function GuideArtwork({ deck, slug, name }: { deck: DeckModule; slug: string; name: string }) {
  const { state, fail } = useCardArtwork(deck.id, slug);
  return <figure className="parlor-guide-art">
    {state.status === "ready" ? <img src={state.url} alt={`${name}, a deck example independent of this reading`} onError={fail} /> : <p>{state.status === "loading" || state.status === "idle" ? "Loading deck example…" : "Artwork unavailable."}</p>}
    <figcaption>{name}<small>Deck example · not a draw</small></figcaption>
  </figure>;
}

/** Three deliberate pages; no presentation timers, automatic rotation or draws. */
export function DeckIntroduction({ deck, page }: { deck: DeckModule; page: number }) {
  const dialog = useRef<HTMLDivElement>(null);
  const guide = useMemo(() => deckIntroduction(deck), [deck]);
  useLayoutEffect(() => { dialog.current?.focus({ preventScroll: true }); }, []);
  return <div className="parlor-deck-introduction" data-guide-page={page + 1} role="dialog" aria-modal="true" aria-labelledby="parlor-introduction-title" tabIndex={-1} ref={dialog}>
    <h2 id="parlor-introduction-title">{page === 0 ? guide.name : page === 1 ? "The Major Arcana" : "The Minor Arcana"}</h2>
    <div className={`parlor-introduction-text parlor-guide-page-${page + 1}`}>
      {page === 0 && <div className="parlor-guide-welcome"><p>{guide.intro}</p><p>{guide.theme}</p>{guide.tagline && <p className="parlor-guide-tagline">{guide.tagline}</p>}</div>}
      {page === 1 && <><div className="parlor-guide-major-copy"><p>{guide.majorCount ? `${guide.majorCount} major visions` : "The major themes"}</p><p>{guide.majorStory}</p></div>{guide.example && <GuideArtwork deck={deck} slug={guide.example.slug} name={guide.example.name} />}</>}
      {page === 2 && <><div className="parlor-guide-suits">{guide.suits.map(suit => <div className="parlor-guide-suit" key={suit.slug}><SuitIcon icon={suit.icon} svg={suit.svg} /><div><strong>{suit.name}</strong>{suit.description && <p>{suit.description}</p>}</div></div>)}{!guide.suits.length && <p>No suits are specified.</p>}{guide.moreSuits > 0 && <p>{guide.moreSuits} more suits in the deck browser.</p>}</div><div className="parlor-guide-ranks"><h3>{guide.courts.length ? "The years" : "The ranks"}</h3><p>{guide.ranks}</p>{guide.moreRanks > 0 && <p>{guide.moreRanks} more ranks in the deck browser.</p>}{guide.courts.length > 0 && <><h3>The court: four roles</h3><dl>{guide.courts.map(court => <div key={court.name}><dt>{court.name}</dt><dd>{court.description}</dd></div>)}</dl></>}</div></>}
    </div>
    <p className="parlor-introduction-cue">{deckGuideCue(page)}</p>
  </div>;
}
