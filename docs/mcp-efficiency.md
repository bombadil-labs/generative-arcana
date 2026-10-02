# Efficient MCP deck workflows

## Lean reads and response formats

The canonical `DeckManifest` schema and its import/validation semantics are unchanged. Read
projections let clients fetch only the information needed for their next step. `get_deck` accepts
an optional `view`:

- `full` (default): the historical runtime deck, including both `data.cards` and the ordered
  `cards` projection. Existing callers retain their result shape.
- `manifest`: exactly the canonical schema-v2 manifest (`schemaVersion`, `data`, `tagline`, and
  optional native `spreads`). Card bodies occur once, under `data.cards`. This is the export and
  full re-import view; runtime resource IDs and aliases are not added to the authored envelope.
- `summary`: resource ID, authored slug, name/version/tagline, custom status, current schema
  version, and card/suit/rank/station/spread counts. `spreadCount` includes all available spreads;
  `nativeSpreadCount` counts only deck-authored spreads. No card or axis bodies are returned.
- `structure`: `{ summary, data, cardOrder, spreads? }`. `data` retains all authored metadata,
  axes, visual language, and extension fields except its `cards` member; `cardOrder` lists the
  canonical runtime card slugs. This is a read projection, not an importable partial manifest.
  Use `get_card` or `analyze_card` for individual bodies/interpretation after selecting a slug.

For example, `get_deck` with `{ "deckId": "...", "view": "structure" }` lets an agent inspect
the deck's axes and choose a card without retrieving every card's meanings and visual prose.
Malformed `view` values fail instead of silently falling back to a full response.

Core deck tools also accept `responseFormat`. The default, `"json"`, returns compact JSON in one
text block and the same data in `structuredContent.result`. It removes pretty-print whitespace
while preserving text-only hosts and consumers that parse the text as JSON. Callers that know
their host exposes structured content may explicitly choose `"structured"`: the full data appears
once in `structuredContent.result`, with a short human-readable summary as the text block. That
summary is not JSON and must not be passed to a legacy JSON-text parser. Do not enable this mode
globally based merely on the existence of an MCP connection; it is an explicit caller choice.
Errors retain their error text and `isError` behavior.

The two options are independent. A text-only host can use `view: "manifest"` or `"summary"` to
reduce output without changing its parser. A structure-aware client can combine
`view: "manifest", responseFormat: "structured"` to transfer an exportable artifact once.
Neither option changes the deck, registry, catalog permissions, revision, or reading semantics.

### Representative payload sizes

With the existing 78-card Deep Time fixture, measured as UTF-8 bytes of the MCP result JSON
(excluding JSON-RPC/HTTP framing), the previous full response was 430,254 bytes. Compact JSON
text with the same legacy result was 393,957 bytes. With structured mode, the full view was
192,342 bytes, the canonical manifest 109,093 bytes, the structure 26,095 bytes, and the summary
388 bytes. These are fixture measurements, not universal payload limits or host compatibility
claims. Structured mode plus the manifest view reduced this example by about 75% while preserving
the complete canonical artifact. Network compression, if present, is separate from model-context
savings; the default still deliberately repeats the result for older text-only hosts.

## File transfer and immutable imports

Native ChatGPT file inputs are declared with `openai/fileParams` on `stage_deck_manifest` and
`validate_deck_manifest`. The schema declares download_url, file_id, mime_type and file_name,
requiring the first two, as documented at https://developers.openai.com/plugins/reference.
This is host-specific, not a promise that every generated sandbox artifact is attachable.
The server only fetches approved ChatGPT file-delivery hosts over HTTPS, rejects redirects,
pins a validated public IPv4 destination, and bounds time, response content type and actual bytes.
It never accepts a generic remote URL or a local sandbox path.

For file-capable hosts with network egress, `create_manifest_upload({byteLength,sha256?})` issues
a 15-minute upload-only ticket for one immutable JSON object. PUT the exact file to uploadUrl
with the returned Authorization header and Content-Type application/json, without multipart or
content encoding. The ticket cannot read, list, import, or edit decks. It is not the user's account
token. Its hash is stored; the ticket and native download URL are not logged. Finalization returns
the actual received SHA-256 and byte count; callers should compare against their local file.

If neither file route works, prefer the incremental MCP draft workflow below. In particular,
Claude sandbox `host_not_allowed` on raw PUT does not mean the remote MCP connector is blocked:
use its draft tools rather than repeatedly retrying sandbox egress or extracting account tokens.
Legacy `stage_deck_manifest({json})` remains available to send inline JSON once; subsequent
validation/import calls use only uploadId. Files are at most 2,000,000 UTF-8 bytes; staging
creation is 12/minute/account and at most eight active uploads and drafts combined/account.
Repeated identical finalize is safe; changed bytes require a new upload.
The database enforces the size cap too. Staged JSON also has maximum depth 128 and 100,000 nodes;
invalid Unicode/NUL strings unsupported by PostgreSQL JSON are rejected. Finalization includes
validation summary or up to 100 bounded JSON-path diagnostics and an explicit truncation flag. Invalid JSON/manifests are retained only as private repair
feedback; they cannot be imported. No source deck, meaning, or artwork is changed by staging.

Imports recheck owner and scopes. An upload-based create does not silently replace a same-slug
deck. Replacement requires stable deckId + expectedRevision. The deck write and import receipt
commit in one transaction, preventing duplicate effects after concurrent calls or a lost response.
Receipts retain only the result/digest/operation policy for 24 hours; source bytes are removed on
successful import. After expiry, the ID fails closed rather than creating a fresh operation. Total
active rows plus unexpired receipts are capped at 100/account. Expired rows are swept globally in bounded batches every minute while the HTTP service is running,
on startup and on subsequent staging activity. Dormant owners need not return for cleanup. If all
containers are suspended, cleanup resumes when they wake; expiry is always enforced at reads,
finalize and import even before physical cleanup.

## Incremental, resumable MCP drafts

`start_deck_draft`, `update_deck_draft`, `get_deck_draft`, `validate_deck_draft` and
`commit_deck_draft` assemble the same canonical `DeckManifest` entirely through MCP calls.
They require authenticated `decks:read` and `decks:write` scopes, including reads and validation;
anonymous callers cannot inspect private staging. No new upload host, storage credential,
account token in a sandbox, arbitrary remote URL, local file path, or executable code is needed.

1. Call `start_deck_draft({startKey:"my-deck-2026-10-02"})`. Use a unique key of 1–80 ASCII
   letters, digits, underscores or hyphens. Keep the returned `draftId`, `version` (initially 1)
   and `expiresAt`. Reuse the same key after a lost response to recover that draft.
2. Call `update_deck_draft` in bounded batches. Every call includes `draftId`, `expectedVersion`
   and a new `mutationId` (1–128 letters/digits/`.`/`_`/`:`/`-`, starting with a letter or digit).
   For example:

   ```json
   {
     "draftId": "<returned UUID>",
     "expectedVersion": 1,
     "mutationId": "metadata-1",
     "metadata": {
       "schemaVersion": 2,
       "tagline": "A deck about attention and balance.",
       "data": {"name": "Example Tarot", "slug": "example-tarot", "version": "1.0.0"}
     }
   }
   ```

   Use `metadata.data` for ordinary deck fields, including theme, visual language, major-arcana
   grammar and authored extensions. It excludes `cards`, `suits`, `ranks` and `transversal`.
   Use `transversal` for its metadata/extension fields, excluding `stations`. `cards.upsert`
   takes complete card objects with slugs; `spreads.upsert` takes complete spread objects with
   IDs. Axis collections (`suits`, `ranks`, `stations`) take `upsert:[{key,value}]`, with the
   authored dictionary key separate from the typed entity. Each collection also has `remove`
   keys. `metadata.remove` removes data fields; `transversalRemove` removes transversal fields.
   An upsert replaces the entire entity, including its extension fields; omitted top-level
   update fields leave the draft unchanged. Arbitrary JSON Patch paths and prototype keys
   are rejected.
3. Advance `expectedVersion` to the returned version after each successful batch. At most
   20 operations and 64 KiB of UTF-8 argument JSON are allowed per update. Each metadata field,
   removal and entity upsert counts as an operation. Split larger content into card/axis batches.
   Reuse the exact arguments and `mutationId` after a lost response; identical retries do not
   apply twice. A replay reports the original applied `version` and the latest `currentVersion`;
   use `get_deck_draft` before continuing if those differ. Reusing a mutation ID with different
   content or version fails. After a version
   conflict, inspect current state and reconcile before issuing a new mutation ID.
4. Use `get_deck_draft({draftId})` to recover version, expiry, state and counts only. To inspect
   content, choose a named `section`: `metadata`, `transversal`, `cards`, `suits`, `ranks`,
   `stations` or `spreads`. Optional `keys` selects at most 20 entries; `offset` and `limit`
   page over the selection. Follow `nextOffset` until null. Each page has at most 20 entries and
   bounded JSON bytes; there is no default whole-manifest echo. Metadata entry keys are
   `schemaVersion`, `tagline` and `data.<field>`; transversal entry keys omit `stations`.
5. Call `validate_deck_draft({draftId,expectedVersion})`. Updates permit incomplete intermediate
   structure; full deck, axis, card, spread and cross-reference checks run here. Repair bounded
   diagnostics with more updates. Finish authoring only with `valid:true, canonical:true`.
6. After the user authorizes saving, call `commit_deck_draft({draftId,expectedVersion})`.
   Commit re-runs full canonical validation and atomically writes the catalog entry and receipt.
   A new deck is private; it never silently replaces a same-slug deck. Authorized replacement
   requires the stable `deckId` and current `expectedRevision` together. A conflict leaves
   existing content unchanged. Repeat the same commit arguments after a lost response to
   retrieve the original receipt for 24 hours; source bytes are removed on successful commit.

Drafts expire two hours after creation, with no sliding renewal. A draft permits at most 512
successful mutations and 2,000,000 assembled UTF-8 JSON bytes. Updates, reads, validation and commit
share a durable 60/minute/account limiter. Drafts share the existing active/retained staging
quotas and expiry sweeper with file uploads. Nothing enters catalog discovery or becomes
readable as a deck until a successful commit. Draft IDs are not accepted as file upload IDs by
`validate_deck_manifest` or `import_deck`; use the draft tools so the version check cannot be skipped.

This is incremental text transport, not zero-copy file transfer. All authored text still passes
through model tool arguments. Batching bounds individual calls and retry costs, and server-side
assembly avoids re-sending already accepted parts. It does not eliminate the model-token cost
of authoring/transmitting the deck. Native files, upload-ticket PUT, immutable inline staging,
and legacy inline validation/import remain supported when appropriate.

## Typed revision-safe edits

`edit_deck` accepts stable deckId, expectedRevision, optional metadata edits, and typed cards/spreads
with upsert/remove lists. It limits total operations to 20 and UTF-8 arguments to 64 KiB. Card
upserts supply a whole typed card, not an arbitrary JSON patch. All resulting deck/axis/card/spread
relationships pass the canonical manifest validator before an atomic compare-and-swap. Conflict
returns the current revision; reconcile changes before retrying. Existing IDs, owner and publication
state are preserved. Legacy inline replacement remains compatible, and now supports optional
expectedRevision when replaceExisting is true.

## Deployment and acceptance

Apply additive migration003 before deploying file transfers and migration005 before deploying
incremental drafts; no new storage credentials are needed.
The existing PostgreSQL database holds short-lived private JSON staging. Startup does not migrate.
Readiness checks require the staging table and draft columns. Local tests cover real PostgreSQL-compatible SQL, cross-owner
and scope denial, immutable bytes, digest/size errors, expiry/quota limits, repeated idempotent
imports, revision conflicts, HTTP PUT behavior, URL policy, and MCP descriptor/reference flow.
PGlite leases a single connection and serializes these calls: this proves transaction SQL and
retry behavior, not real multi-connection PostgreSQL lock contention across deployed replicas.
Independent multi-connection race/timeout acceptance remains a separate operational test.
Real Claude sandbox egress and ChatGPT generated-file eligibility remain host acceptance tests;
local protocol tests do not establish them. Do not report an untested host transfer as successful.

Draft source is stored separately from legacy finalized-upload bytes: draft rows keep `raw_json`
NULL, including during authoring. This is enforced by a database constraint so an older deployment
cannot accidentally import an editable draft through its legacy upload route. Commit reads the
separate source under the same row lock and clears it atomically with the receipt.
