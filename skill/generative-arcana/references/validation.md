# Platform validation loop

The authoring grammar is portable, but Generative Arcana owns the executable validation boundary. When a host has the Generative Arcana MCP connected, use it rather than reproducing runtime validation rules in prose.

## Before authoring

If `get_deck_authoring_spec` is available, call it once before generation. Treat the returned spec as the current machine-readable statement of the `DeckManifest` boundary and identity rules. It supplements this bundle; it does not replace the richer authoring strategies here.

If the tool is unavailable, continue normally from `references/schema.md`. The authoring workflow must still be usable offline or in hosts without MCP.

## Before final delivery

After assembling the complete canonical schema-v2 `DeckManifest` (`schemaVersion: 2`), prefer
file/reference transfer when the server exposes it. Keep the canonical authored file unchanged:

1. If the host supplies native file parameters, call `validate_deck_manifest({ file })` or
   `stage_deck_manifest({ file })`. Use a real host-provided file object; a sandbox path alone
   is not a remote file reference. Successful staging returns an immutable `uploadId` and SHA-256.
2. If the host can send file bytes over HTTP, call `create_manifest_upload` with the exact byte
   length and optional local SHA-256. Make one plain PUT of the file with Content-Type application/json
   and the returned upload-only Authorization header. Do not extract or pass account OAuth tokens
   into a sandbox. Compare the server's received SHA-256, then validate using `{ uploadId }`.
3. If neither file transport is available, prefer incremental MCP drafts when exposed. A sandbox
   `host_not_allowed` error on PUT, including in Claude, is a reason to use the connector's draft
   tools rather than repeatedly attempting sandbox egress. An MCP connection does not imply
   that its sandbox can reach the upload host. Do not extract account OAuth tokens into a sandbox.
4. If draft tools are unavailable, `stage_deck_manifest({ json })` sends the artifact inline once;
   validate and import by `uploadId` afterward. Do not regenerate the entire deck merely because
   a host cannot upload. For older servers or offline-compatible inline validation, call:

```text
validate_deck_manifest({ manifest: <the complete manifest> })
```

Do not request `includeNormalizedManifest` unless you actually need the normalized payload; full decks are large.

Treat results this way:

- `valid: true, canonical: true` — the authored artifact may be delivered or imported.
- `valid: true, canonical: false` — the input is supported legacy content (a v1 manifest without `schemaVersion`, or bare raw deck data). Use the normalized v2 shape or explicitly add `schemaVersion: 2`, then validate again. New authoring must not finish on this path.
- `valid: false` — use `error` as repair feedback, edit the artifact, and validate again. Do not paper over the failure or merely warn the user.
- tool/transport failure — do not reinterpret that as a validation failure. If the platform validator is unavailable, perform the local quality checks in this bundle and clearly deliver the manifest without claiming server validation.

Inline validation is stateless. File validation stages private transient bytes for 15 minutes; validation by uploadId reads those same immutable bytes. Neither creates or publishes a deck. Repairs require a new upload, so a validated upload cannot be overwritten before import.

## Incremental MCP assembly

For a host without usable native-file or raw HTTP transfer, assemble the authored manifest over
MCP in bounded batches. This preserves the same deck schema and authoring grammar:

1. `start_deck_draft({startKey})` returns a private `draftId`, `version:1` and fixed two-hour
   expiry. Pick a unique key of 1–80 ASCII letters, digits, underscores or hyphens; reuse it only
   when recovering the same start after a lost response.
2. `update_deck_draft({draftId,expectedVersion,mutationId,...})` adds metadata and typed entity
   batches. `metadata` supports `schemaVersion`, `tagline`, and `data` fields excluding cards,
   suits, ranks and transversal. `transversal` supplies its fields except stations. Cards and
   spreads use `{upsert:[<complete entities>],remove:[<slugs or IDs>]}`. Suits, ranks and stations
   use `{upsert:[{key:<dictionary key>,value:<complete entity>}],remove:[<keys>]}`. Preserve
   extension fields when replacing an entity. `metadata.remove` and `transversalRemove` remove
   fields in their respective sections; arbitrary JSON patches are not supported.
3. Each batch must fit both 20 combined operations and 64 KiB of UTF-8 JSON. Each metadata
   field, entity upsert and removal counts. Follow the returned version for the next batch.
   After a lost response, retry identical arguments with the same mutationId. Changing content
   or expectedVersion requires a fresh mutationId; never blindly replay against a newer version.
   Replays include the original applied version and currentVersion; read current state before
   continuing when they differ.
4. Recover with `get_deck_draft({draftId})` for summary/version/expiry only. Select a named
   section (`metadata`, `transversal`, `cards`, `suits`, `ranks`, `stations`, `spreads`) plus
   optional `keys`, `offset` and `limit` for bounded pages. Follow `nextOffset`; do not fetch
   all content when a summary or one affected card is enough.
5. `validate_deck_draft({draftId,expectedVersion})` runs full canonical validation and returns
   bounded repair diagnostics. Incomplete intermediate drafts are allowed during assembly,
   but finish only after `valid:true, canonical:true`. Repair with more bounded updates.
   Draft responses label the hash as `sha256Basis:"assembled-json-sorted-keys-compact-utf8-v1"`:
   SHA-256 and byteLength refer to assembled JSON before import normalization, with recursively
   sorted object keys (JavaScript UTF-16 lexical order), preserved array order, compact
   JSON.stringify scalar/string encoding, UTF-8, and no BOM or trailing newline. This is not an
   original-file byte hash or an assertion of equality with a local file. Equal byte counts do
   not prove byte/content parity. Compare actual parsed values or use the same serialization
   algorithm before explaining a hash mismatch. File staging instead labels `original-upload-bytes`.

All draft tools require account read/write permissions. Drafts are private staging and create
no catalog deck until explicit commit. They allow at most 512 successful mutations and
2,000,000 assembled UTF-8 bytes; the two-hour expiry does not slide on activity. Authored text
still passes through model tool arguments. Batching reduces per-call size and retry costs; it
does not make this zero-copy transfer or guarantee a particular host's acceptance.

## Import is separate

Only import when the user actually wants the deck added to the connected Generative Arcana account/host and the relevant stateful tool is available. Validation success alone is not permission to mutate account state.

For a staged file, call `import_deck({ uploadId })`; do not send the full file again. A lost-response
retry with the same uploadId and options returns its original result for 24 hours. Replacement
requires the existing stable `deckId` and current `expectedRevision` together. On a revision
conflict, read current state and reconcile rather than blindly overwriting another host's changes.

For a validated draft, explicitly call `commit_deck_draft({draftId,expectedVersion})` after the
user authorizes saving. It revalidates the whole canonical manifest and writes the catalog and
receipt atomically. Replacement additionally requires stable `deckId` and current
`expectedRevision` together. Retry identical commit arguments to recover the original result
for 24 hours. Use the draft commit tool, not `import_deck({uploadId:draftId})`.

For older servers, pass the exact validated authored artifact:

```text
import_deck({ manifest })
```

If replacement of an existing same-slug owned deck is intended, keep that operation policy outside the manifest:

```text
import_deck({ manifest, replaceExisting: true, expectedRevision: <current revision> })
```

Do not add catalog IDs, owner IDs, visibility, revisions, provider metadata, or replacement policy to the manifest; the platform owns those concerns.

Legacy callers may still send raw `data` or `json` plus top-level `tagline`/`spreads`. New authoring workflows should not unpack a canonical manifest into that compatibility form. When `manifest` is supplied, top-level `tagline` and `spreads` overrides are rejected so there is exactly one authored source of truth. Never silently turn a create into a replacement.

## Focused edits and reads

For a small change to an existing owned deck, use `edit_deck` with its stable `deckId`,
`expectedRevision`, and typed card/spread upserts or removals (at most 20 combined operations,
64 KiB per request). Metadata supports name, version, tagline and theme fields. Full-card upserts
replace that card; preserve the other fields deliberately. The server validates the resulting
whole manifest before its atomic write. For an owned catalog deck, obtain the current revision
from `get_deck({deckId,view:"summary"}).revision`, the structure view's `summary.revision`, or
`list_my_decks`; do not deliberately submit a stale write to discover it. Summary content and
revision come from the same snapshot. Built-in/non-catalog and shared non-owned summaries omit
this editing metadata. Deck meaning stays separate from visual image sets.

Use `get_deck({deckId,view:"summary"})` for counts, `view:"structure"` for axes and card slugs,
and `get_card` for a chosen card. `view:"manifest"` exports the canonical artifact with each card
only once. Hosts that reliably expose structured results can request `responseFormat:"structured"`
to avoid duplicate JSON text. Default responses keep parseable JSON text for compatibility.
