# The Numeric Axis (Prime / Composite)

The fourth axis. It is not woven into the deck's space like suit, rank, and station — it is *intrinsic* to each card's number. Every card has a number, every number has a factorization, and that factorization gives the card a character. The factorization is a pure function of `card.number` — derived, not the thing you store. Its **gloss** and optional **visual logic** are authored at the layer that *owns that number*. Majors always own their number on the card; the default 78-card minor profile owns numbers at rank, while alternate profiles may declare suit- or card-owned minor numbers. It is the **fourth quantum number**: usually a quiet undertone, occasionally the thing that makes a configuration cohere, and — the v2 change — **a quality signal**. A gloss that won't follow from the factors is telling you the slot is miscast.

## The characters

A card's number is one of:

- **Identity** — 0 (additive: the void/precondition) or 1 (multiplicative: the unit of agency, the transparent operator). Majors include both; the default rank-numbered minor profile begins at 1, while alternate profiles may legitimately include 0.
- **Prime** — irreducible. It cannot be factored; it simply *is*. An atomic energy.
  - Majors 0–21: 2, 3, 5, 7, 11, 13, 17, 19.
  - Default rank-numbered minors 1–14: 2, 3, 5, 7, 11, 13. Other profiles use the primes present in their own authored number range.
- **Composite** — derived; a product of primes. Its character emerges from its factors.
  - Powers intensify/transform: x² stabilizes (structure), x³ deep mastery or excess, x⁴ collapse/breakthrough.
  - Products combine: x×y asks "what happens when energy X meets energy Y?"
  - Majors 0–21: 4, 6, 8, 9, 10, 12, 14, 15, 16, 18, 20, 21. Default rank-numbered minors 1–14: 4, 6, 8, 9, 10, 12, 14.

The full major factor table and interpretive frames are in `references/tarot_structure.md`. This axis *is* that structure, lifted out of the majors and recognized as present everywhere a number is.

## Where the gloss lives

The gloss and visual logic are stored **only where the number is originated** — not copied onto every card that inherits it. Major numbers are always card-owned. Minor ownership is an authored profile decision recorded by `Deck.minor_number_origin`:

- **`"rank"` — the default 78-card profile.** `Rank.numeric_value` owns the number; optional rank `factorization` is written once and shared across suits. `ranks/prime_scaffold` makes this load-bearing.
- **`"suit"` — alternate lattice profiles such as Ultima Octave.** `Suit.numeric_value` owns the number; the suit may carry its factorization once while all rank/octave cards inherit it.
- **`"card"` — exceptional profiles.** Each minor card owns its own number and may therefore own its interpretation directly. Use only when neither shared axis actually originates the value.
- **Majors — always card-owned.** Each trump position is unique to that card, so every major carries its own factorization/gloss and normally `visual_logic`.

Historical decks may contain duplicated card-level factorization from before origin was explicit. Resolved reads prefer the declared owner; legacy card fields remain a compatibility fallback. New authoring should not duplicate axis-owned factorization across cards.

Each `factorization` block has **`character`** (`identity|prime|composite`, derived), **`factors`** (derived prime factors for composites), **`gloss`** (authored semantic interpretation), and optionally **`visual_logic`** (authored formal/compositional consequence).

## Writing the gloss

- **Identity 0** — the additive identity, the void/precondition. Gloss: what "nothing yet, the ground before differentiation" *is* for this card.
- **Identity 1** — the multiplicative identity, the transparent operator. Gloss: what "the pure unit of agency" is here.
- **Prime** — irreducible. Gloss: *why this energy doesn't decompose* — name the atomic experience and then stop. Resist over-glossing a prime; its whole point is that it simply *is*.
- **Composite** — derived. The gloss leans on the factor-**cards**, not just the numbers:
  - **x²** — the base card *stabilized / structured into a frame*: "Major 2 (The Two Moons) squared — the threshold made permanent."
  - **x³** — the base *compounded into mastery or its shadow (excess, being consumed)*.
  - **x⁴** — the base *concentrated past containment* — collapse, breakthrough, shattering.
  - **x × y** — *what happens when energy X meets energy Y*: name both factor-cards and the quality of their meeting. (`x²·y`: the first is structured, the second acts on it. `x·y²`: the second is fulfilled, the first witnesses it.)

  On a **major** the factors are the majors at those factors (Major 6 = Major 2 × Major 3). On a **rank-owned** minor profile they are factor-ranks. On a **suit-owned** profile they are factor-suits (which may reveal a different structural relation than another authored encoding, such as a bit-lattice).

## The gloss as signal — read this

The gloss is not a field to fill mechanically. **If you cannot write a gloss that genuinely follows from the factors, that is information.** A composite whose meaning doesn't read as its factor-cards meeting — or a prime whose card decomposes too easily into parts — is telling you one of two things:

1. **The card chosen for this slot is wrong.** Under `strategies/majors/primes.md` especially, a composite slot's identity is *supposed* to derive from its factorization; if it won't, you have probably named the wrong archetype for that number.
2. **A factor-card is mis-defined.** When the load-bearing 2 or 3 is off, everything built on it strains, and the strain shows up first as composites whose glosses won't close.

Treat a forced gloss as a flag to **revise the slot or its factors** — not as something to write around. Most of the value of baking this axis in is this early-warning signal; a deck where every gloss closes cleanly is a deck whose numbers and meanings agree.

## Resonance with the transversal

The numeric axis and the transversal are **siblings** — both cross-cut the suit×rank grid — but with different rhythms. The transversal is **periodic** (the station cycles with period N as you walk). The numeric axis is **arithmetic / aperiodic** (primes cluster early, thin late, recur by no fixed beat). Walk the cards and the two drift in and out of phase; their interference is the "oscillating resonance."

Two phenomena worth noticing (and worth folding into the gloss when present):

- **Reinforcement — "extra prime."** When a card is *numerically* prime **and** *transversally* prime (its station sits at a prime index in the canonical order), both cross-cutting structures say "irreducible" at once. The card is doubly-atomic — the deck's most elemental. Lean into irreducibility hard, and let the gloss note it.
- **Tension — crossing.** When a composite number lands on a prime-position station (or a prime on a composite-position station), the two structures disagree about how reducible the card is. That productive dissonance is a reading: a derived thing wearing an atomic key signature, or vice versa.

This resonance is a *soft* tool. The transversal's prime positions are just the prime indices of its order; you needn't compute them precisely to feel it, and you should not let arithmetic override a card's meaning.

## Generating *with* it vs. *noticing* it

- **Generating with it** (`strategies/majors/primes.md`, `strategies/ranks/prime_scaffold.md`): the archetype is *built from* the factorization, so the gloss almost writes itself and the signal is sharpest — a slot that resists a clean gloss is a slot to reconsider then and there.
- **Noticing it** (`journey.md`/`borrowed.md` majors, `questions.md`/`manual.md` ranks): the card was built another way, but the number is still there. A **major** still earns its gloss — terse is fine ("prime — an irreducible beat in the journey") — and a number that flatly contradicts the trump is still worth a second look. A **rank** built this way will usually skip the optional gloss; author it only if it genuinely clarifies.

So: **every major carries a `factorization.gloss`**; default-profile ranks carry one only when it is useful/load-bearing; alternate suit-owned profiles place it once on the suit; minor cards carry it only under an explicit card-owned profile. The rule is ownership, not tarot convention.

## Visual logic

The authored semantic gloss and the visual consequence of factorization are related but distinct. Schema v2 permits `factorization.visual_logic` at the same number-owning layer as the gloss. It states how the number constrains **formal organization** rather than what the number means.

For majors the default authoring profile normally writes this field. Primes/identity can favor an irreducible organizing proposition; composites should inherit formal ancestry from their factor-majors (axes, symmetry, rhythm, nesting, directional systems, scale relations) without literal pasted references or naive object counting. The same idea belongs once at whichever minor layer owns the number: rank under the default profile, suit in a suit-numbered lattice, or card only for an explicitly card-numbered profile.

A visual logic that cannot be made to follow from the factor structure is the same kind of signal as a semantic gloss that will not close: revisit the slot or its factor definitions instead of decorating around the mismatch. See `references/visual_language.md`.
