# The Numeric Axis (Prime / Composite)

The fourth axis. It is not woven into the deck's space like suit, rank, and station — it is *intrinsic* to each card's number. Every card has a number (majors 0–21, minors 1–14), every number has a factorization, and that factorization gives the card a character. The factorization is a pure function of `card.number` — derived, not the thing you store. But its **gloss** — what that character *means for this card* — is an integration, and like every integration it is **authored and stored** (`card.factorization.gloss`). It is the **fourth quantum number**: usually a quiet undertone, occasionally the thing that makes a configuration cohere, and — the v2 change — **a quality signal**. A gloss that won't follow from the factors is telling you the slot is miscast.

## The characters

A card's number is one of:

- **Identity** — 0 (additive: the void/precondition) or 1 (multiplicative: the unit of agency, the transparent operator). Minors have 1 (Ace); majors have both.
- **Prime** — irreducible. It cannot be factored; it simply *is*. An atomic energy.
  - Majors: 2, 3, 5, 7, 11, 13, 17, 19.
  - Minors: 2, 3, 5, 7, 11, 13.
- **Composite** — derived; a product of primes. Its character emerges from its factors.
  - Powers intensify/transform: x² stabilizes (structure), x³ deep mastery or excess, x⁴ collapse/breakthrough.
  - Products combine: x×y asks "what happens when energy X meets energy Y?"
  - Majors: 4, 6, 8, 9, 10, 12, 14, 15, 16, 18, 20, 21. Minors: 4, 6, 8, 9, 10, 12, 14.

The full major factor table and interpretive frames are in `references/tarot_structure.md`. This axis *is* that structure, lifted out of the majors and recognized as present everywhere a number is.

## Where the gloss lives

The gloss is stored **only where the number is originated** — not on every card. A number lives in exactly two places: a **major's position** (0–21, unique to that trump) and a **rank's value** (1–14, shared by all four suits at that rank). So:

- **Majors carry it, per card** (`MajorArcanaCard.factorization`, required). A trump's number is its own; the gloss has nowhere else to live, and the prime structure is *about* the trumps.
- **Ranks may carry it, once** (`Rank.factorization`, optional). A minor's number is its rank's, so its gloss — if worth authoring — belongs on the rank, shared across the four suits. This is load-bearing under `ranks/prime_scaffold` and usually skipped otherwise (the suits do the minors' structural work; a per-rank number-gloss is rarely an interesting source).
- **Minor cards carry nothing.** Their character is recovered by reference to their rank. Glossing all 56 would just denormalize 14 rank-level facts fourfold.

Each `factorization` block has three semantic fields: **`character`** (`identity|prime|composite`, derived), **`factors`** (the prime factorization for composites — `[2,2]` for 4, `[2,7]` for 14 — derived, stored for legibility), and **`gloss`** (the authored semantic part). Schema v2 additionally permits **`visual_logic`**, the authored formal/compositional consequence of the same number.

## Writing the gloss

- **Identity 0** — the additive identity, the void/precondition. Gloss: what "nothing yet, the ground before differentiation" *is* for this card.
- **Identity 1** — the multiplicative identity, the transparent operator. Gloss: what "the pure unit of agency" is here.
- **Prime** — irreducible. Gloss: *why this energy doesn't decompose* — name the atomic experience and then stop.
- **Composite** — derived. The gloss leans on the factor-**cards**, not just the numbers:
  - **x²** — the base card *stabilized / structured into a frame*.
  - **x³** — the base *compounded into mastery or its shadow*.
  - **x⁴** — the base *concentrated past containment* — collapse, breakthrough, shattering.
  - **x × y** — *what happens when energy X meets energy Y*.

On a **major** the factors are the majors at those factors; on a **rank** (if you gloss it) they are the ranks.

## The gloss as signal — read this

The gloss is not a field to fill mechanically. **If you cannot write a gloss that genuinely follows from the factors, that is information.** A composite whose meaning doesn't read as its factor-cards meeting — or a prime whose card decomposes too easily into parts — is telling you either the slot is wrong or a factor-card is mis-defined. Revise rather than write around it.

## Resonance with the transversal

The numeric axis and transversal are siblings with different rhythms: station is periodic; prime/composite structure is arithmetic/aperiodic. Their interference creates reinforcement (a prime card on a structurally irreducible station) and crossing tension (derived number under irreducible environmental pressure, or vice versa). This is a soft tool; do not let arithmetic override coherent meaning.

## Generating *with* it vs. *noticing* it

- **Generating with it** (`strategies/majors/primes.md`, `strategies/ranks/prime_scaffold.md`): the archetype is built from factorization; gloss/visual logic are load-bearing.
- **Noticing it** (`journey.md`/`borrowed.md` majors, `questions.md`/`manual.md` ranks): the card was built another way, but the number remains an optional constraint. Every major still earns a gloss; ranks usually omit one unless it clarifies.

So: **every major carries a `factorization.gloss`**; a **rank** carries one only when load-bearing; **minor cards carry none.**

## Visual logic

The authored semantic gloss and visual consequence of factorization are related but distinct. `factorization.visual_logic` states how the number constrains **formal organization** rather than what the number means.

For majors the default authoring profile normally writes this field. Primes/identity can favor an irreducible organizing proposition; composites should inherit formal ancestry from their factor-majors (axes, symmetry, rhythm, nesting, directional systems, scale relations) without literal pasted references or naive object counting. Under `ranks/prime_scaffold`, the same idea may be authored once on the rank and inherited by all minor cards of that rank.

A visual logic that cannot be made to follow from the factor structure is the same kind of signal as a semantic gloss that will not close: revisit the slot or its factor definitions instead of decorating around the mismatch. See `references/visual_language.md`.
