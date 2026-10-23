import { boundedSpeechBody } from "./speech";

const MAX_BYTES = 8_000_000;
const MAX_RECORDING_MS = 60_000;
const MIN_RECORDING_MS = 250;
const mimeTypes = ["audio/webm;codecs=opus", "audio/webm", "audio/mp4", "audio/ogg;codecs=opus"];

/** One bounded, intentional clip; no streaming, retries, or remote fallback. */
export async function transcribeScribe(audio: Blob, key: string, signal: AbortSignal): Promise<string> {
  if (!key || !audio.size || audio.size > MAX_BYTES || !mimeTypes.includes(audio.type)) throw new Error("Invalid recording");
  signal.throwIfAborted();
  const form = new FormData();
  const extension = audio.type.includes("mp4") ? "m4a" : audio.type.includes("ogg") ? "ogg" : "webm";
  form.append("file", audio, `recording.${extension}`);
  form.append("model_id", "scribe_v2");
  form.append("tag_audio_events", "false");
  form.append("diarize", "false");
  form.append("timestamps_granularity", "none");
  form.append("webhook", "false");
  const response = await fetch("https://api.elevenlabs.io/v1/speech-to-text", {
    method: "POST", headers: { "xi-api-key": key }, body: form, signal,
    credentials: "omit", redirect: "error", cache: "no-store", referrerPolicy: "no-referrer",
  });
  // Provider errors may echo credentials or submitted content; never display them.
  const bytes = await boundedSpeechBody(response, 64_000);
  signal.throwIfAborted();
  const result: unknown = JSON.parse(new TextDecoder().decode(bytes));
  const text = result && typeof result === "object" && "text" in result ? result.text : undefined;
  if (typeof text !== "string" || text.length > 1200 || text.includes(key)) throw new Error("Invalid transcription");
  return text.trim();
}

export interface RecordingRuntime {
  getUserMedia(): Promise<MediaStream>;
  recordingType(): string | undefined;
  createRecorder(stream: MediaStream, type: string): MediaRecorder;
  now(): number;
}
const browserRuntime: RecordingRuntime = {
  getUserMedia: () => navigator.mediaDevices.getUserMedia({ audio: true }),
  recordingType: () => typeof MediaRecorder === "undefined" ? undefined : mimeTypes.find(type => MediaRecorder.isTypeSupported(type)),
  createRecorder: (stream, mimeType) => new MediaRecorder(stream, { mimeType, audioBitsPerSecond: 64_000 }),
  now: () => performance.now(),
};
export interface MicrophoneState {
  phase: "idle" | "checking" | "listening" | "finishing" | "error";
  error: string;
}
const initial = (): MicrophoneState => ({ phase: "idle", error: "" });
function stopTracks(stream?: MediaStream) {
  stream?.getTracks().forEach(track => { try { track.stop(); } catch { /* Continue stopping other tracks. */ } });
}
export class ScribeMicrophone {
  private state = initial();
  private listeners = new Set<() => void>();
  private stream?: MediaStream;
  private recorder?: MediaRecorder;
  private chunks: Blob[] = [];
  private bytes = 0;
  private epoch = 0;
  private held = false;
  private startedAt = 0;
  private timer?: ReturnType<typeof setTimeout>;
  private request?: AbortController;
  private disposed = false;
  constructor(private submit: (text: string) => void, private key: () => string,
    private runtime: RecordingRuntime = browserRuntime, private transcribe = transcribeScribe, private available = () => !!this.key()) {}
  subscribe = (listener: () => void) => { this.listeners.add(listener); return () => { this.listeners.delete(listener); }; };
  getSnapshot = () => this.state;
  private set(patch: Partial<MicrophoneState>) { if (!this.disposed) { this.state = { ...this.state, ...patch }; this.listeners.forEach(fn => fn()); } }
  private cleanup() {
    clearTimeout(this.timer); this.timer = undefined;
    this.request?.abort(); this.request = undefined;
    const recorder = this.recorder; this.recorder = undefined;
    if (recorder) {
      recorder.onstart = recorder.ondataavailable = recorder.onstop = recorder.onerror = null;
      try { if (recorder.state !== "inactive") recorder.stop(); } catch { /* Tracks are still stopped below. */ }
    }
    stopTracks(this.stream); this.stream = undefined;
    this.chunks = []; this.bytes = 0;
  }
  private fail(error: string) {
    ++this.epoch; this.held = false; this.cleanup(); this.set({ phase: "error", error });
  }
  async press() {
    if (this.disposed || this.held || ["checking", "listening", "finishing"].includes(this.state.phase)) return;
    this.held = true;
    const epoch = ++this.epoch;
    const current = () => !this.disposed && epoch === this.epoch;
    this.set({ phase: "checking", error: "" });
    try {
      if (!this.available()) { this.fail("Add your ElevenLabs key in setup to use Scribe, or tap to continue without speech."); return; }
      const type = this.runtime.recordingType();
      if (!type) { this.fail("Audio recording is unavailable in this browser. Tap to continue without speech."); return; }
      this.timer = setTimeout(() => { if (current()) this.fail("Microphone permission timed out. Hold to talk again, or tap to continue without speech."); }, MAX_RECORDING_MS);
      const stream = await this.runtime.getUserMedia();
      // A permission prompt cannot be dismissed by the app. Stop any stream granted after release.
      if (!current() || !this.held) { stopTracks(stream); return; }
      this.stream = stream;
      const recorder = this.runtime.createRecorder(stream, type); this.recorder = recorder;
      this.startedAt = this.runtime.now();
      recorder.onstart = () => { if (current() && this.held) this.set({ phase: "listening" }); };
      recorder.ondataavailable = event => {
        if (!current() || !event.data.size) return;
        this.bytes += event.data.size;
        if (this.bytes > MAX_BYTES) { this.fail("That recording is too large. Hold to talk again with a shorter thought."); return; }
        this.chunks.push(event.data);
      };
      recorder.onerror = () => { if (current()) this.fail("Recording stopped. Check your microphone, or tap to continue without speech."); };
      recorder.onstop = () => {
        if (!current()) return;
        if (this.held || this.state.phase !== "finishing") { this.fail("Recording stopped before release. Hold to talk again."); return; }
        recorder.onstart = recorder.ondataavailable = recorder.onstop = recorder.onerror = null;
        this.recorder = undefined;
        const audio = new Blob(this.chunks, { type });
        this.chunks = []; this.bytes = 0;
        // Stop callbacks are asynchronous; release has already stopped every track.
        void this.finish(audio, epoch);
      };
      clearTimeout(this.timer);
      this.timer = setTimeout(() => { if (current()) this.fail("Recording stopped after one minute and was discarded. Hold to talk again with a shorter thought."); }, MAX_RECORDING_MS);
      recorder.start(250);
    } catch (error) {
      if (current()) this.fail(error instanceof DOMException && (error.name === "NotAllowedError" || error.name === "SecurityError")
        ? "Microphone access was denied. Allow the microphone in your browser, then hold to talk again, or tap to continue without speech."
        : "The microphone could not start. Check microphone access, or tap to continue without speech.");
    }
  }
  release() {
    if (!this.held) return;
    this.held = false;
    if (!this.recorder || this.recorder.state !== "recording") { this.cancel(); return; }
    const duration = this.runtime.now() - this.startedAt;
    if (duration < MIN_RECORDING_MS) { this.fail("That press was too short. Hold to talk while you speak, then release."); return; }
    if (duration >= MAX_RECORDING_MS) { this.fail("Recording stopped after one minute and was discarded. Hold to talk again with a shorter thought."); return; }
    this.set({ phase: "finishing" }); clearTimeout(this.timer);
    const epoch = this.epoch;
    this.timer = setTimeout(() => { if (epoch === this.epoch) this.fail("Recording did not finish. Hold to talk again."); }, 5000);
    try { this.recorder.stop(); }
    catch { this.fail("Recording stopped. Hold to talk again."); }
    finally { stopTracks(this.stream); this.stream = undefined; }
  }
  private async finish(audio: Blob, epoch: number) {
    const current = () => !this.disposed && epoch === this.epoch;
    if (!current()) return;
    if (!audio.size) { this.fail("No audio was captured. Hold to talk again, or tap to continue without speech."); return; }
    clearTimeout(this.timer);
    const request = new AbortController(); this.request = request;
    this.timer = setTimeout(() => { if (current()) this.fail("Transcription timed out. Hold to talk again, or tap to continue without speech."); }, 45_000);
    try {
      const text = await this.transcribe(audio, this.key(), request.signal);
      if (!current()) return;
      if (!text) { this.fail("No speech was heard. Hold to talk again, or tap to continue without speech."); return; }
      ++this.epoch; this.cleanup(); this.set(initial()); this.submit(text);
    } catch { if (current()) this.fail("Scribe could not transcribe that recording. Check your ElevenLabs key and transcription access, or tap to continue without speech."); }
  }
  cancel() { ++this.epoch; this.held = false; this.cleanup(); this.set(initial()); }
  dispose() { this.cancel(); this.disposed = true; this.listeners.clear(); }
}
