import { useEffect, useState } from "react";
import { listPublicDecks, type CatalogDeckSummary } from "@/catalog/api";
import { navigate } from "./router";

export function Community() {
  const [decks, setDecks] = useState<CatalogDeckSummary[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const controller = new AbortController();
    void listPublicDecks(controller.signal)
      .then((items) => { setDecks(items); setError(null); })
      .catch((reason: unknown) => {
        if (controller.signal.aborted) return;
        setError(reason instanceof Error ? reason.message : "Unable to load the community catalog.");
      });
    return () => controller.abort();
  }, []);

  return (
    <div style={page}>
      <header style={{ marginBottom: "var(--s-5)" }}>
        <div style={kicker}>Community library</div>
        <h1 style={headline}>Shared symbolic worlds</h1>
        <p style={lede}>
          Public decks authored by the Generative Arcana community. Opening one resolves its stable
          resource directly from the catalog — no copy or installation required.
        </p>
      </header>

      {error && <Status title="Couldn’t load the catalog" body={error} />}
      {!error && decks === null && <Status title="Loading public decks…" body="Looking through the shared catalog." />}
      {!error && decks?.length === 0 && <Status title="The shelves are waiting" body="No community decks have been published yet." />}

      {decks && decks.length > 0 && (
        <div style={grid}>
          {decks.map((deck) => (
            <button key={deck.id} onClick={() => navigate(`/deck/${deck.id}`)} style={tile}>
              <div style={preview} aria-hidden><span style={sigil}>✦</span></div>
              <div style={body}>
                <div style={deckName}>{deck.name}</div>
                <div style={tagline}>{deck.tagline}</div>
                <div style={meta}>revision {deck.revision} · {publishedLabel(deck)}</div>
              </div>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

function publishedLabel(deck: CatalogDeckSummary): string {
  const value = deck.publishedAt ?? deck.updatedAt;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "public" : `published ${date.toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" })}`;
}

function Status({ title, body: copy }: { title: string; body: string }) {
  return <div style={status}><strong style={{ display: "block", color: "var(--ink)", marginBottom: 6 }}>{title}</strong>{copy}</div>;
}

const page: React.CSSProperties = { maxWidth: 1180, margin: "0 auto", padding: "clamp(var(--s-4),5vw,var(--s-6)) clamp(var(--s-3),4vw,28px) var(--s-6)" };
const kicker: React.CSSProperties = { font: "400 12px/1.4 var(--font-mono)", letterSpacing: "0.13em", textTransform: "uppercase", color: "var(--ink-3)", marginBottom: "var(--s-3)" };
const headline: React.CSSProperties = { font: "400 clamp(38px,6vw,72px)/1.04 var(--font-display)", letterSpacing: "-0.01em", color: "var(--ink)", margin: 0 };
const lede: React.CSSProperties = { font: "400 17px/1.6 var(--font-body)", color: "var(--ink-2)", maxWidth: "62ch", margin: "var(--s-4) 0 0" };
const grid: React.CSSProperties = { display: "grid", gridTemplateColumns: "repeat(auto-fill,minmax(248px,1fr))", gap: "var(--s-4)" };
const tile: React.CSSProperties = { all: "unset", cursor: "pointer", display: "block", overflow: "hidden", background: "var(--card)", border: "1px solid var(--line)", borderRadius: "var(--r-3)", boxShadow: "var(--e-1)" };
const preview: React.CSSProperties = { height: 108, display: "grid", placeItems: "center", borderBottom: "1px solid var(--line)", background: "radial-gradient(circle at 50% 45%, var(--accent-wash), transparent 64%), var(--paper-2)", color: "var(--accent)" };
const sigil: React.CSSProperties = { font: "400 54px/1 var(--font-display)", opacity: 0.7 };
const body: React.CSSProperties = { padding: "var(--s-3) var(--s-4) var(--s-4)" };
const deckName: React.CSSProperties = { font: "400 21px/1.15 var(--font-display)", color: "var(--ink)" };
const tagline: React.CSSProperties = { marginTop: "var(--s-1)", font: "400 13.5px/1.45 var(--font-body)", color: "var(--ink-2)" };
const meta: React.CSSProperties = { marginTop: "var(--s-3)", font: "400 11px/1.4 var(--font-mono)", letterSpacing: "0.05em", textTransform: "uppercase", color: "var(--ink-3)" };
const status: React.CSSProperties = { padding: "var(--s-4)", border: "1px solid var(--line)", borderRadius: "var(--r-2)", background: "var(--card)", font: "400 14px/1.6 var(--font-body)", color: "var(--ink-2)", maxWidth: 620 };
