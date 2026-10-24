# The parlor

The production Parlor is restricted to the verified auth issuer/subject in
`mcp/src/parlorAccess.ts`. The server checks the current verified browser session
before serving `/parlor`, its private JavaScript/CSS, and every `/api/parlor`
endpoint. Responses are private and not stored in shared caches. Navigation and
lazy loading also require the server's `parlorAllowed` flag. GitHub Pages strips
private Parlor assets because it cannot enforce server authorization.

Production uses `PARLOR_MODE=byok`. This interaction update needs no migration,
entitlement grant, hosted key, billing configuration or security-policy change.
An optional [owner account key fallback](parlor-owner-keys.md) can use server-held
Anthropic and ElevenLabs keys only for the pinned verified owner, while keeping
BYOK precedence and the page restriction. It is off until explicitly configured.
The dormant hosted implementation remains separately controlled; see
[Hosted parlor rollout](hosted-parlor.md).

## A reading

Sign in, choose an account deck and artwork set, select a storyteller, and
configure the existing Anthropic or OpenAI model/key. An ElevenLabs key and your
selected voice ID enable speech. The voice ID is preserved, including remembered
settings; browser-key speech now requests `eleven_v3`.

Start the show opens a blank dark screen with exactly: **Press and hold the button to make contact with the beyond**.
A separate **seven-second summon hold** gradually reveals three empty card spaces
and slow radio-like light pulses. It never requests microphone access. At the threshold,
the selected voice asks the guest to release; the introduction and invitation to speak
follow only after release. Releasing during the cue lets it finish before the introduction.
Early release or cancellation before the threshold returns to blank idle without a provider call.
Cancellation after contact aborts pending speech and prevents a late introduction; it cannot
retract a request already received by ElevenLabs.
There is no setup question, prefilled text or guest typing form.
The final Scribe transcript appears above the cards. The first
card follows the query (or an explicit tap for an open reading). Each card's narration ends at a pause: talk repeatedly
about that card, or tap once to draw the next card. After card three, a tap requests
the closing synthesis. Every later card requires an intentional gesture. Discussion context contains only
revealed card names, positions, orientations and authored meanings.
Completed card narration joins the recent discussion history in order, so a
question such as “What did you mean by that?” includes the interpretation just
delivered. Advancing retains recent discussion alongside the next completed
narration. Future narration and unspoken synthesis are excluded; interrupted or
failed delivery is not committed until a retry or explicit silent fallback completes.

## Table keyboard

While the encounter is open, ordinary keys work anywhere in the guest view without
focusing a button. There are no visible guest buttons, inputs or menus. The scene
does not consume pointer gestures: touch scrolling, dragging and text selection
cannot summon, advance or start recording. Long captions retain native scrolling.

While the spirit speaks, transcribes or prepares a response, ordinary taps and
holds are ignored and never replayed later. Five quick taps still reset in every
state, including pending work and narration. Releasing an already active capture
or summon remains effective; Escape always returns to setup. The optional operator
speech button follows the same busy lock and five-tap reset exception.

- After the introduction, hold for **450 ms**, wait for **Speak now**, speak, then release to submit. Microphone
  permission/startup can take longer than the threshold. Short taps never request access.
- Tap and release in less than 450 ms to continue without discussion. At the greeting's
  end this starts an open reading; at each card pause it advances once; after the third
  card it requests the closing. A tap while narration/transcription is busy is discarded.
- **Five taps** with less than **500 ms** from each release to the next press reset the
  encounter immediately on the fifth release. This stops audio/recording, aborts pending
  requests and clears cards, query, captions and history, then returns to blank idle.
  Selected decks, artwork, persona, voice and saved keys remain intact.
- A tap waits 500 ms after release before advancing, to distinguish it from reset.
  Two to four taps in the same burst coalesce into one advance. A hold breaks the burst.
  Keyboard auto-repeat is ignored. Overlapping keys count as one gesture, lasting until
  **all** keys are released; pressing three keys together is not three reset taps.
- Escape returns to operator setup. Tab, modifier shortcuts, editable fields and operator
  buttons retain native behavior. Shortcuts are installed only while the encounter is open.
  Lost focus, hidden tabs, reset, exit and logout cancel pending gestures and microphone work.

One high-contrast cue sits beside the spread on desktop/projector screens and below
it on narrow screens. It distinguishes summoning, release, microphone preparation,
recording, transcription, inference and actual speech. Only a card pause invites
discussion or the next card; the third pause offers the closing, and the completed
reading offers follow-up or five-tap reset. Pending work never invites a new action.
The blank reset invitation is preserved. The radio decoration has no duplicate label,
and user text above the cards contains only the guest's actual transcript.

Escape returns to setup, including radio mute/volume and the optional **Show operator
controls while testing** checkbox. It is off by default and is not persisted across
reloads. When enabled, a dedicated Hold to talk button supports intentional pointer
and touch testing; only that button captures its gesture. The host can pause/retry,
read without audio, cancel transcription,
inspect detailed errors and adjust Radio sound during the test encounter. Leave it
unchecked for guests. Error details also remain available to assistive technology;
the projected cue gives concise recovery instructions. A single tap retries paused
or failed narration, while five taps always clear the encounter.

Configure the PCsensor keys as ordinary keys (for example A, B and C), not macros or
system/media shortcuts. Test their key-down/key-up events, the 500 ms reset rhythm,
microphone permission and audio output on the actual party Mac before guests arrive.
OS-reserved shortcuts cannot be intercepted by the page. No always-listening input exists.
The summon hold and speech hold are distinct intents captured on press: holding during
an introduction cannot become a recording when it ends.

## Radio apparatus

The quiet reset invitation is unchanged. Once held, an amber tuning arc and needle
follow the **actual seven-second gesture clock**, while radio rings around the three
spaces strengthen. Releasing early, losing focus or resetting clears the sweep; the
next summon starts from zero. Contact is established by the existing release-cue flow,
not by the decoration's animation finishing.

Remote work has no estimated percentage or countdown. A slowly searching needle,
drifting carrier wave and restrained scan lines distinguish microphone preparation,
Scribe transcription, reading generation, discussion and voice preparation. Labels
identify the actual state. Listening uses a steady open-channel lamp and waveform;
speaking motion starts on the audio player's `playing` event. Buffering or pausing the
player returns to searching, without changing transcript timing. These waveforms are
decorative state cues, **not** microphone levels, measured audio or provider progress.
The apparatus adds no audio analyser, microphone use, dependency or network request.

At each card pause the apparatus rests. Errors and pauses stop all motion and show a
static interrupted-channel cue with the appropriate tap-to-recover instruction. Idle removes
the apparatus entirely. All motion is slow continuous movement (3–6-second cycles),
with no strobing or flashing. Reduced-motion preference uses static symbols and meaningful
state labels, stops the summon animation clock, and responds to preference changes during
a hold. Cards remain opaque, complete and undistorted; captions stay separate from the
background. The layout leaves room for the dial on landscape projectors and small screens.

## Radio ambience

The operator can mute the radio or change its volume in setup and under **Radio sound**
when operator testing controls are enabled. These preferences last for the hosting session, including encounter resets
and returns to setup; they are separate from saved provider keys and reader settings.
The default is a quiet 35% setting. This controls only the ambience, never the selected
ElevenLabs voice. Check the actual amplifier/projector speaker volume before the party.

The bed plays the owner-approved, three-minute historical radio mix through Web Audio.
The exact MP3 is a private Parlor asset, fetched from this app only after an intentional
gesture. No extra synth layer, remote audio service, new permission or normalization is
added. Gain is capped at 1, preserving the quiet mastered recording at maximum volume.
The default 35% setting attenuates it further. Searching rises
smoothly over 650 ms; actual voice playback ducks it to 8% of the searching level over
25 ms. Card pauses use a quieter steady bed. The waveform remains a decorative state cue.

No AudioContext exists on page load or blank idle. The existing intentional summon/key,
pointer or operator gesture [unlocks audio](https://developer.mozilla.org/en-US/docs/Web/API/AudioContext/resume).
Talk presses begin silencing immediately, before the 450 ms microphone threshold; permission
waits and recording stay silent. Ambience resumes only after tracks stop. Mute, error, pause,
reset, focus loss and hidden tabs fade out and [stop playback](https://developer.mozilla.org/en-US/docs/Web/API/AudioScheduledSourceNode/stop).
State/provider updates cannot restart a stopped bed: another intentional gesture is required.
One context is reused per encounter view, suspended when stopped, and closed on exit/logout/unmount.
All fades use scheduled gain ramps; sources also receive an audio-clock stop so throttled
background JavaScript cannot leave it playing. Late resume/download/decode promises cannot revive old audio.
Unsupported or blocked Web Audio leaves the reading functional and reports the issue under
Radio sound. No silent switch to a remote audio service exists.

Playback begins at one of four quiet source cues, then continues through the complete
recording. Ducking does not restart it; mute, blur and reset retain its cursor for the
next intentional gesture. Natural wraps use the source's mastered silent endpoints.
This avoids repeatedly starting the same short passage; a finite three-minute source
can still become recognizable. Downloads are capped at 5 MB and 20 seconds; errors
leave the reading usable without ambience. [Recording provenance and credits](parlor-radio-recording.md)

Tests use a mock output device for UI interactions, decode the real MP3 offline, and
render the real gain envelope with a constant synthetic source in an OfflineAudioContext
to measure signal bounds, fade continuity, voice ducking and zero output
during capture. Offline rendering never connects to speakers or microphones. Actual party
hardware, room acoustics and live provider audio still need an owner acceptance check.

## Spirit and vocal delivery

The default storyteller is an original old Austrian male spirit: gloomy, existential,
bored by eternity and dryly playful. It gently needles life's absurdities rather than
the guest's identity or vulnerabilities, with no hostility, threats or certainty claims.
It uses the **existing selected voice ID**, never a named person's imitation or a new
voice. Alternate storyteller selections, model/key overrides and remembered voice settings
are preserved. The default `keeper` persona is updated in place.

The [official ElevenLabs v3 guidance](https://elevenlabs.io/docs/overview/capabilities/text-to-speech/best-practices#prompting-eleven-v3)
was checked on 2026-10-22. The speech payload permits at most one leading documented tag:
`[sighs]`, `[exhales]`, `[curious]`, `[sarcastic]` or `[mischievously]`. Generated segments
are instructed to use tags sparingly. Other bracketed directions are discarded; no accent
override, sound-effect tag or SSML is added. Tag effectiveness depends on the selected voice.

Annotations never enter visible captions or completed-narration history. They are removed
from the complete returned alignment **before** taking a timed prefix, so partial tags
cannot leak while playing. Remaining characters retain their provider timestamps and
normalized wording. Silent/segment-end captions and saved in-memory assistant turns also
strip annotations. No timing is estimated and no extra annotation-generation call is made.

## Artwork presentation

Parlor keeps stable 2:3 card slots and contains each complete image inside a small inset,
preserving its aspect ratio, printed border and title, including reversed cards. This
uses the existing CardArt fit option only in Parlor; other views and source assets are unchanged.

Read-only inspection on 2026-10-22 of The Roaring Twenties' `gpt-deco-nouveau-2026` set
found 35 cards at 945×1663, four at 958×1642, 27 at 971×1619 and 12 at 1024×1536.
Original WebP samples inspected: The Armistice (`major-0`, 945×1663), The Afterglow
(`atom-year-1920`, 958×1642), The Unseen Guest (`atom-host`, 971×1619), and The Borrowed
Roof (`zeppelin-host`, 1024×1536). Their edge decoration explains the visible damage
from filling a 2:3 box with `cover`. No image or canonical deck metadata was altered.

Narration appears below the cards. ElevenLabs' [speech-with-timing endpoint](https://elevenlabs.io/docs/api-reference/text-to-speech/convert-with-timestamps)
returns audio and character alignment. Valid returned character **end** times
are compared with the audio element's `currentTime`; wall-clock time and estimated
reading speed are never used. Pauses, buffering and playback delays cannot reveal
future text. If timing is missing or invalid, the operator controls identify the fallback and
reveals the complete segment only after that audio segment ends. This is
segment-level completion, not word synchronization. A failed request is never
automatically retried or silently switched to another model.

Without a voice key, or after explicitly choosing Read without audio, captions
are shown immediately and labelled as a silent reading in operator controls. The dormant hosted
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
retry. Failed transcription offers a new deliberate hold or a tap to continue without speech.
Missing keys or unsupported recording APIs never request microphone access.

Pointer cancellation, lost capture, focus loss, hidden tabs, page navigation,
Escape, leaving the table, account change and unmount stop tracks and discard
pending audio. Releasing while permission is pending cannot start a late
recording; any subsequently granted stream is immediately stopped. Cancellation
during transcription aborts the request and fences late results; it cannot retract
a clip that already reached ElevenLabs. No recording auto-restarts. Raw clips and
transcripts are never saved to app storage or the database.

Questions, captions and conversation remain in memory and clear on exit. Only
the recognized text and revealed card context go to the selected language
provider. ElevenLabs receives the intentional audio clip for transcription and
text for narration. Provider retention policies and transcription charges apply.
Dormant hosted mode has no user-supplied key and supports open readings without speech; this update
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
requires an explicit retry. A failed step stays at the table with a tap-to-retry cue.
Retries preserve the original draw. Retrying discussion audio reuses the generated
answer rather than charging for another language-model response. Conversation
history is bounded to ten narration/discussion pairs while allowing further discussion.

## Projection layout

Performance mode reserves fixed rows for the apparatus, guest question, spread,
and narration inside the centered viewport. Questions show their last two lines
and narration its last four at projector sizes; smaller screens reserve fewer
lines while keeping readable type. Older lines leave through a soft top edge as
new lines arrive. There are no caption scrollbars or required scrolling controls.
Only the already-revealed speech prefix enters the caption window; resizing does
not reveal later words or change audio timing. Explicit silent reading instead
shows every page from beginning to end, measured against the actual caption
font and window. Pages remain for at least four seconds, with additional time
for longer text (about 150 words per minute). The final page also gets its full
reading time before discussion or advance becomes available. Resize restarts
the current page without skipping words; pause/reset/exit stop page timers.
Retrying an interrupted silent segment restarts it silently from the beginning.
The full question and completed narration remain in conversation state, independent
of the visible excerpt. Reset clears both. Optional operator controls remain
scrollable outside the guest composition.

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
holds, global keys, five-tap reset, overlapping keys, auto-repeat, late provider results,
WebM/MP4 selection and desktop/mobile layouts with varying artwork proportions. Every provider request,
audio player, account and microphone in the automated interaction tests is
synthetic. External requests outside the fixtures are blocked.

**No real keys, microphone recordings or paid provider calls are used in testing.**
Mocks do not establish actual provider CORS, account/model/voice entitlement,
real-audio autoplay, real v3 alignment quality, physical-device recording support
or live Scribe transcription quality.
Those remain a signed-in owner acceptance test after review and an authorized rollout.
