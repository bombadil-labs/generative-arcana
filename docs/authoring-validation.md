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

See `docs/deck-manifest.md` for the ownership and identity contract.

## Validation loop

A portable authoring workflow is:

1. produce a schema-v2 `DeckManifest`;
2. validate it through Generative Arcana;
3. use `{ valid: false, error }` as repair feedback and repeat;
4. continue only when the result is `valid: true` and `canonical: true`;
5. persist/import the same authored content; the catalog then assigns stable resource identity, ownership, visibility, and revision.

Validation is stateless and account-independent.

## MCP

Two read-only tools are available in every MCP host:

- `get_deck_authoring_spec`
- `validate_deck_manifest`

A successful canonical validation returns:

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

A historical v1 manifest without `schemaVersion` remains readable but returns `inputKind: "legacy-manifest-v1"`, `canonical: false`, `migrated: true`, and may return its normalized v2 manifest. Bare `DeckDataFile` is a second compatibility path (`legacy-raw-deck`). New producers should never standardize on either legacy form.

Invalid authored content remains structured repair data rather than a failed tool call.

### Importing the validated artifact

```text
import_deck({ manifest })
```

`replaceExisting` is operation metadata and may accompany the manifest explicitly. Top-level `tagline`/`spreads` overrides are rejected when `manifest` is supplied.

## HTTP

The same account-independent surface is available beside the web app and MCP endpoint:

```text
GET  /api/authoring/spec
POST /api/authoring/validate
```

These routes do not require browser auth or MCP OAuth; ordinary Host/Origin, size, and rate guardrails still apply.
