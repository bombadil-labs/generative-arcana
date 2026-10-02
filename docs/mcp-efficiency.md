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

Stage inline JSON once if neither file route works. Subsequent validation/import calls use only
uploadId. Files are at most 2,000,000 UTF-8 bytes; issuance is 12/minute/account and at most eight
active uploads/account. Repeated identical finalize is safe; changed bytes require a new upload.
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

## Typed revision-safe edits

`edit_deck` accepts stable deckId, expectedRevision, optional metadata edits, and typed cards/spreads
with upsert/remove lists. It limits total operations to 20 and UTF-8 arguments to 64 KiB. Card
upserts supply a whole typed card, not an arbitrary JSON patch. All resulting deck/axis/card/spread
relationships pass the canonical manifest validator before an atomic compare-and-swap. Conflict
returns the current revision; reconcile changes before retrying. Existing IDs, owner and publication
state are preserved. Legacy inline replacement remains compatible, and now supports optional
expectedRevision when replaceExisting is true.

## Deployment and acceptance

Apply additive migration003 before deploying file transfers; no new storage credentials are needed.
The existing PostgreSQL database holds short-lived private JSON staging. Startup does not migrate.
Readiness checks require the table. Local tests cover real PostgreSQL-compatible SQL, cross-owner
and scope denial, immutable bytes, digest/size errors, expiry/quota limits, repeated idempotent
imports, revision conflicts, HTTP PUT behavior, URL policy, and MCP descriptor/reference flow.
PGlite leases a single connection and serializes these calls: this proves transaction SQL and
retry behavior, not real multi-connection PostgreSQL lock contention across deployed replicas.
Independent multi-connection race/timeout acceptance remains a separate operational test.
Real Claude sandbox egress and ChatGPT generated-file eligibility remain host acceptance tests;
local protocol tests do not establish them. Do not report an untested host transfer as successful.
