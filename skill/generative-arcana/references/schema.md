# Generative Arcana Schema

The JSON shape of the **default four-suit tarot construction profile**. One principle governs it: **atomic at write, derived at read.** Every axis's contribution is stored once; a card stores only slugs plus the things it originates — its integrated meaning and its integrated visual description (a **major** additionally carries a factorization gloss; see below).

## Profile scope and portable runtime

The cardinalities below (four suits, fourteen ranks, twenty-two majors) and rank-originated minor
numbers describe this authoring profile, not every deck the application can represent. Ulysses has
21 majors; Ultima Octave has eight suits and eight ranks, suit-originated minor numbers, and authored
minor factorization glosses. Those are deliberate constructions, not malformed conventional tarot.

The app's portable card type uses deck-local string slugs, and its import validator checks fields,
indices, and references without enforcing this profile's cardinalities, number origin, or walk.
Do not infer a generation strategy from card count alone. The normalization rules below apply to the
default profile; another profile must state where its numbers and glosses originate.

Renderer independence does not mean absence of visual information: axis styles, SVG symbols, and
integrated scene descriptions are authored **iconographic briefs**. Executable rendering and finished
skins are a separate layer.

## Why this schema looks the way it does

A card is an integration over four axes. Three are stored entities the card references by slug (suit, rank, station); the fourth (prime/composite) is derived from the number, and its *gloss* is stored only where the number is originated. So:

- **Suit, rank, and station live once.** A card points at them by slug and never copies their `visual_style`, `visual_content`, or `visual_motif`. Those are reachable by reference at the point of use.
- **A card stores `meaning` (integrated) and `visuals.detailed_description` (integrated);** a major also stores `factorization.gloss`. Plus optional `style`/`content` overrides, present only on deviation.
- **The prime/composite gloss is stored only where the number is originated.** The factorization is always derived from the number. The *gloss* (what the factorization means) is authored — but a **minor's** number is its **rank's** value (1–14), shared by all four suits at that rank, so the gloss, if authored, lives on the `Rank` (once) and minor cards derive their character by reference. A **major's** number (0–21) is unique to the card with no rank to hold it, so its gloss lives on `MajorArcanaCard.factorization.gloss` and is **required**. Glossing every minor card would be denormalization. See `references/numeric_axis.md`.

## Interfaces

```typescript
interface Theme {
  name: string         // concise canonical name
  description: string  // evocative; rich enough to sustain generation
  creator: string      // how the user wishes to be credited
}

enum Arcana { Major = "major", Minor = "minor" }

// ─────────────────────────────────────────────────────────────
// AXES — stored entities, referenced by slug.
// ─────────────────────────────────────────────────────────────

// SUIT — grid axis. DECLARE. ORDERED (index 0–3) so the transversal walk is deterministic.
interface Suit {
  index: number                                  // 0–3; fixed suit order
  name: string
  slug: string                                   // lowercase, hyphenated
  description: string
  symbol: { name: string; description: string; svg: string }  // glyph, stamped on the card
  meaning: { upright: string[]; inverted: string[] }          // 3–6 each; a generative palette
  visual_style: string                           // colors, perspective, art movement, composition
}

// RANK — grid axis. DECLARE. 14 MINOR ranks (majors have no rank layer).
interface Rank {
  index: number                                  // 0-based: 0 = Ace … 13 = fourth face
  arcana: Arcana.Minor
  numeric_value: number                          // 1–14  (this number carries the prime/composite axis)
  name: string                                   // "Ace", "Two"…"Ten", or face-rank name
  symbol: string                                 // glyph: "A","II"…"X", or face-rank initial
  description: string                            // the rank's framework (the abstraction it poses)
  question?: string                              // numbered ranks: the question, with a literal {suit}
                                                 //   placeholder, e.g. "What stabilizes {suit}?" — consumers
                                                 //   substitute the suit name. Omit for face ranks.
  factorization?: {                                    // OPTIONAL: the gloss for this rank's number (1–14), authored ONCE
                                                 //   and shared by all four suits at this rank. Load-bearing under
                                                 //   ranks/prime_scaffold; omittable otherwise (often not worth it).
                                                 //   Minor cards DERIVE their character from here — they never store it.
    character: "identity" | "prime" | "composite"
    factors?: number[]
    gloss: string
  }
  meaning: { upright: string[]; inverted: string[] }
  visual_content: string                         // abstract imagery this rank depicts, before styling
}

// TRANSVERSAL — substrate axis. SUBLIMATE. REQUIRED. Covers every card.
interface Station {
  slug: string
  index: number                                  // position in the canonical order (0-based)
  name: string
  description: string                            // a concise one-line statement of what the station
                                                 //   represents — for the meta-layer (legends, filters, detail tables)
  symbol?: { name: string; description: string; svg: string }  // OPTIONAL transverse-axis glyph.
                                                 //   Meta-layer by default; may surface on a card face only
                                                 //   tastefully and by exception. See svg_symbols.md.
  meaning: { upright: string[]; inverted: string[] }  // semantic charge; carried as undertone
  visual_motif: string                           // palette temperature, light, density, the
                                                 //   compositional constraint a scene plays out WITHIN
}

interface Transversal {
  name: string
  description: string
  ordering_rationale: string                     // why THIS sequence in THIS order; what the order means
  suit_stride?: number                           // the per-suit kick; coprime to N; default 1. See "The walk".
  stations: { [station_slug: string]: Station }  // N stations, N ≥ 4
}

// MAJOR ARCANA — a suit contributing ONLY visual_style. No MajorRank type; 22 cards built directly.
interface MajorArcana {
  story: string
  visual_style: string                           // DECLARE; may act as a superset of suit styles
  symbol?: { name: string; description: string; svg: string }
}

// ─────────────────────────────────────────────────────────────
// CARDS — slugs + integrated outputs only.
// ─────────────────────────────────────────────────────────────

interface Card {
  name: string
  number: string                                 // major: "0".."21"; minor: numeric_value "1".."14"
                                                 //   (this string's value carries the prime/composite axis)
  slug: string
  arcana: Arcana
  station_slug: string                           // → transversal station, from the walk (every card has one)
  meaning: { upright: string; inverted: string } // INTEGRATED prose across the axes (originated here)
  visuals: {
    detailed_description: string                 // the ONE concrete, unique, integrated scene (originated here)
    style_override?: string                      // present only if this card refines suit/major visual_style
    content_override?: string                    // present only if this card refines rank visual_content
  }
}

interface MinorArcanaCard extends Card {
  arcana: Arcana.Minor
  suit_slug: string
  rank_slug: string
  // slug = `${suit_slug}-${rank_slug}`
}

interface MajorArcanaCard extends Card {
  arcana: Arcana.Major
  factorization: {                                     // the fourth axis — majors carry it PER CARD (no rank to hold it)
    character: "identity" | "prime" | "composite"
    factors?: number[]                           // composite only: e.g. [2,2] for 4 (DERIVED; stored for legibility)
    gloss: string                                // AUTHORED, integrated: what this number's character means for this
                                                 //   major. Composites name their factor-majors ("Major 2 squared —
                                                 //   The Two Moons stabilized into …"). A gloss that won't cohere is
                                                 //   signal the slot is miscast. See numeric_axis.md.
  }
  // slug = `major-${number}`  (no suit_slug, no rank_slug)
}

// Optional, deck-level. Present ONLY when the four suits were built as a cross-product of two
// dialectics (the `suits/dialectical` strategy). Names the two axes and places each suit in the
// grid, so a consumer can lay the suits out as a labeled 2×2. Omit entirely for other suit
// strategies (e.g. `suits/manual`) — it is the single switch for "is this deck dialectical?".
interface SuitDialectic {
  axes: [
    { name: string; poles: [string, string] },   // axis 0 — e.g. { name: "Realm", poles: ["World","Soul"] }
    { name: string; poles: [string, string] },   // axis 1 — e.g. { name: "Way",   poles: ["Throne","Road"] }
  ]
  cells: { [suit_slug: string]: [string, string] }  // each suit's pole on axis 0 and axis 1, e.g.
                                                 //   { crowns: ["World","Throne"], … } — poles must match axes[].poles
}

interface Deck {
  name: string                                   // theme name + " Tarot"
  slug: string
  version: string                                // semver
  theme: Theme
  suits: { [suit_slug: string]: Suit }           // exactly 4, ordered by index
  ranks: { [rank_slug: string]: Rank }           // exactly 14 (minor)
  transversal: Transversal                       // REQUIRED
  major_arcana: MajorArcana
  dialectic?: SuitDialectic                      // OPTIONAL: the suit cross-product axes (see SuitDialectic)
  cards: { [card_slug: string]: MinorArcanaCard | MajorArcanaCard }  // 78: 22 major, then minors by suit then rank
}
```

## The walk

The transversal touches every card, so station assignment is **deterministic and structural** — no configured anchor. The suit order (`Suit.index`) and rank order (`Rank.index`) fix it. Let `N` = number of stations (indexed `0 … N-1` in canonical order) and `k = transversal.suit_stride` (default 1).

- **Minor walk** — `station_index = (rank.index + k · suit.index) mod N`. Origin: the first suit's Ace (suit 0, rank 0) → station 0.
- **Major walk** — a *separate* walk. `station_index = major_number mod N`. Origin: Major 0 → station 0.

Resolve each `station_index` to a `station_slug` via the canonical order and write it to the card. (Materialized for self-description and querying, though recoverable from structure.)

**Why `k`, and why not a plain continuous count.** Laying the 56 minors out as contiguous 14-rank suits and walking `station = (14·suit + rank) mod N` looks continuous and clean, but when `N` divides 14 — which the classic **7** does — it collapses: `14·suit ≡ 0 (mod 7)`, so `station = rank mod N`, identical in every suit, and the axis stops cross-cutting entirely. The escape is a per-suit kick `k` **coprime to N** (the suit stride): each suit's walk is shifted, so no two suits share a pattern. The major walk has no suit coordinate, so it needs no per-suit kick.

**Choosing `k` — the fold.** `k` is the *chord* the four suits strike through the qualitative cycle. At a fixed rank they occupy `{r, r+k, r+2k, r+3k} mod N`: `k = 1` packs them onto four adjacent stations (a *close voicing* — suit-neighbors are quality-neighbors); larger `k` spreads them around the ring (an *open voicing* — adjacent suits draw on distant qualities), folding the grid-to-cycle map more and widening the surface for cross-suit correspondence. The choice is **N-relative** — you cannot hardcode a stride:

- **Full-cycle design rule:** choose `k` coprime to `N`. Repeated stride steps then visit all `N` stations. For `S` consecutive suits, distinct stations at a fixed rank require only `S ≤ N / gcd(N, k)`: coprimality is sufficient when `S ≤ N`, but is not necessary. For example, `N = 8`, `k = 2`, `S = 4` gives `0, 2, 4, 6`, all distinct; `N = 6`, `k = 3`, `S = 4` gives only two. If `S > N`, no stride avoids collisions. This profile deliberately retains the stronger coprime rule. `k` and `N−k` are mirror images, so the full-cycle choices are the coprime `k` in `1 … ⌊N/2⌋`.
- **Default `k = 1`** — the cleanest, most legible diagonal. This is the explicit version of what traditional tarot achieves implicitly by scattering each suit across three non-adjacent zodiac triplicities (see `references/tarot_structure.md`).
- **To unfold**, climb toward `⌊N/2⌋` for more fold; the maximal fold is the largest coprime ≤ `⌊N/2⌋`. For N = 7 the ladder is 1 → 2 → 3; N = 5 is 1 → 2; N = 9 is 1 → 2 → 4 (3 drops out — shared factor). Unfold when the theme wants denser correspondence and can carry the reduced legibility.

## Field notes

**Suits are ordered.** `Suit.index` 0–3 is load-bearing: the minor walk reads it. Keep `suits` keyed by slug but treat `index` as the source of truth for order.

**Meaning palettes vs. integrated meaning.** Axes carry *lists* (a 3–6 sense palette, deliberately unreduced). A card carries *prose* (the synthesis). List = atom; prose = integration. See `integration.md`.

**Overrides, not guidance.** No per-card `style_guidance`/`content_guidance` copies. A card writes only the *delta* into `style_override`/`content_override`, or leaves them unset to inherit from its axis.

**station_slug is the only *textual* mark the transversal leaves on a card.** No per-card station prose — that would re-denormalize and foreground the sublimated axis. The station reaches the card through the integration pass; the slug exists so cross-cutting families stay queryable. (A station's optional `symbol` may surface on a card face by deliberate exception — see `references/svg_symbols.md` — but that is a visual choice in the `detailed_description`, never stored station text on the card.)

**The prime/composite gloss lives on the major (and optionally the rank), never on a minor card.** The factorization is always derived from the number. The authored *gloss* is stored only where the number is originated: on each **major** (`MajorArcanaCard.factorization.gloss`, required — the trumps are the prime structure's home), and optionally **once per rank** (`Rank.factorization`, mainly under `ranks/prime_scaffold`; usually not worth authoring otherwise). A **minor card stores no factorization** — its character is its rank's, recovered by reference. The gloss is authored like `meaning` and can be done well or badly: one that won't follow from the factors is a generative signal, not a field to fill mechanically. See `references/numeric_axis.md`.

**Canonical card order is derived, not key order.** `cards` stays keyed by slug for O(1) lookup, and is emitted in canonical order (22 majors by number, then minors by suit then rank). But consumers that need the order — anything that sorts, paginates, or references a card by position — must *derive* it (majors first by `number`; minors by `suit.index` then `rank.index`), not rely on JSON object key order, which no spec guarantees.

**Majors carry no rank.** A major's `number` is its position 0–21; its meaning and visuals come straight from the chosen `strategies/majors/` method, integrated with `major_arcana.visual_style` (declared), its `station_slug` (sublimated), and its prime character (latent).

**Naming.** Numbered ranks: index 0 → "Ace", 1–9 → "Two"…"Ten". Face ranks (index 10–13): the rank's `name`, no "the". Majors: the card's own name.
