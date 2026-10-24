import type { State } from "./machine";
import type { MicrophoneState } from "./microphone";

export interface GuestCue { title: string; instruction?: string; attention?: boolean }
export const IDLE_INVITATION = "Press and hold the button to make contact with the beyond";
export const LOADING_CUE = "Please wait a moment, dialing in the etheric connection";

/** Describe the current gesture gate, never a hoped-for next state or provider ETA. */
export function guestCue(state: Pick<State, "phase" | "segment" | "audioPlaying"> & Partial<Pick<State, "timing">>, mic: MicrophoneState, speechAvailable = true): GuestCue {
  if (state.phase === "idle") return { title: IDLE_INVITATION };
  if (state.phase === "summoning") return { title: "Keep holding.", instruction: "The signal is gathering." };
  if (state.phase === "calling") return { title: "Keep holding.", instruction: state.audioPlaying ? "Contact is forming." : LOADING_CUE };
  if (state.phase === "awaiting-release") return { title: "Release the button." };
  if (state.phase === "error") return { title: "The signal was interrupted.", instruction: "Press once to retry. Escape opens setup.", attention: true };
  if (state.phase === "paused") return { title: "The reading is paused.", instruction: "Press once to resume." };
  if (mic.phase === "checking") return { title: "Keep holding.", instruction: "Opening the microphone." };
  if (mic.phase === "listening") return { title: "Speak now.", instruction: "Release to send." };
  if (mic.phase === "finishing") return { title: LOADING_CUE };
  if (state.phase === "drawing" || state.phase === "generating" || state.phase === "confirm" || (state.phase === "ready" && state.segment === 0)) return { title: LOADING_CUE };
  if (state.phase === "conversation") return { title: LOADING_CUE };
  if (state.phase === "speaking") return state.timing === "silent" ? { title: "Read along.", instruction: "The pages turn automatically." } : { title: state.audioPlaying ? "Listen." : LOADING_CUE };
  const spoken = !speechAvailable ? "" : state.phase === "question" ? "Press and hold to speak your query. "
    : state.phase === "complete" ? "Hold to ask about the reading. " : "Hold to ask more about this card. ";
  const instruction = spoken + (state.phase === "question" ? "Press once for an open reading."
    : state.phase === "complete" ? "Press five times for a new guest."
    : state.segment === 3 ? "Press once to hear the closing." : "Press once to draw the next card.");
  return mic.phase === "error"
    ? { title: "Your voice did not reach us.", instruction: `${instruction} Escape opens setup.`, attention: true }
    : { title: instruction };
}
