# DeckManifest contract

`DeckManifest` is the canonical authored artifact for Generative Arcana.

It is deliberately smaller than a catalog record and larger than raw deck data:

```ts
interface DeckManifest {
  data: DeckDataFile;
  tagline: string;
  spreads?: Spread[];
}
```

Every authoring route should terminate in this shape before persistence:

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
  id: string;          // opaque stable resource identity
  ownerId: string;     // opaque Generative Arcana principal
  slug: string;        // authored metadata copied/indexed from manifest.data.slug
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
- `app/src/decks/registry.ts` is the deck construction boundary: it validates, canonicalizes card order, normalizes native spreads, snapshots JSON, and selects runtime identity.
- `app/src/decks/manifest.ts` exposes the manifest-level boundary.

`validateDeckManifest(value)` validates a canonical `{ data, tagline, spreads? }` artifact without mutating the application registry. `createDeckManifest(data, options)` is the compatibility/construction path for consumers that still accept legacy raw deck JSON.

This distinction is intentional:

- **producer rule:** new authoring workflows emit `DeckManifest`;
- **consumer compatibility:** imports may still accept raw `DeckDataFile` and normalize it into a manifest before persistence.

The catalog/MCP layer delegates manifest construction to this shared domain code; transports should not rebuild validation semantics themselves.

## Identity and replacement

Importing a manifest into a user catalog assigns an opaque stable resource ID. That ID, not `manifest.data.slug`, is canonical for new readings, sharing, MCP operations, and web routes.

Replacing an owned deck with the same authored slug is an explicit operation. A successful replacement preserves the existing resource ID and publication state while advancing the catalog revision. The authored content remains a new manifest snapshot attached to the same resource.

## Authoring profiles are separate

`DeckManifest` does not imply “78-card Rider–Waite-like tarot.” The runtime contract already permits variant cardinalities and extension fields; for example, alternate decks can use different suit/rank counts or numeric-origin rules.

A host-specific or workflow-specific authoring profile can impose stronger generation rules on `manifest.data`—for example the current default four-suit × fourteen-rank + twenty-two-major profile used by the Generative Arcana authoring skill. Those profile rules are **quality/generation constraints**, not extra catalog identity fields and not a different manifest format.

## Host wrappers

A host wrapper should be thin:

1. gather or generate authored content;
2. assemble a `DeckManifest`;
3. validate it through the shared contract (directly when embedded, or through the platform import boundary);
4. hand it to Generative Arcana persistence/runtime APIs.

The wrapper may offer host-native UX, inference, or image-generation assistance. It should not invent a host-specific deck ontology.
