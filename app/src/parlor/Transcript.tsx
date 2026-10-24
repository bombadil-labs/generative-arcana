/** Only already-revealed text enters this window. CSS keeps its last complete
 * lines in view as they wrap, without timers, estimated speech or scroll input.
 * The machine retains the full transcript/history independently of presentation. */
export function Transcript({ text, kind }: { text: string; kind: "user" | "narrator" }) {
  return <div className={`parlor-transcript-window ${kind === "user" ? "parlor-user-transcript" : "parlor-caption"}`}
    aria-label={kind === "user" ? "Your words" : "Narrator transcript"} aria-live={kind === "user" ? "polite" : "off"}>
    <div className="parlor-transcript-lines">{text.trim()}</div>
  </div>;
}
