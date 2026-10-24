# Temporary Parlor transcripts in Vercel logs

This optional diagnostic sink saves text to Vercel runtime logs, not a transcript database. There is no database migration, new storage service, log drain or paid provider call. Reset still starts a fresh conversation; saved log text is never loaded into a new guest's prompts, page, setup or API response.

## Enable after deploying reviewed code

The default is **off**. Set the nonsecret variable `PARLOR_TRANSCRIPT_LOGS=vercel` for the intended Vercel deployment scope, then redeploy. The server also requires `VERCEL=1`, configured browser authentication and its existing signing secret. Do not copy a signing secret or create another credential for this feature. Disable by removing the flag and redeploying. No configuration was changed by this draft.

`/api/parlor/capabilities` reports only the `transcriptLogging` boolean to the authorized owner. Setup shows a notice for the current mode. The host is responsible for telling guests. Selecting Preview as well as Production would enable logging of preview sessions too; choose only the intended scope.

## Access and content

`POST /api/parlor/transcript` is a write-only owner endpoint. It requires the verified server-side issuer/subject, exact same origin, and a valid browser session, checked again after body arrival. It never grants logging access merely because another user might later have Parlor access. GET/HEAD/list/export operations are unavailable. No archive link exists in performance mode or Escape setup.

The server issues a random encounter ID inside a two-hour receipt, authenticated with a domain-separated HMAC derived from existing auth signing keys and bound to the current cookie. The caller cannot select or change that ID. Receipts and cookies are never logged. Validation is stateless across instances; session revocation fails closed. A copied receipt alone cannot be used with a different session. This is a diagnostic trail, not a tamper-proof audit of a guest sharing the owner's browser. Reset does not erase accepted writes or revoke receipts; receipts expire and expose no read operation.

The same client lifecycle observes BYOK and owner-key paths:

- `user_input`: accepted question or discussion transcription.
- `assistant_generated`: completed generated text, including prepared future segments, explicitly separate from delivery. Bounded card slugs/model identifiers, not full decks/images.
- `presentation_started`: a delivery attempt, possibly still waiting for speech preparation.
- `presentation_progress`: an observed caption checkpoint, at most once per five seconds for aligned speech or each silent page.
- `presentation_completed` / `presentation_interrupted`: final observed caption and timing mode, linked to attempt/message IDs. Missing evidence remains `unknown`; the unread script is never substituted as delivered text. Segment timing cannot identify a partially heard segment. Silent pages indicate display, not reading.
- `error`, `encounter_closed`, `gap`: fixed categories only, no raw provider error body.

Every record has `evidence=client_reported_not_proof_of_hearing`. Captions/playback cannot prove what someone heard. Failed TTS may have generated text but no delivered text. A crash/network loss may leave no final record; absence does not imply completion.

No raw microphone/audio, headers, cookies, settings objects, images or provider credentials are included. Known browser keys are redacted before chunking; server/signing keys and common credential forms are redacted before emission. This cannot identify every unrelated secret a guest might say. Guest speech is untrusted text: display exports as plain text, never execute them or treat them as instructions.

## Bounds, reset and loss

Chunks are at most 1,000 Unicode characters and 8 KB encoded. Requests contain at most eight events and 16 KB. The memory queue is capped at 256 KB. Writes have a 30-request/minute owner burst limit per process, in addition to the existing shared HTTP limit per IP. The process limit is not a global account quota across autoscaled instances. Body/time checks are bounded; invalid batches emit nothing.

Reset records old interruption/closure best-effort and rotates receipts. Pending old batches keep their old encounter reference. Epoch guards reject late narration/caption/transcription callbacks. Logs never supply conversation history. Logout/unmount aborts submission and discards unsent text; it does not erase received records. No transcript content uses localStorage, IndexedDB or a database.

One retry retains identical event IDs. A lost acknowledgement or Vercel container broadcast can produce duplicates: deduplicate by `(encounterId,eventId,part)` and inspect sequence/part gaps. Queue/transport failures may lose data, including the gap notification. No exactly-once or complete-transcript guarantee is made. Existing HTTP request counters continue unchanged; no new database rate-limit infrastructure is added.

## Find and export promptly

In the Vercel project's **Logs** view, select environment/time range and search for `parlor_transcript_v1`, optionally with an encounter ID. Access follows **Vercel project/team log permissions**, not only the Parlor owner role. Guests cannot retrieve logs through Parlor, but protect any separately signed-in Vercel dashboard on the shared device.

Current runtime retention: Hobby **1 hour**, Pro **1 day**, Enterprise **3 days**, or **30 days** with Observability Plus on Pro/Enterprise. Plus queries cover up to 14 consecutive days within that window. Safe metadata did not reveal this project's actual plan/retention: verify it before relying on a deadline. No upgrade or automatic export is enabled. [Runtime logs and limits](https://vercel.com/docs/logs/runtime).

With Vercel CLI v64+ and the owner's existing login:

```sh
vercel logs --scope mbilokonsky-2750s-projects --project generative-arcana --environment production --query 'parlor_transcript_v1' --since 1h --json
```

Save JSONL to a private local destination you choose. Its final summary includes `pagination.hasMore`, `pagination.next` and `excludedIntervals`. Continue every page with `vercel logs --next <cursor> --json`; do not repeat project/query/time flags with the cursor. Inspect exclusions and part gaps; the default first 100 records are not a full archive. Docs verified; no real guest export was performed in development. [CLI reference](https://vercel.com/docs/cli/logs).

Platform runtime output is capped at 256 lines, 1 MB total/request and 256 KB/line. App limits are lower, but concurrent container requests may receive duplicate broadcast output and truncation remains possible. For indefinite retention, export before expiry. No log drain/external archive is part of this change.
