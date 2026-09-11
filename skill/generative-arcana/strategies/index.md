# Strategy Registry

The orchestrator reads this in Stage 0 to build the per-stage generation plan. Each row: the stage, the method, when it's right, the file. Strategies generate an axis's *inputs*; they defer to `references/schema.md` for output shape and `references/integration.md` for the card pass.

The **transversal is always on** (the choice is which one). The **prime/composite axis is always on too** — its factorization is derived from the number, but its **gloss is authored on every major** (and optionally on each rank); a gloss that won't cohere is signal the slot is miscast. The prime-leaning strategies below merely make it *load-bearing* rather than a quiet undertone.

## Suits — Stage 1 (grid axis, fixed order)

| Method | Best when | File |
|---|---|---|
| dialectical | The theme has no obvious four-fold structure; derive suits from its deepest tensions. The default. | `suits/dialectical.md` |
| manual | The theme already supplies four natural categories (elements/houses/seasons/nations). | `suits/manual.md` |

## Transversal — Stage 2 (substrate axis, required, before majors)

| Method | Best when | File |
|---|---|---|
| chaldean | Esoteric/astrological/classical themes where the seven planets in Chaldean order are the right substrate. | `transversal/chaldean.md` |
| themed_cycle | Any theme with its own canonically-ordered cycle. The general case. | `transversal/themed_cycle.md` |

## Majors — Stage 3 (22 cards built directly; no rank layer)

| Method | Best when | File |
|---|---|---|
| primes | Lean into the fourth axis: 22 archetypes from irreducible primes; composes with the transversal. | `majors/primes.md` |
| journey | The theme tells a 22-beat story already; narrative-first. | `majors/journey.md` |
| borrowed | The theme contains an existing 22-element set to map onto 1:1. | `majors/borrowed.md` |

## Ranks — Stage 4 (grid axis)

| Method | Best when | File |
|---|---|---|
| questions | Each numbered rank poses a question the suit answers. The default. | `ranks/questions.md` |
| prime_scaffold | Make the fourth axis load-bearing in the ranks; pairs with `majors/primes`. | `ranks/prime_scaffold.md` |
| manual | The theme supplies a native rank progression. | `ranks/manual.md` |

## Pairing notes

- **manual suits often want manual or themed ranks** for tonal consistency; a dialectical grid pairs naturally with `questions`.
- **`majors/primes` pairs with `ranks/prime_scaffold`** if you want the fourth axis visible at both scales.
- **The transversal composes with any of the above** — it is a substrate the others express, not a sibling that competes with them. So is the numeric axis: present regardless, glossed on every major (and optionally each rank) — leaned on hard under the prime strategies, noted briefly or skipped otherwise.

## Visual grammar is always on

Visual grammar is not a fifth strategy choice. Every generation plan also authors the shared stack in `references/visual_language.md`: deck material language, suit/Major family grammar, rank formal grammar, station environment, numeric visual logic where useful, and concrete card scene. Strategies may shape those outputs, but none may omit the visual layer and leave `detailed_description` to carry the entire art direction by itself.
