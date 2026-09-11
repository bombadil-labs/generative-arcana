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

interface Suit {
  index: number
  name: string
  slug: string
  description: string
  symbol: { name: string; description: string; svg: string }
  meaning: { upright: string[]; inverted: string[] }
  visual_style: string                           // concise legacy/general summary
  visual_grammar?: VisualFamilyGrammar           // default authoring profile should populate this
}

interface Rank {
  index: number
  arcana: Arcana.Minor
  numeric_value: number
  name: string
  symbol: string
  description: string
  question?: string
  factorization?: {
    character: "identity" | "prime" | "composite"
    factors?: number[]
    gloss: string
    visual_logic?: string                        // formal/compositional consequence of the number
  }
  visual_form?: RankVisualForm                   // formal identity across suits
  meaning: { upright: string[]; inverted: string[] }
  visual_content: string                         // abstract imagery/event before suit styling
}

interface Station {
  slug: string
  index: number
  name: string
  description: string
  symbol?: { name: string; description: string; svg: string }
  meaning: { upright: string[]; inverted: string[] }
  visual_motif: string                           // concise legacy/general summary
  visual_environment?: StationVisualEnvironment // environmental modulation; must not replace family grammar
}

interface Transversal {
  name: string
  description: string
  ordering_rationale: string
  suit_stride?: number
  stations: { [station_slug: string]: Station }
}

interface MajorArcana {
  story: string
  visual_style: string                           // concise legacy/general summary
  visual_grammar?: VisualFamilyGrammar           // Major-family handling/composition system
  symbol?: { name: string; description: string; svg: string }
}

interface Card {
  name: string
  number: string
  slug: string
  arcana: Arcana
  station_slug: string
  meaning: { upright: string; inverted: string }
  visuals: {
    detailed_description: string                 // concrete scene unique to this card
    style_override?: string
    content_override?: string
  }
}

interface MinorArcanaCard extends Card {
  arcana: Arcana.Minor
  suit_slug: string
  rank_slug: string
}

interface MajorArcanaCard extends Card {
  arcana: Arcana.Major
  factorization: {
    character: "identity" | "prime" | "composite"
    factors?: number[]
    gloss: string                                // AUTHORED semantic consequence
    visual_logic?: string                        // AUTHORED formal ancestry/consequence; default profile normally writes it
  }
}

interface SuitDialectic {
  axes: [
    { name: string; poles: [string, string] },
    { name: string; poles: [string, string] },
  ]
  cells: { [suit_slug: string]: [string, string] }
}

interface Deck {
  name: string
  slug: string
  version: string
  theme: Theme
  visual_language?: DeckVisualLanguage           // default profile should populate shared material world
  suits: { [suit_slug: string]: Suit }
  ranks: { [rank_slug: string]: Rank }
  transversal: Transversal
  major_arcana: MajorArcana
  dialectic?: SuitDialectic
  cards: { [card_slug: string]: MinorArcanaCard | MajorArcanaCard }
}
```

## Resolved visual read model

The source model above stays normalized: a card does not repeat its deck, family, rank, station, or numeric visual grammar. On read, Generative Arcana deliberately denormalizes those facts into `CardRenderSpec`; `get_card(...).render` contains the full resolved context plus the concrete card scene. That is the handoff a human artist or generative image system should consume. See `references/visual_language.md` and `docs/schema-v2.md`.

## The walk

The transversal touches every card, so station assignment is **deterministic and structural** — no configured anchor. The suit order (`Suit.index`) and rank order (`Rank.index`) fix it. Let `N` = number of stations and `k` = transversal `suit_stride` (default 1).

- **Minor walk** — `station_index = (rank.index + k · suit.index) mod N`. Origin: first suit's Ace → station 0.
- **Major walk** — `station_index = major_number mod N`. Origin: Major 0 → station 0.

Resolve each station index to `station_slug` via canonical station order.

**Why the kick.** A plain continuous count over contiguous 14-rank suits collapses when N divides 14. The per-suit stride de-aligns suits. Choose a full-cycle `k` coprime to N when possible; more generally distinct suit offsets require `S ≤ N / gcd(N,k)` for S suits. `k=1` is the most legible close voicing; larger coprime values fold the suits more widely around the station ring.

## Field notes

**Suits are ordered.** `Suit.index` is load-bearing for structural walks.

**Meaning palettes vs. integrated meaning.** Axes carry lists; a card carries synthesized prose. See `integration.md`.

**Overrides, not guidance.** A card writes only genuine `style_override` / `content_override` deltas; inherited visual grammar remains on its owning layers.

**station_slug is the textual reference; environment resolves at read.** Do not copy station prose into each stored card merely to make reads convenient. `CardRenderSpec` performs that denormalization.

**The prime/composite gloss and visual logic live at number origin.** Majors own theirs; ranks may own them once when load-bearing; minors inherit rank number context rather than duplicating it.

**Canonical card order is derived, not key order.** Consumers sort majors by `number`; minors by `suit.index` then `rank.index`.

**Majors carry no rank.** Their semantic content comes from the majors strategy, family visual grammar from `major_arcana`, station environment from the major walk, and numeric formal ancestry from factorization.
