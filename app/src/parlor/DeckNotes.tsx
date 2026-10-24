import { useLayoutEffect, useRef, useState } from "react";
import { readSilently } from "./silentReading";
import type { currentCardDetails } from "./cardDetails";
import { detailPageRuns } from './cardDetails';

/** Static authored deck notes, independent of the spirit's generated captions.
 * Small panels cycle measured pages; this cannot advance the encounter. */
export function CardDetails({ details }: { details: NonNullable<ReturnType<typeof currentCardDetails>> }) {
  const area = useRef<HTMLDivElement>(null);
  const [page, setPage] = useState({text:'',start:0,failed:false});
  useLayoutEffect(() => {
    const abort = new AbortController(); setPage({text:'',start:0,failed:false});
    void (async () => {
      try {
        do { await readSilently(details.text, abort.signal, (text,start)=>setPage({text,start,failed:false}), area.current); } while (!abort.signal.aborted);
      } catch { if (!abort.signal.aborted) setPage({text:'Deck notes unavailable at this display size.',start:0,failed:true}); }
    })();
    return () => abort.abort();
  }, [details.text]);
  const runs = detailPageRuns(details.sections,page.start,Array.from(page.text).length);
  const kinds = new Set(runs.map(run=>run.kind).filter(kind=>kind!=='context'));
  const section = kinds.size>1 ? 'Both meanings' : kinds.has('upright') ? 'Upright meaning' : kinds.has('reversed') ? 'Reversed meaning' : 'Deck notes';
  return <aside className="parlor-card-details" aria-label="Current card deck notes" data-card={details.slug} data-orientation={details.orientation}>
    <div className="parlor-details-heading">Drawn: {details.orientation}<span className="parlor-details-section">{section}</span></div>
    <div className="parlor-details-text" ref={area}>{page.failed ? page.text : runs.map(run=><span key={run.index} data-meaning={run.kind==='context'?undefined:run.kind} className={run.active===false?'parlor-meaning-secondary':run.active?'parlor-meaning-drawn':undefined}>{run.text}</span>)}</div>
  </aside>;
}
