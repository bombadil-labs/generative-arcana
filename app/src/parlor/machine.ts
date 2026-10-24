import { arcanaEngine } from "../engine/ArcanaEngine";
import type { ArcanaReading } from "../engine/types";
import { converse, narrate, speak, ParlorError, type Narration, type Turn } from "./providers";
import { characters, useOwnerEleven, type Settings } from "./settings";
import { plainSpeech, type CaptionTiming } from "./speech";
import { OwnerRequestError } from "./hosted";
import { noVision, optionalVision, type VisionInput } from './vision';

export type Phase = "idle" | "summoning" | "calling" | "awaiting-release" | "question" | "confirm" | "drawing" | "generating" | "ready" | "speaking" | "paused" | "error" | "complete" | "conversation";
export interface State {
  phase: Phase; question: string; reading?: ArcanaReading; narration?: Narration;
  revealed: number; segment: number; caption: string; timing: CaptionTiming;
  error: string; turns: Turn[]; pendingQuestion: string; userText: string;
  summonStartedAt?: number; audioPlaying?: boolean;
}
const initial = (): State => ({ phase: "idle", question: "", revealed: 0, segment: 0, caption: "", timing: "aligned", error: "", turns: [], pendingQuestion: "", userText: "" });
export interface Services {
  draw(deckId: string, question: string): Promise<ArcanaReading>;
  narrate: typeof narrate; converse: typeof converse; speak: typeof speak;
  preload(reading: ArcanaReading, segment: number): Promise<void>;
  vision(settings: Settings, reading: ArcanaReading, revealed: number, signal: AbortSignal, segment?: number): Promise<VisionInput>;
  clearVision(): void;
  readSilently(text: string, signal: AbortSignal, show: (page: string) => void): Promise<void>;
}
const services: Services = { draw: (id, question) => arcanaEngine.castReading(id, "three-card", question), narrate, converse, speak, preload: async () => {}, vision: async () => noVision(), clearVision: () => {}, readSilently: async () => { throw new ParlorError("Silent reading is unavailable. Return to setup and retry."); } };
type Speech = { kind: "release" | "greeting" | "card" | "answer"; text: string; segment: number; turns?: Turn[]; silent?: boolean };

/** A synchronous transition gate plus an epoch fence: even late responses after abort are inert. */
export class ParlorMachine {
  private state = initial();
  private listeners = new Set<() => void>();
  private epoch = 0;
  private controller?: AbortController;
  private timer?: ReturnType<typeof setTimeout>;
  private drawPromise?: Promise<ArcanaReading>;
  private speech?: Speech;
  private preparedAdvance = false;
  private preparedMuted = false;
  private summonReleased = false;
  private disposed = false;
  private service: Services;
  constructor(private deckId: string, private settings: Settings, overrides: Partial<Services> = {}) { this.service = { ...services, ...overrides }; }
  subscribe = (listener: () => void) => { this.listeners.add(listener); return () => { this.listeners.delete(listener); }; };
  getSnapshot = () => this.state;
  canReadWithoutAudio = () => !!this.speech;
  private set(patch: Partial<State>) { if (!this.disposed) { this.state = { ...this.state, ...patch }; this.listeners.forEach(listener => listener()); } }
  private invalidate() { ++this.epoch; clearTimeout(this.timer); this.timer = undefined; this.controller?.abort(); this.controller = undefined; }
  private async run(work: (signal: AbortSignal, current: () => boolean) => Promise<void>) {
    this.invalidate();
    const epoch = this.epoch;
    const controller = new AbortController(); this.controller = controller;
    const current = () => !this.disposed && epoch === this.epoch && !controller.signal.aborted;
    const timer = setTimeout(() => {
      if (current()) { this.invalidate(); this.set({ phase: "error", audioPlaying: false, error: "This step timed out. Retry, or choose Read without audio." }); }
    }, 180000);
    this.timer = timer;
    try { await work(controller.signal, current); }
    catch (error) { if (current()) { this.invalidate(); this.set({ phase: "error", audioPlaying: false, error: error instanceof ParlorError || error instanceof OwnerRequestError ? error.message : "This step could not finish. Retry or leave the table." }); } }
    finally { clearTimeout(timer); if (epoch === this.epoch) { this.controller = undefined; this.timer = undefined; } }
  }
  begin() {
    if (!["idle", "awaiting-release"].includes(this.state.phase) || this.disposed) return;
    this.speech = { kind: "greeting", segment: 0, text: characters[this.settings.character].greeting };
    void this.playSpeech(false);
  }
  summon(startedAt = performance.now()) { if (this.state.phase === "idle") { this.summonReleased = false; this.set({ phase: "summoning", summonStartedAt: startedAt }); } }
  contact() {
    if (this.state.phase !== "summoning") return;
    this.speech = { kind: "release", segment: 0, text: this.settings.character === "keeper" ? "[exhales] Yes... the signal holds. Something stirs in the ether." : "The signal holds. Something stirs in the ether." };
    void this.playSpeech(false);
  }
  releaseSummon() {
    if (this.state.phase === "summoning") this.reset();
    else if (this.state.phase === "awaiting-release") this.begin();
    else if (this.speech?.kind === "release") this.summonReleased = true;
  }
  cancelSummon() {
    if (["summoning", "calling", "awaiting-release"].includes(this.state.phase) || this.speech?.kind === "release") this.reset();
  }
  question(value: string) { if (this.state.phase === "question") this.set({ question: value.slice(0, 1200) }); }
  review() { if (this.state.phase === "question" && this.state.question.trim()) this.set({ phase: "confirm", question: this.state.question.trim() }); }
  edit() { if (this.state.phase === "confirm") this.set({ phase: "question" }); }
  submit(text: string) {
    const value = text.trim();
    if (!value || value.length > 1200) return;
    if (this.state.phase === "question") { this.question(value); this.review(); this.confirm(); }
    else this.ask(value);
  }
  confirm() {
    if (this.state.phase !== "confirm") return;
    this.set({ phase: "drawing", userText: this.state.question, caption: "" });
    const question = this.state.question;
    this.drawPromise = Promise.resolve().then(() => this.service.draw(this.deckId, question));
    void this.prepare();
  }
  private prepare(advance = this.preparedAdvance, muted = this.preparedMuted) {
    this.preparedAdvance = advance; this.preparedMuted = muted;
    const segment = this.state.segment;
    this.set({ phase: this.state.reading ? "generating" : "drawing", error: "" });
    return this.run(async (signal, current) => {
      const reading = this.state.reading ?? await this.drawPromise!;
      if (!current()) return;
      this.set({ reading, phase: "generating" });
      await optionalVision(() => this.service.preload(reading, segment), signal, undefined);
      if (!current()) return;
      const vision = await this.service.vision(this.settings, reading, this.state.revealed, signal, segment);
      if (!current()) return;
      const result = await this.service.narrate(this.settings, reading, signal, segment, this.state.turns, vision);
      if (!current()) return;
      // Only the requested segment enters state, even if a legacy service supplies more.
      const narration = this.state.narration ?? { cards: reading.placements.map(p => ({ slug: p.card.slug, text: '' })), synthesis: '' };
      const text = segment < 3 ? result.cards[segment]?.text : result.synthesis;
      if (!text?.trim()) throw new ParlorError('The reader returned an incomplete vision. Retry with the same cards.');
      const next = { cards: narration.cards.map((card, index) => index === segment ? { ...card, text } : card), synthesis: segment === 3 ? text : narration.synthesis };
      this.preparedAdvance = false; this.preparedMuted = false;
      if (advance) {
        this.set({ narration: next });
        if (!current()) return;
        this.speech = { kind: 'card', segment, text };
        void this.playSpeech(muted);
      } else this.set({ narration: next, phase: "ready" });
    });
  }
  cancel() {
    this.cancelSummon();
    if (!["drawing", "generating", "speaking", "conversation"].includes(this.state.phase)) return;
    this.invalidate(); this.set({ phase: "paused", audioPlaying: false, error: "" });
  }
  retry(muted = false) {
    if (!["paused", "error"].includes(this.state.phase)) return;
    if (this.speech) { void this.playSpeech(muted); return; }
    if (this.state.pendingQuestion) { void this.answer(); return; }
    if (this.drawPromise) void this.prepare();
  }
  next(muted = false) {
    if (this.state.phase !== "ready" || !this.state.narration || this.state.segment > 3) return;
    const segment = this.state.segment;
    const text = segment < 3 ? this.state.narration.cards[segment].text : this.state.narration.synthesis;
    if (!text) { void this.prepare(true, muted); return; }
    this.speech = { kind: "card", segment, text };
    void this.playSpeech(muted);
  }
  advance() {
    if (this.state.phase === "question") { this.set({ phase: "confirm", question: "" }); this.confirm(); }
    else if (this.state.phase === "paused" || this.state.phase === "error") this.retry();
    else this.next();
  }
  private playSpeech(muted: boolean) {
    const speech = this.speech!;
    this.set({ phase: speech.kind === "release" ? "calling" : "speaking", audioPlaying: false, caption: "", error: "", timing: "aligned" });
    return this.run(async (signal, current) => {
      const reveal = () => { if (current() && speech.kind === "card") this.set({ revealed: Math.max(this.state.revealed, Math.min(speech.segment + 1, 3)) }); };
      const caption = (text: string, timing: CaptionTiming) => { if (current()) this.set({ caption: text, timing }); };
      // Hosted speech requires a drawn reading token. Its opening stays explicitly silent.
      const voice = this.settings.hosted ? !!this.state.reading && !!this.settings.voiceId : !!this.settings.elevenKey.trim() || useOwnerEleven(this.settings) && !!this.settings.voiceId.trim();
      if (!muted && !speech.silent && !this.settings.silent && !voice && useOwnerEleven(this.settings)) {
        throw new ParlorError("Select an ElevenLabs voice in setup, or explicitly choose Read without audio.");
      }
      if (muted || speech.silent || this.settings.silent || !voice) {
        speech.silent = true; reveal(); this.set({ timing: "silent" });
        // Reading is user-facing delivery, not a provider wait. Long passages must
        // not hit the remote-request timeout before their last page can be read.
        clearTimeout(this.timer); this.timer = undefined;
        await this.service.readSilently(plainSpeech(speech.text), signal, page => caption(page, "silent"));
      } else await this.service.speak(this.settings, speech.text, signal, () => { if (current()) { this.set({ audioPlaying: true }); reveal(); } }, this.state.reading, caption, () => { if (current()) this.set({ audioPlaying: false }); });
      if (!current()) return;
      this.speech = undefined;
      this.set({ audioPlaying: false });
      if (speech.kind === "release") { this.set({ phase: "awaiting-release" }); if (this.summonReleased) this.begin(); }
      else if (speech.kind === "greeting") this.set({ phase: "question" });
      else if (speech.kind === "card") {
        // Record only completed delivery, not the pre-generated reading. Keep a user/assistant
        // pair for provider compatibility and preserve recent discussion across card advances.
        const turns: Turn[] = [...this.state.turns.slice(-18),
          { role: "user", content: speech.segment === 3 ? "The spirit is bringing the visions together." : `The spirit has described vision ${speech.segment + 1}.` },
          { role: "assistant", content: plainSpeech(speech.text) }];
        this.set({ phase: speech.segment === 3 ? "complete" : "ready", segment: speech.segment + 1, turns });
      }
      else this.set({ phase: this.state.segment > 3 ? "complete" : "ready", pendingQuestion: "", turns: speech.turns! });
    });
  }
  captions() { if (this.speech && ["speaking", "calling", "paused", "error"].includes(this.state.phase)) void this.playSpeech(true); }
  ask(question: string) {
    if (!(this.state.phase === "complete" || (this.state.phase === "ready" && this.state.segment > 0)) || !question.trim() || question.length > 1200) return;
    this.set({ pendingQuestion: question.trim(), userText: question.trim(), caption: "" }); void this.answer();
  }
  private answer() {
    // Bound request history while permitting repeated discussion at every card.
    const turns: Turn[] = [...this.state.turns.slice(-18), { role: "user", content: this.state.pendingQuestion }];
    this.set({ phase: "conversation", error: "" });
    return this.run(async (signal, current) => {
      const vision = await this.service.vision(this.settings, this.state.reading!, this.state.revealed, signal);
      if (!current()) return;
      const content = await this.service.converse(this.settings, this.state.reading!, turns, signal, this.state.revealed, vision);
      if (!current()) return;
      this.speech = { kind: "answer", segment: this.state.segment, text: content, turns: [...turns, { role: "assistant", content: plainSpeech(content) }] };
      // Keep the generated answer for audio retry without another model call.
      void this.playSpeech(false);
    });
  }
  reset() { this.invalidate(); this.service.clearVision(); this.preparedAdvance = this.preparedMuted = false; this.drawPromise = undefined; this.speech = undefined; this.summonReleased = false; this.state = initial(); this.listeners.forEach(listener => listener()); }
  dispose() { this.reset(); this.disposed = true; this.settings = { ...this.settings, anthropicKey: "", openaiKey: "", elevenKey: "" }; this.listeners.clear(); }
}
