import { arcanaEngine } from "../engine/ArcanaEngine";
import type { ArcanaReading } from "../engine/types";
import { converse, narrate, speak, ParlorError, type Narration, type Turn } from "./providers";
import type { Settings } from "./settings";

export type Phase = "greeting" | "question" | "confirm" | "drawing" | "generating" | "ready" | "speaking" | "paused" | "error" | "complete" | "conversation";
export interface State {
  phase: Phase; question: string; reading?: ArcanaReading; narration?: Narration;
  revealed: number; segment: number; caption: string; error: string; turns: Turn[]; pendingQuestion: string;
}
const initial = (): State => ({ phase: "greeting", question: "", revealed: 0, segment: 0, caption: "", error: "", turns: [], pendingQuestion: "" });
export interface Services {
  draw(deckId: string, question: string): Promise<ArcanaReading>;
  narrate: typeof narrate; converse: typeof converse; speak: typeof speak;
  preload(reading: ArcanaReading): Promise<void>;
}
const services: Services = { draw: (id, question) => arcanaEngine.castReading(id, "three-card", question), narrate, converse, speak, preload: async () => {} };

/** A synchronous transition gate plus a generation fence. Abort alone is insufficient: mocks,
 * decode work and completed HTTP requests may still resolve after cancellation. */
export class ParlorMachine {
  private state = initial();
  private listeners = new Set<() => void>();
  private epoch = 0;
  private controller?: AbortController;
  private timer?: ReturnType<typeof setTimeout>;
  private drawPromise?: Promise<ArcanaReading>;
  private disposed = false;
  private service: Services;
  constructor(private deckId: string, private settings: Settings, overrides: Partial<Services> = {}) { this.service = { ...services, ...overrides }; }
  subscribe = (listener: () => void) => { this.listeners.add(listener); return () => { this.listeners.delete(listener); }; };
  getSnapshot = () => this.state;
  private set(patch: Partial<State>) { if (!this.disposed) { this.state = { ...this.state, ...patch }; this.listeners.forEach((listener) => listener()); } }
  private invalidate() { ++this.epoch; clearTimeout(this.timer); this.timer = undefined; this.controller?.abort(); this.controller = undefined; }
  private async run(work: (signal: AbortSignal, current: () => boolean) => Promise<void>) {
    this.invalidate();
    const epoch = this.epoch;
    const controller = new AbortController(); this.controller = controller;
    const current = () => !this.disposed && epoch === this.epoch && !controller.signal.aborted;
    const timer = setTimeout(() => {
      if (current()) { this.invalidate(); this.set({ phase: "error", error: "This step timed out. Retry, or continue with captions if the reading is ready." }); }
    }, 90000);
    this.timer = timer;
    try { await work(controller.signal, current); }
    catch (error) { if (current()) this.set({ phase: "error", error: error instanceof ParlorError ? error.message : "This step could not finish. Retry or start the next guest." }); }
    finally { clearTimeout(timer); if (epoch === this.epoch) { this.controller = undefined; this.timer = undefined; } }
  }
  begin() { if (this.state.phase === "greeting") this.set({ phase: "question" }); }
  question(value: string) { if (this.state.phase === "question") this.set({ question: value.slice(0, 1200) }); }
  review() { if (this.state.phase === "question" && this.state.question.trim()) this.set({ phase: "confirm", question: this.state.question.trim() }); }
  edit() { if (this.state.phase === "confirm") this.set({ phase: "question" }); }
  confirm() {
    if (this.state.phase !== "confirm") return;
    this.set({ phase: "drawing" });
    // Keep this promise even when interrupted. Retrying never starts a second draw.
    const question = this.state.question;
    this.drawPromise = Promise.resolve().then(() => this.service.draw(this.deckId, question));
    void this.prepare();
  }
  private prepare() {
    this.set({ phase: this.state.reading ? "generating" : "drawing", error: "" });
    return this.run(async (signal, current) => {
      const reading = this.state.reading ?? await this.drawPromise!;
      if (!current()) return;
      this.set({ reading, phase: "generating" });
      const narration = await this.service.narrate(this.settings, reading, signal);
      if (!current()) return;
      await this.service.preload(reading);
      if (current()) this.set({ narration, phase: "ready" });
    });
  }
  cancel() {
    if (!["drawing", "generating", "speaking", "conversation"].includes(this.state.phase)) return;
    this.invalidate(); this.set({ phase: "paused", error: "" });
  }
  retry(muted: boolean) {
    if (!["paused", "error"].includes(this.state.phase)) return;
    if (this.state.pendingQuestion) { void this.answer(); return; }
    if (this.state.narration) { this.set({ phase: "ready", error: "" }); this.next(muted); }
    else if (this.drawPromise) void this.prepare();
  }
  next(muted: boolean) {
    if (this.state.phase !== "ready" || !this.state.narration) return;
    const segment = this.state.segment;
    const text = segment < 3 ? this.state.narration.cards[segment].text : this.state.narration.synthesis;
    const reveal = () => this.set({ revealed: Math.max(this.state.revealed, Math.min(segment + 1, 3)), caption: text });
    const finish = () => this.set({ phase: segment === 3 ? "complete" : "ready", segment: segment + 1, error: "" });
    this.set({ phase: "speaking", error: "" });
    void this.run(async (signal, current) => {
      if (muted || !this.settings.elevenKey.trim()) {
        reveal();
        // Keep the action gated through the flip, including double clicks in captions mode.
        await new Promise<void>((resolve) => {
          const done = () => { clearTimeout(delay); signal.removeEventListener("abort", done); resolve(); };
          const delay = setTimeout(done, 950); signal.addEventListener("abort", done, { once: true });
        });
        if (current()) finish();
        return;
      }
      await this.service.speak(this.settings, text, signal, () => { if (current()) reveal(); });
      if (current()) finish();
    });
  }
  captions() {
    if (!this.state.narration || this.state.pendingQuestion || this.state.segment > 3) return;
    this.invalidate(); this.set({ phase: "ready", error: "" }); this.next(true);
  }
  ask(question: string) {
    if (this.state.phase !== "complete" || !question.trim() || question.length > 1200 || this.state.turns.length >= 20) return;
    this.set({ pendingQuestion: question.trim() }); void this.answer();
  }
  private answer() {
    const pending = this.state.pendingQuestion;
    const turns: Turn[] = [...this.state.turns, { role: "user", content: pending }];
    this.set({ phase: "conversation", error: "" });
    return this.run(async (signal, current) => {
      const content = await this.service.converse(this.settings, this.state.reading!, turns, signal);
      if (current()) this.set({ phase: "complete", caption: content, pendingQuestion: "", turns: [...turns, { role: "assistant", content }] });
    });
  }
  reset() { this.invalidate(); this.drawPromise = undefined; this.state = initial(); this.listeners.forEach((listener) => listener()); }
  dispose() { this.reset(); this.disposed = true; this.settings = { ...this.settings, anthropicKey: "", openaiKey: "", elevenKey: "" }; this.listeners.clear(); }
}
