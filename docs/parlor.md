# The parlor

The production Parlor is restricted to the verified auth issuer/subject in
`mcp/src/parlorAccess.ts`. The server checks the current verified browser session
before serving `/parlor`, its private JavaScript/CSS, and every `/api/parlor`
endpoint. Responses are private and not stored in shared caches. Navigation and
lazy loading also require the server's `parlorAllowed` flag. GitHub Pages strips
private Parlor assets because it cannot enforce server authorization.

Production uses `PARLOR_MODE=byok`. This interaction update needs no migration,
entitlement grant, hosted key, billing configuration or security-policy change.
The dormant hosted implementation remains separately controlled; see
[Hosted parlor rollout](hosted-parlor.md).

## A reading

Sign in, choose an account deck and artwork set, select a storyteller, and
configure the existing Anthropic or OpenAI model/key. An ElevenLabs key and your
selected voice ID enable speech. The voice ID is preserved, including remembered
settings; browser-key speech now requests `eleven_v3`.

Start the show opens with the storyteller's spoken greeting and invitation to
hold the talk button. There is no setup question or prefilled text. Hold with a
pointer, or focus the button and hold Space or Enter; release to submit the
recognized words. Interim and final user text appear above the cards. The first
card follows the query. Each card's narration ends at a pause: talk repeatedly
about that card, or press Next card. After card three, Hear the closing requests
the synthesis. Nothing advances on a timer. Discussion context contains only
revealed card names, positions, orientations and authored meanings.
Completed card narration joins the recent discussion history in order, so a
question such as “What did you mean by that?” includes the interpretation just
delivered. Advancing retains recent discussion alongside the next completed
narration. Future narration and unspoken synthesis are excluded; interrupted or
failed delivery is not committed until a retry or explicit silent fallback completes.

Narration appears below the cards. ElevenLabs' [speech-with-timing endpoint](https://elevenlabs.io/docs/api-reference/text-to-speech/convert-with-timestamps)
returns audio and character alignment. Valid returned character **end** times
are compared with the audio element's `currentTime`; wall-clock time and estimated
reading speed are never used. Pauses, buffering and playback delays cannot reveal
future text. If timing is missing or invalid, the UI identifies the fallback and
reveals the complete segment only after that audio segment ends. This is
segment-level completion, not word synchronization. A failed request is never
automatically retried or silently switched to another model.

Without a voice key, or after explicitly choosing Read without audio, captions
are shown immediately and labelled as a silent reading. The dormant hosted
speech route still uses its configured model and returns audio without timing;
its captions therefore use segment completion. Its opening is silent because
hosted speech requires a drawn-reading token. This PR does not activate hosted
mode or change its pricing/model configuration.

## Scribe microphone and privacy

Push-to-talk uses `getUserMedia` and `MediaRecorder` only after a held-button
press. On intentional release, all microphone tracks stop immediately and the
completed in-memory clip is sent directly to ElevenLabs with the existing
user-supplied ElevenLabs key. There is no browser speech service or other provider
fallback.

The official [Scribe batch API](https://elevenlabs.io/docs/api-reference/speech-to-text/convert)
was checked on 2026-10-21. It accepts a multipart `file` and `model_id=scribe_v2`
at `/v1/speech-to-text`. Batch conversion fits this flow: no audio is streamed
while the button is held. Audio-event tags, diarization, timestamps and webhook
delivery are disabled. Transcript editing and its additional fee are not enabled.
The returned text appears above the cards once transcription finishes. It is not
an interim live transcript. Narrator captions still follow TTS alignment below.

WebM/Opus is preferred, with browser-supported WebM, MP4 or Ogg/Opus alternatives
for devices that need them. Clips shorter than 250 ms, empty clips, recordings
exceeding 8 MB or one minute, and cancelled recordings are discarded before upload.
Permission waits and recording duration are bounded to one minute, recorder
finalization to five seconds, and transcription to 45 seconds. There is no auto
retry. Failed transcription offers a new deliberate press or Type instead.
Missing keys or unsupported recording APIs never request microphone access.

Pointer cancellation, lost capture, focus loss, hidden tabs, page navigation,
Escape, leaving the table, account change and unmount stop tracks and discard
pending audio. Releasing while permission is pending cannot start a late
recording; any subsequently granted stream is immediately stopped. Cancellation
during transcription aborts the request and fences late results; it cannot retract
a clip that already reached ElevenLabs. No recording auto-restarts. Raw clips and
transcripts are never saved to app storage or the database.

Questions, captions and conversation remain in memory and clear on exit. Only
the recognized/typed text and revealed card context go to the selected language
provider. ElevenLabs receives the intentional audio clip for transcription and
text for narration. Provider retention policies and transcription charges apply.
Dormant hosted mode has no user-supplied key and offers typing instead; this update
does not introduce hosted transcription or enable hosted billing.

## Credentials and cleanup

Keys remain masked, account-scoped and in memory unless Remember keys is explicitly
enabled. Remembered localStorage is plaintext, accessible to same-origin scripts
and anyone using the device. Clear keys removes the saved credentials. No keys are
placed in logs, URLs or screenshots. Browser-key requests go directly to fixed
provider origins with credentials omitted, redirects refused and bounded errors.
This update introduces no server credential proxy. [ElevenLabs authentication guidance](https://elevenlabs.io/docs/api-reference/authentication)
discourages exposing API keys in browsers; the existing BYOK tradeoff is retained.

Escape or Leave the table aborts requests/audio, releases the player/object URL,
clears the guest state, restores setup and returns focus to Start the show.
Backgrounding pauses in-flight narration and cancels microphone input; resuming
requires an explicit retry. A failed step stays at the table with retry controls.
Retries preserve the original draw. Retrying discussion audio reuses the generated
answer rather than charging for another language-model response. Conversation
history is bounded to ten narration/discussion pairs while allowing further discussion.

## Verification

Use Node 24 and an existing installed Edge browser; the browser test does not
download browsers or use a real browser profile:

```sh
cd app
npm test
npm run typecheck
npm run build
node tests/parlor.browser.mjs
cd ../mcp
npm run typecheck
npm run test:parlor
```

Tests cover v3/voice preservation, alignment and segment completion, explicit
advance, repeated discussion, no hidden-card context, retries, pending-permission
release, microphone denial, held-only Scribe uploads, byte/duration limits,
short/empty clips, provider errors, cancellation/teardown, key
masking, navigation, account changes and server page/API/private-asset guards.
Browser interactions cover mouse release outside, Space/Enter, touch pointer
holds, WebM/MP4 selection and desktop/mobile layouts. Every provider request,
audio player, account and microphone in the automated interaction tests is
synthetic. External requests outside the fixtures are blocked.

**No real keys, microphone recordings or paid provider calls are used in testing.**
Mocks do not establish actual provider CORS, account/model/voice entitlement,
real-audio autoplay, real v3 alignment quality, physical-device recording support
or live Scribe transcription quality.
Those remain a signed-in owner acceptance test after review and an authorized rollout.
