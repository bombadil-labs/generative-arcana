# Optional introduction

After contact and physical release, the spirit offers an optional name or alias. A guest may speak an introduction, decline, ask their question immediately, or tap once to skip the introduction. No identity is required or inferred. A skipped introduction makes no language-model request.

The owner-key and BYOK paths make at most one short model exchange before the query. The response classifies whether the utterance contains a reading question, without name lists or punctuation heuristics. Classification is fallible: it only changes the visual confirmation cue. It cannot draw cards. If a question was offered, the original utterance waits for a deliberate tap; holding to speak replaces it. Otherwise the spirit gently invites a question, and the next spoken question starts the reading as before. A further tap can request an open reading. All control instructions remain visual.

Only the completed opening reply joins the current encounter history. Narration and later discussion can use it, independently of the actual reading question. Reset clears the introduction, question, history and pending work from the next encounter. No alias is written to browser preferences or a separate identity record. When temporary Vercel transcript logging is enabled, volunteered names are text input and can appear in those logs, subject to the documented audience and retention. Reset does not delete provider records or previously submitted logs. See [runtime transcript guidance](parlor-runtime-transcripts.md).

Owner introductions use `/api/parlor/owner/introduce`, with the same independently verified owner identity, same-origin POST, owned-deck check, rate limit, fixed Anthropic endpoint, key-echo rejection and pre/post-dispatch authentication checks. No card, token, image or deck prose is sent during the introduction. BYOK still takes precedence, with no fallback after a failed personal-key request. Current voice and ElevenLabs v3 remain unchanged.

The older metered-hosted mode retains its direct, gentler query invitation. Its pre-reading model calls require a reading token; this change does not expand billing permissions or bypass reservations. Owner-key fallback in BYOK mode supports the full optional exchange.

Validation uses synthetic identities, model responses and audio/microphone fixtures. Live intent interpretation, conversational tone, voice delivery and physical party hardware still need owner acceptance. This draft adds one possible inference wait, not a promise of instant contact or reliable classification.
