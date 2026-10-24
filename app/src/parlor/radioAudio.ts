import type { RadioMode } from "./radio";

export interface RadioPreferences { muted: boolean; volume: number }
export const defaultRadioPreferences = (): RadioPreferences => ({ muted: false, volume: .35 });
// The approved recording is already mastered quietly. Never amplify/normalize it.
export const MAX_RADIO_GAIN = 1;
export const RADIO_RECORDING = '/assets/parlor-radio-recording.mp3';
export const RADIO_STARTS = [0, 45.4, 95.2, 145.75] as const;
// Brief band-limited accents, far below full-scale voice; never normalize the bed.
export const MAX_SIGNAL_GAIN = .012;
export const SIGNAL_SECONDS = { lock: .075, loss: .11 } as const;
/** Session-protected same-origin asset, requested only after an intentional gesture. */
export async function loadRadioRecording(context: AudioContext, signal: AbortSignal): Promise<AudioBuffer> {
  const response = await fetch(RADIO_RECORDING, { credentials: 'same-origin', cache: 'no-store', redirect: 'error', signal });
  if (!response.ok || response.headers.get('content-type')?.split(';')[0] !== 'audio/mpeg' || !response.body) { await response.body?.cancel(); throw new Error('Radio recording unavailable'); }
  const reader = response.body.getReader(), parts: Uint8Array[] = []; let size = 0;
  try {
    for (;;) {
      signal.throwIfAborted(); const { done, value } = await reader.read(); if (done) break;
      size += value.length; if (size > 5_000_000) throw new Error('Radio recording too large'); parts.push(value);
    }
  } finally { await reader.cancel().catch(() => {}); reader.releaseLock(); }
  signal.throwIfAborted();
  const bytes = new Uint8Array(size); let offset = 0; for (const part of parts) { bytes.set(part, offset); offset += part.length; }
  const buffer = await context.decodeAudioData(bytes.buffer); signal.throwIfAborted();
  if (buffer.numberOfChannels !== 1 || !Number.isFinite(buffer.duration) || Math.abs(buffer.duration - 180) > .1) throw new Error('Unexpected radio recording');
  return buffer;
}
export function radioGain(mode: RadioMode, preferences: RadioPreferences, capture = false, held = false): number {
  if (preferences.muted || capture || held || ["quiet", "stopped", "listening"].includes(mode)) return 0;
  const volume = Number.isFinite(preferences.volume) ? Math.max(0, Math.min(1, preferences.volume)) : 0;
  const level = mode === "searching" ? 1 : mode === "tuning" ? .75 : mode === "speaking" ? .08 : .22;
  return MAX_RADIO_GAIN * volume * level;
}
type Envelope = { from: number; to: number; start: number; end: number };
type Graph = { gain: GainNode; nodes: AudioNode[]; sources: AudioScheduledSourceNode[]; envelope: Envelope; offset: number; started: number };
type Accent = { source: AudioBufferSourceNode; gain: GainNode; nodes: AudioNode[]; start: number; duration: number; peak: number; cancelling?: boolean; timer?: ReturnType<typeof setTimeout> };
const fraction = (value: number) => Math.max(0, Math.min(1, value));

/** One gesture-unlocked context and recording, plus bounded optional static accents. */
export class RadioAudio {
  private context?: AudioContext;
  private buffer?: AudioBuffer;
  private graph?: Graph;
  private mode: RadioMode = "quiet";
  private preferences = defaultRadioPreferences();
  private capture = false;
  private held = false;
  private armed = false;
  private disposed = false;
  private epoch = 0;
  private suspendTimer?: ReturnType<typeof setTimeout>;
  private retiring = new Map<Graph, ReturnType<typeof setTimeout>>();
  private listeners = new Set<() => void>();
  private error = "";
  private cursor: number;
  private loading?: { abort: AbortController; timer: ReturnType<typeof setTimeout> };
  private noise?: AudioBuffer;
  private accents = new Set<Accent>();
  constructor(private createContext = () => new AudioContext({ latencyHint: "interactive" }),
    private load = loadRadioRecording, random = Math.random) {
    const choice = random();
    this.cursor = RADIO_STARTS[Math.floor(fraction(Number.isFinite(choice) ? choice : 0) * (RADIO_STARTS.length - .000001))];
  }
  subscribe = (listener: () => void) => { this.listeners.add(listener); return () => { this.listeners.delete(listener); }; };
  getSnapshot = () => this.error;
  private message(error: string) { if (!this.disposed && error !== this.error) { this.error = error; this.listeners.forEach(fn => fn()); } }
  setPreferences(preferences: RadioPreferences) {
    this.clearAccents();
    this.preferences = { ...preferences };
    if (preferences.muted || preferences.volume <= 0) this.stop(); else this.apply();
  }
  setState(mode: RadioMode, capture: boolean) {
    this.mode = mode; this.capture = capture;
    if (capture || mode === 'listening') this.clearAccents(true);
    if (mode === "quiet" || mode === "stopped") this.stop(); else this.apply();
  }
  hold(held: boolean) { this.held = held; if (held) this.clearAccents(); this.apply(); }
  /** Actual vocalization edges only. Never unlock, queue or delay an accent. */
  signal(edge: 'lock' | 'loss') {
    const context = this.context, volume = this.preferences.volume;
    if (!this.armed || this.disposed || !context || context.state !== 'running' || this.preferences.muted || !Number.isFinite(volume) || volume <= 0 || this.capture || this.held || ['quiet','stopped','listening'].includes(this.mode)) return;
    this.clearAccents();
    // At most one short retiring accent and one new accent, even with bad callers.
    while (this.accents.size > 1) this.finishAccent(this.accents.values().next().value!);
    const nodes: AudioNode[] = [];
    let source: AudioBufferSourceNode | undefined;
    let accent: Accent | undefined;
    try {
      if (!this.noise) {
        this.noise = context.createBuffer(1, Math.ceil(context.sampleRate * SIGNAL_SECONDS.loss), context.sampleRate);
        const samples = this.noise.getChannelData(0);
        // Local repeatable noise: no external audio/service, no random loud spikes.
        let seed = 0x41524341;
        for (let i=0;i<samples.length;i++) { seed ^= seed << 13; seed ^= seed >>> 17; seed ^= seed << 5; samples[i] = (seed >>> 0) / 0xffffffff * 2 - 1; }
      }
      source = context.createBufferSource(); nodes.push(source); source.buffer = this.noise;
      const filter = context.createBiquadFilter(); nodes.push(filter); filter.type = 'bandpass'; filter.frequency.value = 1200; filter.Q.value = .6;
      const gain = context.createGain(); nodes.push(gain); gain.gain.value = 0;
      source.connect(filter); filter.connect(gain); gain.connect(context.destination);
      const now = context.currentTime, duration = SIGNAL_SECONDS[edge];
      const peak = MAX_SIGNAL_GAIN * Math.min(1, volume) * (edge === 'loss' ? .8 : 1);
      gain.gain.setValueAtTime(0, now); gain.gain.linearRampToValueAtTime(peak, now + .012); gain.gain.linearRampToValueAtTime(0, now + duration);
      const active: Accent = accent = { source, gain, nodes, start: now, duration, peak }; this.accents.add(active);
      source.onended = () => this.finishAccent(active);
      source.start(now); source.stop(now + duration);
      active.timer = setTimeout(() => this.finishAccent(active), duration * 1000 + 50);
    } catch {
      try { source?.stop(); } catch {}
      if (accent) this.finishAccent(accent);
      nodes.forEach(node => { try { node.disconnect(); } catch {} });
      // Cosmetic failure does not stop narration or the recording bed.
    }
  }
  private finishAccent(accent: Accent) {
    clearTimeout(accent.timer); this.accents.delete(accent); accent.source.onended = null;
    accent.nodes.forEach(node => { try { node.disconnect(); } catch {} });
  }
  private clearAccents(immediate = false) {
    for (const accent of this.accents) {
      if (immediate) { try { accent.source.stop(); } catch {} this.finishAccent(accent); continue; }
      if (accent.cancelling) continue;
      accent.cancelling = true; clearTimeout(accent.timer);
      const now = this.context?.currentTime ?? 0, elapsed = Math.max(0, now - accent.start);
      const value = accent.peak * fraction(elapsed < .012 ? elapsed / .012 : (accent.duration - elapsed) / (accent.duration - .012));
      try {
        accent.gain.gain.cancelScheduledValues(now); accent.gain.gain.setValueAtTime(value, now); accent.gain.gain.linearRampToValueAtTime(0, now + .005);
        accent.source.stop(now + .006); // Audio-clock stop survives throttled background timers.
        accent.timer = setTimeout(() => this.finishAccent(accent), 12);
      } catch { this.finishAccent(accent); }
    }
  }
  /** Call synchronously from an intentional key/pointer/operator gesture only. */
  unlock() {
    if (this.disposed || this.preferences.muted || !Number.isFinite(this.preferences.volume) || this.preferences.volume <= 0) return;
    clearTimeout(this.suspendTimer);
    this.armed = true;
    const epoch = ++this.epoch;
    try {
      const context = this.context ??= this.createContext();
      if (context.state === "running") { this.message(""); this.apply(); return; }
      const pending = context.resume();
      void pending.then(() => {
        if (this.disposed || epoch !== this.epoch) {
          if (!this.armed && context.state !== "closed") void context.suspend().catch(() => {});
          return;
        }
        this.message(""); this.apply();
      }).catch(() => { if (!this.disposed && epoch === this.epoch) this.fail(); });
    } catch { this.fail(); }
  }
  private fail() { this.stop(); this.message("Radio ambience is unavailable. The reading continues."); }
  private makeGraph(context: AudioContext): Graph {
    const nodes: AudioNode[] = [], sources: AudioScheduledSourceNode[] = [];
    try {
      const gain = context.createGain(); nodes.push(gain); gain.gain.value = 0; gain.connect(context.destination);
      const source = context.createBufferSource(); nodes.push(source); sources.push(source);
      source.buffer = this.buffer!; source.loop = true;
      // The source's first/last 100 ms are silent, with a mastered end fade. Its
      // natural loop needs no hard splice. Starts at quiet cues always fade in.
      const offset = this.cursor % this.buffer!.duration, started = context.currentTime;
      source.connect(gain); source.start(started, offset);
      return { gain, nodes, sources, offset, started, envelope: { from: 0, to: 0, start: started, end: started } };
    } catch (error) {
      sources.forEach(source => { try { source.stop(); } catch {} });
      nodes.forEach(node => { try { node.disconnect(); } catch {} });
      throw error;
    }
  }
  private ramp(graph: Graph, target: number, seconds: number) {
    const now = this.context!.currentTime, previous = graph.envelope;
    if (previous.to === target) return;
    const value = previous.end <= previous.start ? previous.to : previous.from + (previous.to - previous.from) * fraction((now - previous.start) / (previous.end - previous.start));
    // Track our linear envelope so engines without cancelAndHoldAtTime remain click-free.
    graph.gain.gain.cancelScheduledValues(now);
    graph.gain.gain.setValueAtTime(value, now);
    graph.gain.gain.linearRampToValueAtTime(target, now + seconds);
    graph.envelope = { from: value, to: target, start: now, end: now + seconds };
  }
  private apply() {
    if (!this.armed || this.disposed || !this.context || this.context.state !== "running") return;
    const target = radioGain(this.mode, this.preferences, this.capture, this.held);
    try {
      if (!this.graph && target > 0) {
        if (!this.buffer) { this.prepare(); return; }
        this.graph = this.makeGraph(this.context);
      }
      if (this.graph) this.ramp(this.graph, target, target < this.graph.envelope.to ? .025 : .65);
    } catch { this.fail(); }
  }
  private prepare() {
    if (this.loading || !this.context) return;
    const context = this.context, abort = new AbortController();
    const pending = { abort, timer: setTimeout(() => { if (this.loading === pending) this.fail(); }, 20000) };
    this.loading = pending;
    const current = () => !this.disposed && this.armed && this.loading === pending && this.context === context && !abort.signal.aborted;
    void Promise.resolve().then(() => { abort.signal.throwIfAborted(); return this.load(context, abort.signal); }).then(buffer => {
      if (!current()) return;
      this.buffer = buffer; this.message(''); this.apply();
    }).catch(() => { if (current()) this.fail(); }).finally(() => {
      clearTimeout(pending.timer); if (this.loading === pending) this.loading = undefined;
    });
  }
  private disconnect(graph: Graph) {
    clearTimeout(this.retiring.get(graph)); this.retiring.delete(graph);
    graph.nodes.forEach(node => { try { node.disconnect(); } catch {} });
  }
  /** Silence on blur/reset/mute; later state changes cannot resume without another gesture. */
  stop() {
    this.clearAccents();
    this.armed = false; const epoch = ++this.epoch;
    clearTimeout(this.suspendTimer);
    if (this.loading) { clearTimeout(this.loading.timer); this.loading.abort.abort(); this.loading = undefined; }
    const context = this.context, graph = this.graph; this.graph = undefined;
    if (graph && context) {
      this.cursor = (graph.offset + Math.max(0, context.currentTime - graph.started)) % this.buffer!.duration;
      try { this.ramp(graph, 0, .025); } catch { graph.gain.disconnect(); }
      graph.sources.forEach(source => { try { source.stop(context.currentTime + .03); } catch {} });
      this.retiring.set(graph, setTimeout(() => this.disconnect(graph), 50));
    }
    if (context) this.suspendTimer = setTimeout(() => {
      if (epoch === this.epoch && !this.armed && context.state !== "closed") void context.suspend().catch(() => {});
    }, 60);
  }
  dispose() {
    if (this.disposed) return;
    this.stop(); this.disposed = true; clearTimeout(this.suspendTimer); this.listeners.clear();
    const context = this.context; this.context = undefined; this.buffer = undefined; this.noise = undefined;
    // Sources have a bounded audio-clock stop even if background JS timers are throttled.
    setTimeout(() => {
      for (const graph of this.retiring.keys()) this.disconnect(graph);
      if (context && context.state !== "closed") void context.close().catch(() => {});
    }, 60);
  }
}
