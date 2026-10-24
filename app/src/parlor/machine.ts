import { arcanaEngine } from "../engine/ArcanaEngine";
import type { ArcanaReading } from "../engine/types";
import { converse, narrate, speak, introduce, ParlorError, type Narration, type Turn } from "./providers";
import { openingGreeting, QUESTION_INVITATION } from './opening';
import { useOwnerEleven, type Settings } from "./settings";
import { plainSpeech, type CaptionTiming } from "./speech";
import { OwnerRequestError } from "./hosted";
import { PresentationPause } from "./pause";
import type { TranscriptInput, TranscriptSink } from "./runtimeTranscript";

export type Phase = "idle" | "summoning" | "calling" | "awaiting-release" | "question" | "confirm" | "drawing" | "generating" | "ready" | "speaking" | "paused" | "error" | "complete" | "conversation";
export interface State {
  phase: Phase; question: string; reading?: ArcanaReading; narration?: Narration;
  revealed: number; segment: number; caption: string; timing: CaptionTiming;
  error: string; turns: Turn[]; pendingQuestion: string; userText: string;
  summonStartedAt?: number; audioPlaying?: boolean;
  guideOpen?: boolean;
  opening?: boolean;
}
const initial = (): State => ({ phase: "idle", question: "", revealed: 0, segment: 0, caption: "", timing: "aligned", error: "", turns: [], pendingQuestion: "", userText: "" });
export interface Services {
  transcript?: TranscriptSink;
  vocalization?(edge: 'lock' | 'loss'): void;
  draw(deckId: string, question: string): Promise<ArcanaReading>;
  narrate: typeof narrate; converse: typeof converse; speak: typeof speak; introduce: typeof introduce;
  preload(reading: ArcanaReading): Promise<void>;
  readSilently(text: string, signal: AbortSignal, show: (page: string) => void, pause?: PresentationPause): Promise<void>;
}
const services: Services = { draw: (id, question) => arcanaEngine.castReading(id, "three-card", question), narrate, converse, speak, introduce, preload: async () => {}, readSilently: async () => { throw new ParlorError("Silent reading is unavailable. Return to setup and retry."); } };
type Speech = { kind: "release" | "greeting" | "invitation" | "introduction" | "card" | "answer"; text: string; segment: number; turns?: Turn[]; silent?: boolean; messageId?: string; offeredQuestion?: string };

/** A synchronous transition gate plus an epoch fence: even late responses after abort are inert. */
export class ParlorMachine {
  private state = initial();
  private listeners = new Set<() => void>();
  private epoch = 0;
  private controller?: AbortController;
  private timer?: ReturnType<typeof setTimeout>;
  private drawPromise?: Promise<ArcanaReading>;
  private speech?: Speech;
  private summonReleased = false;
  private disposed = false;
  private service: Services;
  private narrationIds: string[] = [];
  private introductionInput = '';
  private presentation?: { messageId: string; attemptId: string; stage: TranscriptInput['stage']; text?: string; timing: TranscriptInput['timing']; checkpoint: number };
  readonly presentationPause = new PresentationPause();
  constructor(private deckId: string, private settings: Settings, overrides: Partial<Services> = {}) { this.service = { ...services, ...overrides }; }
  subscribe = (listener: () => void) => { this.listeners.add(listener); return () => { this.listeners.delete(listener); }; };
  getSnapshot = () => this.state;
  canReadWithoutAudio = () => !!this.speech;
  openGuide() { if (!this.disposed && !this.state.guideOpen) { this.presentationPause.set(true); this.set({ guideOpen: true, audioPlaying: false }); } }
  closeGuide() { if (this.state.guideOpen) { this.set({ guideOpen: false }); this.presentationPause.set(false); } }
  private set(patch: Partial<State>) { if (!this.disposed) { this.state = { ...this.state, ...patch }; this.listeners.forEach(listener => listener()); } }
  private log(value: TranscriptInput) { try { this.service.transcript?.event(value); } catch { /* Diagnostics never alter the encounter. */ } }
  private generated(text: string, stage: TranscriptInput['stage'], card?: string, scripted = false) {
    const messageId = crypto.randomUUID();
    this.log({ kind:'assistant_generated', text:plainSpeech(text), messageId, stage, ...(card?{card}:{}), provider:scripted?'script':this.settings.provider, ...(scripted?{}:{model:this.settings.provider==='anthropic'?this.settings.anthropicModel:this.settings.openaiModel}) });
    return messageId;
  }
  private finishPresentation(kind: 'presentation_completed' | 'presentation_interrupted', reason?: TranscriptInput['reason']) {
    const active = this.presentation; this.presentation = undefined;
    if (active) { const {checkpoint:_,...record}=active; this.log({kind,...record,...(reason?{reason}:{})}); }
  }
  private invalidate(reason: TranscriptInput['reason'] = 'cancelled') { this.finishPresentation('presentation_interrupted',reason); ++this.epoch; clearTimeout(this.timer); this.timer = undefined; this.controller?.abort(); this.controller = undefined; }
  private async run(work: (signal: AbortSignal, current: () => boolean) => Promise<void>) {
    this.invalidate();
    const epoch = this.epoch;
    const controller = new AbortController(); this.controller = controller;
    const current = () => !this.disposed && epoch === this.epoch && !controller.signal.aborted;
    let remaining = 180000, started = performance.now();
    const timeout = () => {
      if (current()) { this.invalidate('timeout'); this.log({kind:'error',reason:'timeout'}); this.set({ phase: "error", audioPlaying: false, error: "This step timed out. Retry, or choose Read without audio." }); }
    };
    const arm = () => { started = performance.now(); this.timer = setTimeout(timeout, remaining); };
    if (!this.presentationPause.paused) arm();
    const unsubscribe = this.presentationPause.subscribe(paused => {
      if (!current() || (this.state.timing === "silent" && ["speaking", "calling"].includes(this.state.phase))) return;
      if (paused) { remaining = Math.max(0, remaining - (performance.now() - started)); clearTimeout(this.timer); this.timer = undefined; }
      else arm();
    });
    try { if (this.presentationPause.paused) await this.presentationPause.wait(controller.signal); if (current()) await work(controller.signal, current); }
    catch (error) { await this.presentationPause.wait(controller.signal).catch(() => {}); if (current()) { this.invalidate('failed'); this.log({kind:'error',reason:'failed'}); this.set({ phase: "error", audioPlaying: false, error: error instanceof ParlorError || error instanceof OwnerRequestError ? error.message : "This step could not finish. Retry or leave the table." }); } }
    finally { unsubscribe(); if (epoch === this.epoch) { clearTimeout(this.timer); this.controller = undefined; this.timer = undefined; } }
  }
  begin() {
    if (this.state.guideOpen) return;
    if (!["idle", "awaiting-release"].includes(this.state.phase) || this.disposed) return;
    this.speech = { kind: "greeting", segment: 0, text: this.settings.hosted ? QUESTION_INVITATION : openingGreeting(this.settings) };
    void this.playSpeech(false);
  }
  summon(startedAt = performance.now()) { if (!this.state.guideOpen && this.state.phase === "idle") { this.summonReleased = false; this.set({ phase: "summoning", summonStartedAt: startedAt }); } }
  contact() {
    if (this.state.guideOpen) return;
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
  question(value: string) { if (!this.state.guideOpen && this.state.phase === "question") this.set({ question: value.slice(0, 1200) }); }
  review() { if (!this.state.guideOpen && this.state.phase === "question" && this.state.question.trim()) this.set({ phase: "confirm", question: this.state.question.trim() }); }
  edit() { if (!this.state.guideOpen && this.state.phase === "confirm") this.set({ phase: "question" }); }
  submit(text: string) {
    if (this.state.guideOpen) return;
    const value = text.trim();
    if (!value || value.length > 1200) return;
    if (this.state.phase === "question" && this.state.opening) {
      this.introductionInput = value;
      this.log({kind:'user_input',text:value,stage:'greeting'});
      this.set({userText:value,caption:''}); void this.introduceGuest();
    }
    else if (this.state.phase === "question") { this.question(value); this.review(); this.confirm(); }
    else this.ask(value);
  }
  confirm() {
    if (this.state.guideOpen) return;
    if (this.state.phase !== "confirm") return;
    this.set({ phase: "drawing", opening: false, userText: this.state.question, caption: "" });
    const question = this.state.question;
    if (question) this.log({kind:'user_input',text:question,stage:'reading'});
    this.drawPromise = Promise.resolve().then(() => this.service.draw(this.deckId, question));
    void this.prepare();
  }
  private prepare() {
    this.set({ phase: this.state.reading ? "generating" : "drawing", error: "" });
    return this.run(async (signal, current) => {
      const reading = this.state.reading ?? await this.drawPromise!;
      await this.presentationPause.wait(signal);
      if (!current()) return;
      this.set({ reading, phase: "generating" });
      const narration = await this.service.narrate(this.settings, reading, signal, this.state.turns);
      if (!current()) return;
      this.narrationIds = narration.cards.map((card,i)=>this.generated(card.text,'card',reading.placements[i]?.card.slug));
      this.narrationIds.push(this.generated(narration.synthesis,'synthesis'));
      await this.presentationPause.wait(signal);
      if (!current()) return;
      await this.service.preload(reading);
      await this.presentationPause.wait(signal);
      if (current()) this.set({ narration, phase: "ready" });
    });
  }
  cancel() {
    this.cancelSummon();
    if (!["drawing", "generating", "speaking", "conversation"].includes(this.state.phase)) return;
    this.invalidate(); this.set({ phase: "paused", audioPlaying: false, error: "" });
  }
  retry(muted = false) {
    if (this.state.guideOpen) return;
    if (!["paused", "error"].includes(this.state.phase)) return;
    if (this.speech) { void this.playSpeech(muted); return; }
    if (this.introductionInput) { void this.introduceGuest(); return; }
    if (this.state.pendingQuestion) { void this.answer(); return; }
    if (this.drawPromise) void this.prepare();
  }
  next(muted = false) {
    if (this.state.guideOpen) return;
    if (this.state.phase !== "ready" || !this.state.narration || this.state.segment > 3) return;
    const segment = this.state.segment;
    this.speech = { kind: "card", segment, text: segment < 3 ? this.state.narration.cards[segment].text : this.state.narration.synthesis, messageId:this.narrationIds[segment] };
    void this.playSpeech(muted);
  }
  advance() {
    if (this.state.guideOpen) return;
    if (this.state.phase === "question" && this.state.opening) {
      this.speech = {kind:'invitation',segment:0,text:QUESTION_INVITATION}; void this.playSpeech(false);
    }
    else if (this.state.phase === "question") { this.set({ phase: "confirm" }); this.confirm(); }
    else if (this.state.phase === "paused" || this.state.phase === "error") this.retry();
    else this.next();
  }
  private playSpeech(muted: boolean) {
    const speech = this.speech!;
    this.set({ phase: speech.kind === "release" ? "calling" : "speaking", audioPlaying: false, caption: "", error: "", timing: "aligned" });
    return this.run(async (signal, current) => {
      const stage = speech.kind==='card' ? speech.segment===3?'synthesis':'card' : speech.kind==='introduction'||speech.kind==='invitation'?'greeting':speech.kind;
      speech.messageId ??= this.generated(speech.text,stage,undefined,true);
      this.presentation = {messageId:speech.messageId,attemptId:crypto.randomUUID(),stage,timing:'unknown',checkpoint:0};
      this.log({kind:'presentation_started',messageId:speech.messageId,attemptId:this.presentation.attemptId,stage,timing:'unknown'});
      const reveal = () => { if (current() && !this.presentationPause.paused && speech.kind === "card") this.set({ revealed: Math.max(this.state.revealed, Math.min(speech.segment + 1, 3)) }); };
      const caption = (text: string, timing: CaptionTiming) => { if (current() && !this.presentationPause.paused) {
        this.set({ caption: text, timing });
        const active=this.presentation;
        if(active) { const changed=active.text!==text; active.text=text; active.timing=timing;
          if(changed && text && (timing==='silent'||Date.now()-active.checkpoint>=5000)) { active.checkpoint=Date.now(); const {checkpoint:_,...record}=active; this.log({kind:'presentation_progress',...record}); }
        }
      } };
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
        await this.service.readSilently(plainSpeech(speech.text), signal, page => caption(page, "silent"), this.presentationPause);
      } else await this.service.speak(this.settings, speech.text, signal, () => { if (current() && !this.presentationPause.paused) { this.set({ audioPlaying: true }); reveal(); } }, this.state.reading, caption, () => { if (current()) this.set({ audioPlaying: false }); }, this.presentationPause, edge => { if (current() && !this.presentationPause.paused) this.service.vocalization?.(edge); });
      await this.presentationPause.wait(signal);
      if (!current()) return;
      this.finishPresentation('presentation_completed');
      this.speech = undefined;
      this.set({ audioPlaying: false });
      if (speech.kind === "release") { this.set({ phase: "awaiting-release" }); if (this.summonReleased) this.begin(); }
      else if (speech.kind === "greeting") this.set({ phase: "question", opening: !this.settings.hosted });
      else if (speech.kind === "invitation") this.set({ phase: "question", opening: false });
      else if (speech.kind === "introduction") {
        this.introductionInput = '';
        this.set({phase:'question',opening:false,question:speech.offeredQuestion??'',turns:speech.turns!});
      }
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
  captions() { if (!this.state.guideOpen && this.speech && ["speaking", "calling", "paused", "error"].includes(this.state.phase)) void this.playSpeech(true); }
  private introduceGuest() {
    const input = this.introductionInput;
    this.set({phase:'conversation',error:''});
    return this.run(async (signal, current) => {
      const reply = await this.service.introduce(this.settings, this.deckId, input, signal);
      if (!current()) return;
      const messageId = this.generated(reply.text,'greeting');
      await this.presentationPause.wait(signal);
      if (!current()) return;
      this.speech = {kind:'introduction',segment:0,text:reply.text,messageId,offeredQuestion:reply.hasQuestion?input:'',turns:[{role:'user',content:input},{role:'assistant',content:plainSpeech(reply.text)}]};
      void this.playSpeech(false);
    });
  }
  ask(question: string) {
    if (this.state.guideOpen) return;
    if (!(this.state.phase === "complete" || (this.state.phase === "ready" && this.state.segment > 0)) || !question.trim() || question.length > 1200) return;
    this.log({kind:'user_input',text:question.trim(),stage:'answer'});
    this.set({ pendingQuestion: question.trim(), userText: question.trim(), caption: "" }); void this.answer();
  }
  private answer() {
    // Bound request history while permitting repeated discussion at every card.
    const turns: Turn[] = [...this.state.turns.slice(-18), { role: "user", content: this.state.pendingQuestion }];
    this.set({ phase: "conversation", error: "" });
    return this.run(async (signal, current) => {
      const content = await this.service.converse(this.settings, this.state.reading!, turns, signal, this.state.revealed);
      if (!current()) return;
      const messageId=this.generated(content,'answer');
      await this.presentationPause.wait(signal);
      if (!current()) return;
      this.speech = { kind: "answer", segment: this.state.segment, text: content, messageId, turns: [...turns, { role: "assistant", content: plainSpeech(content) }] };
      // Keep the generated answer for audio retry without another model call.
      void this.playSpeech(false);
    });
  }
  reset() { this.invalidate('reset'); try { this.service.transcript?.reset(); } catch { /* Reset must remain unconditional. */ } this.narrationIds=[]; this.introductionInput=""; this.presentationPause.set(false); this.drawPromise = undefined; this.speech = undefined; this.summonReleased = false; this.state = initial(); this.listeners.forEach(listener => listener()); }
  dispose() { try { this.service.transcript?.dispose(); } catch { /* Teardown must remain unconditional. */ } this.reset(); this.disposed = true; this.settings = { ...this.settings, anthropicKey: "", openaiKey: "", elevenKey: "" }; this.listeners.clear(); }
}
