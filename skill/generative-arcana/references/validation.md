# Platform validation loop

The authoring grammar is portable, but Generative Arcana owns the executable validation boundary. When a host has the Generative Arcana MCP connected, use it rather than reproducing runtime validation rules in prose.

## Before authoring

If `get_deck_authoring_spec` is available, call it once before generation. Treat the returned spec as the current machine-readable statement of the `DeckManifest` boundary and identity rules. It supplements this bundle; it does not replace the richer authoring strategies here.

If the tool is unavailable, continue normally from `references/schema.md`. The authoring workflow must still be usable offline or in hosts without MCP.

## Before final delivery

After assembling the complete canonical schema-v2 `DeckManifest` (`schemaVersion: 2`), call:

```text
validate_deck_manifest({ manifest: <the complete manifest> })
```

Do not request `includeNormalizedManifest` unless you actually need the normalized payload; full decks are large.

Treat results this way:

- `valid: true, canonical: true` — the authored schema-v2 artifact may be delivered or imported.
- `valid: true, canonical: false` — the input is supported legacy content (a v1 manifest without `schemaVersion`, or bare raw deck data). Use the normalized v2 shape or explicitly add `schemaVersion: 2`, then validate again. New authoring must not finish on this path.
- `valid: false` — use `error` as repair feedback, edit the artifact, and validate again.
- tool/transport failure — do not reinterpret that as a validation failure.

Validation is stateless. It does not save, publish, or import the deck.

## Import is separate

Only import when the user actually wants the deck added to the connected account/host. Validation success alone is not permission to mutate account state.

```text
import_deck({ manifest })
```

Replacement policy remains outside authored content:

```text
import_deck({ manifest, replaceExisting: true })
```

Do not add catalog IDs, owner IDs, visibility, revisions, provider metadata, or replacement policy to the manifest. Legacy callers may still send v1/raw compatibility forms; new authoring must not standardize on them.
