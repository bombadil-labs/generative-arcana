# Owner account provider keys

This optional fallback keeps `PARLOR_MODE=byok`. It does not enable the older
entitlement/budget hosted mode, grant Parlor access, add billing, or require a new
migration. The page, private assets and APIs retain the existing owner-only gate.
The fallback requires the code in this change to be deployed; adding the variables
to an older deployment does not add this behavior.

## Vercel setup

Enter the values yourself in the project's Environment Variables settings. Never
put secret values in chat, source, `VITE_*`, `NEXT_PUBLIC_*`, or PR descriptions.

| Variable | Value | Kind |
| --- | --- | --- |
| `PARLOR_MODE` | `byok` (keep the current setting) | Config |
| `PARLOR_OWNER_KEYS_ENABLED` | `true` | Config |
| `ANTHROPIC_API_KEY` | Your Anthropic API key | Secret |
| `ELEVENLABS_API_KEY` | Your ElevenLabs API key with TTS and Scribe access | Secret |
| `PARLOR_OWNER_ANTHROPIC_MODEL` | `claude-sonnet-5-5` (reader default) | Config |
| `PARLOR_OWNER_ELEVENLABS_VOICE_ID` | Your selected ElevenLabs voice ID (voice default) | Config |

`claude-sonnet-5-5` is a currently documented model ID; this change does not query
your account or make paid calls to establish your access. You can instead use the
exact supported Claude model ID you already use in Parlor. This is a default:
the verified owner may select another Claude model available to their server key.
Provider origins, Anthropic-only selection, model syntax, output caps and owner
identity are still enforced server-side. [Anthropic model IDs](https://platform.claude.com/docs/en/models/overview)

For `claude-sonnet-5-5`, both owner-key and BYOK requests explicitly send
`thinking: {"type":"between_tools"}` and `output_config: {"effort":"low"}`.
These tool-free readings do not silently inherit high adaptive thinking. No
`tools`, forced `tool_choice`, or thinking blocks are sent or replayed. Other
model IDs keep their existing request behavior. [Sonnet 5.5 compatibility](https://platform.claude.com/docs/en/models/sonnet-5-5/whats-new-sonnet-5-5)

No OpenAI server fallback is enabled. ElevenLabs narration remains `eleven_v3`
with timestamps, and transcription remains `scribe_v2`. These are fixed in code;
no extra speech model variables are needed. The voice ID setting seeds setup
when no nonblank voice choice was saved. Use the bare ID, not a URL, display name
or quoted value. Identity ID, role, budget and database
variables are unchanged. Leave the existing `BETTER_AUTH_URL` and database settings unchanged.

For all hosted deployments select **Production and Preview** for the variables.
Production alone covers production deployments. **Development** separately makes
values available to local development tools; select it only if desired. Values
apply to new deployments, so deploy the reviewed change after saving them.
Branch-specific Preview values override general Preview values. Preview code can
execute with its scoped keys: use only trusted preview branches. This does not
require staging database work. [Vercel environment scopes](https://vercel.com/docs/environment-variables)

Environment scoping does not authorize a new identity. Every deployment still
requires the pinned, verified production issuer/subject pair in `parlorAccess.ts`.
A preview using a different auth issuer or account will fail closed even with the
same email. This change deliberately does not alter auth configuration to make
such accounts equivalent.

## Selection and failure behavior

- A nonblank browser Anthropic key wins for Anthropic requests. A nonblank browser
  ElevenLabs key wins for both narration and Scribe. Invalid BYOK keys fail without
  an automatic server-key retry or provider change.
- When the relevant browser key is blank, the verified owner can use the server
  key advertised by authenticated capabilities. New or previously empty models
  use the configured model; new or previously blank voice settings use the configured voice ID.
  **Use account model** and **Use account voice** restore these defaults explicitly.
  Existing nonblank model/voice choices and personas are retained. Intentional
  silence is saved separately with **Read without audio**, so clearing keys or a
  legacy blank voice cannot accidentally disable the account voice default.
  Both IDs can be overridden in setup. OpenAI
  still requires the browser's own OpenAI key.
- With an owner ElevenLabs fallback, a missing voice ID requires selecting a
  voice or explicitly choosing **Read without audio**. Scribe can still transcribe
  intentional push-to-talk clips in silent mode. Microphone handling, release,
  cancellation, audio timing and radio ambience are otherwise unchanged.
- Other permitted users, if page access is expanded in a separate change, see BYOK
  capabilities and cannot use these server credentials. Client flags, emails,
  names, entitlements and even a matching domain principal do not grant access.
- Missing/disabled server keys, wrong providers/models, auth or database failures,
  provider errors and limits fail closed. They never trigger another remote route.
- Failed account-provider requests return fixed, status-based diagnostic codes;
  provider error bodies and headers are discarded. A GET opened in a browser
  returns `post_required`; it does not describe the preceding POST's failure.
  Failed speech keeps its retry state and never reveals the remaining script or
  advances the reading. Summoning release cannot itself deal cards.
  Availability is transient client state; it is neither authorization nor saved
  in localStorage. Server secret values are never returned.

## Server boundary and limits

`/api/parlor/owner/narrate`, `/converse`, `/speech`, and `/transcribe` authenticate
the current verified browser identity independently of general Parlor admission.
Identity and principal are rechecked immediately before provider dispatch and
before output. The old hosted endpoints now have the same stable-owner credential
restriction, independently of their existing entitlement/budget checks.

POST requires the exact existing auth origin. Language requests reconstruct a
three-card reading from an owned deck and reject arbitrary prompts, URLs, providers
and models. Follow-ups include only revealed context and completed conversation.
Opening speech and Scribe work before a reading exists. Speech accepts the owner's
selected voice ID, bounded text, and the existing allowlisted emotional tags.
Scribe accepts only the intentional audio body, with fixed provider parameters.

All four routes share a 30-request/minute limit using the existing durable
`arcana_rate_limits` counter. Missing limiter/database support denies dispatch.
Each request has a 60-second server deadline, no automatic retries, a 64 KB language
input / 2,000 output-token cap, 4,000 speech-character cap, and 8 MB uploaded audio
cap. The client stops and discards recordings at one minute. These are request
bounds, not a dollar budget or provider invoice guarantee; normal provider usage
charges still apply. No new paid calls occur merely on page load.

Keys, guest content and provider bodies are not logged or persisted by these
routes. Errors are generic; output is bounded and checked for credential echoes,
including decoded audio and joined alignment characters. TTS returns only audio
and validated alignment fields; Scribe returns only its transcript. Responses use
private/no-store caching. Cancellation aborts upstream work, but cannot undo a
request already received by the provider.

## Verification

Security tests exercise the stable-owner boundary even with deliberately permissive
page admission, all four providers routes, missing keys, model/provider mismatch,
wrong origin/deck, limits, secret-safe failures, and revoked/changed identities.
Real signed-session fixtures also deny anonymous, forged, nonowner, unverified and
revoked sessions on all new paths. App and browser tests cover BYOK precedence,
credential-free owner setup, greeting before draw, Scribe, aligned captions,
discussion and teardown. Providers, microphone input and playback are synthetic;
there is no claim of live key, account-model or microphone validation.
