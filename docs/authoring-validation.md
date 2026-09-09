# Portable authoring validation

Generative Arcana owns the executable validation boundary for authored decks. Hosts may supply inference and UX, but they should not reproduce deck validation rules themselves.

The canonical producer artifact is `DeckManifest`:

```ts
interface DeckManifest {
  data: DeckDataFile;
  tagline: string;
  spreads?: Spread[];
}
```

See `docs/deck-manifest.md` for the ownership and identity contract.

## Validation loop

A portable authoring workflow is:

1. produce a `DeckManifest`;
2. validate it through Generative Arcana;
3. use `{ valid: false, error }` as repair feedback and repeat;
4. continue only when the result is `valid: true` and `canonical: true`;
5. persist/import the same authored content; the catalog then assigns stable resource identity, ownership, visibility, and revision.

Validation is stateless and account-independent. It never imports a deck or mutates a caller's runtime/catalog.

## MCP

Two read-only tools are available in every MCP host:

- `get_deck_authoring_spec` — compact machine-readable description of the canonical envelope, identity boundary, compatibility policy, and validation behavior.
- `validate_deck_manifest` — validates either `manifest` (an object) or `json` (a string). Set `includeNormalizedManifest: true` only when the normalized artifact is needed; large decks make that response correspondingly large.

Invalid authored content is returned as structured repair data rather than as a failed MCP tool call. Malformed tool input (for example supplying both `manifest` and `json`) is still a tool error.

## HTTP

The same account-independent surface is available beside the web app and MCP endpoint:

```text
GET  /api/authoring/spec
POST /api/authoring/validate
```

`POST /api/authoring/validate` accepts the authored JSON document directly. Add `?includeNormalizedManifest=true` to receive the validated/normalized manifest in the result.

These routes do not require `DATABASE_URL`, browser authentication, or MCP OAuth. The production HTTP server still applies its existing Host/Origin validation, request-size limits, and rate limiting.

## Result shape

Successful canonical validation returns a compact result like:

```json
{
  "valid": true,
  "specVersion": "1",
  "inputKind": "manifest",
  "canonical": true,
  "summary": {
    "name": "Example Tarot",
    "slug": "example",
    "version": "1.0.0",
    "cardCount": 78,
    "suitCount": 4,
    "rankCount": 14,
    "stationCount": 7,
    "spreadCount": 0
  }
}
```

A bare legacy `DeckDataFile` may also validate because uploads/imports still support that historical input shape. Such a result is explicitly marked:

```json
{
  "valid": true,
  "inputKind": "legacy-raw-deck",
  "canonical": false,
  "warning": "Bare DeckDataFile is accepted for compatibility ..."
}
```

New authoring producers should never standardize on that compatibility path.

Invalid authored content stays a normal validation result:

```json
{
  "valid": false,
  "specVersion": "1",
  "inputKind": "manifest",
  "canonical": true,
  "error": "manifest.tagline: must be a non-empty string."
}
```

## Why there is no duplicate JSON Schema source of truth

The machine-readable spec intentionally describes the artifact boundary rather than attempting to reimplement every deck rule as a second static schema. The shared deck-domain validator performs referential checks, canonical runtime card-order derivation, native spread normalization, JSON snapshotting, and extension preservation that are not usefully captured by a shallow envelope schema alone.

If a future editor needs JSON Schema for completion/form generation, it should be generated or tested against this executable boundary rather than becoming a competing definition of what a valid deck is.
