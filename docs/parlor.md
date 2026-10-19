# The parlor

The deployment now explicitly selects `disabled` (default), `hosted`, or `byok`. See [Hosted parlor rollout](hosted-parlor.md) for the new entitlement, server-only keys, conservative budgets and reviewed migration/grant procedure. Hosted mode has no key inputs and never falls back to browser credentials. The browser-key details below apply only when the operator explicitly selects `PARLOR_MODE=byok`.

`/parlor` is an authenticated, browser-only party reading. `/parlor/` also loads the built app. Existing hash routes and subdirectory builds retain their relative asset behavior. The login return validators accept only the exact new literal path (and its trailing slash), without question/query parameters.

Sign in, choose an account deck and its artwork set, select a storyteller, and configure Anthropic or OpenAI. Model IDs are deliberately editable and have no guessed default: use a Messages-compatible Anthropic model or Chat Completions-compatible OpenAI model available to the key. An optional ElevenLabs key and voice ID enable narration; its speech model is `eleven_multilingual_v2`. No provider request happens until the host enters a question in setup and presses Start the show, confirming that question.

The show is a cards-only kiosk. Enter the question before starting; the three face-down cards reveal automatically in order, synchronized to optional spoken interpretations, followed by spoken synthesis. Silent mode uses the existing reveal delay. The final three cards remain on screen until Escape or navigation. No greeting, caption, meaning, status label, form, button, or follow-up conversation is rendered in the show. Text authored into the card artwork itself remains part of the card.

## Credentials and privacy

**Start the show** fades setup and app navigation away. Escape ends the reading, returns to setup and restores focus to Start the show. On touch-only devices, use browser Back; there is no visible exit affordance inside the kiosk. Exiting aborts pending work, stops audio and clears guest state; late responses cannot reopen the show. Errors return to setup with an explanation, without automatic provider retries. Host settings remain for the next guest. Reduced motion disables the entrance fade and card flip. Logout/account changes and pagehide also tear down the show.

- All three API-key inputs are always password fields, including pasted/restored values. There is no reveal toggle. Masking is visual, not encryption.
- Keys stay in browser memory by default. Remember-on-device is explicit, account-scoped, plaintext localStorage. Unchecking it removes the saved record; Clear keys empties all key fields and removes the record. Storage failures are reported without claiming erasure succeeded.
- Remembered keys can be read by same-origin scripts, extensions or people with browser access. Account gating is not a localStorage security boundary. Use a trusted device and limited provider credentials.
- Fixed provider endpoints receive credentials directly. No proxy, database change, server credential configuration, provider telemetry, request logging, or automatic retries were added. Provider error bodies are never displayed; even successful responses that echo an entered key are rejected.
- Questions, reading tokens, narration, conversation and audio never enter app storage, URLs or logs. Reset, account changes, loss of authenticated state, navigation, and pagehide invalidate asynchronous work and clear the guest state. Audio objects and blob URLs are released. Remembered host keys intentionally survive logout under their account's storage key until cleared.
- Provider processing/retention still applies. The chosen LLM receives the guest question and authored deck context. ElevenLabs receives the narration. OpenAI requests set `store: false`; that is not a claim of zero provider retention.

## Browser support checked October 6, 2026

[Anthropic's official TypeScript SDK](https://github.com/anthropics/anthropic-sdk-typescript) and [OpenAI's official SDK](https://github.com/openai/openai-node) disable browser calls by default and document an explicit `dangerouslyAllowBrowser` opt-in. The equivalent direct Anthropic request uses `anthropic-dangerous-direct-browser-access: true`. This implementation uses native fetch with AbortSignal and does not add SDK dependencies.

[ElevenLabs authentication guidance](https://elevenlabs.io/docs/api-reference/authentication) says API keys should not be exposed in browsers. Its [single-use tokens](https://elevenlabs.io/docs/api-reference/tokens/create) include a frontend TTS WebSocket flow. A server-issued-token architecture conflicts with the requested client-only key design. This implementation therefore keeps direct REST TTS as an explicitly exposed-key option, with a warning and an error return to setup if playback fails. It does not silently introduce a credential proxy.

**Mocks do not establish actual browser CORS acceptance, model/key entitlement, ElevenLabs voice access, autoplay behavior with real audio, latency, or provider billing. No real keys or paid provider calls were used.** A trusted host must evaluate those conditions before party use.

## Control and verification

`ParlorMachine` gates synchronous transitions and fences asynchronous completions with a generation counter as well as AbortController. A confirmed question owns one draw promise; retrying generation, narration, or conversation cannot draw again. The narration JSON must have exactly three matching card slugs in order. Prompts use `ArcanaEngine.buildInterpretationContext`, including authored meanings and orientation, plus explicit card identities. A language model's semantic faithfulness cannot be proven by shape validation; authored meanings remain in the engine context, but are not displayed outside the card artwork in kiosk mode.

Each step has a 90-second timeout. Leaving the kiosk clears that timer, aborts requests/playback and destroys the guest reading. Errors return to setup rather than waiting for an invisible retry control. Audio is loaded one segment at a time. Artwork uses the existing catalog store and CardArt/PackAssetImage; a missing slot stays within the chosen set and uses the existing semantic face or generic back. Three front loads reuse that store. A choice is required when multiple populated sets have no selected set.

Run the app checks with Node 24 (the locked jsdom version requires a newer Node than 22.0):

```sh
cd app
npm run typecheck
npm test
npm run build
# Uses one installed Edge browser by default; never downloads browsers.
# Optional PLAYWRIGHT_MODULE is an absolute existing playwright-core entry path.
# Optional PARLOR_BROWSER selects an existing browser executable.
node tests/parlor.browser.mjs
```

The serial unit/UI suite covers draw-once retries, abort and stale results, playback synchronization, error redaction, captions/mute, key persistence and masking, login/account changes, logout, pagehide and navigation. The standalone production-preview browser test mocks all account/provider traffic, blocks other external requests, uses only synthetic keys, captures masked screenshots, and closes its one context, browser and server in `finally`. No real profile is opened. The existing app test runner now explicitly uses `--test-concurrency=1`.

The browser test also measures the single app header at viewport top before and after scrolling, checks that the parlor begins immediately below it at document top, and verifies desktop/mobile overflow, Back navigation, and logout. Full-page screenshots return to scroll position zero first: otherwise Chromium captures the sticky header at the current document scroll offset, making it appear displaced over the page title even though it is pinned correctly in the live viewport. Both viewport and full-page images are saved for comparison.
