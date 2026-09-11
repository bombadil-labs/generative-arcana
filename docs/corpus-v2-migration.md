# Bundled corpus → schema-v2 visual migration

The bundled deck corpus predates the structured visual grammar added with schema v2. All seven decks still validate because the runtime contract remains backward-compatible, and `CardRenderSpec` can resolve their legacy `visual_style`, `visual_content`, and `visual_motif` prose as fallbacks. Migration is therefore staged art direction rather than a mechanical schema emergency.

Run the live audit from the repository root:

```bash
node tools/audit-deck-v2.mjs
```

CI runs the same tool with `--check`; that mode verifies that every bundled deck parses, has its core axes/cards, and provides a concrete `detailed_description` for every card. Decks that have completed migration are additionally named with `--require-enriched=<id>` so later edits cannot silently drop their v2 visual layers.

## Baseline at migration start

| deck | cards | suits | ranks | stations | deck visual | family grammar | rank form | station env | major grammar | major visual logic | legacy fallbacks |
| --- | ---: | ---: | ---: | ---: | --- | ---: | ---: | ---: | --- | ---: | --- |
| byrne | 78 | 4 | 14 | 7 | no | 0/4 | 0/14 | 0/7 | no | 0/22 | yes |
| deep-time | 78 | 4 | 14 | 8 | no | 0/4 | 0/14 | 0/8 | no | 0/22 | yes |
| evolution | 78 | 4 | 14 | 7 | no | 0/4 | 0/14 | 0/7 | no | 0/22 | yes |
| finalfantasy | 78 | 4 | 14 | 8 | no | 0/4 | 0/14 | 0/8 | no | 0/22 | yes |
| ultima | 78 | 4 | 14 | 8 | no | 0/4 | 0/14 | 0/8 | no | 0/22 | yes |
| ultima-octave | 86 | 8 | 8 | 8 | no | 0/8 | 0/8 | 0/8 | no | 0/22 | yes |
| ulysses | 77 | 4 | 14 | 4 | no | 0/4 | 0/14 | 0/4 | no | 0/21 | yes |

Additional legacy differences matter during migration:

- **Byrne** and **Ulysses** predate the major factorization blocks entirely; they need semantic/numeric migration as well as visual enrichment.
- **Final Fantasy** and **Ultima Octave** did not use the legacy `rank.visual_content` field, so their rank migration must recover/author both narrative and formal rank contributions from the deck itself rather than mechanically splitting an existing prose field.
- **Ultima Octave** is intentionally 8 suits × 8 ranks and must not be coerced into the default 4×14 authoring profile.
- **Ulysses** currently has 77 cards / 21 majors; migration should preserve intentional corpus shape unless a separate content review concludes it is actually incomplete.
- **Deep Time** already has a substantial `DESIGN.md` and source implementation; use those as authoring evidence rather than inventing a replacement visual system from scratch.

## Migration progress

- **Final Fantasy** — first v2 visual migration. The historical `deck.json` keeps stable symbolic/card content while `decks/finalfantasy/v2/*.json` holds normalized enrichment fragments for deck material language, suit families, rank narrative/form, station environments, and Major formal ancestry. The bundled loader deep-composes those fragments before validation, so the runtime/exported deck is one canonical v2 data tree.

## Definition of enriched

The audit considers a bundled deck visually enriched when its composed authored source has:

- deck-level `visual_language`;
- `visual_grammar` for every suit plus `major_arcana`;
- `visual_form` for every rank;
- `visual_environment` for every station;
- `factorization.visual_logic` for every major;
- concrete card scenes (already complete across the current corpus).

This is a migration target, not a universal runtime requirement.

## Bundled source composition

Large historical `deck.json` files do not need to be rewritten wholesale just to add v2 art direction. A bundled deck may keep small JSON-only fragments under `decks/<id>/v2/`; `composeBundledDeckData` recursively merges those trusted fragments into the base payload before the ordinary registry validation boundary. Arrays/scalars replace and plain objects merge.

This is **not a second public deck format**. It is repository source organization for bundled fixtures. `DeckManifest.data`, `get_deck`, imports/exports, catalog persistence, and `CardRenderSpec` all see the single composed/validated `DeckDataFile`.

The audit composes the same fragment directory so its coverage report reflects the runtime source rather than only the historical base file.

## Migration method

Migrate deck-by-deck with art-direction judgment:

1. **Recover invariants before inventing them.** Read the deck's theme, existing axis prose, card scenes, renderer/skin source, and any design notes.
2. **Write the deck material world.** Extract what is genuinely shared across the whole deck into `visual_language`.
3. **Differentiate families structurally.** Author suit/Major `visual_grammar` in composition, edge/value, scale, detail, and medium handling—not mascot/palette alone.
4. **Author rank narrative/form.** Preserve/recover the rank's narrative condition and make each rank formally legible across families, including nonstandard rank systems.
5. **Constrain stations to environment.** Convert station prose into light/palette/atmosphere/motion/material modulation without style leakage.
6. **Add numeric formal ancestry.** Preserve/review existing semantic factorization; add `visual_logic` to majors. For decks that predate factorization, do a genuine numeric review rather than filling boilerplate.
7. **Sample resolved cards.** Inspect `CardRenderSpec` from majors/minors across axis intersections; the resolved view should be sufficient for a human artist or image model while remaining recognizably that deck.
8. **Run visual stress tests.** Use the portable skill's `references/visual_language.md` diagnostics.
9. **Keep stable symbolic identities.** Do not rename deck/card slugs or alter reading-token identity as a side effect of visual migration.

## Storage migration is separate

The current Neon catalog stores each user deck's normalized manifest in one `jsonb` column. The public schema and read projections no longer depend on that physical choice. Do not prematurely explode the bundled migration into relational tables; first learn what the editor/query/revision workloads actually need. A later relational/hybrid migration should remain hidden behind `UserDeckCatalogRepository`.
