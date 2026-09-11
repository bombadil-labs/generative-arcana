---
name: generative-arcana
description: Design thematically coherent custom tarot decks woven from four symbolic axes — suit, rank, a required transversal substrate, and the latent prime/composite character of each card's number. Use when the user asks to create, design, or generate a custom tarot deck. This portable skill routes a per-stage generation plan and emits one canonical DeckManifest artifact.
---

# Generative Arcana

This is the **portable, host-neutral authoring workflow** for Generative Arcana. ChatGPT, Claude, the web product, and future hosts may provide different intelligence or UX around it; they do not get different deck semantics.

A custom tarot designer built on one idea: **a tarot deck is a small semantic space woven from a few axes, and every card is an integration over those axes.**

## The formalism

Four axes, two kinds, one storage rule. Internalize this before generating anything.

- **Suit** — grid axis, declared.
- **Rank** — grid axis, declared.
- **Transversal (station)** — required substrate axis, sublimated.
- **Prime/composite** — intrinsic numeric axis; its authored gloss (and optional visual logic) lives where the number originates.

**Atomic at write, derived at read.** An axis's contribution lives on the axis, once. A card stores only what it originates: integrated meaning, concrete visual scene, genuine overrides, and on a major its number-owned factorization. A resolved card returned by the platform may denormalize all inherited visual context into a self-contained render specification; that is a read projection, not authored duplication.

## Always-on references

- `references/schema.md` — schema-v2 `DeckManifest`, normalized axes, walk, and field ownership.
- `references/integration.md` — declare/sublimate/latent directives and integration procedure.
- `references/numeric_axis.md` — numeric fourth axis.
- `references/svg_symbols.md` — glyph constraints.
- `references/tarot_structure.md` — traditional baseline.
- `references/validation.md` — platform validation/import loop.

## Platform contract when available

If Generative Arcana authoring tools are connected, call `get_deck_authoring_spec` before generation and use `validate_deck_manifest` as repair feedback. Finish only on `valid: true, canonical: true`. The platform validator owns runtime correctness; this skill owns generative quality.

## Workflow: plan, then execute

Don't prompt stage-by-stage — plan once, adjust once, build.

### Stage 0 — Theme and plan

1. Articulate the theme.
2. Propose one generation strategy per stage from `strategies/index.md`.
3. Let the user adjust once; lock the plan.

### Stage 1 — Suits

Establish ordered suits. Use `strategies/suits/dialectical.md` or `strategies/suits/manual.md`.

### Stage 2 — Transversal

Lay down the required canonically ordered substrate cycle before generating cards. Use `strategies/transversal/chaldean.md` or `strategies/transversal/themed_cycle.md`.

### Stage 3 — Major Arcana

Generate majors directly, informed by their station and numeric character. Use `strategies/majors/primes.md`, `journey.md`, or `borrowed.md`.

### Stage 4 — Minor ranks

Define the minor rank progression. Use `strategies/ranks/questions.md`, `prime_scaffold.md`, or `manual.md`.

### Stage 5 — Minor projection

Generate minors by integrating suit × rank × station × numeric character. Follow `references/integration.md`; card-level overrides are only for true deviations.

### Stage 6 — Emit and validate the canonical DeckManifest

Assemble the full deck payload and wrap it in the canonical schema-v2 artifact:

```json
{
  "schemaVersion": 2,
  "data": { "...": "the complete Deck payload" },
  "tagline": "A concise human-facing summary of the deck.",
  "spreads": []
}
```

`schemaVersion: 2` is required for newly authored manifests. `spreads` is optional. Do not emit catalog identity, owner, visibility, revisions, auth/session metadata, or renderer implementation objects.

When `validate_deck_manifest` is available, repair until `valid: true, canonical: true`. Validation does not itself import or publish anything.

Save the artifact as `[deck-slug].manifest.json`. Import is a separate explicit mutation using `import_deck({ manifest })` only when requested.

## Quality checks

- **Platform-valid?** Connected validation reached `valid: true, canonical: true`.
- **Canonical envelope?** `schemaVersion: 2`, `data`, non-empty `tagline`, optional `spreads`, no account/host identity metadata.
- **Axes orthogonal?** Suit, rank, station, and number each contribute differently.
- **No authored denormalization?** Parent grammar is referenced/derived, not copied into every card.
- **Resolved renderability?** A platform `get_card` projection has enough inherited deck/family/rank/station/number context plus the card scene for a human artist or generative renderer to work from.
- **Integration real?** Card meaning and scene are syntheses, not concatenations.
- **Majors factor coherently?** Numeric gloss/visual logic follow the factor structure rather than being decorative numerology.
