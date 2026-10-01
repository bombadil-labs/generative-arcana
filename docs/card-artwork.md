# Saved static card artwork (opt-in)

This slice attaches one raster image to one card in an owned catalog deck. Stable deck resource IDs and card slugs select the target. DeckManifest remains semantic content; artwork returns a separate, portable VisualPackManifest. Replacing artwork never rewrites card meanings, authored source, or executable programs.

## Website and MCP

- Signed in: open a deck, choose **Artwork**, select a card and PNG/JPEG/WebP file, then save. The website accepts at most 3,000,000 input bytes and 16 million pixels. Raster artwork appears in the card browser/detail; other cards keep their existing semantic fallback.
- MCP: `get_card_artwork` returns metadata, current deck revision, artwork ID, and an image content block. `set_card_artwork` accepts actual canonical base64 image bytes up to 1,000,000 decoded bytes, media type, stable deck ID, card slug, expected deck revision, and expected prior artwork ID (null for a first attachment). Get the current revision through `get_shared_deck`/`list_my_decks`; use `get_card_artwork` to obtain an existing artwork ID. A conflict requires refreshing and an intentional retry, never silently overwriting a newer upload.
- Existing `list_visual_packs`, `get_card_art`, and static `render_reading` can resolve saved artwork. A partially illustrated spread still reports missing card art; it does not fabricate a completed deck.
- A generated picture shown by ChatGPT/Claude is not proof that its bytes are available to the connector. The base64 tool is a concrete transport for hosts that can supply file bytes. Automatic generated-file handoff is **not verified or implemented**. Downloading an image and uploading it through the signed-in website is the supported fallback.
- SVG rasterization and animated/p5 program execution are **not implemented**. Existing portable program declarations/source remain untouched. Static fallbacks can be uploaded separately. Nothing in this feature runs user-authored code or fetches user-supplied URLs.

## Security and lifecycle

Uploads require the current owner and deck read+write scopes. Metadata/image reads follow the deck's current private/unlisted/public permissions. Private object keys, credentials, provider URLs and owner IDs are never returned. Reencoding strips source metadata and outputs static WebP; SVG/GIF/other decoders are rejected before image parsing, as are PNG/WebP animation containers. The pipeline limits input bytes, pixel count, processing concurrency (2/process), decoder time (10 seconds), output edge (4096) and output bytes (2,000,000). Authenticated uploads share a durable 12/minute principal limit across website/MCP instances, in addition to the existing request limit.

Objects use immutable random keys in a private bucket. Reads pass through an authenticated same-origin endpoint with no-store, nosniff and sandbox headers; MCP reads return the same verified bytes. No public bucket or permanent signed URLs are used. Object byte length and SHA-256 are checked on every read. Authorization is rechecked after storage retrieval to catch in-flight revocation.

A PostgreSQL transaction locks the owning deck and compares both deck revision and previous artwork ID before attachment. A rejected concurrent upload cannot overwrite a newer attachment or re-create a deleted deck. Successful replacement best-effort deletes the previous object. Definitely rejected new objects are cleaned up; uncertain commit outcomes retain their object to avoid deleting potentially committed artwork. Deck deletion cascades metadata. Unreferenced objects from deleted decks, ambiguous commits or failed deletes require an operator-reviewed retention/garbage-collection process; automatic bucket-wide cleanup is deliberately absent. Do not treat database deletion as proof the old object bytes have been physically erased.

## Explicit activation, isolated preview first

The checked-in feature is disabled by default and creates no bucket, credentials or database schema. Unconfigured website uploads return a clear unavailable response. All values are server-only. Use one dedicated feature-preview environment with a matching database branch, private bucket and narrowly anchored storage credential; do not reuse a production-root credential or configure one root bucket globally across automatic database previews.

1. Review `mcp/migrations/002-card-artwork.sql` and the target database hostname. Preview additive SQL with `npm run db:migrate:domain --prefix mcp -- --include-artwork`; applying additionally requires `--apply --expected-host <reviewed host>` and the existing migration-role/backup review. No runtime schema creation occurs.
2. Provision an explicitly approved private bucket on that preview's Neon branch. A separate scoped storage credential is required; current Neon storage credentials are branch+descendant scoped. Creating/configuring that credential requires operator approval and secure secret handling.
3. Configure only that preview branch's server environment:
   - `ARCANA_ARTWORK_ENABLED=true`
   - `ARCANA_ARTWORK_DATABASE_HOST` = the approved database endpoint hostname. Only the exact direct/`-pooler` pair of the same Neon AWS endpoint is treated as equivalent; endpoint ID, cluster, region and domain must all match
   - `ARCANA_ARTWORK_S3_ENDPOINT` = the reviewed HTTPS origin for the **same branch**
   - `ARCANA_ARTWORK_S3_REGION` = its region
   - `ARCANA_ARTWORK_S3_BUCKET` = approved private bucket name
   - `ARCANA_ARTWORK_S3_ACCESS_KEY_ID`
   - `ARCANA_ARTWORK_S3_SECRET_ACCESS_KEY`
4. The explicit database-host pin (with only that narrow direct/pooled equivalence) fails closed if an automatic preview is assigned another DB host. These variables are not assumed to be injected by the Vercel Neon integration. Never place secret values in NEXT_PUBLIC/VITE variables, commit them, print them, or paste them into chat.
5. Verify a neutral one-card upload/read through both website and MCP in that isolated preview, plus unauthorized access and visibility revocation. The first live probe must also confirm Neon accepts conditional `PutObject` (`If-None-Match: *`) and the pinned AWS SDK checksum behavior; the general S3 compatibility docs do not explicitly guarantee those details. The adapter does not silently downgrade those protections. Production activation and whole-deck expansion are separate decisions.

The S3 adapter uses path-style addressing and explicit credentials, so no ambient AWS credential fallback can silently point at a different provider. Endpoint configuration is operator-controlled, not accepted from an upload. Require a private bucket; a public-read bucket would bypass application authorization at the storage origin.

Neon currently documents Object Storage in us-east-1, $0.023/GB-month, no operation fees, and a 5 GB/project Free allowance. Exact allowance/billing for the Vercel-managed plan must be verified before paid activation. See [Neon storage overview](https://neon.com/docs/storage/overview), [authentication](https://neon.com/docs/storage/authentication), and [pricing](https://neon.com/pricing). No billable tier change is included in this code change.
