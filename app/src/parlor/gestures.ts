import type { State } from "./machine";
import type { MicrophoneState } from "./microphone";

/** Availability is captured at press time; busy input still counts toward reset. */
export function tableInput(state: Pick<State, "phase" | "segment">, mic: Pick<MicrophoneState, "phase">, speechAvailable: boolean) {
  const blocked = ["checking", "listening", "finishing"].includes(mic.phase);
  const card = state.phase === "ready" && state.segment > 0;
  const tap = !blocked && (card || ["question", "paused", "error"].includes(state.phase));
  const hold = blocked ? undefined : state.phase === "idle" ? "summon"
    : speechAvailable && (card || state.phase === "question" || state.phase === "complete") ? "speak" : undefined;
  return { tap, hold };
}

/** A short delay separates an ordinary tap from the deliberate five-tap reset. */
export const HOLD_MS = 450;
export const TAP_GAP_MS = 500;
export const SUMMON_MS = 7000;
export interface GestureActions {
  captureTap(): (() => void) | undefined;
  captureHold?(): (() => void) | undefined;
  holdDelay?(): number;
  press?(startedAt: number): void;
  lift?(): void;
  hold(): void;
  release(): void;
  cancel(): void;
  reset(): void;
}
export class TableGestures {
  private pressed = new Set<string>();
  private holding = false;
  private engaged = false;
  private taps = 0;
  private tapAction?: () => void;
  private holdAction?: () => void;
  private holdTimer?: ReturnType<typeof setTimeout>;
  private tapTimer?: ReturnType<typeof setTimeout>;
  private epoch = 0;
  private disposed = false;
  constructor(private actions: GestureActions) {}
  owns(id: string) { return this.pressed.has(id); }
  get active() { return this.pressed.size > 0; }
  down(id: string, repeat = false) {
    if (this.disposed || repeat || this.pressed.has(id)) return;
    this.pressed.add(id);
    if (this.pressed.size !== 1) return;
    clearTimeout(this.tapTimer); this.tapTimer = undefined;
    const tapAction = this.actions.captureTap();
    if (!this.taps) this.tapAction = tapAction;
    this.holdAction = this.actions.captureHold ? this.actions.captureHold() : this.actions.hold;
    this.engaged = !!tapAction || !!this.holdAction;
    const delay = this.actions.holdDelay?.() ?? HOLD_MS;
    if (this.engaged) this.actions.press?.(performance.now());
    const epoch = this.epoch;
    this.holdTimer = setTimeout(() => {
      if (this.disposed || epoch !== this.epoch || !this.pressed.size) return;
      this.holdTimer = undefined; this.holding = true; this.taps = 0; this.tapAction = undefined;
      this.holdAction?.();
    }, delay);
  }
  up(id: string) {
    if (!this.pressed.delete(id) || this.pressed.size) return;
    clearTimeout(this.holdTimer); this.holdTimer = undefined;
    const engaged = this.engaged; this.engaged = false;
    if (engaged) this.actions.lift?.();
    if (this.holding) { this.holding = false; if (engaged) this.actions.release(); return; }
    if (++this.taps === 5) { this.clear(); this.actions.reset(); return; }
    const epoch = this.epoch;
    this.tapTimer = setTimeout(() => {
      if (this.disposed || epoch !== this.epoch || this.pressed.size) return;
      const action = this.tapAction; this.clear(); action?.();
    }, TAP_GAP_MS);
  }
  private clear() {
    ++this.epoch; clearTimeout(this.holdTimer); clearTimeout(this.tapTimer);
    this.holdTimer = this.tapTimer = undefined; this.pressed.clear();
    this.holding = this.engaged = false; this.taps = 0; this.tapAction = this.holdAction = undefined;
  }
  cancelGesture() { const engaged = this.engaged; this.clear(); if (engaged) this.actions.cancel(); }
  cancel() { this.clear(); this.actions.cancel(); }
  dispose() { this.cancel(); this.disposed = true; }
}

/** Guest shortcuts exist only while the encounter is mounted, never in operator inputs. */
export function tableKey(event: Pick<KeyboardEvent, 'key' | 'code' | 'isComposing' | 'metaKey' | 'ctrlKey' | 'altKey'>, target: EventTarget | null): string | undefined {
  if (event.isComposing || event.metaKey || event.ctrlKey || event.altKey
    || ['Escape', 'Tab', 'Shift', 'Control', 'Alt', 'Meta', 'AltGraph', 'CapsLock', 'Dead', 'Process', 'Unidentified'].includes(event.key)) return;
  const element = target as Element | null;
  if (element?.closest?.('input, textarea, select, [contenteditable]:not([contenteditable="false"]), [data-parlor-operator]')) return;
  return `key:${event.code || event.key}`;
}
