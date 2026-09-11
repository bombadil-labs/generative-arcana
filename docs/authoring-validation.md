# Portable authoring validation

Generative Arcana owns the executable validation boundary for authored decks. Hosts may supply inference and UX, but they should not reproduce deck validation rules themselves.

The canonical producer artifact is schema-v2 `DeckManifest`:

```ts
interface DeckManifest {
  schemaVersion: 2;
  data: DeckDataFile;
  tagline: string;
  spreads?: Spread[];
}
```

## Validation loop

1. produce schema-v2 `DeckManifest`;
2. validate it through Generative Arcana;
3. repair from `{ valid: false, error }`;
4. continue only on `valid: true, canonical: true`;
5. persist/import the same normalized authored content.

Validation is stateless and account-independent.

## MCP and HTTP

Read-only MCP tools:

- `get_deck_authoring_spec`
- `validate_deck_manifest`

HTTP equivalents:

```text
GET  /api/authoring/spec
POST /api/authoring/validate
```

A successful canonical result is shaped like:

```json
{
  "valid": true,
  "specVersion": "2",
  "inputKind": "manifest-v2",
  "canonical": true,
  "migrated": false,
  "summary": {
    "schemaVersion": 2,
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

A historical v1 manifest (`{ data, tagline, spreads? }`) returns `inputKind: "legacy-manifest-v1"`, `canonical: false`, `migrated: true`, and can optionally return its normalized schema-v2 manifest. Bare `DeckDataFile` remains a second compatibility input (`legacy-raw-deck`). New producers must not standardize on either path.

## Import

The preferred stateful call accepts the validated artifact directly:

```text
import_deck({ manifest })
```

`replaceExisting` is operation metadata and may accompany the manifest. Authored `tagline`/`spreads` cannot be overridden outside the manifest.
