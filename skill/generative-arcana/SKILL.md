---
name: generative-arcana
description: Design thematically coherent custom tarot decks woven from four symbolic axes — suit, rank, a required transversal substrate (the generalization of tarot's Chaldean/decan order), and the latent prime/composite character of each card's number. Use when the user asks to create, design, or generate a custom tarot deck for a theme (e.g. "design a cyberpunk tarot deck", "make a tarot deck about ocean mythology"). This portable skill routes a per-stage generation plan and emits one canonical DeckManifest artifact.
---

# Generative Arcana

This is the **portable, host-neutral authoring workflow** for Generative Arcana. ChatGPT, Claude, the web product, and future hosts may provide different intelligence or UX around it; they do not get different deck semantics.

A custom tarot designer built on one idea: **a tarot deck is a small semantic space woven from a few axes, and every card is an integration over those axes.** Traditional tarot wove two (suit, rank), laid a third across them (the planets, in Chaldean order, as decan rulers), and carried a fourth silently in its numbering (the prime/composite structure of the trumps). Generative Arcana makes all four explicit, lets you re-instantiate each for any theme, and stores only what each card genuinely adds.

v2.0. Changes from v1: the fourth (prime/composite) axis is now **baked in where the number is originated** — each **major** stores an authored `factorization.gloss`, and a gloss that won't cohere is treated as *signal* that the slot is miscast (was: derived-only, stored nothing). Minors derive their character from their **rank**, which may carry an optional gloss; minor cards store no factorization (glossing all 56 would denormalize). Stations gain an optional concise `description` and an optional `symbol` (meta-layer by default; may surface tastefully). Numbered ranks gain a `question` with a literal `{suit}` placeholder. Per-card `description` is dropped (it was redundant with `meaning`). See `references/schema.md`.

## The formalism (read this first)

Four axes, two kinds, one storage rule. Internalize this before generating anything.

**The four axes.**

- **Suit** — a *grid* axis. Minors only. Integration mode: **declare**. Stamps a glyph; states its style and meaning openly.
- **Rank** — a *grid* axis. Minors only (majors use their position directly). Integration mode: **declare**. Stamps a glyph; states its content and meaning openly.
- **Transversal (station)** — a *substrate* axis. **Required**, and it covers **every** card. A single canonically-ordered cycle of N stations laid *across* the suit×rank grid so it refuses to align with it. Integration mode: **sublimate** — dissolved into palette, lighting, mood, the constraint a scene plays out within. A novice never names it; it structures what they feel.
- **Prime/composite** — an *intrinsic* axis. Every card's number has a factorization, and that gives the card a character — identity, prime (irreducible), or composite (derived from factors). The factorization is *derived* from the number; its **gloss** — what that character means — is an *integration*, **authored and stored where the number is originated**: on each **major** (`factorization.gloss`, required; the trumps are the prime structure's home), and optionally once per **rank** (the minors share their rank's number, so a minor card stores nothing and derives by reference). It applies to **both** majors (0–21) and minors (1–14). It is the **fourth quantum number**: usually a quiet undertone, occasionally the thing that makes the rest cohere. **On the majors, a gloss that won't cohere is signal** the slot is miscast or a factor-major is mis-defined. It also *beats against* the transversal — see `references/numeric_axis.md`.

The first three are **woven** — they are positions in the deck's space. The fourth is **intrinsic** — a property of the number, like spin: not a coordinate, just *there* — but on the majors its reading is written down, because a major's number-meaning can be done well or badly.

**Atomic at write, derived at read.** An axis's contribution lives on the axis, once. A card stores only what it originates and cannot recover by reference: its **integrated meaning** and **integrated visual description** — and, for a **major**, its **factorization gloss** (plus optional `style`/`content` overrides, present only on deviation). It never restates a suit's style, a rank's content, or a station's motif. The numeric axis is the cleanest case of the rule: the factorization is always derived; the gloss is stored only at the number's origin (the major, or the rank), so a minor — whose number *is* its rank's — stores no factorization at all.

**Declare vs. sublimate vs. latent.** Suit and rank are foregrounded; the station is dissolved (handed to the integrator in full precisely so it can be sublimated well — it is an ordinary axis with an extraordinary instruction, not something hidden from the structure); the prime character stays an undertone in the meaning and visual, **but on the majors its gloss is written down** — leaned on where it clarifies, authored on every trump, and read as a quality signal when it resists. See `references/integration.md`.

## The walk is structural, not configured

Because the transversal touches every card, the suit order is **as fixed as the rank order** — suits carry an explicit `index` (0–3). Station assignment is then a deterministic walk with the origin baked in, not a chosen anchor. Let N = station count and `k` = the transversal's `suit_stride` (default 1, coprime to N):

- **Minor walk** — `station_index = (rank_index + k · suit_index) mod N`, origin the **first suit's Ace** (suit 0, rank 0) = station 0. The `k`-kick per suit is what keeps the cycle cross-cutting: a plain continuous count over contiguous 14-rank suits collapses whenever N divides 14 (the classic 7 does), making the station a pure function of rank; the coprime kick de-aligns the suits. `k = 1` is the minimal diagonal.
- **Major walk** — a *separate* walk, origin **Major 0** = station 0. `station_index = major_number mod N` (no kick needed; 22 ≡ 1 mod 7).

Both walks traverse the same N stations in the same canonical order. See `references/schema.md` → "The walk."

## Always-on references (the invariants)

Hold across every theme and strategy; never duplicate their contents into strategy files.

- `references/schema.md` — the canonical `DeckManifest` envelope, normalized four-axis deck payload, the walk, and what each field is for.
- `references/integration.md` — declare/sublimate/latent directives, the meaning-integration procedure, chiral inversion.
- `references/numeric_axis.md` — the prime/composite fourth quantum number and its resonance with the transversal.
- `references/svg_symbols.md` — glyph constraints (suit glyphs; optional major glyph; optional station symbol).
- `references/tarot_structure.md` — traditional tarot as a reference point, including the Chaldean decan order the transversal generalizes and the prime/composite structure the fourth axis generalizes.
- `references/validation.md` — how a connected host uses Generative Arcana's executable spec/validator without making authoring depend on MCP availability.

## Platform contract when available

This bundle is usable without a connected Generative Arcana service. When the host **does** expose Generative Arcana authoring tools, follow `references/validation.md`: call `get_deck_authoring_spec` before generation, and validate the final artifact with `validate_deck_manifest` until it returns both `valid: true` and `canonical: true`.

The platform validator owns runtime correctness. This skill owns generative quality and thematic coherence. Do not recreate server validation rules inside a ChatGPT-, Claude-, or other host-specific wrapper.

## Workflow: plan, then execute

Don't prompt stage-by-stage — plan once, adjust once, build.

### Stage 0 — Theme, dialectics, and the plan

1. Articulate the **theme** (canonical name + evocative description). See `references/schema.md` → Theme.
2. Read `references/tarot_structure.md` if you need the traditional baseline.
3. Propose a **generation plan** — one strategy per stage — consulting `strategies/index.md` (the registry). Give each a one-line rationale. The transversal is always on; the choice there is *which* transversal.
4. Present the plan; let the user adjust in one pass (strategies can be chosen aware of each other). Lock it, then execute in order.

Every strategy emits values conforming to `references/schema.md` and defers to `references/integration.md` for the card pass — strategies decide *how to generate an axis's inputs*, never the card's output shape.

### Stage 1 — Suits (grid axis, fixed order)

Establish four ordered suits (`index` 0–3). Strategies in `strategies/suits/`:
- `dialectical.md` — cross-product of two theme-derived dialectics. The default.
- `manual.md` — a four-fold structure the theme already supplies (elements, houses, seasons, nations).

Output: four `Suit` entities (index, name, slug, glyph SVG per `references/svg_symbols.md`, meaning palette, `visual_style`).

### Stage 2 — Transversal (substrate axis) — *before the majors*

Lay down the required transversal now: it is the deck's most global layer, the one structure that must stay coherent across majors, courts, and pips at once, so it is a substrate the others express rather than something derived per-class. Strategies in `strategies/transversal/`:
- `chaldean.md` — the seven classical planets in Chaldean order. Best for esoteric/classical themes.
- `themed_cycle.md` — a theme-native canonically-ordered cycle (alchemical operations, OSI layers, lunar phases, modes). The general case.

Output: one `Transversal` entity — N **stations** in canonical order (N ≥ 4 so each rank's four suits land on distinct stations), an optional `suit_stride` (default 1; any value coprime to N works, so N = 7 is fine), each station carrying a semantic charge, a concise `description`, an optional `symbol`, and a `visual_motif`. The walk is structural (above); nothing to anchor. Once N, the order, and `suit_stride` are fixed, **every card's station is determined** — including each major's, which seeds Stage 3.

### Stage 3 — Major Arcana (style-suit + 22 cards)

The Major Arcana is a suit contributing only `visual_style`; the 22 cards are generated **directly** (no major-rank layer — that would be 1:1 duplication). Each major already has a station (major walk) and a prime/composite character (its number). Strategies in `strategies/majors/`:
- `primes.md` — lean into the fourth axis: build 22 archetypes from irreducible primes + identities, deriving composites by factorization. Resonates with the transversal (a slot that is numerically prime *and* sits on an early/irreducible station is doubly-atomic).
- `journey.md` — narrative-first: 22 beats from a story the theme tells. (The prime character stays latent and derivable; the integrator may still notice it.)
- `borrowed.md` — map 1:1 onto an existing 22-element structure.

Each slot's station (sublimated) and numeric character (gloss authored) inform what it becomes — and for `primes.md`, a composite whose gloss won't follow from its factor-cards is a flag to recast the slot. Output: `MajorArcana` + 22 `MajorArcanaCard`s per `references/integration.md`.

### Stage 4 — Minor ranks (grid axis)

Define 14 ranks (10 numbered + 4 face) as abstract frameworks refracting through every suit. Strategies in `strategies/ranks/`:
- `questions.md` — each numbered rank is a question the suit answers; face ranks a four-step progression. The default.
- `prime_scaffold.md` — lean into the fourth axis for ranks 1–14.
- `manual.md` — a theme-native rank progression.

Face ranks: four roles, distinct initials (for glyph abbreviation), an encoded progression. Output: 14 `Rank` entities (numbered ranks carry a `question` with a literal `{suit}` placeholder; a rank may optionally carry a `factorization` gloss — load-bearing under `prime_scaffold`, usually skipped otherwise).

### Stage 5 — Minor projection

Generate the 56 minor cards. Each integrates its **suit** (style, declared) × **rank** (content, declared) × its **station** (motif, sublimated — from the minor walk) × its **numeric character** (latent — derived from its rank's number; not stored per-card). Follow `references/integration.md` exactly. Overrides only where a card genuinely refines a parent axis.

### Stage 6 — Emit and validate the canonical DeckManifest

Assemble the full `Deck` payload per `references/schema.md` (theme, 4 ordered suits, 14 ranks, transversal, major_arcana, 78 cards), write a concise explicit `tagline`, and wrap them in the canonical host-neutral artifact:

```json
{
  "schemaVersion": 2,
  "data": { "...": "the complete Deck payload" },
  "tagline": "A concise human-facing summary of the deck.",
  "spreads": []
}
```

`schemaVersion: 2` is required for newly authored manifests. `spreads` is optional; omit it when the deck has no authored native spreads. Do **not** emit a catalog resource ID, owner/principal, visibility, revision/timestamps, OAuth/provider/session data, or renderer/MCP host metadata. `data.slug` remains authored metadata; the platform assigns stable resource identity when the manifest is imported.

When `validate_deck_manifest` is available, validate this exact envelope before delivery. Repair any `valid: false` result and re-run; if the result says `canonical: false`, convert the artifact to the canonical manifest envelope and re-run. Finish only on `valid: true, canonical: true`. Validation does not itself import or publish anything.

Save the artifact:

```bash
cat > /mnt/user-data/outputs/[deck-slug].manifest.json << 'EOF'
[the complete DeckManifest JSON]
EOF
```

Confirm the save and report the path. If the user also asked to import it into a connected account, follow `references/validation.md` and treat that as a separate explicit mutation after validation. (No renderer is part of this skill yet — the canonical JSON manifest is the authoring deliverable.)

## Working with feedback

- Iterate freely; revising an axis cascades to dependents (re-running the transversal re-derives every station; changing N re-walks the whole deck).
- Creative judgment supersedes the plan when the theme demands it.
- Present cards by name and meaning; mention scaffolding (primes, stations) only if asked.

## Quality checks

- **Platform-valid when available?** If the executable validator is connected, did the final artifact reach `valid: true, canonical: true` before delivery/import?
- **Canonical envelope?** Is the final artifact schema v2 — `schemaVersion: 2`, `data`, explicit non-empty `tagline`, and optional `spreads` — with no catalog/account/host identity metadata?
- **Axes orthogonal?** Do suit, rank, and transversal each carve the space differently? (If the transversal aligns with the suits, N or the walk is wrong.)
- **No denormalization?** Does any card restate an axis (a suit's style, a rank's content, a station's motif) instead of overriding it? It shouldn't. (The factorization *gloss* IS stored — intentionally; the factorization is not.)
- **Transversal sublimated?** Read ten random pip descriptions — can you feel the station without it being named? (A station `symbol`, if any, stays weather on the card face — surfacing only as a deliberate, rare exception, never the default register.)
- **Majors direct?** No vestigial major-rank layer; 22 cards built straight from the chosen strategy.
- **Majors glossed, and each gloss earns its place?** Every **major** carries a `factorization.gloss` (ranks optionally; minor cards never). Does each major's follow from its factors — a composite's from its factor-majors, a prime's from its irreducibility, an identity's from precondition/operator? A gloss you had to force is *signal*: the slot is miscast or a factor-major mis-defined. Recast it; don't paper over.
- **Stations legible in the meta-layer?** Each station has a concise `description` that says what it represents at a glance.
- **Integration real?** Are card meanings syntheses, not concatenations? Are inversions chiral?
- **Cross-cutting families legible?** Could a reader pull "all the [station] cards" across suits?
