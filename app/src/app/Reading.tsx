import { useEffect, useMemo, useState } from "react";
import { getDeck } from "@/decks";
import { spreadsForDeck } from "@/decks/spreads";
import { CardFrame } from "@/components/CardFrame";
import { CardModal } from "@/components/CardModal";
import { deal } from "@/reading/deal";
import { encodeReading, decodeReading, resolveReading, MAX_QUESTION_LENGTH, type ResolvedReading } from "@/reading/encode";
import { buildPrompt } from "@/reading/prompt";
import type { DeckModule } from "@/decks/types";
import { navigate } from "./router";
import { getPackId } from "./packPref";
import { listPacks } from "@/runtime/defineCard";

export function Reading({ deckId, token }: { deckId: string; token?: string }) {
  const deck = getDeck(deckId);
  if (!deck) {
    return (
      <div style={{ padding: "var(--s-5)" }}>
        <p style={{ color: "var(--ink)", font: "400 16px/1.5 var(--font-body)" }}>Unknown deck “{deckId}”. For a custom reading, import the original deck JSON from the home page first.</p>
        <button onClick={() => navigate("/")} style={link}>← all decks</button>
      </div>
    );
  }
  return (
    <div style={{ maxWidth: 980, margin: "0 auto", padding: "var(--s-4) var(--s-4) var(--s-6)" }}>
      {token ? <ReadingResult key={deck.id} deck={deck} token={token} /> : <ReadingComposer key={deck.id} deck={deck} />}
    </div>
  );
}

function ReadingComposer({ deck }: { deck: DeckModule }) {
  const spreads = useMemo(() => spreadsForDeck(deck.spreads), [deck]);
  const [question, setQuestion] = useState("");
  const [casting, setCasting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [spreadId, setSpreadId] = useState(spreads[1]?.id ?? spreads[0].id);
  const spread = spreads.find((s) => s.id === spreadId)!;

  async function castReading() {
    setCasting(true);
    setError(null);
    try {
      const dealt = deal(spread, deck.cards.length);
      const tk = await encodeReading(deck, spread, question.trim(), dealt);
      navigate(`/deck/${deck.id}/r/${tk}`);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Unable to create this reading.");
    } finally { setCasting(false); }
  }

  const n = spread.positions.length;

  return (
    <div>
      <div style={kicker}>Cast a reading · {deck.name}</div>
      <h2 style={headline}>Compose a spread</h2>
      <p style={lede}>Ask a question, choose a spread, and deal. You'll get a shareable link and an LLM-ready prompt.</p>

      <label style={fieldLabel}>Your question <span style={{ color: "var(--ink-3)" }}>(optional)</span></label>
      <textarea
        value={question}
        maxLength={MAX_QUESTION_LENGTH}
        onChange={(e) => setQuestion(e.target.value)}
        placeholder="What should I focus on right now?"
        style={{
          width: "100%",
          minHeight: 72,
          boxSizing: "border-box",
          resize: "vertical",
          background: "var(--paper-2)",
          color: "var(--ink)",
          border: "1px solid var(--line)",
          borderRadius: "var(--r-2)",
          padding: "var(--s-3)",
          font: "400 15px/1.5 var(--font-body)",
        }}
      />

      <label style={{ ...fieldLabel, marginTop: "var(--s-4)" }}>Spread</label>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(220px, 1fr))", gap: "var(--s-2)" }}>
        {spreads.map((s) => {
          const on = s.id === spreadId;
          return (
            <button
              key={s.id}
              onClick={() => setSpreadId(s.id)}
              style={{
                ...spreadCard,
                borderColor: on ? "var(--accent)" : "var(--line)",
                background: on ? "var(--accent-wash)" : "var(--card)",
              }}
            >
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", gap: "var(--s-2)" }}>
                <span style={{ font: "400 17px/1.2 var(--font-display)", color: "var(--ink)" }}>{s.name}</span>
                <span style={countLabel}>{s.positions.length}×{s.deckId ? " · native" : ""}</span>
              </div>
              <div style={{ marginTop: "var(--s-1)", color: "var(--ink-2)", font: "400 12.5px/1.4 var(--font-body)" }}>{s.description}</div>
            </button>
          );
        })}
      </div>

      <div style={{ marginTop: "var(--s-4)" }}>
        <button onClick={castReading} disabled={casting || n > deck.cards.length} style={dealBtn}>
          {casting ? "Preparing reading…" : `Deal ${n} card${n > 1 ? "s" : ""} →`}
        </button>
        {n > deck.cards.length && <p role="alert" style={errorText}>This spread needs {n} cards; this deck has {deck.cards.length}. Choose a smaller spread.</p>}
        {error && <p role="alert" style={errorText}>{error}</p>}
      </div>
    </div>
  );
}

function ReadingResult({ deck, token }: { deck: DeckModule; token: string }) {
  const decoded = useMemo(() => decodeReading(token), [token]);
  const [copied, setCopied] = useState<string | null>(null);
  // modal walks the dealt order, so prev/next moves through the spread itself.
  const [openIndex, setOpenIndex] = useState<number | null>(null);

  const [resolution, setResolution] = useState<{ token: string; deck: DeckModule; result: ResolvedReading } | null>(null);
  useEffect(() => {
    let active = true;
    setCopied(null);
    setOpenIndex(null);
    resolveReading(decoded, deck).then((result) => {
      if (active) setResolution({ token, deck, result });
    });
    return () => { active = false; };
  }, [decoded, deck, token]);

  if (!resolution || resolution.token !== token || resolution.deck !== deck) return <p role="status">Checking reading…</p>;
  if (!resolution.result.ok) return <p role="alert" style={errorText}>{resolution.result.error}</p>;
  const { spread, dealt, question, legacy } = resolution.result;
  const seqCards = dealt.map((dc) => deck.cards[dc.index]);
  const prompt = buildPrompt(deck, spread, dealt, question);
  const packs = listPacks(deck.id);
  const prefer = (packs.find((p) => p.id === getPackId(deck.id, packs[0]?.id ?? "")) ?? packs[0])?.id;

  function copy(text: string, which: string) {
    navigator.clipboard?.writeText(text).then(() => { setCopied(which); setTimeout(() => setCopied(null), 1600); });
  }

  return (
    <div>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", flexWrap: "wrap", gap: "var(--s-2)" }}>
        <div>
          <div style={kicker}>{spread.name} · {deck.name}</div>
          {question && <p style={{ margin: "var(--s-1) 0 0", color: "var(--ink)", font: "400 22px/1.3 var(--font-display)" }}>“{question}”</p>}
        </div>
        <button onClick={() => navigate(`/deck/${deck.id}/read`)} style={secondaryBtn}>↺ New reading</button>
      </div>

      {legacy && <p role="status" style={lede}>This legacy link stores card positions, not stable IDs or a deck revision. Verify the card names if the deck has changed.</p>}
      {deck.custom && <p style={lede}>Custom deck data is not included in this link. The recipient needs the original deck JSON.</p>}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(190px, 1fr))", gap: "var(--s-4)", marginTop: "var(--s-4)" }}>
        {dealt.map((dc, i) => {
          const card = deck.cards[dc.index];
          const pos = spread.positions[i];
          if (!card || !pos) return null;
          const meaning = dc.reversed ? card.meaning.inverted : card.meaning.upright;
          return (
            <div key={i}>
              <div style={positionLabel}>{i + 1}. {pos.name}</div>
              <div style={{ color: "var(--ink-2)", font: "italic 400 11.5px/1.35 var(--font-body)", margin: "var(--s-1) 0 var(--s-2)" }}>{pos.prompt}</div>
              <div style={{ transform: dc.reversed ? "rotate(180deg)" : "none" }}>
                <CardFrame card={card} deckId={deck.id} prefer={prefer} deck={deck.data} showBanner={false} mode="poster" onOpen={() => setOpenIndex(i)} />
              </div>
              <div style={{ marginTop: "var(--s-2)", font: "400 16px/1.25 var(--font-display)", color: "var(--ink)" }}>
                {card.name}{" "}
                {dc.reversed && <span style={reversedTag}>· Reversed</span>}
              </div>
              {card.factorization?.gloss && <div style={{ marginTop: "var(--s-1)", color: "var(--ink-3)", font: "400 11px/1.4 var(--font-mono)" }}>Number — {card.factorization.gloss}</div>}
              <p style={{ margin: "var(--s-1) 0 0", color: "var(--ink)", font: "400 12.5px/1.45 var(--font-body)" }}>{meaning}</p>
            </div>
          );
        })}
      </div>

      <section style={{ marginTop: "var(--s-5)", paddingTop: "var(--s-4)", borderTop: "1px solid var(--line)" }}>
        <h3 style={sectionKicker}>Take it to an LLM</h3>
        <p style={{ color: "var(--ink-2)", font: "400 13.5px/1.5 var(--font-body)", marginTop: 0 }}>
          Share the link (a browsing model can open it), or copy the self-contained prompt into any model. Nothing is sent to a server — the whole reading lives in the URL fragment.
        </p>
        <div style={{ display: "flex", gap: "var(--s-2)", flexWrap: "wrap" }}>
          <button onClick={() => copy(window.location.href, "link")} style={secondaryBtn}>{copied === "link" ? "Copied ✓" : "Copy share link"}</button>
          <button onClick={() => copy(prompt, "prompt")} style={dealBtn}>{copied === "prompt" ? "Copied ✓" : "Copy reading for an LLM"}</button>
        </div>
        <div style={{ marginTop: "var(--s-3)", background: "var(--paper-2)", border: "1px solid var(--line)", borderRadius: "var(--r-2)", padding: "var(--s-3)" }}>
          <div style={{ ...positionLabel, marginBottom: "var(--s-2)" }}>Prompt preview</div>
          <pre style={{
            margin: 0,
            background: "var(--card)",
            border: "1px solid var(--line)",
            borderRadius: "var(--r-1)",
            padding: "var(--s-3)",
            color: "var(--ink-2)",
            font: "400 12px/1.5 var(--font-mono)",
            whiteSpace: "pre",
            overflowX: "auto",
            maxHeight: 320,
            overflowY: "auto",
          }}>{prompt}</pre>
        </div>
      </section>

      {openIndex !== null && (
        <CardModal
          cards={seqCards}
          index={openIndex}
          onNavigate={setOpenIndex}
          onClose={() => setOpenIndex(null)}
          contextLabel={spread.name}
          deckId={deck.id}
          prefer={prefer}
          deck={deck.data}
        />
      )}
    </div>
  );
}

const kicker: React.CSSProperties = { color: "var(--accent)", font: "400 12px/1 var(--font-mono)", letterSpacing: "0.13em", textTransform: "uppercase", margin: "0 0 var(--s-2)" };
const headline: React.CSSProperties = { font: "400 32px/1.1 var(--font-display)", color: "var(--ink)", margin: "0 0 var(--s-1)" };
const lede: React.CSSProperties = { color: "var(--ink-2)", font: "400 15px/1.5 var(--font-body)", marginTop: 0, marginBottom: "var(--s-4)" };
const fieldLabel: React.CSSProperties = { display: "block", color: "var(--ink-3)", font: "400 12px/1 var(--font-mono)", letterSpacing: "0.13em", textTransform: "uppercase", margin: "0 0 var(--s-2)" };
const countLabel: React.CSSProperties = { color: "var(--ink-3)", font: "400 12px/1 var(--font-mono)", letterSpacing: "0.06em" };
const positionLabel: React.CSSProperties = { color: "var(--accent)", font: "400 11px/1.2 var(--font-mono)", letterSpacing: "0.13em", textTransform: "uppercase" };
const sectionKicker: React.CSSProperties = { font: "400 12px/1 var(--font-mono)", letterSpacing: "0.13em", textTransform: "uppercase", color: "var(--ink-3)", margin: "0 0 var(--s-2)" };
const reversedTag: React.CSSProperties = { color: "var(--error)", font: "400 11px/1 var(--font-mono)", letterSpacing: "0.06em", textTransform: "uppercase" };
const errorText: React.CSSProperties = { color: "var(--error)", font: "400 15px/1.5 var(--font-body)" };
const spreadCard: React.CSSProperties = { all: "unset", cursor: "pointer", display: "block", padding: "var(--s-3)", borderRadius: "var(--r-2)", border: "1px solid", boxSizing: "border-box", transition: "border-color var(--t-fast) var(--ease), background var(--t-fast) var(--ease)" };
const dealBtn: React.CSSProperties = { all: "unset", cursor: "pointer", padding: "11px 20px", borderRadius: "var(--r-2)", background: "var(--accent)", color: "var(--accent-ink)", font: "600 14px/1 var(--font-body)" };
const secondaryBtn: React.CSSProperties = { all: "unset", cursor: "pointer", padding: "10px 16px", borderRadius: "var(--r-2)", background: "transparent", color: "var(--ink)", border: "1px solid var(--line-2)", font: "600 14px/1 var(--font-body)" };
const link: React.CSSProperties = { all: "unset", cursor: "pointer", color: "var(--ink-2)", font: "400 13px/1 var(--font-body)" };
