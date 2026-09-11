# Schema v2: normalized source, independent persistence, resolved views

Schema v2 separates three concerns that the original all-in-one JSON era naturally blurred.

## 1. Authored source model

`DeckManifest` is a normalized authored artifact. Facts belong once at the layer that owns them:

- deck: theme and shared material/visual language;
- suit / Major family: family-level handling and composition;
- rank: semantic progression and formal grammar;
- station: transversal meaning and environmental modulation;
- number origin: factorization gloss / visual logic;
- card: concrete integrated meaning, scene, and genuine overrides;
- spreads: deck-native reading geometry/position semantics.

New manifests carry `schemaVersion: 2`. Historical v1 envelopes omitted the field and are compatibility input only.

## 2. Persistence model

Persistence is **not** the public schema. Today `arcana_user_decks` stores one normalized manifest in a JSONB column plus identity/ownership/publication columns. That is durable but not relationally decomposed.

Schema v2 deliberately does not require the database to mirror the manifest document. A later storage migration may use separate tables for deck revisions, axes, cards, assets, or precomputed/materialized projections when query/editing needs justify it. Repository interfaces should hide that choice from the engine and host transports.

This means we can optimize storage and editing without forcing another deck-format migration.

## 3. Resolved read model

Normalized writes are not normalized reads. A single card returned by MCP should be renderable in isolation.

The `CardRenderSpec` projection therefore denormalizes the full inherited visual stack:

```text
deck visual language
  ↓
suit or Major family grammar
  ↓
rank formal grammar (minor only)
  ↓
station environment
  ↓
number/factorization visual logic
  ↓
card concrete scene + overrides
```

The projection embeds source context and a render-oriented breakdown (material, form, environment, legacy fallbacks, concrete scene, avoid-list). It is derived at read time and is not copied into authored card storage.

`get_card` preserves the historical top-level card fields and adds `render`. Reading placements do the same, so each placed card is independently renderable. This also creates the right input vocabulary for future Living Spread/spread-scene composition.

## Compatibility and migration sequence

1. **Runtime compatibility:** v1 manifests and bare raw deck data remain readable; validators normalize them to v2.
2. **Resolved reads:** old decks immediately receive the best render projection possible from their legacy `visual_style`, `visual_content`, and `visual_motif` fields.
3. **Corpus migration:** bundled legacy decks should be re-authored/migrated into schema-v2 manifests with structured visual grammar so their resolved render specs become fully explicit rather than fallback-heavy.
4. **Catalog rewrite:** persisted v1 user-deck rows can be rewritten to v2 opportunistically/offline; reads already normalize safely in the meantime.
5. **Physical DB normalization:** only after editor/query requirements are clear, migrate JSONB internals to relational/hybrid storage behind the repository boundary if it materially improves the product.

This sequence keeps public identity/read semantics stable while allowing the internal storage model to evolve.
