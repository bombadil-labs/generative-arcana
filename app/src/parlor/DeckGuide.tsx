import { useLayoutEffect, useMemo, useRef, useState } from "react";
import type { DeckModule } from "../decks/types";
import { deckIntroduction } from "./deckIntroduction";
import { readSilently } from "./silentReading";

export function DeckIntroduction({ deck }: { deck: DeckModule }) {
  const dialog = useRef<HTMLDivElement>(null), area = useRef<HTMLDivElement>(null);
  const text = useMemo(() => deckIntroduction(deck), [deck]);
  const [page, setPage] = useState("");
  useLayoutEffect(() => {
    dialog.current?.focus({ preventScroll: true });
    const abort = new AbortController();
    void (async () => {
      try { do { await readSilently(text, abort.signal, setPage, area.current); } while (!abort.signal.aborted); }
      catch { if (!abort.signal.aborted) setPage("The deck introduction cannot fit here. Press once to return."); }
    })();
    return () => abort.abort();
  }, [text]);
  return <div className="parlor-deck-introduction" role="dialog" aria-modal="true" aria-labelledby="parlor-introduction-title" tabIndex={-1} ref={dialog}>
    <h2 id="parlor-introduction-title">About this deck</h2>
    <div className="parlor-introduction-text" ref={area}>{page}</div>
    <p className="parlor-introduction-cue">Press once to return. Pages turn automatically.</p>
  </div>;
}
