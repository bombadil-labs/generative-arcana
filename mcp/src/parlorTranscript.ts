import { createHmac, randomUUID, timingSafeEqual } from 'node:crypto';
import type { IncomingMessage, ServerResponse } from 'node:http';
import type { BrowserSessionAuthenticator } from './browserSession';
import { isParlorOwner } from './parlorAccess';
import { FixedWindowRateLimiter } from './limits';
import { redactTranscript, TRANSCRIPT_BATCH_BYTES, TRANSCRIPT_MAX_EVENTS, TRANSCRIPT_TEXT_CHARS, type TranscriptEvent } from '../../app/src/parlor/runtimeTranscript';

const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const kinds = ['user_input','assistant_generated','presentation_started','presentation_progress','presentation_completed','presentation_interrupted','error','encounter_closed','gap'];
const enums: Record<string, string[]> = { stage:['release','greeting','card','synthesis','answer','reading'], timing:['aligned','segment','silent','unknown'], reason:['reset','cancelled','failed','timeout','queue_full'], provider:['anthropic','openai','script'] };
const record = (value: unknown): value is Record<string, unknown> => !!value && typeof value === 'object' && !Array.isArray(value);
class Fault extends Error { constructor(readonly status: number) { super('transcript_unavailable'); } }
const json = (res: ServerResponse, status: number, body: unknown) => { if (!res.destroyed && !res.writableEnded) { res.writeHead(status, { 'content-type':'application/json', 'cache-control':'private, no-store', vary:'Cookie' }); res.end(JSON.stringify(body)); } };

export function validateTranscriptEvents(input: unknown, secrets: readonly string[], now: number): TranscriptEvent[] {
  if (!Array.isArray(input) || !input.length || input.length > TRANSCRIPT_MAX_EVENTS) throw new Fault(400);
  return input.map(value => {
    if (!record(value) || Object.keys(value).some(k => !['kind','eventId','seq','at','part','parts','text','stage','messageId','attemptId','timing','reason','provider','model','card'].includes(k))) throw new Fault(400);
    if (typeof value.kind !== 'string' || !kinds.includes(value.kind) || typeof value.eventId !== 'string' || !uuid.test(value.eventId)
      || !Number.isSafeInteger(value.seq) || Number(value.seq) < 1 || Number(value.seq) > 100_000
      || typeof value.at !== 'number' || !Number.isSafeInteger(value.at) || Math.abs(now - value.at) > 86_400_000
      || !Number.isSafeInteger(value.parts) || Number(value.parts) < 1 || Number(value.parts) > 64
      || !Number.isSafeInteger(value.part) || Number(value.part) < 0 || Number(value.part) >= Number(value.parts)) throw new Fault(400);
    for (const [key, allowed] of Object.entries(enums)) if (value[key] !== undefined && (typeof value[key] !== 'string' || !allowed.includes(value[key]))) throw new Fault(400);
    for (const key of ['messageId','attemptId']) if (value[key] !== undefined && (typeof value[key] !== 'string' || !uuid.test(value[key]))) throw new Fault(400);
    for (const key of ['model','card']) if (value[key] !== undefined && (typeof value[key] !== 'string' || value[key].length > 160 || /[\r\n\x00-\x1f]/.test(value[key]))) throw new Fault(400);
    if (value.text !== undefined && (typeof value.text !== 'string' || [...value.text].length > TRANSCRIPT_TEXT_CHARS || !['user_input','assistant_generated','presentation_progress','presentation_completed','presentation_interrupted'].includes(String(value.kind)))) throw new Fault(400);
    // Never emit arbitrary nested input. Known server credentials are redacted from every string field.
    const clean = Object.fromEntries(Object.entries(value).map(([k,v]) => [k, typeof v === 'string' ? redactTranscript(v,secrets) : v])) as unknown as TranscriptEvent;
    if (Buffer.byteLength(JSON.stringify(clean)) > 8_000) throw new Fault(413);
    return clean;
  });
}

/** Stateless session-bound receipts; no transcript database, read endpoint or raw request logging. */
export function createParlorTranscriptHandler(options: {
  enabled: boolean; origin?: string; authenticator?: BrowserSessionAuthenticator;
  signingSecrets: string[]; redactSecrets: string[]; emit?: (line: string) => void; now?: () => number;
}) {
  const clock = options.now ?? Date.now;
  const limiter = new FixedWindowRateLimiter(30, 60_000, 1);
  const keys = options.signingSecrets.filter(Boolean).map(secret => createHmac('sha256',secret).update('arcana:parlor-transcript:v1').digest());
  const mac = (key: Buffer, data: string, cookie: string) => createHmac('sha256',key).update(data).update('\0').update(cookie).digest();
  return async (req: IncomingMessage, res: ServerResponse) => {
    res.setHeader('cache-control','private, no-store'); res.setHeader('vary','Cookie');
    let timeout: ReturnType<typeof setTimeout> | undefined;
    try {
      const session = await options.authenticator?.authenticate(req,res);
      if (!session) throw new Fault(options.authenticator ? 401 : 503);
      if (!isParlorOwner(session.identity)) throw new Fault(403);
      if (!options.enabled || !keys.length || !options.origin) throw new Fault(404);
      if (req.method !== 'POST') throw new Fault(405);
      if (req.headers.origin !== options.origin) throw new Fault(403);
      if (!limiter.check('owner',clock()).allowed) throw new Fault(429);
      if (!req.headers['content-type']?.startsWith('application/json')) throw new Fault(415);
      const chunks: Buffer[] = []; let size = 0;
      timeout = setTimeout(() => req.destroy(), 5_000);
      for await (const chunk of req) { size += chunk.length; if (size > TRANSCRIPT_BATCH_BYTES) throw new Fault(413); chunks.push(Buffer.from(chunk)); }
      clearTimeout(timeout);
      let data: unknown; try { data = JSON.parse(Buffer.concat(chunks).toString('utf8')); } catch { throw new Fault(400); }
      if (!record(data)) throw new Fault(400);
      // Check session revocation after body arrival and before emitting any content.
      if (!isParlorOwner((await options.authenticator?.authenticate(req,res))?.identity)) throw new Fault(403);
      const cookie = req.headers.cookie ?? ''; if (!cookie || cookie.length > 16_384) throw new Fault(403);
      if (data.start === true && Object.keys(data).length === 1) {
        const payload = Buffer.from(JSON.stringify({ id:randomUUID(), expires:clock()+2*60*60*1000 })).toString('base64url');
        return json(res,200,{token:payload+'.'+mac(keys[0],payload,cookie).toString('base64url')});
      }
      if (Object.keys(data).some(k => !['token','events'].includes(k)) || typeof data.token !== 'string' || data.token.length > 1_024) throw new Fault(400);
      const [payload,signature,...extra] = data.token.split('.');
      if (!payload || !signature || extra.length) throw new Fault(403);
      const sig = Buffer.from(signature,'base64url');
      if (!keys.some(key => { const expected = mac(key,payload,cookie); return expected.length === sig.length && timingSafeEqual(expected,sig); })) throw new Fault(403);
      const receipt = JSON.parse(Buffer.from(payload,'base64url').toString('utf8'));
      if (!record(receipt) || typeof receipt.id !== 'string' || !uuid.test(receipt.id) || typeof receipt.expires !== 'number' || receipt.expires < clock()) throw new Fault(403);
      const events = validateTranscriptEvents(data.events,[...options.redactSecrets,...options.signingSecrets,cookie],clock());
      for (const event of events) (options.emit ?? console.log)(JSON.stringify({ marker:'parlor_transcript_v1', version:1, encounterId:receipt.id, receivedAt:clock(), evidence:'client_reported_not_proof_of_hearing', ...event }));
      json(res,200,{accepted:events.length});
    } catch (error) { json(res,error instanceof Fault ? error.status : 503,{error:'transcript_unavailable'}); }
    finally { clearTimeout(timeout); }
  };
}
