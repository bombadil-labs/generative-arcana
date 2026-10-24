import { useLayoutEffect, useRef, useState } from "react";
import { CardArt } from "../components/CardArt";
import { detailSummary, type currentCardDetails } from "./cardDetails";

/** Static authored excerpts, separate from synchronized narration. The image is
 * laid out at its actual display size rather than enlarged through the spread's
 * 3D card transform. It shares the existing selected-pack asset cache. */
export function CardDetails({ details }: { details: NonNullable<ReturnType<typeof currentCardDetails>> }) {
  const box = useRef<HTMLDivElement>(null), notes = useRef<HTMLElement>(null);
  const dimensions = useRef('');
  const [level, setLevel] = useState(0);
  const summary = detailSummary(details, level);
  useLayoutEffect(() => {
    const measure = () => {
      const area = box.current, text = notes.current;
      if (!area || !text) return;
      const key = `${area.clientWidth}:${area.clientHeight}`;
      if (dimensions.current !== key) {
        dimensions.current = key;
        const initial = area.clientWidth < 600 || area.clientHeight < 300 ? 1 : 0;
        if (initial !== level) { setLevel(initial); return; }
      }
      if (level < 3 && (area.scrollHeight > area.clientHeight + 1 || text.scrollHeight > text.clientHeight + 1 || text.scrollWidth > text.clientWidth + 1)) setLevel(level + 1);
    };
    measure();
    const observer = typeof ResizeObserver === "undefined" ? undefined : new ResizeObserver(measure); if (box.current) observer?.observe(box.current);
    let active = true; void document.fonts?.ready.then(() => { if (active) measure(); });
    return () => { active = false; observer?.disconnect(); };
  }, [details, level]);
  return <div className="parlor-details-lightbox" ref={box} data-detail-level={level}>
    <div className="parlor-lightbox-art" style={{ transform: details.reversed ? "rotate(180deg)" : undefined }}>
      <CardArt card={details.card} deckId={details.deckId} deck={details.deck} mode="poster" fit="contain" />
    </div>
    <aside className="parlor-card-details" ref={notes} aria-label="Current card deck notes" data-card={details.slug} data-orientation={details.orientation}>
      <strong className="parlor-details-name">{summary.name}</strong>
      {summary.axes && <p className="parlor-details-axes">{summary.axes}</p>}
      {summary.scene && <p className="parlor-details-scene">{summary.scene}</p>}
      <div className="parlor-details-meanings">
        <section data-meaning="upright" className={!details.reversed ? "parlor-meaning-drawn" : "parlor-meaning-secondary"}>
          <h3>Upright{!details.reversed ? " · drawn" : " · not drawn"}</h3><p>{summary.upright || "Not authored."}</p>
        </section>
        <section data-meaning="reversed" className={details.reversed ? "parlor-meaning-drawn" : "parlor-meaning-secondary"}>
          <h3>Reversed{details.reversed ? " · drawn" : " · not drawn"}</h3><p>{summary.inverted || "Not authored."}</p>
        </section>
      </div>
    </aside>
  </div>;
}
