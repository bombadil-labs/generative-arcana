/** Provider timestamps, never an estimated reading speed, drive the visible transcript. */
export interface SpeechAlignment {
  characters: string[];
  character_start_times_seconds: number[];
  character_end_times_seconds: number[];
}
export type CaptionTiming = "aligned" | "segment" | "silent";
// Small documented v3 delivery vocabulary; never forward arbitrary stage directions.
const DELIVERY_TAGS = new Set(["sighs", "exhales", "curious", "sarcastic", "mischievously"]);
const tagPattern = /\[[^\]]*(?:\]|$)/g;
export function plainSpeech(text: string): string { return text.replace(tagPattern, "").replace(/[ \t]{2,}/g, " ").trim(); }
export function speechPayload(text: string): string {
  const tag = [...text.matchAll(/\[([^\]]+)\]/g)].map(match => match[1].trim().toLowerCase()).find(value => DELIVERY_TAGS.has(value));
  const plain = plainSpeech(text);
  return tag && plain ? `[${tag}] ${plain}` : plain;
}
/** Remove annotation spans from the FULL alignment before revealing any prefix. Keep
 * the provider's times for every remaining character/chunk, including normalized words. */
export function captionAlignment(alignment: SpeechAlignment): SpeechAlignment {
  const text = alignment.characters.join("");
  const hidden = new Uint8Array(text.length);
  for (const match of text.matchAll(tagPattern)) hidden.fill(1, match.index, match.index + match[0].length);
  const result: SpeechAlignment = { characters: [], character_start_times_seconds: [], character_end_times_seconds: [] };
  let offset = 0;
  alignment.characters.forEach((chunk, i) => {
    const visible = [...chunk].filter(character => { const keep = !hidden[offset]; offset += character.length; return keep; }).join("");
    if (visible) { result.characters.push(visible); result.character_start_times_seconds.push(alignment.character_start_times_seconds[i]); result.character_end_times_seconds.push(alignment.character_end_times_seconds[i]); }
  });
  return result;
}
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
  return alignment.characters.slice(0, count).join("").trimStart();
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
