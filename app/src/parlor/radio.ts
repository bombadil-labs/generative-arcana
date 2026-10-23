import type { State } from "./machine";
import type { MicrophoneState } from "./microphone";
import { SUMMON_MS } from "./gestures";

export type RadioMode = "quiet" | "tuning" | "searching" | "listening" | "speaking" | "contact" | "waiting" | "stopped";
export interface RadioState { mode: RadioMode; label: string }
/** Real application events only. Searching is indeterminate, never a provider ETA. */
export function radioState(state: Pick<State, "phase" | "audioPlaying">, mic: Pick<MicrophoneState, "phase">): RadioState {
  if (state.phase === "idle") return { mode: "quiet", label: "" };
  if (state.phase === "error") return { mode: "stopped", label: "Signal interrupted" };
  if (state.phase === "paused") return { mode: "stopped", label: "Transmission paused" };
  if (state.phase === "summoning") return { mode: "tuning", label: "Tuning the beyond" };
  if (mic.phase === "listening") return { mode: "listening", label: "The table is listening" };
  if (mic.phase === "checking") return { mode: "searching", label: "Opening the microphone" };
  if (mic.phase === "finishing") return { mode: "searching", label: "Deciphering your words" };
  // A recoverable microphone error must not mask a later intentional open reading.
  if (state.phase === "calling" || state.phase === "speaking") return state.audioPlaying
    ? { mode: "speaking", label: state.phase === "calling" ? "Contact established" : "The spirit speaks" }
    : { mode: "searching", label: state.phase === "calling" ? "A presence is approaching" : "Finding the voice" };
  if (state.phase === "drawing" || state.phase === "generating") return { mode: "searching", label: "The cards are gathering" };
  if (state.phase === "conversation") return { mode: "searching", label: "The spirit is considering" };
  if (state.phase === "awaiting-release") return { mode: "contact", label: "Contact established" };
  if (mic.phase === "error") return { mode: "stopped", label: "Your voice did not reach us" };
  return { mode: "waiting", label: state.phase === "complete" ? "The channel remains open" : "The spirit awaits you" };
}

/** Shares the gesture's monotonic start time and duration. Never used for remote work. */
export function summonProgress(startedAt: number, now: number): number {
  return Math.max(0, Math.min(1, (now - startedAt) / SUMMON_MS));
}
