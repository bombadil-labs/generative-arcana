import { useState } from "react";
import { listDecks } from "@/decks";
import { loadCustomDeck } from "@/decks/custom";
import { isIllustrated } from "@/runtime/defineCard";
import { Svg } from "@/components/cardMeta";
import { navigate } from "./router";

export function Landing() {
  const decks = listDecks();
  const [pasting, setPasting] = useState(false);
  const [text, setText] = useState("");
  const [error, setError] = useState<string | null>(null);

  function load() {
    const res = loadCustomDeck(text);
    if (!res.ok) { setError(res.error); return; }
    navigate(`/deck/${res.deck.id}`);
  }

  return (
    <div style={page}>
      <header style={{ marginBottom: "var(--s-6)" }}>
        <div style={kicker}>The Vitrine · custom tarot</div>
        <h1 style={hero}>Generative Arcana</h1>
        <p style={lede}>
          A home for <em>custom tarot decks</em> — symbolic systems you can inspect, browse, read with,
          author, and share across hosts. Explore the reference decks below, open a deck published by
          the community, or load your own manifest locally.
        </p>
        <div style={{ display: "flex", flexWrap: "wrap", gap: "var(--s-3)", marginTop: "var(--s-4)" }}>
          <button onClick={() => navigate("/community")} style={primaryAction}>Browse community decks →</button>
          <button onClick={() => setPasting((p) => !p)} style={secondaryAction}>Load a deck manifest</button>
        </div>
      </header>

      <div style={grid}>
        {decks.map((d) => {
          const illustrated = d.cards.filter((c) => isIllustrated(d.id, c.slug)).length;
          const glyphSvg = deckGlyphSvg(d);
          return (
            <button key={d.id} onClick={() => navigate(`/deck/${d.id}`)} style={tileBtn} onMouseEnter={lift} onMouseLeave={drop}>
              <div data-theme={d.id} style={tileInner}>
                <div style={previewBand}>{glyphSvg && <span style={watermark} aria-hidden><Svg svg={glyphSvg} size={92} /></span>}</div>
                <div style={tileBody}>
                  <div style={deckName}>{d.name}</div>
                  <div style={tagline}>{d.tagline}</div>
                  <div style={metaLine}>{(d.custom ? "local deck" : d.data.theme.creator)} · {d.cards.length} cards · {illustrated === 0 ? "generative" : `${illustrated} illustrated`}</div>
                </div>
              </div>
            </button>
          );
        })}

        <button onClick={() => { setPasting((p) => !p); setError(null); }} style={pasteTile} onMouseEnter={lift} onMouseLeave={drop}>
          <div style={pasteInner}><div style={pasteTitle}>+ Load your own</div><div style={pasteCopy}>Paste any valid Generative Arcana deck manifest and use it immediately in this browser.</div></div>
        </button>
      </div>

      {pasting && (
        <div style={{ marginTop: "var(--s-4)" }}>
          <textarea value={text} onChange={(e) => { setText(e.target.value); setError(null); }} placeholder="Paste a deck.json here…" spellCheck={false} style={textarea} />
          {error && <div style={errorMsg}>{error}</div>}
          <div style={{ marginTop: "var(--s-3)" }}><button onClick={load} disabled={!text.trim()} style={primaryBtn(!text.trim())}>Load deck</button></div>
        </div>
      )}

      <footer style={footer}><a href="https://github.com/bombadil-labs/generative-arcana" target="_blank" rel="noopener noreferrer" style={repoLink}>Open source — decks, renderer, MCP service, and authoring tools on GitHub ↗</a></footer>
    </div>
  );
}

function deckGlyphSvg(d: { data: { suits: Record<string, unknown>; major_arcana: unknown } }): string | undefined {
  const firstSuit = Object.values(d.data.suits)[0] as { symbol?: { svg?: string } } | undefined;
  const major = d.data.major_arcana as { symbol?: { svg?: string } } | undefined;
  return firstSuit?.symbol?.svg ?? major?.symbol?.svg;
}
function lift(e: React.MouseEvent<HTMLButtonElement>) { e.currentTarget.style.transform = "translateY(-4px)"; e.currentTarget.style.boxShadow = "var(--e-2)"; }
function drop(e: React.MouseEvent<HTMLButtonElement>) { e.currentTarget.style.transform = "translateY(0)"; e.currentTarget.style.boxShadow = "var(--e-1)"; }

const page: React.CSSProperties = { maxWidth: 1180, margin: "0 auto", padding: "clamp(var(--s-4), 5vw, var(--s-6)) clamp(var(--s-3), 4vw, 28px) var(--s-6)", boxSizing: "border-box" };
const kicker: React.CSSProperties = { fontFamily: "var(--font-mono)", fontSize: 12, letterSpacing: "0.13em", textTransform: "uppercase", color: "var(--ink-3)", marginBottom: "var(--s-3)" };
const hero: React.CSSProperties = { fontFamily: "var(--font-display)", fontWeight: 400, fontSize: "clamp(40px, 6vw, 84px)", lineHeight: 1.02, letterSpacing: "-0.01em", color: "var(--ink)", maxWidth: "16ch", margin: 0 };
const lede: React.CSSProperties = { fontFamily: "var(--font-body)", fontWeight: 400, fontSize: "clamp(16px, 1.6vw, 19px)", lineHeight: 1.6, color: "var(--ink-2)", maxWidth: "60ch", marginTop: "var(--s-4)" };
const primaryAction: React.CSSProperties = { all: "unset", cursor: "pointer", padding: "12px 18px", borderRadius: "var(--r-2)", font: "600 14px/1 var(--font-body)", background: "var(--accent)", color: "var(--accent-ink)", border: "1px solid var(--accent)" };
const secondaryAction: React.CSSProperties = { ...primaryAction, background: "transparent", color: "var(--ink)", border: "1px solid var(--line-2)" };
const grid: React.CSSProperties = { display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(248px, 1fr))", gap: "var(--s-4)" };
const tileBtn: React.CSSProperties = { all: "unset", cursor: "pointer", display: "block", boxSizing: "border-box", background: "var(--card)", border: "1px solid var(--line)", borderRadius: "var(--r-3)", boxShadow: "var(--e-1)", overflow: "hidden", transition: "transform var(--t-fast) var(--ease), box-shadow var(--t-fast) var(--ease)" };
const tileInner: React.CSSProperties = { display: "block" };
const previewBand: React.CSSProperties = { position: "relative", height: 108, overflow: "hidden", background: "linear-gradient(135deg, var(--accent-wash), transparent 70%), linear-gradient(0deg, var(--card), var(--paper-2))", borderBottom: "1px solid var(--line)", color: "var(--accent)" };
const watermark: React.CSSProperties = { position: "absolute", right: -8, bottom: -10, opacity: 0.46, display: "inline-flex", pointerEvents: "none" };
const tileBody: React.CSSProperties = { padding: "var(--s-3) var(--s-4) var(--s-4)" };
const deckName: React.CSSProperties = { fontFamily: "var(--font-display)", fontWeight: 400, fontSize: 21, lineHeight: 1.15, color: "var(--ink)" };
const tagline: React.CSSProperties = { marginTop: "var(--s-1)", fontFamily: "var(--font-body)", fontSize: 13.5, lineHeight: 1.45, color: "var(--ink-2)" };
const metaLine: React.CSSProperties = { marginTop: "var(--s-3)", fontFamily: "var(--font-mono)", fontSize: 11.5, letterSpacing: "0.06em", textTransform: "uppercase", color: "var(--ink-3)" };
const pasteTile: React.CSSProperties = { all: "unset", cursor: "pointer", display: "block", boxSizing: "border-box", background: "var(--card)", border: "1px dashed var(--line-2)", borderRadius: "var(--r-3)", boxShadow: "var(--e-1)", overflow: "hidden", transition: "transform var(--t-fast) var(--ease), box-shadow var(--t-fast) var(--ease)" };
const pasteInner: React.CSSProperties = { padding: "var(--s-4)", display: "flex", flexDirection: "column", justifyContent: "center", minHeight: 108 };
const pasteTitle: React.CSSProperties = { fontFamily: "var(--font-display)", fontWeight: 400, fontSize: 21, lineHeight: 1.15, color: "var(--ink)" };
const pasteCopy: React.CSSProperties = { marginTop: "var(--s-2)", fontFamily: "var(--font-body)", fontSize: 13.5, lineHeight: 1.5, color: "var(--ink-2)" };
const textarea: React.CSSProperties = { width: "100%", boxSizing: "border-box", minHeight: 240, resize: "vertical", background: "var(--card)", color: "var(--ink)", border: "1px solid var(--line-2)", borderRadius: "var(--r-2)", padding: "var(--s-3)", fontFamily: "var(--font-mono)", fontSize: 12.5, lineHeight: 1.5, outline: "none" };
const errorMsg: React.CSSProperties = { marginTop: "var(--s-2)", color: "var(--danger)", font: "400 13px/1.4 var(--font-body)" };
function primaryBtn(disabled: boolean): React.CSSProperties { return { all: "unset", cursor: disabled ? "not-allowed" : "pointer", opacity: disabled ? 0.45 : 1, padding: "11px 17px", borderRadius: "var(--r-2)", font: "600 13px/1 var(--font-body)", background: "var(--accent)", color: "var(--accent-ink)" }; }
const footer: React.CSSProperties = { marginTop: "var(--s-6)", paddingTop: "var(--s-4)", borderTop: "1px solid var(--line)" };
const repoLink: React.CSSProperties = { font: "400 12px/1.5 var(--font-mono)", color: "var(--ink-3)", textDecoration: "none" };
