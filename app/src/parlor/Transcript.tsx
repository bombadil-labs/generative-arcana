/** Spoken mode receives only the audio-revealed prefix; silent mode receives one
 * measured page. Delivery timing belongs to the encounter, not this view.
 * Full conversation history is retained independently of the visible window. */
export function Transcript({ text, kind, silent = false, windowRef }: { text: string; kind: "user" | "narrator"; silent?: boolean; windowRef?: React.Ref<HTMLDivElement> }) {
  return <div ref={windowRef} className={`parlor-transcript-window ${kind === "user" ? "parlor-user-transcript" : "parlor-caption"}${silent ? " is-silent" : ""}`}
    aria-label={kind === "user" ? "Your words" : "Narrator transcript"} aria-live={kind === "user" ? "polite" : "off"}>
    <div className="parlor-transcript-lines">{text.trim()}</div>
  </div>;
}
