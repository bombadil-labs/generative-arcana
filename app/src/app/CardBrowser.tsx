import { useMemo, useState } from "react";
import { getDeck } from "@/decks";
import { isIllustrated, listPacks } from "@/runtime/defineCard";
import { DeckGrid } from "@/components/DeckGrid";
import { navigate } from "./router";
import { getPackId, setPackId } from "./packPref";
import { useArtworkStore, useArtworkVersion, useArtworkSelection } from "../artwork/context";
import type { CardData } from "@/runtime/types";

type Named = { slug?: string; name: string; index?: number };

/** Concise singular label for a deck's transversal axis, e.g. "The Eight Virtues" -> "Virtue". */
function axisLabel(name: string | undefined): string {
  if (!name) return "Axis";
  let s = name.replace(/^the\s+/i, "").replace(/^(one|two|three|four|five|six|seven|eight|nine|ten|twelve)\s+/i, "");
  if (/s$/i.test(s) && !/ss$/i.test(s)) s = s.replace(/s$/i, "");
  return s;
}

function numericKind(numStr: string): "identity" | "prime" | "composite" {
  const n = parseInt(numStr, 10);
  if (n <= 1) return "identity";
  let m = n;
  const f: number[] = [];
  for (let dd = 2; dd * dd <= m; dd++) while (m % dd === 0) { f.push(dd); m /= dd; }
  if (m > 1) f.push(m);
  return f.length === 1 ? "prime" : "composite";
}

export function CardBrowser({ deckId }: { deckId: string }) {
  const deck = getDeck(deckId);
  const artwork = useArtworkStore();
  const artworkVersion = useArtworkVersion();
  const artworkSelection = useArtworkSelection();
  const [q, setQ] = useState("");
  const [arcana, setArcana] = useState("");
  const [suit, setSuit] = useState("");
  const [rank, setRank] = useState("");
  const [virtue, setVirtue] = useState("");
  const [comp, setComp] = useState("");
  const [illustratedOnly, setIllustratedOnly] = useState(false);

  const packs = listPacks(deckId);
  const [pack, setPack] = useState(() => getPackId(deckId, packs[0]?.id ?? ""));
  const prefer = artworkSelection?.packId ?? (packs.find((p) => p.id === pack) ?? packs[0])?.id;

  const opts = useMemo(() => {
    if (!deck) return { suits: [], ranks: [], virtues: [] as Named[] };
    const byIndex = (a: Named, b: Named) => (a.index ?? 0) - (b.index ?? 0);
    const suits = (Object.entries(deck.data.suits) as [string, Named][]).map(([slug, s]) => ({ ...s, slug })).sort(byIndex);
    const ranks = (Object.entries(deck.data.ranks) as [string, Named][]).map(([slug, r]) => ({ ...r, slug })).sort(byIndex);
    const stations = (deck.data.transversal as { stations: Record<string, Named> }).stations;
    const virtues = (Object.entries(stations) as [string, Named][]).map(([slug, v]) => ({ ...v, slug })).sort(byIndex);
    return { suits, ranks, virtues };
  }, [deck]);

  const filtered = useMemo(() => {
    if (!deck) return [] as CardData[];
    const needle = q.trim().toLowerCase();
    return deck.cards.filter((c) => {
      if (needle && !c.name.toLowerCase().includes(needle)) return false;
      if (arcana && c.arcana !== arcana) return false;
      if (suit && c.suit_slug !== suit) return false;
      if (rank && c.rank_slug !== rank) return false;
      if (virtue && c.station_slug !== virtue) return false;
      if (comp && numericKind(c.number) !== comp) return false;
      if (illustratedOnly && !(artwork ? artwork.hasArtwork(c.slug) : isIllustrated(deckId, c.slug))) return false;
      return true;
    });
  }, [deck, q, arcana, suit, rank, virtue, comp, illustratedOnly, artwork, artworkVersion]);

  if (!deck) {
    return (
      <div style={{ padding: "var(--s-5)" }}>
        <p style={{ fontFamily: "var(--font-body)", color: "var(--ink)" }}>Unknown deck “{deckId}”.</p>
        <button onClick={() => navigate("/")} style={linkBtn}>← all decks</button>
      </div>
    );
  }

  const stationLabel = axisLabel((deck.data.transversal as { name?: string } | undefined)?.name);
  const hasFilters = !!(q || arcana || suit || rank || virtue || comp || illustratedOnly);
  const clearFilters = () => { setQ(""); setArcana(""); setSuit(""); setRank(""); setVirtue(""); setComp(""); setIllustratedOnly(false); };

  return (
    <div style={{ maxWidth: 1180, margin: "0 auto", padding: "0 var(--s-4) 110px" }}>
      {/* compact deck header (the page no longer renders DeckTabs) */}
      <div style={{ padding: "var(--s-4) 0 var(--s-3)" }}>
        <div style={{ fontFamily: "var(--font-mono)", fontSize: 12, letterSpacing: ".13em", textTransform: "uppercase", color: "var(--ink-3)" }}>
          Browse the deck
        </div>
        <h1 style={{ fontFamily: "var(--font-display)", fontSize: "clamp(28px, 4vw, 44px)", lineHeight: 1.05, color: "var(--ink)", margin: "var(--s-1) 0 0" }}>
          {deck.name}
        </h1>
      </div>

      {/* sticky filter bar */}
      <div style={stickyBar}>
        <div style={{ display: "flex", flexWrap: "wrap", gap: "var(--s-2)", alignItems: "center" }}>
          <input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Search cards…"
            style={input}
          />
          <Select value={arcana} onChange={setArcana} label="Arcana" options={[["major", "Major"], ["minor", "Minor"]]} />
          <Select value={suit} onChange={setSuit} label="Suit" options={opts.suits.map((s) => [s.slug!, s.name])} />
          <Select value={rank} onChange={setRank} label="Rank" options={opts.ranks.map((r) => [r.slug!, r.name])} />
          <Select value={virtue} onChange={setVirtue} label={stationLabel} options={opts.virtues.map((v) => [v.slug!, v.name])} style={{ maxWidth: 180 }} />
          <Select value={comp} onChange={setComp} label="Number" options={[["identity", "Identity"], ["prime", "Prime"], ["composite", "Composite"]]} />
          <button
            type="button"
            onClick={() => setIllustratedOnly((v) => !v)}
            aria-pressed={illustratedOnly}
            style={illusBtn(illustratedOnly)}
          >
            Illustrated
          </button>
        </div>

        <div style={{ display: "flex", flexWrap: "wrap", gap: "var(--s-3)", alignItems: "center", justifyContent: "space-between", marginTop: "var(--s-3)" }}>
          <span style={{ fontFamily: "var(--font-mono)", fontSize: 12, color: "var(--ink-3)" }}>
            {filtered.length} of {deck.cards.length} cards
          </span>
          {artworkSelection && <div style={{ display: "flex", alignItems: "center", gap: "var(--s-2)", flexWrap: "wrap", justifyContent: "flex-end" }}>
            <label htmlFor="browser-artwork-set" style={skinLabel}>Artwork set</label>
            <select id="browser-artwork-set" value={artworkSelection.packId} onChange={(event) => artworkSelection.selectPack(event.target.value)} style={selectStyle}>
              {!artworkSelection.packs.some((item) => item.id === artworkSelection.packId) && <option value={artworkSelection.packId}>{artworkSelection.packId} · unavailable</option>}
              {artworkSelection.packs.map((item) => <option key={item.id} value={item.id}>{item.label} · {item.cardCount}/{deck.cards.length}{item.complete ? " · complete" : ""}</option>)}
            </select>
            {artworkSelection.status === "loading" && <span role="status" style={skinCaption}>Loading this artwork set…</span>}
            {artworkSelection.packs.find((item) => item.id === artworkSelection.packId)?.description && <span style={skinCaption}>{artworkSelection.packs.find((item) => item.id === artworkSelection.packId)?.description}</span>}
            {artworkSelection.error && <span role="alert" style={skinCaption}>{artworkSelection.error} <button type="button" onClick={artworkSelection.refresh} style={linkBtn}>Retry artwork</button></span>}
          </div>}
          {!artworkSelection && packs.length > 1 && (() => {
            const active = packs.find((p) => p.id === pack) ?? packs[0];
            const caption = active.description ?? "";
            return (
              <div style={{ display: "flex", alignItems: "center", gap: "var(--s-2)", flexWrap: "wrap", justifyContent: "flex-end" }}>
                <span style={skinLabel}>Skin</span>
                <div role="radiogroup" aria-label="Visual skin" style={segWrap}>
                  {packs.map((p) => {
                    const on = p.id === pack;
                    return (
                      <button
                        key={p.id}
                        type="button"
                        role="radio"
                        aria-checked={on}
                        title={p.description || p.label}
                        onClick={() => { setPack(p.id); setPackId(deckId, p.id); }}
                        style={segBtn(on)}
                      >
                        {p.label}
                      </button>
                    );
                  })}
                </div>
                {caption && <span style={skinCaption}>{caption}</span>}
              </div>
            );
          })()}
        </div>
      </div>

      {filtered.length ? (
        <DeckGrid cards={filtered} deck={deck.data} deckId={deck.id} prefer={prefer} minColPx={150} contextLabel={hasFilters ? "filtered" : "deck order"} />
      ) : (
        <div style={{ textAlign: "center", padding: "80px 20px", color: "var(--ink-3)" }}>
          <div style={{ fontFamily: "var(--font-display)", fontSize: 24, color: "var(--ink-2)", marginBottom: "var(--s-2)" }}>No cards match</div>
          <div style={{ fontFamily: "var(--font-body)", fontSize: 14, marginBottom: "var(--s-4)" }}>Try loosening a filter.</div>
          {hasFilters && (
            <button type="button" onClick={clearFilters} style={clearBtn}>Clear all filters</button>
          )}
        </div>
      )}
    </div>
  );
}

function Select({ value, onChange, label, options, style }: { value: string; onChange: (v: string) => void; label: string; options: [string, string][]; style?: React.CSSProperties }) {
  return (
    <select value={value} onChange={(e) => onChange(e.target.value)} style={{ ...selectStyle, ...style }} aria-label={label}>
      <option value="">{label}: Any</option>
      {options.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
    </select>
  );
}

const stickyBar: React.CSSProperties = {
  position: "sticky",
  top: 53,
  zIndex: 30,
  background: "color-mix(in srgb, var(--paper) 85%, transparent)",
  backdropFilter: "blur(10px)",
  WebkitBackdropFilter: "blur(10px)",
  padding: "var(--s-3) 0",
  marginBottom: "var(--s-4)",
  borderBottom: "1px solid var(--line)",
};

const input: React.CSSProperties = {
  flex: "1 1 150px",
  minWidth: 150,
  minHeight: 42,
  padding: "0 13px",
  background: "var(--paper-2)",
  color: "var(--ink)",
  border: "1px solid var(--line)",
  borderRadius: "var(--r-2)",
  fontFamily: "var(--font-body)",
  fontSize: 14,
  outline: "none",
};

const selectStyle: React.CSSProperties = {
  minHeight: 42,
  padding: "0 12px",
  background: "var(--paper-2)",
  color: "var(--ink)",
  border: "1px solid var(--line)",
  borderRadius: "var(--r-2)",
  fontFamily: "var(--font-body)",
  fontSize: 13.5,
  cursor: "pointer",
  outline: "none",
  minWidth: 0,
};

const illusBtn = (on: boolean): React.CSSProperties => ({
  minHeight: 42,
  padding: "0 15px",
  borderRadius: "var(--r-2)",
  cursor: "pointer",
  fontFamily: "var(--font-body)",
  fontSize: 13.5,
  fontWeight: on ? 600 : 500,
  border: `1px solid ${on ? "var(--accent)" : "var(--line)"}`,
  background: on ? "var(--accent-wash)" : "var(--paper-2)",
  color: on ? "var(--accent)" : "var(--ink-2)",
});

const skinLabel: React.CSSProperties = {
  fontFamily: "var(--font-mono)", fontSize: 11, letterSpacing: ".13em", textTransform: "uppercase", color: "var(--ink-3)",
};

const skinCaption: React.CSSProperties = {
  flexBasis: "100%", textAlign: "right",
  fontFamily: "var(--font-mono)", fontSize: 11, letterSpacing: ".02em", color: "var(--ink-3)", fontStyle: "italic",
};

const segWrap: React.CSSProperties = {
  display: "inline-flex",
  padding: 3,
  gap: 3,
  background: "var(--paper-2)",
  border: "1px solid var(--line)",
  borderRadius: 999,
};

const segBtn = (on: boolean): React.CSSProperties => ({
  appearance: "none",
  border: "none",
  cursor: "pointer",
  minHeight: 34,
  padding: "0 15px",
  borderRadius: 999,
  fontFamily: "var(--font-body)",
  fontSize: 13,
  fontWeight: on ? 600 : 500,
  background: on ? "var(--accent)" : "transparent",
  color: on ? "var(--accent-ink)" : "var(--ink-2)",
  boxShadow: on ? "var(--e-1)" : "none",
});

const clearBtn: React.CSSProperties = {
  minHeight: 42,
  padding: "0 18px",
  border: "1px solid var(--line-2)",
  borderRadius: "var(--r-2)",
  background: "transparent",
  color: "var(--ink)",
  fontFamily: "var(--font-body)",
  fontSize: 14,
  cursor: "pointer",
};

const linkBtn: React.CSSProperties = { all: "unset", cursor: "pointer", color: "var(--ink-2)", fontFamily: "var(--font-body)", fontSize: 13 };
