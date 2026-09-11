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

New authoring workflows emit a **schema-v2 `DeckManifest`**, not a bare deck payload and not a catalog/account record:

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

- **Suit, rank, and station live once.** A card points at them by slug and never copies their `visual_style`, `visual_content`, or `visual_motif`. Those are reachable by reference at the point of use.
- **A card stores `meaning` (integrated) and `visuals.detailed_description` (integrated);** a major also stores `factorization.gloss`. Plus optional `style`/`content` overrides, present only on deviation.
- **The prime/composite gloss is stored only where the number is originated.** The factorization is always derived from the number. The *gloss* (what the factorization means) is authored — but a **minor's** number is its **rank's** value (1–14), shared by all four suits at that rank, so the gloss, if authored, lives on the `Rank` (once) and minor cards derive their character by reference. A **major's** number (0–21) is unique to the card with no rank to hold it, so its gloss lives on `MajorArcanaCard.factorization.gloss` and is **required**. Glossing every minor card would be denormalization. See `references/numeric_axis.md`.

## Resolved card reads

Atomic-at-write does **not** require normalized reads. The platform's resolved card render view deliberately embeds the inherited deck/family/rank/station/number visual context next to the card's concrete scene so one returned card is sufficient input for a human artist or generative renderer. That resolved projection is derived; do not copy it back into every authored card.

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
  index: number
  name: string
  slug: string
  description: string
  symbol: { name: string; description: string; svg: string }
  meaning: { upright: string[]; inverted: string[] }
  visual_style: string
}

// RANK — grid axis. DECLARE. 14 MINOR ranks (majors have no rank layer).
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
    visual_logic?: string
  }
  meaning: { upright: string[]; inverted: string[] }
  visual_content: string
}

interface Station {
  slug: string
  index: number
  name: string
  description: string
  symbol?: { name: string; description: string; svg: string }
  meaning: { upright: string[]; inverted: string[] }
  visual_motif: string
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
  visual_style: string
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
    detailed_description: string
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
    gloss: string
    visual_logic?: string
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
  suits: { [suit_slug: string]: Suit }
  ranks: { [rank_slug: string]: Rank }
  transversal: Transversal
  major_arcana: MajorArcana
  dialectic?: SuitDialectic
  cards: { [card_slug: string]: MinorArcanaCard | MajorArcanaCard }
}
```

The structured visual-grammar extensions are documented separately in `docs/visual-grammar.md` and will be incorporated into the default authoring profile; legacy prose visual fields remain accepted by the runtime.

## The walk

The transversal touches every card, so station assignment is **deterministic and structural** — no configured anchor. The suit order (`Suit.index`) and rank order (`Rank.index`) fix it. Let `N` = number of stations (indexed `0 … N-1` in canonical order) and `k = transversal.suit_stride` (default 1).

- **Minor walk** — `station_index = (rank.index + k · suit.index) mod N`. Origin: the first suit's Ace (suit 0, rank 0) → station 0.
- **Major walk** — a *separate* walk. `station_index = major_number mod N`. Origin: Major 0 → station 0.

Resolve each `station_index` to a `station_slug` via the canonical order and write it to the card. (Materialized for self-description and querying, though recoverable from structure.)

## Field notes

**Suits are ordered.** `Suit.index` is load-bearing for structural walks. Keep `suits` keyed by slug but treat `index` as the source of truth for order.

**Meaning palettes vs. integrated meaning.** Axes carry *lists*; a card carries *prose*. List = atom; prose = integration. See `integration.md`.

**Overrides, not guidance.** No per-card copies of parent visual grammar. A card writes only genuine `style_override` / `content_override` deltas.

**station_slug is the only textual mark the transversal must leave on a card.** The full station context is recoverable and may be embedded in a resolved read projection without being duplicated in authored storage.

**The prime/composite gloss lives on the major (and optionally the rank), never on a minor card.** The optional `visual_logic` follows the same ownership rule: write the formal consequence where the number originates; resolve it into the card view later.

**Canonical card order is derived, not key order.** Consumers derive majors by `number` and minors by `suit.index` then `rank.index`; JSON key order is not semantic card order.
