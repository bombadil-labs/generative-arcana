# Generative Arcana Schema

The normalized symbolic payload inside a canonical Generative Arcana `DeckManifest`. One principle governs it: **atomic at write, derived at read.** Every axis's contribution is stored once; a card stores only slugs plus the things it originates — its integrated meaning and its integrated visual description (a **major** additionally carries a factorization gloss; see below).

## Authoring profile versus runtime contract

The interfaces below describe the **default 78-card tarot authoring profile**: four suits, fourteen
ranks, and twenty-two majors, with the minor number originating at rank. They are not universal
runtime cardinality or numeric-origin constraints. Ultima Octave is an existing alternate profile:
eight suits × eight ranks plus twenty-two majors (86 cards), with suit-originating numbers and authored
minor glosses. Do not force that deck back into the default profile.

The app's runtime import validator checks field shapes, ordered axes, every card, and referential
integrity. It permits incomplete decks and variant cardinalities and does not enforce the default
walk or numeric-origin rules. Profile-specific generation/quality checks are a separate concern;
explicit machine-readable profile selection is still future work. See `docs/contracts-and-readings.md`.

## Canonical authored artifact

New authoring workflows emit a **`DeckManifest`**, not a bare deck payload and not a catalog/account record:

```typescript
interface DeckManifest {
  schemaVersion: 2 // canonical schema version; older envelopes are compatibility input only
  data: Deck       // the symbolic payload defined below
  tagline: string  // required, concise human-facing summary
  spreads?: Spread[]
}

interface SpreadPosition {
  name: string
  prompt: string
}

interface Spread {
  id: string
  name: string
  description: string
  positions: SpreadPosition[]
  deckId?: string  // normalized by the platform; new authoring should normally omit it
}
```

The `Deck` interface below is therefore `manifest.data`. `schemaVersion` versions the authored envelope independently of the deck's own content `version`. Existing v1 manifests (which omitted `schemaVersion`) and bare `Deck` payloads remain compatibility inputs and are normalized to v2; new producers must emit `schemaVersion: 2`.

`manifest.data.slug` is authored metadata. It is **not** Generative Arcana's durable resource identity; the catalog assigns an opaque stable ID after import. Likewise, do not put owner IDs, visibility, revisions/timestamps, OAuth/provider/session data, MCP metadata, or renderer implementation objects into the manifest. Those are host/catalog concerns layered around the authored artifact.

In the repository, `docs/deck-manifest.md` is the normative platform contract. This reference describes the authoring payload used by the skill.

## Why this schema looks the way it does

A card is an integration over four axes. Three are stored entities the card references by slug (suit, rank, station); the fourth (prime/composite) is derived from the number, and its *gloss* is stored only where the number is originated. So:

- **Suit, rank, and station live once.** A card points at them by slug and never copies their visual grammar. Those facts are reachable by reference at the point of use and embedded in resolved card views.
- **A card stores `meaning` (integrated) and `visuals.detailed_description` (integrated);** a major also stores `factorization.gloss`. Plus optional `style`/`content` overrides, present only on deviation.
- **The prime/composite gloss is stored only where the number is originated.** The factorization is always derived from the number. The *gloss* (what the factorization means) is authored — but a **minor's** number is its **rank's** value (1–14), shared by all four suits at that rank, so the gloss, if authored, lives on the `Rank` (once) and minor cards derive their character by reference. A **major's** number (0–21) is unique to the card with no rank to hold it, so its gloss lives on `MajorArcanaCard.factorization.gloss` and is **required**. Glossing every minor card would be denormalization. See `references/numeric_axis.md`.

## Interfaces

```typescript
interface Theme {
  name: string         // concise canonical name
  description: string  // evocative; rich enough to sustain generation
  creator: string      // how the user wishes to be credited
}

interface DeckVisualLanguage {
  medium?: string
  surface?: string
  mark_making?: string
  signature_accent?: string
  finish?: string
  avoid?: string[]
}

interface VisualFamilyGrammar {
  medium_handling?: string
  composition?: string
  edge_language?: string
  value_structure?: string
  camera_and_scale?: string
  detail_distribution?: string
  finish?: string
  avoid?: string[]
}

interface RankVisualForm {
  composition_law?: string
  spatial_logic?: string
  rhythm?: string
  density?: string
  figure_ground?: string
}

interface StationVisualEnvironment {
  illumination?: string
  palette?: string
  atmosphere?: string
  motion?: string
  density?: string
  material_effects?: string
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
  visual_style: string                           // concise legacy/general summary
  visual_grammar?: VisualFamilyGrammar           // default authoring profile should populate this
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
  factorization?: {                              // OPTIONAL: number-owned interpretation, written once on rank
    character: "identity" | "prime" | "composite"
    factors?: number[]
    gloss: string
    visual_logic?: string                        // formal/compositional consequence of the number
  }
  visual_form?: RankVisualForm                   // formal identity across suits
  meaning: { upright: string[]; inverted: string[] }
  visual_content: string                         // abstract imagery this rank depicts, before styling
}

// TRANSVERSAL — substrate axis. SUBLIMATE. REQUIRED. Covers every card.
interface Station {
  slug: string
  index: number                                  // position in the canonical order (0-based)
  name: string
  description: string                            // concise meta-layer statement of the station
  symbol?: { name: string; description: string; svg: string }  // optional transverse-axis glyph
  meaning: { upright: string[]; inverted: string[] }           // semantic charge; carried as undertone
  visual_motif: string                           // concise legacy/general summary
  visual_environment?: StationVisualEnvironment // environmental modulation; must not replace family grammar
}

interface Transversal {
  name: string
  description: string
  ordering_rationale: string                     // why THIS sequence in THIS order; what the order means
  suit_stride?: number                           // the per-suit kick; coprime to N; default 1. See "The walk".
  stations: { [station_slug: string]: Station }  // N stations, N ≥ 4
}

// MAJOR ARCANA — a visual family, no MajorRank type; 22 cards built directly.
interface MajorArcana {
  story: string
  visual_style: string                           // concise legacy/general summary
  visual_grammar?: VisualFamilyGrammar           // Major-family handling/composition system
  symbol?: { name: string; description: string; svg: string }
}

// ─────────────────────────────────────────────────────────────
// CARDS — slugs + integrated outputs only.
// ─────────────────────────────────────────────────────────────

interface Card {
  name: string
  number: string                                 // major: "0".."21"; minor: numeric_value "1".."14"
  slug: string
  arcana: Arcana
  station_slug: string                           // → transversal station, from the walk
  meaning: { upright: string; inverted: string } // INTEGRATED prose across the axes
  visuals: {
    detailed_description: string                 // concrete scene unique to this card
    style_override?: string                      // genuine exception only
    content_override?: string                    // genuine exception only
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
  factorization: {
    character: "identity" | "prime" | "composite"
    factors?: number[]                           // composite only; derived, stored for legibility
    gloss: string                                // AUTHORED semantic consequence
    visual_logic?: string                        // AUTHORED formal ancestry/consequence; default profile normally writes it
  }
  // slug = `major-${number}`
}

// Optional, deck-level. Present only when suits are the cross-product of two dialectics.
interface SuitDialectic {
  axes: [
    { name: string; poles: [string, string] },
    { name: string; poles: [string, string] },
  ]
  cells: { [suit_slug: string]: [string, string] }
}

interface Deck {
  name: string                                   // theme name + " Tarot"
  slug: string
  version: string                                // authored content version
  theme: Theme
  visual_language?: DeckVisualLanguage           // default profile should populate shared material world
  suits: { [suit_slug: string]: Suit }           // exactly 4 in default profile, ordered by index
  ranks: { [rank_slug: string]: Rank }           // exactly 14 in default profile
  transversal: Transversal                       // REQUIRED
  major_arcana: MajorArcana
  dialectic?: SuitDialectic
  cards: { [card_slug: string]: MinorArcanaCard | MajorArcanaCard }
}
```

## Resolved visual read model

The source model above stays normalized: a card does not repeat its deck, family, rank, station, or numeric visual grammar. On read, Generative Arcana deliberately denormalizes those facts into `CardRenderSpec`; `get_card(...).render` contains the full resolved context plus the concrete card scene. That is the handoff a human artist or generative image system should consume. See `references/visual_language.md` and `docs/schema-v2.md`.

## The walk

The transversal touches every card, so station assignment is **deterministic and structural** — no configured anchor. The suit order (`Suit.index`) and rank order (`Rank.index`) fix it. Let `N` = number of stations (indexed `0 … N-1` in canonical order) and `k = transversal.suit_stride` (default 1).

- **Minor walk** — `station_index = (rank.index + k · suit.index) mod N`. Origin: the first suit's Ace (suit 0, rank 0) → station 0.
- **Major walk** — a *separate* walk. `station_index = major_number mod N`. Origin: Major 0 → station 0.

Resolve each `station_index` to a `station_slug` via the canonical order and write it to the card. (Materialized for self-description and querying, though recoverable from structure.)

**Why `k`, and why not a plain continuous count.** Laying the 56 minors out as contiguous 14-rank suits and walking `station = (14·suit + rank) mod N` looks continuous and clean, but when `N` divides 14 — which the classic **7** does — it collapses: `14·suit ≡ 0 (mod 7)`, so `station = rank mod N`, identical in every suit, and the axis stops cross-cutting entirely. The escape is a per-suit kick `k` **coprime to N** (the suit stride): each suit's walk is shifted, so no two suits share a pattern. The major walk needs no kick: 22 ≡ 1 mod 7, so a plain count never realigns.

**Choosing `k` — the fold.** `k` is the *chord* the suits strike through the qualitative cycle. At a fixed rank they occupy `{r, r+k, r+2k, r+3k} mod N`: `k = 1` packs them onto adjacent stations; larger `k` spreads them around the ring. The choice is N-relative.

- **Full-cycle design rule:** choose `k` coprime to N. This is sufficient, not necessary, for distinct suit offsets. With S consecutive suit indices, the exact noncollision condition is `S ≤ N / gcd(N,k)`.
- **Default `k = 1`** — cleanest, most legible diagonal.
- **To unfold**, climb toward `floor(N/2)` through valid coprime strides for more fold.

## Field notes

**Suits are ordered.** `Suit.index` is load-bearing: the minor walk reads it. Keep `suits` keyed by slug but treat `index` as the source of truth for order.

**Meaning palettes vs. integrated meaning.** Axes carry lists (an unreduced sense palette); a card carries prose (the synthesis). List = atom; prose = integration. See `integration.md`.

**Overrides, not guidance.** No per-card copies of parent art direction. A card writes only genuine `style_override` / `content_override` deltas, or leaves them unset to inherit.

**station_slug is the textual reference; station environment resolves at read.** No per-card station prose is needed merely for self-contained reads; `CardRenderSpec` supplies the inherited environment. A station may still surface its optional symbol deliberately and rarely per `references/svg_symbols.md`.

**The prime/composite gloss and visual logic live at number origin.** Majors own them per card; ranks may own them once when load-bearing; minor cards inherit rank number context rather than duplicating it. See `references/numeric_axis.md`.

**Canonical card order is derived, not key order.** Consumers that need order derive majors by `number`; minors by `suit.index` then `rank.index`. JSON property insertion order is not semantic card order.

**Majors carry no rank.** A major's semantic content comes directly from its majors strategy, visual family from `major_arcana`, station environment from the major walk, and numeric formal ancestry from factorization.

**Naming.** Numbered ranks: index 0 → "Ace", 1–9 → "Two"…"Ten". Face ranks (index 10–13): the rank's `name`, no "the". Majors: the card's own name.
