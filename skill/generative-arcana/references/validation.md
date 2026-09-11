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

- `valid: true, canonical: true` — the authored artifact may be delivered or imported.
- `valid: true, canonical: false` — the input is supported legacy content (a v1 manifest without `schemaVersion`, or bare raw deck data). Use the normalized v2 shape or explicitly add `schemaVersion: 2`, then validate again. New authoring must not finish on this path.
- `valid: false` — use `error` as repair feedback, edit the artifact, and validate again. Do not paper over the failure or merely warn the user.
- tool/transport failure — do not reinterpret that as a validation failure. If the platform validator is unavailable, perform the local quality checks in this bundle and clearly deliver the manifest without claiming server validation.

Validation is stateless. It does not save, publish, or import the deck.

## Import is separate

Only import when the user actually wants the deck added to the connected Generative Arcana account/host and the relevant stateful tool is available. Validation success alone is not permission to mutate account state.

Pass the exact validated authored artifact as the preferred import payload:

```text
import_deck({ manifest })
```

If replacement of an existing same-slug owned deck is intended, keep that operation policy outside the manifest:

```text
import_deck({ manifest, replaceExisting: true })
```

Do not add catalog IDs, owner IDs, visibility, revisions, provider metadata, or replacement policy to the manifest; the platform owns those concerns.

Legacy callers may still send raw `data` or `json` plus top-level `tagline`/`spreads`. New authoring workflows should not unpack a canonical manifest into that compatibility form. When `manifest` is supplied, top-level `tagline` and `spreads` overrides are rejected so there is exactly one authored source of truth. Never silently turn a create into a replacement.
