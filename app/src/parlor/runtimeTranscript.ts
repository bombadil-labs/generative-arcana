/** Temporary diagnostic records, never conversation input or a browser archive. */
export type TranscriptKind = 'user_input' | 'assistant_generated' | 'presentation_started' | 'presentation_progress' | 'presentation_completed' | 'presentation_interrupted' | 'error' | 'encounter_closed' | 'gap';
export interface TranscriptInput {
  kind: TranscriptKind;
  stage?: 'release' | 'greeting' | 'card' | 'synthesis' | 'answer' | 'reading';
  text?: string;
  messageId?: string;
  attemptId?: string;
  timing?: 'aligned' | 'segment' | 'silent' | 'unknown';
  reason?: 'reset' | 'cancelled' | 'failed' | 'timeout' | 'queue_full';
  provider?: 'anthropic' | 'openai' | 'script';
  model?: string;
  card?: string;
}
export interface TranscriptEvent extends TranscriptInput { eventId: string; seq: number; at: number; part: number; parts: number }
export interface TranscriptSink { event(value: TranscriptInput): void; reset(): void; dispose(): void }
export const TRANSCRIPT_BATCH_BYTES = 16_384;
export const TRANSCRIPT_QUEUE_BYTES = 262_144;
export const TRANSCRIPT_MAX_EVENTS = 8;
export const TRANSCRIPT_TEXT_CHARS = 1_000;

/** Remove known keys before chunking, plus common pasted credential forms. Never serialize settings. */
export function redactTranscript(text: string, secrets: readonly string[] = []): string {
  let safe = text;
  for (const secret of [...secrets].filter(Boolean).sort((a, b) => b.length - a.length)) safe = safe.split(secret).join('[redacted]');
  return safe.replace(/\b(?:sk-(?:ant-)?[A-Za-z0-9_-]{12,}|Bearer\s+[A-Za-z0-9._~+/-]{12,})\b/gi, '[redacted]')
    .replace(/((?:api[_ -]?key|authorization|cookie|secret)\s*[:=]\s*)[^\s,;]+/gi, '$1[redacted]');
}
const bytes = (value: unknown) => new TextEncoder().encode(JSON.stringify(value)).length;
type Encounter = { token?: string; seq: number };
type Pending = { encounter: Encounter; event: TranscriptEvent };

export class RuntimeTranscript implements TranscriptSink {
  private encounter: Encounter = { seq: 0 };
  private queue: Pending[] = [];
  private dropped = 0;
  private disposed = false;
  private running = false;
  private timer?: ReturnType<typeof setTimeout>;
  private controller?: AbortController;
  constructor(private secrets: string[] = [], private send: typeof fetch = fetch) {}
  event(input: TranscriptInput) {
    if (this.disposed) return;
    // Explicit field projection: unexpected settings, audio or error objects never reach the wire.
    const value: TranscriptInput = { kind: input.kind };
    for (const key of ['stage', 'messageId', 'attemptId', 'timing', 'reason', 'provider', 'model', 'card'] as const) {
      if (typeof input[key] === 'string') Object.assign(value, { [key]: redactTranscript(input[key]!, this.secrets) });
    }
    const text = input.text === undefined ? undefined : redactTranscript(input.text, this.secrets);
    if (text !== undefined && text.length > 32_000) { this.dropped++; return; }
    const chars = text === undefined ? [] : [...text];
    const parts = Math.max(1, Math.ceil(chars.length / TRANSCRIPT_TEXT_CHARS));
    const eventId = crypto.randomUUID(), seq = ++this.encounter.seq, at = Date.now();
    const pending: Pending[] = Array.from({ length: parts }, (_, part) => ({ encounter: this.encounter,
      event: { ...value, ...(text === undefined ? {} : { text: chars.slice(part * TRANSCRIPT_TEXT_CHARS, (part + 1) * TRANSCRIPT_TEXT_CHARS).join('') }), eventId, seq, at, part, parts } }));
    // Reserve room for one loss marker; the queue cap includes metadata and separators.
    if (pending.some(p => bytes(p.event) > 8_000) || bytes(this.queue.map(p => p.event)) + bytes(pending.map(p => p.event)) + 512 > TRANSCRIPT_QUEUE_BYTES) { this.dropped++; return; }
    this.queue.push(...pending);
    if (this.dropped) {
      this.queue.push({ encounter: this.encounter, event: { kind: 'gap', reason: 'queue_full', eventId: crypto.randomUUID(), seq: ++this.encounter.seq, at, part: 0, parts: 1 } });
      this.dropped = 0;
    }
    this.schedule();
  }
  reset() {
    this.event({ kind: 'encounter_closed', reason: 'reset' });
    this.encounter = { seq: 0 }; this.dropped = 0;
  }
  dispose() {
    this.disposed = true; clearTimeout(this.timer); this.controller?.abort();
    this.queue = []; this.encounter = { seq: 0 }; this.secrets = []; this.dropped = 0;
  }
  private schedule() { if (!this.running && !this.timer && !this.disposed) this.timer = setTimeout(() => { this.timer = undefined; void this.flush(); }, 250); }
  private async post(body: unknown, signal: AbortSignal): Promise<Response> {
    return this.send('/api/parlor/transcript', { method: 'POST', credentials: 'same-origin', cache: 'no-store', redirect: 'error', signal, headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
  }
  private async flush() {
    if (this.disposed || !this.queue.length || this.running) return;
    this.running = true;
    const controller = new AbortController(); this.controller = controller;
    const timeout = setTimeout(() => controller.abort(), 10_000);
    const encounter = this.queue[0].encounter;
    let batch: Pending[] = [];
    try {
      if (!encounter.token) {
        const response = await this.post({ start: true }, controller.signal);
        if (response.status === 401 || response.status === 403 || response.status === 404) { this.dispose(); return; }
        if (!response.ok) throw new Error();
        const body: unknown = await response.json();
        if (!body || typeof body !== 'object' || !('token' in body) || typeof body.token !== 'string' || body.token.length > 1_024) throw new Error();
        if (this.disposed) return;
        encounter.token = body.token;
      }
      for (const pending of this.queue) {
        if (pending.encounter !== encounter || batch.length === TRANSCRIPT_MAX_EVENTS || bytes({ token: encounter.token, events: [...batch, pending].map(p => p.event) }) > TRANSCRIPT_BATCH_BYTES) break;
        batch.push(pending);
      }
      if (!batch.length) throw new Error();
      // One bounded retry with the exact event IDs. Acknowledgement loss can duplicate logs.
      for (let attempt = 0; attempt < 2; attempt++) {
        try {
          const response = await this.post({ token: encounter.token, events: batch.map(p => p.event) }, controller.signal);
          if (response.status === 401 || response.status === 403 || response.status === 404) { this.dispose(); return; }
          if (!response.ok) throw new Error();
          break;
        } catch { if (attempt || controller.signal.aborted || this.disposed) throw new Error(); }
      }
    } catch {
      // No indefinite retention/retry. Gaps are explicit on the next successful batch.
      if (encounter === this.encounter) this.dropped++;
      if (!batch.length) batch = this.queue.filter(p => p.encounter === encounter);
    } finally {
      clearTimeout(timeout);
      if (!this.disposed) this.queue = this.queue.filter(p => !batch.includes(p));
      this.controller = undefined; this.running = false; this.schedule();
    }
  }
}
