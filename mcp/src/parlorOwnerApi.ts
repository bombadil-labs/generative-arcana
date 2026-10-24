import type { IncomingMessage, ServerResponse } from 'node:http';
import type { BrowserSessionAuthenticator, BrowserPrincipalResolver } from './browserSession';
import type { UserDeckCatalogRepository } from './userDeckCatalog';
import { createArcanaAdapter } from './hostStore';
import { isParlorOwner } from './parlorAccess';
import { ParlorFault, type OwnerKeysConfig } from './parlorConfig';
import { defaultSettings, characters } from '../../app/src/parlor/settings';
import { instructions, conversationContext, parseNarration, anthropicReadingOptions } from '../../app/src/parlor/providers';
import { boundedSpeechBody, parseAlignment, speechPayload } from '../../app/src/parlor/speech';
import type { ArcanaReading } from '../../app/src/engine/types';

const json = (res: ServerResponse, status: number, value: unknown) => {
  if (!res.destroyed && !res.writableEnded) { res.writeHead(status, { 'content-type': 'application/json', 'cache-control': 'private, no-store', vary: 'Cookie' }); res.end(JSON.stringify(value)); }
};
const record = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);
const text = (v: unknown, max: number) => { if (typeof v !== 'string' || !v.trim() || v.length > max) throw new ParlorFault(400, 'invalid_parlor_request'); return v; };
function fields(data: Record<string, unknown>, allowed: string[]) { if (Object.keys(data).some(k => !allowed.includes(k))) throw new ParlorFault(400, 'invalid_parlor_request'); }
export function ownerCapabilities(c?: OwnerKeysConfig) {
  return { anthropicModel: c?.keys.anthropic && c.anthropicModel ? c.anthropicModel : null, elevenlabs: !!c?.keys.elevenlabs, voiceId: c?.voiceId || null };
}
function rejectSecrets(value: unknown, c: OwnerKeysConfig): void {
  const check = (s: string) => { if (Object.values(c.keys).some(k => k && s.includes(k))) throw new ParlorFault(502, 'unusable_provider_response'); };
  if (typeof value === 'string') check(value);
  else if (Array.isArray(value)) { if (value.every(v => typeof v === 'string')) check(value.join('')); value.forEach(v => rejectSecrets(v, c)); }
  else if (record(value)) { Object.entries(value).forEach(([k, v]) => { check(k); rejectSecrets(v, c); }); }
}
async function bodyBytes(req: IncomingMessage, max: number, signal: AbortSignal) {
  const chunks: Buffer[] = []; let size = 0;
  const stop = () => req.destroy(); signal.addEventListener('abort', stop, { once: true });
  try { signal.throwIfAborted(); for await (const part of req) { size += part.length; if (size > max) throw new ParlorFault(413, 'request_too_large'); chunks.push(Buffer.from(part)); } }
  finally { signal.removeEventListener('abort', stop); }
  return Buffer.concat(chunks);
}
export interface OwnerParlorOptions {
  config?: OwnerKeysConfig; authenticator?: BrowserSessionAuthenticator; principal?: BrowserPrincipalResolver;
  catalog?: UserDeckCatalogRepository; allowRequest?: () => Promise<boolean>; fetch?: typeof fetch;
}
/** Separate credential boundary: general page access or an entitlement never grants these keys. */
export function createOwnerParlorHandler(options: OwnerParlorOptions) {
  return async (req: IncomingMessage, res: ServerResponse) => {
    const abort = new AbortController(); const close = () => abort.abort(); res.once('close', close);
    const timer = setTimeout(() => { json(res, 408, { error: 'parlor_deadline_exceeded' }); abort.abort(); }, 60000);
    try {
      const { config: c, authenticator, principal, catalog, allowRequest } = options;
      if (!authenticator) throw new ParlorFault(503, 'parlor_auth_unavailable');
      const verify = async () => {
        const session = await authenticator.authenticate(req, res);
        if (!session) throw new ParlorFault(401, 'sign_in_required');
        if (!isParlorOwner(session.identity)) throw new ParlorFault(403, 'owner_credentials_required');
        abort.signal.throwIfAborted();
      };
      await verify();
      if (!c || !principal || !catalog || !allowRequest) throw new ParlorFault(503, 'owner_provider_unavailable');
      const path = new URL(req.url ?? '/', 'http://localhost').pathname;
      const kind = path.slice('/api/parlor/owner/'.length);
      if (!['narrate', 'converse', 'speech', 'transcribe'].includes(kind)) throw new ParlorFault(404, 'not_found');
      if (req.method !== 'POST') throw new ParlorFault(405, 'post_required');
      if (req.headers.origin !== c.origin) throw new ParlorFault(403, 'origin_not_allowed');
      const who = await principal.resolve(req, res); if (!who) throw new ParlorFault(401, 'sign_in_required');
      if (!await allowRequest()) throw new ParlorFault(429, 'parlor_limit_reached');
      let url: string, headers: Record<string, string>, payload: string | FormData;
      let reading: ArcanaReading | undefined;
      if (kind === 'transcribe') {
        if (!c.keys.elevenlabs) throw new ParlorFault(503, 'owner_provider_unavailable');
        const mime = req.headers['content-type'] ?? '';
        if (!['audio/webm;codecs=opus', 'audio/webm', 'audio/mp4', 'audio/ogg;codecs=opus'].includes(mime)) throw new ParlorFault(415, 'audio_required');
        const bytes = await bodyBytes(req, 8_000_000, abort.signal);
        if (!bytes.length) throw new ParlorFault(400, 'invalid_recording');
        const form = new FormData(); form.append('file', new Blob([new Uint8Array(bytes)], { type: mime }), mime.includes('mp4') ? 'recording.m4a' : mime.includes('ogg') ? 'recording.ogg' : 'recording.webm');
        form.append('model_id', 'scribe_v2'); form.append('tag_audio_events', 'false'); form.append('diarize', 'false'); form.append('timestamps_granularity', 'none'); form.append('webhook', 'false');
        url = 'https://api.elevenlabs.io/v1/speech-to-text'; headers = { 'xi-api-key': c.keys.elevenlabs }; payload = form;
      } else {
        if (req.headers['content-type'] !== 'application/json') throw new ParlorFault(415, 'json_required');
        let data: unknown; try { data = JSON.parse((await bodyBytes(req, 96000, abort.signal)).toString('utf8')); } catch (e) { if (e instanceof ParlorFault) throw e; throw new ParlorFault(400, 'invalid_parlor_request'); }
        if (!record(data)) throw new ParlorFault(400, 'invalid_parlor_request');
        rejectSecrets(data, c);
        if (kind === 'speech') {
          fields(data, ['text', 'voiceId']);
          if (!c.keys.elevenlabs) throw new ParlorFault(503, 'owner_provider_unavailable');
          const voice = text(data.voiceId, 160); if (!/^[A-Za-z0-9_-]+$/.test(voice)) throw new ParlorFault(400, 'invalid_voice');
          const prose = speechPayload(text(data.text, 4000)); if (!prose) throw new ParlorFault(400, 'invalid_parlor_request');
          url = `https://api.elevenlabs.io/v1/text-to-speech/${encodeURIComponent(voice)}/with-timestamps`;
          headers = { 'xi-api-key': c.keys.elevenlabs, 'content-type': 'application/json', accept: 'application/json' }; payload = JSON.stringify({ text: prose, model_id: 'eleven_v3' });
        } else {
          fields(data, ['deckId', 'token', 'character', 'provider', 'model', 'turns', 'revealed']);
          if (!c.keys.anthropic || !c.anthropicModel) throw new ParlorFault(503, 'owner_provider_unavailable');
          if (data.provider !== 'anthropic' || typeof data.model !== 'string' || !/^claude-[A-Za-z0-9._-]{1,140}$/.test(data.model)) throw new ParlorFault(400, 'model_not_allowed');
          const deckId = text(data.deckId, 200), token = text(data.token, 65536);
          const deck = await catalog.get(deckId); if (!deck || deck.ownerId !== who.id) throw new ParlorFault(404, 'deck_unavailable');
          const adapter = createArcanaAdapter(); adapter.engine.importDeck(deck.manifest.data, { runtimeId: deck.id, tagline: deck.manifest.tagline, spreads: deck.manifest.spreads });
          try { reading = await adapter.engine.resolveReading(token, deckId); }
          catch { throw new ParlorFault(400, 'invalid_reading'); }
          if (reading.legacy || reading.placements.length !== 3 || reading.question.length > 1200) throw new ParlorFault(400, 'invalid_reading');
          const character = text(data.character, 20); if (!Object.hasOwn(characters, character)) throw new ParlorFault(400, 'invalid_character');
          let system = instructions({ ...defaultSettings(), character: character as keyof typeof characters });
          let messages: { role: 'user' | 'assistant'; content: string }[];
          if (kind === 'narrate') {
            system += ' Return only JSON: {"cards":[{"slug":"exact-card-slug","text":"interpretation"}],"synthesis":"closing synthesis"}. Exactly three cards in the given order. Each card text: 2-3 sentences about its position and authored meaning. Synthesis: 2-3 sentences weaving the cards together. Never reveal later cards in an earlier segment.';
            messages = [{ role: 'user', content: adapter.engine.buildInterpretationContext(reading) + '\nCARD IDENTITIES IN ORDER\n' + JSON.stringify(reading.placements.map(p => ({ slug: p.card.slug, name: p.card.name, position: p.position.name, reversed: p.reversed }))) }];
          } else {
            const revealed = data.revealed;
            if (!Number.isInteger(revealed) || Number(revealed) < 1 || Number(revealed) > 3 || !Array.isArray(data.turns) || !data.turns.length || data.turns.length > 21 || data.turns.length % 2 !== 1) throw new ParlorFault(400, 'invalid_conversation');
            messages = data.turns.map((v, i) => { if (!record(v) || v.role !== (i % 2 === 0 ? 'user' : 'assistant')) throw new ParlorFault(400, 'invalid_conversation'); return { role: v.role as 'user' | 'assistant', content: text(v.content, i % 2 === 0 ? 1200 : 4000) }; });
            system += ` Discuss the current card and the guest's follow-up in 2-4 sentences. Only the revealed cards below are available. Do not invent, name or predict later cards, draw new cards, or advance the reading.\n${conversationContext(reading, Number(revealed))}`;
          }
          payload = JSON.stringify({ model: data.model, ...anthropicReadingOptions(data.model), max_tokens: 2000, system, messages });
          if (Buffer.byteLength(payload) > 64000) throw new ParlorFault(413, 'context_too_large');
          rejectSecrets(payload, c); url = 'https://api.anthropic.com/v1/messages'; headers = { 'x-api-key': c.keys.anthropic, 'anthropic-version': '2023-06-01', 'content-type': 'application/json' };
        }
      }
      await verify(); if ((await principal.resolve(req, res))?.id !== who.id) throw new ParlorFault(403, 'owner_credentials_required');
      let response: Response;
      try { response = await (options.fetch ?? fetch)(url, { method: 'POST', redirect: 'error', cache: 'no-store', signal: abort.signal, headers, body: payload }); }
      catch { throw new ParlorFault(502, 'provider_connection_failed'); }
      if (!response.ok) {
        // Status-only diagnostics: never read, forward or log a provider's error body/headers.
        await response.body?.cancel().catch(() => {});
        const code = response.status === 401 || response.status === 403 ? 'provider_access_refused'
          : response.status === 400 || response.status === 422 ? 'provider_request_rejected'
          : response.status === 404 ? 'provider_resource_unavailable'
          : response.status === 429 ? 'provider_rate_limited' : 'provider_unavailable';
        throw new ParlorFault(response.status === 429 ? 429 : 502, code);
      }
      let value: unknown;
      try { const bytes = await boundedSpeechBody(response, kind === 'speech' ? 12_000_000 : 100_000); value = JSON.parse(new TextDecoder().decode(bytes)); }
      catch { throw new ParlorFault(502, 'unusable_provider_response'); }
      rejectSecrets(value, c);
      if (!record(value)) throw new ParlorFault(502, 'unusable_provider_response');
      let result: unknown;
      if (kind === 'speech') {
        if (typeof value.audio_base64 !== 'string' || !value.audio_base64.length || value.audio_base64.length > 10_700_000 || !/^[A-Za-z0-9+/]+={0,2}$/.test(value.audio_base64)) throw new ParlorFault(502, 'unusable_provider_response');
        const audio = Buffer.from(value.audio_base64, 'base64'); if (!audio.length || audio.length > 8_000_000 || Object.values(c.keys).some(k => k && audio.includes(Buffer.from(k)))) throw new ParlorFault(502, 'unusable_provider_response');
        const alignment = parseAlignment(value.normalized_alignment) ?? parseAlignment(value.alignment);
        result = { audio_base64: value.audio_base64, ...(alignment ? { normalized_alignment: { characters: alignment.characters, character_start_times_seconds: alignment.character_start_times_seconds, character_end_times_seconds: alignment.character_end_times_seconds } } : {}) };
      } else if (kind === 'transcribe') {
        if (typeof value.text !== 'string' || value.text.length > 1200) throw new ParlorFault(502, 'unusable_provider_response');
        result = { text: value.text.trim() };
      }
      else {
        const parts = Array.isArray(value.content) ? value.content.filter(p => record(p) && p.type === 'text') : [];
        if (parts.some(p => typeof p.text !== 'string')) throw new ParlorFault(502, 'unusable_provider_response');
        const prose = parts.map(p => p.text).join('\n');
        if (!prose.trim() || prose.length > (kind === 'narrate' ? 18000 : 4000)) throw new ParlorFault(502, 'unusable_provider_response');
        try { result = kind === 'narrate' ? parseNarration(prose, reading!) : { text: prose }; }
        catch { throw new ParlorFault(502, 'unusable_provider_response'); }
      }
      rejectSecrets(result, c); await verify(); if ((await principal.resolve(req, res))?.id !== who.id) throw new ParlorFault(403, 'owner_credentials_required');
      json(res, 200, result);
    } catch (error) { json(res, error instanceof ParlorFault ? error.status : 503, { error: error instanceof ParlorFault ? error.code : 'owner_provider_unavailable' }); }
    finally { clearTimeout(timer); res.removeListener('close', close); abort.abort(); }
  };
}
