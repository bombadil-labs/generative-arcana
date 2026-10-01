/**
 * <AxisExplorer> — the viewer's peek behind the curtain. Every card sits at the intersection of four
 * axes; this tabbed panel lets the reader bounce between them and see, from the deck's own metadata,
 * what each axis contributes and what each point on it means.
 *
 *   Axis 1 · Suits        — the grid axis (a dialectical 2×2 if the deck encodes one) + the Major
 *                           Arcana, which carries no suit yet functions as one.
 *   Axis 2 · Ranks        — two systems: the minor ranks (1–14) and the majors' own numbering (0–21).
 *   Axis 3 · Transversal  — the substrate axis: a named cycle laid across the grid.
 *   Axis 4 · Prime Factorization — the invariant character latent in every card's number.
 *
 * Built mobile-first and keyboard-accessible (roles tablist/tab/tabpanel, arrow-key nav).
 */
import { useState, useEffect, useRef, Fragment } from "react";
import { Svg, omega, facVar, facWord } from "@/components/cardMeta";
import type { AxisMeaning, DeckDataFile, SuitEntry, TransversalData } from "@/decks/types";

// Axis identity comes from its map key; prose and numeric metadata stay optional.
type Suit = SuitEntry & { slug: string };

const GOLD = "var(--accent)", TEXT = "var(--ink-2)", MUTE = "var(--ink-3)", PANEL = "var(--card)", LINE = "var(--line)";

function useNarrow(bp = 680) {
  const [n, setN] = useState(typeof window !== "undefined" && window.innerWidth < bp);
  useEffect(() => {
    const mq = window.matchMedia(`(max-width:${bp - 1}px)`);
    const h = () => setN(mq.matches); h();
    mq.addEventListener("change", h); return () => mq.removeEventListener("change", h);
  }, [bp]);
  return n;
}

export function AxisExplorer({ deck }: { deck: DeckDataFile }) {
  const tabs = ["Suits", "Ranks", "Transversal", "Prime Factorization"];
  const [active, setActive] = useState(0);
  const refs = useRef<(HTMLButtonElement | null)[]>([]);

  const onKey = (e: React.KeyboardEvent) => {
    let next = active;
    if (e.key === "ArrowRight") next = (active + 1) % tabs.length;
    else if (e.key === "ArrowLeft") next = (active - 1 + tabs.length) % tabs.length;
    else if (e.key === "Home") next = 0;
    else if (e.key === "End") next = tabs.length - 1;
    else return;
    e.preventDefault(); setActive(next); refs.current[next]?.focus();
  };

  return (
    <div>
      <div role="tablist" aria-label="The four axes" onKeyDown={onKey}
        style={{ display: "flex", gap: 6, overflowX: "auto", paddingBottom: 4, marginBottom: 18, scrollbarWidth: "none" }}>
        {tabs.map((label, i) => {
          const on = i === active;
          return (
            <button key={i} role="tab" id={`axis-tab-${i}`} aria-selected={on} aria-controls={`axis-panel-${i}`}
              tabIndex={on ? 0 : -1} ref={(el) => (refs.current[i] = el)} onClick={() => setActive(i)}
              style={{
                all: "unset", cursor: "pointer", whiteSpace: "nowrap", padding: "10px 4px", marginRight: 12,
                font: `${on ? 600 : 400} 13px/1.1 var(--font-body)`, outlineOffset: 2,
                color: on ? "var(--ink)" : "var(--ink-3)",
                boxShadow: on ? "inset 0 -2px 0 var(--accent)" : "none",
                transition: "color var(--t-fast) var(--ease)",
              }}>
              <span style={{ font: "400 11px/1 var(--font-mono)", color: "var(--ink-3)" }}>{i + 1}</span>
              <span style={{ margin: "0 7px", color: "var(--ink-3)" }}>·</span>{label}
            </button>
          );
        })}
      </div>

      <div role="tabpanel" id={`axis-panel-${active}`} aria-labelledby={`axis-tab-${active}`}>
        {active === 0 && <SuitsPanel deck={deck} />}
        {active === 1 && <RanksPanel deck={deck} />}
        {active === 2 && <TransversalPanel tx={deck.transversal} suitCount={Object.keys(deck.suits).length} />}
        {active === 3 && <PrimePanel deck={deck} />}
      </div>
    </div>
  );
}

// ── shared bits ───────────────────────────────────────────────────────────────
function Lead({ children }: { children: React.ReactNode }) {
  return <p style={{ ...body, color: MUTE, margin: "0 0 18px", maxWidth: 720 }}>{children}</p>;
}
function Means({ m }: { m?: AxisMeaning }) {
  if (!m?.upright?.length && !m?.inverted?.length) return null;
  return (
    <div style={{ marginTop: 8, font: "400 12px/1.55 var(--font-body)" }}>
      {m.upright?.length ? <div><span style={{ color: GOLD, fontWeight: 600 }}>Upright </span><span style={{ color: TEXT }}>{m.upright.join(" · ")}</span></div> : null}
      {m.inverted?.length ? <div><span style={{ color: "var(--ink-3)", fontWeight: 600 }}>Shadow </span><span style={{ color: MUTE }}>{m.inverted.join(" · ")}</span></div> : null}
    </div>
  );
}

// ── Axis 1: Suits ─────────────────────────────────────────────────────────────
type DialecticView = { rows: string[]; cols: string[]; cells: Suit[][]; rowAxis?: string; colAxis?: string };

/** The suit 2×2, if the deck has one. Prefers the first-class `deck.dialectic` axes + each suit's
 *  `dialectic` coordinates; falls back to parsing a leading "A x B." in each description (old decks). */
function dialectic(deck: DeckDataFile, suits: Suit[]): DialecticView | null {
  const dx = deck.dialectic;
  if (dx?.axes?.length === 2 && dx.axes[0].poles?.length === 2 && dx.axes[1].poles?.length === 2 && dx.cells) {
    const [a0, a1] = dx.axes;
    const cells = a0.poles.map((r) =>
      a1.poles.map((c) => suits.find((s) => { const pos = dx.cells[s.slug]; return pos && pos[0] === r && pos[1] === c; })),
    );
    if (!cells.flat().some((x) => !x)) {
      return { rows: a0.poles, cols: a1.poles, cells: cells as Suit[][], rowAxis: a0.name, colAxis: a1.name };
    }
  }
  // fallback: parse "A x B." prefix from descriptions
  const parsed = suits.map((s) => {
    const m = s.description?.match(/^\s*([A-Za-z]+)\s*[x×]\s*([A-Za-z]+)\b/);
    return m ? { s, a: m[1], b: m[2] } : null;
  });
  if (parsed.some((p) => !p)) return null;
  const as = [...new Set(parsed.map((p) => p!.a))], bs = [...new Set(parsed.map((p) => p!.b))];
  if (as.length !== 2 || bs.length !== 2 || suits.length !== 4) return null;
  const at = (a: string, b: string) => parsed.find((p) => p!.a === a && p!.b === b)?.s;
  const cells = as.map((a) => bs.map((b) => at(a, b)));
  if (cells.flat().some((x) => !x)) return null;
  return { rows: as, cols: bs, cells: cells as Suit[][] };
}

function SuitCard({ s }: { s: Suit }) {
  return (
    <div style={panel}>
      <div style={{ display: "flex", alignItems: "center", gap: 9 }}>
        {s.symbol?.svg && <span style={{ color: "var(--accent)" }}><Svg svg={s.symbol.svg} size={24} /></span>}
        <span style={{ font: "400 18px/1 var(--font-display)", color: "var(--ink)" }}>{s.name}</span>
      </div>
      {s.description && <p style={{ ...body, margin: "9px 0 0" }}>{s.description}</p>}
      <Means m={s.meaning} />
      {s.visual_style && <p style={{ ...mutedItalic, margin: "9px 0 0" }}>{s.visual_style}</p>}
    </div>
  );
}

function SuitsPanel({ deck }: { deck: DeckDataFile }) {
  const suits = Object.entries(deck.suits).map(([slug, suit]) => ({ ...suit, slug })).sort((a, b) => a.index - b.index);
  const ma = deck.major_arcana;
  const di = dialectic(deck, suits);
  const narrow = useNarrow();
  return (
    <div>
      <Lead>
        The first grid axis. Each suit is a quadrant of the deck's space, <strong>declared</strong> in line
        and color — it stamps its glyph on every minor card and lends a palette of meanings.
        {di && <> Here the four form a true cross-product: <strong>{di.rowAxis ? `${di.rowAxis} (${di.rows.join(" / ")})` : di.rows.join(" / ")}</strong> against <strong>{di.colAxis ? `${di.colAxis} (${di.cols.join(" / ")})` : di.cols.join(" / ")}</strong>.</>}
      </Lead>

      {di && !narrow ? (
        <div style={{ display: "grid", gridTemplateColumns: "20px 1fr 1fr", gap: 10, alignItems: "stretch" }}>
          <div />
          {di.cols.map((b) => <AxisLabel key={b} text={b} />)}
          {di.rows.map((a, ri) => (
            <Fragment key={a}>
              <AxisLabel text={a} vertical />
              {di.cells[ri].map((s) => <SuitCard key={s.slug} s={s} />)}
            </Fragment>
          ))}
        </div>
      ) : (
        <div style={grid(300)}>{suits.map((s) => <SuitCard key={s.slug} s={s} />)}</div>
      )}

      {/* The Major Arcana — no suit, yet functions as one */}
      <div style={{ ...panel, marginTop: 14, borderColor: "var(--accent)", background: "var(--accent-wash)" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 9 }}>
          {ma?.symbol?.svg && <span style={{ color: "var(--accent)" }}><Svg svg={ma.symbol.svg} size={24} /></span>}
          <span style={{ font: "400 18px/1 var(--font-display)", color: "var(--ink)" }}>The Major Arcana</span>
          <span style={{ font: "400 10px/1 var(--font-mono)", color: GOLD, letterSpacing: "0.13em", textTransform: "uppercase", border: "1px solid var(--accent)", borderRadius: "var(--r-1)", padding: "3px 6px" }}>no suit</span>
        </div>
        <p style={{ ...body, margin: "9px 0 0" }}>
          The 22 trumps carry no suit and no rank — yet the Major Arcana <em>functions</em> as a fifth suit:
          a register that contributes a single <strong>visual style</strong> across all of its cards, exactly
          as a suit does for its minors. (Their place on the other three axes is set by their number alone.)
        </p>
        {ma?.visual_style && <p style={{ ...mutedItalic, margin: "9px 0 0" }}>{ma.visual_style}</p>}
      </div>
    </div>
  );
}
function AxisLabel({ text, vertical }: { text: string; vertical?: boolean }) {
  return (
    <div style={{ display: "grid", placeItems: "center", color: GOLD, font: "400 11px/1 var(--font-mono)", letterSpacing: "0.13em", textTransform: "uppercase", writingMode: vertical ? "vertical-rl" : undefined, transform: vertical ? "rotate(180deg)" : undefined, padding: vertical ? 0 : "0 0 4px" }}>{text}</div>
  );
}

// ── Axis 2: Ranks ─────────────────────────────────────────────────────────────
function RanksPanel({ deck }: { deck: DeckDataFile }) {
  const ranks = Object.values(deck.ranks).sort((a, b) => a.index - b.index);
  const hasRankNumbers = ranks.length > 0 && ranks.every((rank) => rank.numeric_value !== undefined);
  const majors = Object.values(deck.cards)
    .filter((c) => c.arcana === "major")
    .map((c) => ({ n: parseInt(c.number, 10), name: c.name }))
    .sort((a, b) => a.n - b.n);
  return (
    <div>
      <Lead>
        Rank works differently for the two arcana. <strong>Minor cards</strong> share {ranks.length} ranks —
        a progression each suit answers in its own way. <strong>Major cards</strong> have no rank at all;
        instead each is numbered <strong>0–{majors.length ? majors[majors.length - 1].n : 21}</strong>, its
        fixed position in the arc. Both numbering systems are shown below.
      </Lead>

      <SubHead>Minor ranks{hasRankNumbers ? ` · ${ranks[0].numeric_value}–${ranks[ranks.length - 1].numeric_value}` : ""}</SubHead>
      <div style={{ display: "flex", flexDirection: "column", marginBottom: 26 }}>
        {ranks.map((r) => (
          <div key={r.index} style={{ display: "flex", gap: 14, padding: "11px 0", borderTop: `1px solid ${LINE}` }}>
            <div style={{ flex: "0 0 56px", textAlign: "right" }}>
              <div style={{ font: "400 20px/1 var(--font-display)", color: GOLD }}>{r.symbol || (r.numeric_value ?? "—")}</div>
              {r.numeric_value !== undefined && <div style={{ font: "400 10px/1.4 var(--font-mono)", color: MUTE }}>{r.numeric_value}</div>}
            </div>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ font: "400 16px/1.2 var(--font-display)", color: "var(--ink)" }}>{r.name}</div>
              {r.question && <div style={{ ...body, color: GOLD, fontStyle: "italic", margin: "3px 0 0", fontSize: 13 }}>{r.question.replace(/\{suit\}/g, "the suit")}</div>}
              {r.description && <p style={{ ...body, margin: "4px 0 0" }}>{r.description}</p>}
            </div>
          </div>
        ))}
      </div>

      <SubHead>Major arcana · 0–{majors.length ? majors[majors.length - 1].n : 21}</SubHead>
      <p style={{ ...body, color: MUTE, margin: "0 0 10px", fontSize: 13 }}>
        The majors' own sequence — each number is a named station of the journey, not a suit rank.
      </p>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(180px, 1fr))", gap: "4px 16px" }}>
        {majors.map((m) => (
          <div key={m.n} style={{ display: "flex", gap: 9, padding: "5px 0", font: "400 13px/1.4 var(--font-body)" }}>
            <span style={{ flex: "0 0 22px", textAlign: "right", color: GOLD, font: "400 13px/1.4 var(--font-mono)" }}>{m.n}</span>
            <span style={{ color: TEXT }}>{m.name}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

// ── Axis 3: Transversal ───────────────────────────────────────────────────────
function TransversalPanel({ tx, suitCount }: { tx: TransversalData; suitCount: number }) {
  void suitCount;
  const stations = Object.entries(tx.stations).map(([slug, station]) => ({ ...station, slug })).sort((a, b) => a.index - b.index);
  const k = tx.suit_stride ?? 1;
  return (
    <div>
      <Lead>
        The third axis is a <strong>substrate</strong>, not a grid line: a single named cycle laid{" "}
        <em>across</em> the suit×rank grid so it refuses to align with it. Unlike suits and ranks it is
        never declared — it's <strong>sublimated</strong> into each card's palette, light and mood. This
        deck's choice is <strong style={{ color: GOLD }}>{tx.name}</strong>.
      </Lead>
      <h3 style={{ font: "400 26px/1.1 var(--font-display)", color: "var(--ink)", margin: "0 0 10px" }}>{tx.name}</h3>
      <p style={{ ...body, margin: "0 0 12px" }}>{tx.description}</p>
      {tx.ordering_rationale && (
        <p style={{ ...mutedItalic, maxWidth: 720, margin: "0 0 14px", paddingLeft: 14, borderLeft: "2px solid var(--accent)" }}>{tx.ordering_rationale}</p>
      )}
      <p style={{ ...body, color: MUTE, margin: "0 0 16px", fontSize: 13 }}>
        {stations.length} stations; each card lands on one by a fixed walk (suit stride {k}{k === 1 ? ", the cleanest diagonal" : ""}),
        so a station recurs across suits and ranks — binding cross-cutting families of cards.
      </p>

      {/* the cycle, mapped out */}
      <div style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: 6, marginBottom: 18 }}>
        {stations.map((st, i) => (
          <Fragment key={st.slug}>
            <span style={{ font: "400 12px/1 var(--font-mono)", color: GOLD, background: "var(--accent-wash)", border: "1px solid var(--accent)", borderRadius: 20, padding: "5px 10px" }}>{st.index}. {st.name}</span>
            <span style={{ color: MUTE }} aria-hidden>{i < stations.length - 1 ? "→" : "↺"}</span>
          </Fragment>
        ))}
      </div>

      <div style={grid(280)}>
        {stations.map((st) => (
          <div key={st.slug} style={panel}>
            <div style={{ display: "flex", alignItems: "baseline", gap: 8 }}>
              <span style={{ font: "400 13px/1 var(--font-mono)", color: MUTE }}>{st.index}</span>
              <span style={{ font: "400 16px/1 var(--font-display)", color: "var(--ink)" }}>{st.name}</span>
            </div>
            {st.description && <p style={{ ...body, margin: "7px 0 0" }}>{st.description}</p>}
            {st.visual_motif && <p style={{ ...mutedItalic, margin: "7px 0 0" }}>{st.visual_motif}</p>}
            <Means m={st.meaning} />
          </div>
        ))}
      </div>
    </div>
  );
}

// ── Axis 4: Prime Factorization ───────────────────────────────────────────────
// Ω, the count of prime factors with multiplicity, is the one invariant axis: its
// color ramp (--fac-*) never re-themes. Source omega/facVar/facWord from cardMeta.
function primeFactors(n: number): number[] {
  if (n <= 1) return [];
  let m = n; const f: number[] = [];
  for (let d = 2; d * d <= m; d++) while (m % d === 0) { f.push(d); m /= d; }
  if (m > 1) f.push(m);
  return f;
}

function NumCell({ n }: { n: number }) {
  const o = omega(n);
  const factors = primeFactors(n);
  const col = `var(${facVar(o)})`;
  return (
    <div title={`${n} — Ω${o} ${facWord(o)}${factors.length > 1 ? ` (${factors.join("×")})` : ""}`}
      style={{ display: "grid", placeItems: "center", width: 34, height: 34, borderRadius: "var(--r-2)", background: "var(--paper-2)", border: `1px solid ${col}` }}>
      <span style={{ font: "400 14px/1 var(--font-mono)", color: col }}>{n}</span>
      {factors.length > 1 && <span style={{ font: "400 8px/1 var(--font-mono)", color: MUTE }}>{factors.join("·")}</span>}
    </div>
  );
}

function PrimePanel({ deck }: { deck: DeckDataFile }) {
  const cards = Object.values(deck.cards);
  const majors = [...new Set(cards.filter((c) => c.arcana === "major").map((c) => parseInt(c.number, 10)))].sort((a, b) => a - b);
  // the minor number-set is whatever numbers the minors actually carry — usually the ranks 1–14, but a
  // deck can number them otherwise (e.g. the Ultima Octave's minors are numbered 0–7 by their virtue's value).
  const minors = [...new Set(cards.filter((c) => c.arcana === "minor").map((c) => parseInt(c.number, 10)))].sort((a, b) => a - b);
  const mrange = minors.length ? `${minors[0]}–${minors[minors.length - 1]}` : "—";
  return (
    <div>
      <Lead>
        The fourth axis isn't woven into the deck's space — it's <strong>intrinsic</strong> to each card's
        number, and the same in every deck. Every number has a factorization, giving the card a character:
        an <strong style={{ color: "var(--fac-identity)" }}>identity</strong> (0 the void, 1 the unit of
        agency), a <strong style={{ color: "var(--fac-prime)" }}>prime</strong> (irreducible — it simply{" "}
        <em>is</em>), or a <strong style={{ color: "var(--fac-c2)" }}>composite</strong> (derived from
        its factors). Powers intensify (x² stabilizes, x³ masters or overreaches); products combine two
        energies. It rides under every card as a quiet undertone — the fourth quantum number.
      </Lead>
      <Legend />
      <Group title="Major arcana" subtitle="numbered by position, 0 upward">{majors.map((n) => <NumCell key={n} n={n} />)}</Group>
      <Group title="Minor arcana" subtitle={`the numbers the minor cards carry · ${mrange}`}>{minors.map((n) => <NumCell key={n} n={n} />)}</Group>
    </div>
  );
}
function Legend() {
  const items: [number, string, string][] = [
    [0, "Ω0 identity", "0, 1 — the void & the unit"],
    [1, "Ω1 prime", "irreducible"],
    [2, "Ω2 composite", "two prime factors"],
    [3, "Ω3 composite", "three prime factors"],
    [4, "Ω4+ composite", "four or more"],
  ];
  return (
    <div style={{ display: "flex", flexWrap: "wrap", gap: 14, margin: "0 0 18px" }}>
      {items.map(([o, name, label]) => {
        const col = `var(${facVar(o)})`;
        return (
          <span key={o} style={{ display: "flex", alignItems: "center", gap: 6, font: "400 12px/1 var(--font-body)", color: TEXT }}>
            <span style={{ width: 10, height: 10, borderRadius: 3, background: col }} />
            <strong style={{ color: col }}>{name}</strong>
            <span style={{ color: MUTE }}>· {label}</span>
          </span>
        );
      })}
    </div>
  );
}
function Group({ title, subtitle, children }: { title: string; subtitle: string; children: React.ReactNode }) {
  return (
    <div style={{ marginBottom: 18 }}>
      <SubHead>{title} <span style={{ opacity: 0.6, textTransform: "none", letterSpacing: 0, fontWeight: 400 }}>— {subtitle}</span></SubHead>
      <div style={{ display: "flex", flexWrap: "wrap", gap: 6, marginTop: 4 }}>{children}</div>
    </div>
  );
}

function SubHead({ children }: { children: React.ReactNode }) {
  return <h3 style={{ font: "400 11px/1 var(--font-mono)", letterSpacing: "0.13em", textTransform: "uppercase", color: MUTE, margin: "0 0 10px" }}>{children}</h3>;
}

const body: React.CSSProperties = { font: "400 14px/1.6 var(--font-body)", color: TEXT };
const mutedItalic: React.CSSProperties = { font: "400 12.5px/1.5 var(--font-body)", color: MUTE, fontStyle: "italic" };
const panel: React.CSSProperties = { padding: 14, borderRadius: "var(--r-3)", background: PANEL, border: `1px solid ${LINE}`, boxShadow: "var(--e-1)" };
const grid = (min: number): React.CSSProperties => ({ display: "grid", gridTemplateColumns: `repeat(auto-fit, minmax(min(${min}px, 100%), 1fr))`, gap: 12 });
