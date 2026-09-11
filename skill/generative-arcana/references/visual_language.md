# Visual Language — structured art direction

The purpose of a card's visual data is practical: **a human artist or generative image system should be able to make the card from the resolved visual specification.** The authored source stays normalized; Generative Arcana resolves the inherited stack into a self-contained `CardRenderSpec` when a card is read.

This profile therefore authors visual semantics in layers rather than pouring every decision into one `visual_style` paragraph.

## The visual stack

Resolve every card in this order:

1. **Deck — material world.** What makes every image feel like an artifact from the same deck?
2. **Suit or Major Arcana — family grammar.** How does this family handle that material and organize an image?
3. **Rank — formal grammar.** What compositional law makes cards of this rank recognizable across suits?
4. **Station — environment.** What light, palette, atmosphere, motion, density, or material effect modulates this particular card?
5. **Number — formal ancestry.** Does prime/composite structure contribute an irreducible or factor-derived organization?
6. **Card — concrete realization.** What exactly is depicted here, and what genuine exception/override is needed?

Later layers **specialize** earlier layers; they do not casually replace them. A station can make ink look rain-soaked, but it does not turn an ink family into 3D chrome. A card override may break a family rule, but only deliberately.

## Deck visual language — the shared material world

For newly authored decks, write `Deck.visual_language` deliberately:

```json
{
  "medium": "...",
  "surface": "...",
  "mark_making": "...",
  "signature_accent": "...",
  "finish": "...",
  "avoid": ["..."]
}
```

These fields should describe **material invariants**, not subject matter. Strong examples specify substrate, physical/digital handling, recurring accents, and exclusions. Weak examples say only “beautiful fantasy illustration,” “cinematic,” or “high detail.”

A deck may be digital, procedural, photographic, diagrammatic, textile, printmaking, collage, or mixed-media. Do not default to handmade gouache; that is one deck's answer, not the grammar's answer.

## Suit / Major visual family

Each suit and `major_arcana` should normally have a `visual_grammar`:

```json
{
  "medium_handling": "...",
  "composition": "...",
  "edge_language": "...",
  "value_structure": "...",
  "camera_and_scale": "...",
  "detail_distribution": "...",
  "finish": "...",
  "avoid": ["..."]
}
```

This is where families diverge while remaining in the same deck-world. Prefer **structural distinctions** over palette-swaps: different space, edge behavior, value grouping, scale, rhythm, or detail distribution. A viewer should have evidence for the family before noticing the mascot or reading the suit glyph.

`visual_style` remains a compatibility/general prose field; for new authoring, use it as a concise summary if useful, but do not make it the only visual specification.

## Rank as formal grammar

For new default-profile decks, each rank should carry a `visual_form`. At minimum, give it a `composition_law`; use the other fields when they carry real information:

```json
{
  "composition_law": "...",
  "spatial_logic": "...",
  "rhythm": "...",
  "density": "...",
  "figure_ground": "..."
}
```

The law is deck-authored, not globally fixed. One deck might use Ace=undivided form, Two=bilateral tension, Three=triangular emergence, Four=enclosure; another might use a completely different progression. The test is whether the rank has a **formal identity across suits**, not whether it follows a universal tarot geometry.

Face/court ranks should likewise encode their progression visually. If the semantic sequence is novice → practitioner → integrator → authority, the formal grammar might progress in control of frame, finish, viewpoint, multiplicity, or spatial sovereignty rather than merely changing costume.

`visual_content` still answers “what kind of thing/event does this rank depict?” `visual_form` answers “how does this rank organize an image?” Keep them orthogonal.

## Station as environment — change the weather, not the family

For newly authored decks, give each station a `visual_environment` where useful:

```json
{
  "illumination": "...",
  "palette": "...",
  "atmosphere": "...",
  "motion": "...",
  "density": "...",
  "material_effects": "..."
}
```

A station may alter light, chroma, air, speed, pressure, accumulation, wetness, frost, haze, grain, or how the established medium behaves. It should **not** silently replace the suit/Major medium, family composition, edge system, or mark-making.

Think: *the same set under different weather*, not *a different production company made this card*.

`visual_motif` remains a compatibility/general prose field and may summarize the environment.

## Numeric structure as formal ancestry

At the point where a number originates, `factorization.visual_logic` may state what its arithmetic means **formally**.

For Major Arcana, the default profile should usually author it:

- identity / prime numbers: favor an irreducible formal proposition — not necessarily one object, but a composition whose organizing idea cannot be decomposed without losing the card;
- composites: show formal ancestry from factor-majors — shared axes, nested organizations, repeated directional systems, inherited symmetries, or transformed spatial logic.

Do **not** reduce factorization to literal counting (“six objects because 6”) or collage (“paste Major 2 and Major 3 together”). `6 = 2 × 3` should constrain organization in a way descended from both 2 and 3.

Under `ranks/prime_scaffold`, the same idea may live once on the rank and be inherited by all minor cards of that rank.

## Card scene

`card.visuals.detailed_description` owns the **specific scene** and symbols that exist only on this card. Write it while consciously holding the complete stack above in mind, but do not copy the inherited grammar into the stored scene description.

Good source storage:

- “A lone bridge worker kneels over the final unjoined span while a flock crosses the gap overhead.”

Bad source storage:

- a 500-word prompt that repeats the deck medium, suit edges, rank composition law, station lighting, and avoid-list already authored elsewhere.

At read time `get_card` resolves those inherited fields and returns them together with the scene in `card.render`; **that resolved view is the fully specified artist/generator handoff.** This is deliberate denormalization at read, not authored duplication at write.

Use `style_override` / `content_override` only when this card intentionally departs from its inherited stack.

## Visual quality / stress tests

These tests are authoring diagnostics. They are not extra persisted fields and not every deck will use every test.

### 1. Rank recognizability

Sample the same rank across several suits with subjects/labels hidden. Does a shared formal law remain visible? If not, `visual_form` is probably decorative rather than structural.

### 2. Factorization composition

For Major Arcana, can a prime's visual organization be described as irreducible? Can a composite's organization be explained through its factors without resorting to literal pasted references? If a composite will not close formally, revisit it just as you would revisit a failed factorization gloss.

### 3. Opposition / diptych

When the deck explicitly contains opposing poles (a dialectic, paired stations, or another authored opposition), compare the pair as if they were a diptych. They should preserve enough invariant structure to make the relation legible while reversing or transforming selected dimensions such as motion, edge, illumination, density, orientation, or material behavior.

Do not invent oppositions merely to run this test.

### 4. Style inversion

Temporarily assign one family's medium handling to another while preserving its composition and symbolism. If the family becomes completely unrecognizable, too much of its meaning may live in medium alone. This is a diagnostic thought experiment; do not persist the inverted version.

### 5. Subject-removal

Hide the family mascot/emblem/obvious subject. Can space, composition, edges, values, camera, and detail distribution still suggest the family? If not, strengthen the grammar beyond iconography.

### 6. Station leakage

Apply several different stations to the same family/rank combination mentally. Do they feel like environmental transformations of one underlying visual grammar, or does each station replace the medium/style? The latter is leakage; rewrite the station as weather.

### 7. Progression

For sequential ranks/courts, view the whole row. Does visual form actually progress with the authored semantic progression, or are the cards arbitrary illustrations wearing rank labels?

### 8. Cross-deck distinctiveness

Describe the visual system with all proper nouns and theme-specific subjects removed. Could it plausibly describe ten unrelated AI-art decks? If yes, the deck-level material language and family grammars are too generic. Strengthen concrete medium, surface, mark-making, spatial, edge, value, and finish decisions.

## Rendering contract

A complete visual system is successful when these are both true:

- **normalized source:** every reusable fact is authored once at its owning layer;
- **self-contained read:** `get_card(...).render` gives an artist or generative renderer enough resolved context to make the image without fetching the deck, suit, rank, station, or numeric records separately.

This separation is intentional and is also the foundation for future spread-level visual composition: a spread can operate on the resolved render specifications of its placements rather than scraping unstructured prose.
