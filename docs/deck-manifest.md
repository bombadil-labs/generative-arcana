# DeckManifest contract

`DeckManifest` is the canonical authored artifact for Generative Arcana.

It is deliberately smaller than a catalog record and larger than raw deck data:

```ts
interface DeckManifest {
  schemaVersion: 2;
  data: DeckDataFile;
  tagline: string;
  spreads?: Spread[];
}
```

`schemaVersion` versions the authored envelope separately from `data.version`, which is the deck creator's own content/version identifier. v1 manifests omitted `schemaVersion`; they remain readable compatibility input and normalize to v2.

Every authoring route should terminate in this v2 shape before persistence:

- upload/import from the web app;
- manual authoring;
- the Generative Arcana ChatGPT skill;
- a Claude/native authoring wrapper;
- a future hosted editor or inference workflow.

Those routes may differ radically in how they help a user create the content. They do **not** get different persisted deck formats.

## What belongs in the manifest

### `data`

The renderer-independent symbolic deck model (`DeckDataFile`). It owns authored deck structure and content: theme, suits, ranks, transversal, majors, cards, and optional extension fields accepted by the runtime deck validator. Renderer-independent **visual semantics** (shared material language, family composition grammar, rank form, station environment, numeric visual logic) also belong here; executable renderer objects do not. See `docs/visual-grammar.md`.

`data.slug` is authored metadata. It is useful for presentation and backwards-compatible lookup, but it is **not** the durable Generative Arcana resource identity.

### `tagline`

A required non-empty human-facing summary of the deck. Canonical authoring producers should write it explicitly rather than relying on a host to derive one.

### `spreads`

Optional deck-native spread definitions. At validation/registration time, spreads are normalized to the owning deck identity and validated for shape, duplicate IDs, generic-spread collisions, and ownership consistency.

## What does not belong in the manifest

A manifest is portable authored content, not an account/catalog row. It must not contain:

- the opaque stable catalog resource ID;
- owner/principal IDs;
- visibility (`private | unlisted | public`);
- catalog revision or publication timestamps;
- OAuth/OIDC/WorkOS/provider identity;
- session or entitlement data;
- host-specific MCP metadata;
- renderer implementation objects or browser component references.

Those concerns are joined to the manifest by the host/catalog at runtime.

The durable catalog record therefore looks conceptually like:

```ts
interface UserDeckRecord {
  id: string;
  ownerId: string;
  slug: string;
  manifest: DeckManifest;
  visibility: "private" | "unlisted" | "public";
  revision: number;
  createdAt: string;
  updatedAt: string;
  publishedAt?: string;
}
```

## Validation boundary

The executable contract lives in the shared deck domain:

- `app/src/decks/validate.ts` validates `DeckDataFile` structure and referential integrity.
- `app/src/decks/registry.ts` is the deck construction boundary.
- `app/src/decks/manifest.ts` validates supported manifest versions and normalizes them to schema v2.

`validateDeckManifest(value)` returns the current schema-v2 artifact plus source-version/migration metadata. `createDeckManifest(data, options)` is the compatibility/construction path for raw deck JSON. Unsupported future versions fail closed.

## Normalized source vs resolved read views

`DeckManifest` is the normalized authored source: deck, suit/Major family, rank, station, numeric, and card facts should each be authored once at the layer that owns them. That does **not** mean every API read should expose the same normalized shape.

`get_card` and reading projections may deliberately return a **resolved card render specification** that embeds inherited deck/family/rank/station/number context alongside the card's concrete scene. This duplication is a read-model concern: it makes a single returned card sufficient for a human artist or generative renderer without denormalizing authored storage.

Physical database layout is a separate repository concern. The current Neon catalog persists normalized manifests in JSONB; a future relational or hybrid persistence model may split those facts into tables/materialized views without changing the DeckManifest or resolved-card contracts.

## Identity and replacement

Importing a manifest into a user catalog assigns an opaque stable resource ID. That ID, not `manifest.data.slug`, is canonical for new readings, sharing, MCP operations, and web routes.

Replacing an owned deck with the same authored slug is an explicit operation. A successful replacement preserves the existing resource ID and publication state while advancing the catalog revision.

## Authoring profiles are separate

`DeckManifest` does not imply “78-card Rider–Waite-like tarot.” The runtime contract permits variant cardinalities and extension fields. Authoring profiles may impose stronger quality/generation constraints without creating a different manifest format.

## Host wrappers

A host wrapper should be thin: gather/generate content, assemble schema-v2 `DeckManifest`, validate through Generative Arcana, then hand the validated artifact to persistence/runtime APIs. It should not invent a host-specific deck ontology.
