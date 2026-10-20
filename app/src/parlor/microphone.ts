/** Local-only Web Speech. Never fall back to a browser vendor's remote recognizer. */
interface Recognition {
  processLocally: boolean; lang: string; continuous: boolean; interimResults: boolean;
  onstart: (() => void) | null; onend: (() => void) | null;
  onerror: ((event: { error: string }) => void) | null;
  onresult: ((event: { results: ArrayLike<{ isFinal: boolean; 0: { transcript: string } }> }) => void) | null;
  start(): void; stop(): void; abort(): void;
}
export interface RecognitionConstructor {
  new(): Recognition;
  available?(options: { langs: string[]; processLocally: true }): Promise<string>;
  install?(options: { langs: string[]; processLocally: true }): Promise<boolean>;
}
export interface MicrophoneState {
  phase: "idle" | "checking" | "listening" | "finishing" | "installing" | "error";
  transcript: string; error: string; canInstall: boolean;
}
const initial = (): MicrophoneState => ({ phase: "idle", transcript: "", error: "", canInstall: false });
export class LocalMicrophone {
  private state = initial();
  private listeners = new Set<() => void>();
  private recognition?: Recognition;
  private epoch = 0;
  private held = false;
  private started = false;
  private finalText = "";
  private timer?: ReturnType<typeof setTimeout>;
  private disposed = false;
  constructor(private submit: (text: string) => void, private factory: () => RecognitionConstructor | undefined = () => {
    const browser = window as unknown as { SpeechRecognition?: RecognitionConstructor; webkitSpeechRecognition?: RecognitionConstructor };
    return browser.SpeechRecognition ?? browser.webkitSpeechRecognition;
  }, private language = "en-US") {}
  subscribe = (listener: () => void) => { this.listeners.add(listener); return () => { this.listeners.delete(listener); }; };
  getSnapshot = () => this.state;
  private set(patch: Partial<MicrophoneState>) { if (!this.disposed) { this.state = { ...this.state, ...patch }; this.listeners.forEach(fn => fn()); } }
  private cleanup() {
    clearTimeout(this.timer); this.timer = undefined;
    const recognition = this.recognition; this.recognition = undefined;
    if (recognition) {
      recognition.onstart = recognition.onend = recognition.onerror = recognition.onresult = null;
      try { recognition.abort(); } catch { /* Already ended. */ }
    }
  }
  private fail(error: string, canInstall = false) {
    ++this.epoch; this.held = false; this.cleanup(); this.finalText = "";
    this.set({ phase: "error", error, canInstall, transcript: "" });
  }
  async press() {
    if (this.disposed || this.held || ["checking", "listening", "finishing", "installing"].includes(this.state.phase)) return;
    this.held = true; this.started = false; this.finalText = "";
    const epoch = ++this.epoch;
    const current = () => !this.disposed && epoch === this.epoch;
    this.set({ phase: "checking", transcript: "", error: "", canInstall: false });
    try {
      const C = this.factory();
      if (!C?.available) { this.fail("On-device speech recognition is unavailable in this browser. You can type instead."); return; }
      const recognition = new C();
      if (!("processLocally" in recognition)) { this.fail("This browser cannot guarantee local speech recognition. You can type instead."); return; }
      recognition.processLocally = true;
      if (recognition.processLocally !== true) { this.fail("Local speech recognition could not be enabled."); return; }
      recognition.lang = this.language; recognition.continuous = true; recognition.interimResults = true;
      const availability = await C.available({ langs: [this.language], processLocally: true });
      if (!current() || !this.held) return;
      if (availability !== "available") {
        this.fail(availability === "downloading" ? "The local speech language pack is still downloading. Try again shortly."
          : "A local speech language pack is needed before you can talk. You can type instead.", availability === "downloadable" && !!C.install);
        return;
      }
      this.recognition = recognition;
      recognition.onstart = () => {
        if (!current() || !this.held) { try { recognition.abort(); } catch {} return; }
        this.started = true; this.set({ phase: "listening" });
      };
      recognition.onresult = event => {
        if (!current()) return;
        const results = Array.from(event.results);
        const full = results.map(r => r[0].transcript).join(" ").trim();
        if (full.length > 1200) { this.fail("That was a little long. Hold to talk again with a shorter thought."); return; }
        this.finalText = results.filter(r => r.isFinal).map(r => r[0].transcript).join(" ").trim();
        this.set({ transcript: full });
      };
      recognition.onerror = event => {
        if (!current()) return;
        this.fail(event.error === "not-allowed" || event.error === "service-not-allowed"
          ? "Microphone access was denied. Allow the microphone in your browser, then hold to talk again, or type instead."
          : event.error === "no-speech" ? "No speech was heard. Hold to talk again."
          : event.error === "audio-capture" ? "No microphone is available. Check your microphone or type instead."
          : "Local speech recognition stopped. Hold to talk again, or type instead.");
      };
      recognition.onend = () => {
        if (!current()) return;
        const send = !this.held && this.state.phase === "finishing";
        const text = this.finalText;
        ++this.epoch; this.held = false; this.cleanup(); this.finalText = "";
        this.set({ phase: "idle", transcript: "", error: send && text ? "" : "No complete speech was captured. Hold to talk again." });
        if (send && text) this.submit(text);
      };
      // Includes the permission prompt: releasing while permission is pending aborts it.
      this.timer = setTimeout(() => { if (current()) this.fail("Listening stopped after one minute. Hold to talk again with a shorter thought."); }, 60000);
      recognition.start();
    } catch { if (current()) this.fail("Local speech recognition could not start. Check microphone access, or type instead."); }
  }
  release() {
    if (!this.held) return;
    this.held = false;
    if (!this.recognition || !this.started) { this.cancel(); return; }
    this.set({ phase: "finishing" }); clearTimeout(this.timer);
    const epoch = this.epoch;
    this.timer = setTimeout(() => { if (epoch === this.epoch) this.fail("Speech recognition did not finish. Hold to talk again."); }, 3000);
    try { this.recognition.stop(); } catch { this.fail("Speech recognition stopped. Hold to talk again."); }
  }
  async install() {
    if (this.disposed || !this.state.canInstall || this.state.phase === "installing") return;
    const C = this.factory(); if (!C?.install) return;
    const epoch = ++this.epoch;
    this.set({ phase: "installing", error: "", canInstall: false });
    try {
      const installed = await C.install({ langs: [this.language], processLocally: true });
      if (epoch !== this.epoch || this.disposed) return;
      if (installed) this.set({ phase: "idle", error: "" });
      else this.fail("The language pack could not be installed. You can type instead.", true);
    } catch { if (epoch === this.epoch && !this.disposed) this.fail("The language pack could not be installed. You can type instead.", true); }
  }
  cancel() { ++this.epoch; this.held = false; this.finalText = ""; this.cleanup(); this.set(initial()); }
  dispose() { this.cancel(); this.disposed = true; this.listeners.clear(); }
}
