import type { RadioMode } from "./radio";

export interface RadioPreferences { muted: boolean; volume: number }
export const defaultRadioPreferences = (): RadioPreferences => ({ muted: false, volume: .35 });
export const MAX_RADIO_GAIN = .06;
export function radioGain(mode: RadioMode, preferences: RadioPreferences, capture = false, held = false): number {
  if (preferences.muted || capture || held || ["quiet", "stopped", "listening"].includes(mode)) return 0;
  const volume = Number.isFinite(preferences.volume) ? Math.max(0, Math.min(1, preferences.volume)) : 0;
  const level = mode === "searching" ? 1 : mode === "tuning" ? .75 : mode === "speaking" ? .08 : .22;
  return MAX_RADIO_GAIN * volume * level;
}
type Envelope = { from: number; to: number; start: number; end: number };
type Graph = { gain: GainNode; nodes: AudioNode[]; sources: AudioScheduledSourceNode[]; envelope: Envelope };
const fraction = (value: number) => Math.max(0, Math.min(1, value));

/** One gesture-unlocked context. Local synthesis only: no media input, assets or fetches. */
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
  constructor(private createContext = () => new AudioContext({ latencyHint: "interactive" })) {}
  subscribe = (listener: () => void) => { this.listeners.add(listener); return () => { this.listeners.delete(listener); }; };
  getSnapshot = () => this.error;
  private message(error: string) { if (!this.disposed && error !== this.error) { this.error = error; this.listeners.forEach(fn => fn()); } }
  setPreferences(preferences: RadioPreferences) {
    this.preferences = { ...preferences };
    if (preferences.muted || preferences.volume <= 0) this.stop(); else this.apply();
  }
  setState(mode: RadioMode, capture: boolean) {
    this.mode = mode; this.capture = capture;
    if (mode === "quiet" || mode === "stopped") this.stop(); else this.apply();
  }
  hold(held: boolean) { this.held = held; this.apply(); }
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
      const noise = context.createBufferSource(); nodes.push(noise); sources.push(noise);
      if (!this.buffer) {
        this.buffer = context.createBuffer(1, context.sampleRate * 2, context.sampleRate);
        const samples = this.buffer.getChannelData(0);
        for (let i = 0; i < samples.length; i++) samples[i] = (Math.random() * 2 - 1) * Math.min(1, i / 256, (samples.length - i - 1) / 256);
      }
      noise.buffer = this.buffer; noise.loop = true;
      const high = context.createBiquadFilter(), low = context.createBiquadFilter(), hiss = context.createGain(); nodes.push(high, low, hiss);
      high.type = "highpass"; high.frequency.value = 160; high.Q.value = .5;
      low.type = "lowpass"; low.frequency.value = 1800; low.Q.value = .5; hiss.gain.value = .22;
      noise.connect(high).connect(low).connect(hiss).connect(gain);
      const hum = context.createOscillator(), warmth = context.createGain(); nodes.push(hum, warmth); sources.push(hum);
      hum.type = "sine"; hum.frequency.value = 110; warmth.gain.value = .18; hum.connect(warmth).connect(gain);
      noise.start(); hum.start();
      return { gain, nodes, sources, envelope: { from: 0, to: 0, start: context.currentTime, end: context.currentTime } };
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
      if (!this.graph && target > 0) this.graph = this.makeGraph(this.context);
      if (this.graph) this.ramp(this.graph, target, target < this.graph.envelope.to ? .025 : .65);
    } catch { this.fail(); }
  }
  private disconnect(graph: Graph) {
    clearTimeout(this.retiring.get(graph)); this.retiring.delete(graph);
    graph.nodes.forEach(node => { try { node.disconnect(); } catch {} });
  }
  /** Silence on blur/reset/mute; later state changes cannot resume without another gesture. */
  stop() {
    this.armed = false; const epoch = ++this.epoch;
    clearTimeout(this.suspendTimer);
    const context = this.context, graph = this.graph; this.graph = undefined;
    if (graph && context) {
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
    const context = this.context; this.context = undefined; this.buffer = undefined;
    // Sources have a bounded audio-clock stop even if background JS timers are throttled.
    setTimeout(() => {
      for (const graph of this.retiring.keys()) this.disconnect(graph);
      if (context && context.state !== "closed") void context.close().catch(() => {});
    }, 60);
  }
}
