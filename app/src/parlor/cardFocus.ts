import type { State } from "./machine";

/** Presentation only: never reveal a card or advance the encounter. A deliberate
 * advance settles the old card while the next voice loads. The existing audio
 * reveal then brings its card forward. Discussion keeps the current card. */
export function focusedCard(state: Pick<State, "phase" | "revealed" | "segment" | "pendingQuestion">): number | null {
  if (!state.revealed || state.segment > 3 || ["idle", "summoning", "calling", "awaiting-release", "question", "confirm", "drawing", "generating", "complete"].includes(state.phase)) return null;
  if (!state.pendingQuestion && ["speaking", "paused", "error"].includes(state.phase) && state.segment >= state.revealed) return null;
  return Math.min(3, state.revealed) - 1;
}
