import { useLayoutEffect, useRef, useState } from "react";
import { readSilently } from "./silentReading";
import type { currentCardDetails } from "./cardDetails";

/** Static authored deck notes, independent of the spirit's generated captions.
 * Small panels cycle measured pages; this cannot advance the encounter. */
export function CardDetails({ details }: { details: NonNullable<ReturnType<typeof currentCardDetails>> }) {
  const area = useRef<HTMLDivElement>(null);
  const [page, setPage] = useState("");
  useLayoutEffect(() => {
    const abort = new AbortController(); setPage("");
    void (async () => {
      try {
        do { await readSilently(details.text, abort.signal, setPage, area.current); } while (!abort.signal.aborted);
      } catch { if (!abort.signal.aborted) setPage("Deck notes unavailable at this display size."); }
    })();
    return () => abort.abort();
  }, [details.text]);
  return <aside className="parlor-card-details" aria-label="Current card deck notes" data-card={details.slug}>
    <div className="parlor-details-heading">Deck notes · {details.orientation}</div>
    <div className="parlor-details-text" ref={area}>{page}</div>
  </aside>;
}
