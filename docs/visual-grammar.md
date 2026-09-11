# Structured visual grammar

Generative Arcana may author visual semantics as structured, renderer-independent deck data. This is **art direction**, not a renderer implementation: p5 sketches, React components, image-generator parameters, asset URLs, and host-specific rendering objects remain outside this vocabulary unless another portable asset contract explicitly models them.

The purpose of the visual grammar is the same as the symbolic grammar: **atomic at write, derived at read**. Store each visual decision at the highest layer that truly owns it; a card's concrete scene is derived by composing those layers rather than copying them onto every card.

## Ownership hierarchy

### Deck: shared material world

`deck.visual_language` establishes what makes the whole deck feel like one family of artifacts:

```ts
interface DeckVisualLanguage {
  medium?: string;
  surface?: string;
  mark_making?: string;
  signature_accent?: string;
  finish?: string;
  avoid?: string[];
}
```

This is the common substrate, not a command that every suit be visually identical. A deck might share “handmade relief print on fibrous paper” while different suits handle ink, edge, value, or composition differently.

### Suit / Major Arcana: visual family

A suit and the Major Arcana may each carry `visual_grammar`:

```ts
interface VisualFamilyGrammar {
  medium_handling?: string;
  composition?: string;
  edge_language?: string;
  value_structure?: string;
  camera_and_scale?: string;
  detail_distribution?: string;
  finish?: string;
  avoid?: string[];
}
```

The deck says what world the image is made in; the family says how that material is handled and organized. The legacy/general `visual_style` field remains valid for existing decks and broad prose guidance.

### Rank: formal identity

A rank may carry `visual_form` independently of its narrative `visual_content`:

```ts
interface RankVisualForm {
  composition_law?: string;
  spatial_logic?: string;
  rhythm?: string;
  density?: string;
  figure_ground?: string;
}
```

This lets a rank be recognizable before its literal subject is read. One deck may make Fours enclosed and stabilizing; another may derive a completely different fourteen-step formal grammar. The runtime does not prescribe particular laws.

### Station: environmental modulation

A station may carry `visual_environment`:

```ts
interface StationVisualEnvironment {
  illumination?: string;
  palette?: string;
  atmosphere?: string;
  motion?: string;
  density?: string;
  material_effects?: string;
}
```

The station **changes the weather, not the visual family**. It can cool the light, thicken the air, accelerate motion, or make the existing medium appear frosted or wet; it should not silently swap the suit's medium, composition system, or mark-making. The legacy `visual_motif` field remains accepted as general prose.

### Numeric structure: formal ancestry

`FactorizationData.visual_logic` may state the compositional consequence of number structure at the point where that number originates. This is especially useful for Major Arcana:

- identity/prime cards can favor a formally irreducible proposition;
- composite cards can organize themselves in a way visibly descended from their factor cards without becoming literal collages of them.

The exact realization remains thematic. `6 = 2 × 3` does not mean “draw two copies of Major 3”; it means the author has a place to say how dyadic and triadic form jointly constrain Major 6.

### Card: concrete realization

`card.visuals.detailed_description` still owns the one concrete scene and its particular symbols. Existing `style_override` / `content_override` fields remain the escape hatch for genuine card-level deviations. A card should not restate the inherited deck/family/rank/station grammar.

## Compatibility

All structured visual fields are optional in the runtime contract. Existing decks using only `visual_style`, `visual_content`, and `visual_motif` continue to validate unchanged. Authoring profiles may require the structured grammar for newly generated decks without turning that quality rule into a migration requirement for the corpus.

Unknown extension fields at the broader deck/axis/card levels remain preserved as before. Known structured visual fields are type-checked when present.
