# DeckManifest contract

`DeckManifest` is the canonical authored artifact for Generative Arcana.

```ts
interface DeckManifest {
  schemaVersion: 2;
  data: DeckDataFile;
  tagline: string;
  spreads?: Spread[];
}
```

`schemaVersion` versions the authored envelope separately from `data.version`, which is the deck creator's own content/version identifier. v1 manifests omitted `schemaVersion`; they remain readable compatibility input and normalize to v2. Unsupported future versions fail closed.

Every new authoring route terminates in the v2 shape before persistence. Upload/manual authoring, ChatGPT, Claude, and future editors may differ in UX or intelligence; they do not get different persisted deck formats.

## What belongs in the manifest

`data` owns renderer-independent authored structure and semantics: theme, axes, cards, and visual grammar. Executable renderer objects do not belong here. See `docs/visual-grammar.md`.

`data.slug` is authored metadata, not durable catalog identity. `tagline` is a required human-facing summary. `spreads` contains optional deck-native spread definitions normalized to deck ownership at registration time.

The manifest must not contain catalog resource IDs, owner/principal IDs, visibility, catalog revisions/timestamps, auth/session/provider data, host-specific MCP metadata, or renderer implementation objects.

## Normalized source vs resolved read views

`DeckManifest` is the normalized authored source: deck, suit/Major family, rank, station, numeric, and card facts should each be authored once at the layer that owns them.

That does **not** mean every API read should expose the same normalized shape. `get_card` and reading projections deliberately return a **resolved card render specification** that embeds inherited deck/family/rank/station/number context alongside the card's concrete scene. The duplication is a read-model concern: a single returned card should be sufficient for a human artist or generative renderer without denormalizing authored storage.

Physical database layout is a separate repository concern. The current Neon catalog persists normalized manifests in JSONB; a future relational or hybrid persistence model may split those facts into tables/materialized views without changing either the `DeckManifest` or resolved-card contracts.

## Validation and migration

`validateDeckManifest(value)` accepts supported historical envelopes and returns the current schema-v2 manifest plus migration metadata. `createDeckManifest(data, options)` converts bare raw-deck compatibility input into v2. Catalog repositories validate/normalize at their boundary, so rows read from historical storage surface as current manifests even before an offline rewrite migration.

## Identity and replacement

Import assigns an opaque stable resource ID. That ID—not `manifest.data.slug`—is canonical for new readings, sharing, MCP operations, and web routes.

Explicit same-slug replacement preserves the existing stable resource identity and publication state while advancing the catalog revision.

## Authoring profiles are separate

Schema v2 does not imply a fixed 78-card tarot shape. The runtime permits variant cardinalities and extension fields. A workflow/profile may impose stronger quality/generation constraints without defining a different manifest format.
