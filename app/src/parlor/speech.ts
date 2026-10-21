/** Provider timestamps, never an estimated reading speed, drive the visible transcript. */
export interface SpeechAlignment {
  characters: string[];
  character_start_times_seconds: number[];
  character_end_times_seconds: number[];
}
export type CaptionTiming = "aligned" | "segment" | "silent";
export function parseAlignment(value: unknown): SpeechAlignment | undefined {
  if (!value || typeof value !== "object") return;
  const a = value as SpeechAlignment;
  if (!Array.isArray(a.characters) || !a.characters.length || a.characters.length > 16000
    || a.characters.some(c => typeof c !== "string" || !c.length || c.length > 16)
    || !Array.isArray(a.character_start_times_seconds) || !Array.isArray(a.character_end_times_seconds)
    || a.characters.length !== a.character_start_times_seconds.length || a.characters.length !== a.character_end_times_seconds.length) return;
  for (let i = 0; i < a.characters.length; i++) {
    const start = a.character_start_times_seconds[i], end = a.character_end_times_seconds[i];
    if (!Number.isFinite(start) || !Number.isFinite(end) || start < 0 || end < start || end > 900
      || (i > 0 && (start < a.character_start_times_seconds[i - 1] || end < a.character_end_times_seconds[i - 1]))) return;
  }
  return a;
}
export function spokenCaption(alignment: SpeechAlignment, seconds: number): string {
  if (!Number.isFinite(seconds) || seconds < 0) return "";
  let count = 0;
  while (count < alignment.characters.length && alignment.character_end_times_seconds[count] <= seconds) count++;
  return alignment.characters.slice(0, count).join("");
}

/** Bound allocation before JSON/base64 decoding. Do not accept an unbounded provider body. */
export async function boundedSpeechBody(response: Response, limit = 12_000_000): Promise<Uint8Array> {
  if (!response.ok || !response.body) { await response.body?.cancel(); throw new Error("Invalid speech response"); }
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = []; let size = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.length;
      if (size > limit) throw new Error("Speech response too large");
      chunks.push(value);
    }
  } finally { await reader.cancel().catch(() => {}); reader.releaseLock(); }
  const result = new Uint8Array(size); let offset = 0;
  for (const chunk of chunks) { result.set(chunk, offset); offset += chunk.length; }
  return result;
}
